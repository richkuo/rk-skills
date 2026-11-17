#!/usr/bin/env bash
set -uo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
REPO_ROOT=$(cd "$HERE/../.." && pwd -P)
WORKFLOW="$REPO_ROOT/.github/workflows/claude-run.yml"
OUT=${RK_PROBE_OUT:-/var/tmp/rk-review-sandbox-probe}
BASE=${RK_PROBE_BASE:-/srv/rk-review-sandbox-probe}
OPT=/opt/rk-review-sandbox-probe
PROBE_USER=${RK_PROBE_USER:-rkprobe}
SYNTH_KEY="sk-ant-rkprobe-synthetic-anthropic-0000000000"
SYNTH_TOKEN="ghs_rkprobeSyntheticJobToken0000000000000"
SYS_PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
RESULTS="$OUT/results.txt"
FAILURES=0

die() {
  echo "probe: $*" >&2
  exit 2
}

say() {
  printf '%s\n' "$*" | tee -a "$RESULTS"
}

gate() {
  if [ "$1" = pass ]; then
    say "GATE PASS $2"
  else
    say "GATE FAIL $2"
    FAILURES=$((FAILURES + 1))
  fi
}

[ "$(uname -s)" = Linux ] || die "run this on Linux"
[ "$(id -u)" = 0 ] || die "run this as root (sudo env \"PATH=\$PATH\" bash $0)"
for tool in python3 git bun curl jq runuser useradd stat find timeout; do
  command -v "$tool" >/dev/null 2>&1 || die "missing $tool"
done

rm -rf "$OUT" "$BASE" "$OPT"
mkdir -p "$OUT" "$BASE" "$OPT/steps"
chmod 755 "$BASE" "$OPT" "$OPT/steps"
: > "$RESULTS"

if ! command -v bwrap >/dev/null 2>&1 || ! command -v socat >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update -qq >/dev/null && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends bubblewrap socat >/dev/null || die "cannot install bubblewrap and socat"
  else
    die "install bubblewrap and socat first"
  fi
fi
if [ -f /proc/sys/kernel/apparmor_restrict_unprivileged_userns ]; then
  sysctl -w kernel.apparmor_restrict_unprivileged_userns=0 >/dev/null || true
fi

if ! id "$PROBE_USER" >/dev/null 2>&1; then
  useradd -m -s /bin/bash "$PROBE_USER" || die "cannot create $PROBE_USER"
fi
PROBE_UID=$(id -u "$PROBE_USER")
PROBE_HOME=$(getent passwd "$PROBE_USER" | cut -d: -f6)
export RK_PROBE_USER="$PROBE_USER"

ACTION_SHA=$(grep -oE 'anthropics/claude-code-action@[0-9a-f]{40}' "$WORKFLOW" | head -n 1 | cut -d@ -f2)
[ -n "$ACTION_SHA" ] || die "cannot read the action commit from $WORKFLOW"
RUN_TS=$(curl -fsSL "https://raw.githubusercontent.com/anthropics/claude-code-action/$ACTION_SHA/src/entrypoints/run.ts") || die "cannot fetch run.ts at $ACTION_SHA"
CC_VERSION=$(printf '%s\n' "$RUN_TS" | sed -nE 's/^[[:space:]]*const claudeCodeVersion = "([0-9][0-9.]*)";.*/\1/p' | head -n 1)
[ -n "$CC_VERSION" ] || die "cannot parse the Claude Code version from run.ts at $ACTION_SHA"

CLAUDE_HOME="$OPT/claude-home"
mkdir -p "$CLAUDE_HOME"
INSTALLED=0
for attempt in 1 2 3; do
  if HOME="$CLAUDE_HOME" CLAUDE_INSTALL_ALLOW_SUDO=1 bash -c "set -o pipefail; curl -fsSL https://claude.ai/install.sh | bash -s -- $CC_VERSION" >> "$OUT/install.log" 2>&1; then
    INSTALLED=1
    break
  fi
  echo "install attempt $attempt failed" >> "$OUT/install.log"
  sleep 5
done
if [ "$INSTALLED" != 1 ]; then
  tail -n 40 "$OUT/install.log" >&2
  die "cannot install Claude Code $CC_VERSION"
fi
CLAUDE="$CLAUDE_HOME/.local/bin/claude"
chmod -R a+rX "$OPT"
GOT_VERSION=$("$CLAUDE" --version 2>/dev/null | awk '{print $1}')
[ "$GOT_VERSION" = "$CC_VERSION" ] || die "installed Claude Code $GOT_VERSION, expected $CC_VERSION"

extract() {
  local name="$1" file="$2"
  shift 2
  bun "$HERE/extract-step.mjs" "$WORKFLOW" "$name" "$@" > "$OPT/steps/$file" || die "cannot extract $name"
  chmod 644 "$OPT/steps/$file"
}
extract "Resolve the review execution contract" contract.sh
extract "Prepare workspace ancestor stubs for the scrub sandbox" stubs.sh
extract "Select the agent home" agent_home.sh
extract "Stage the pull request under review" guard.sh 'rm -f "$GUARD_FILE" "$SETTINGS_FILE"' 'echo "guard_oid=$GUARD_OID" >> "$GITHUB_OUTPUT"'
extract "Stage the pull request under review" settings.sh 'cat > "$SETTINGS_FILE" <<EOF' 'chmod 400 "$SETTINGS_FILE"'
extract "Empty the temporary agent home" cleanup.sh

cat > "$OPT/hook.sh" <<'HOOK'
#!/usr/bin/env bash
if [ -n "${GH_TOKEN:-}${GITHUB_TOKEN:-}" ]; then
  echo "hook token=present home=${HOME:-}" >> "${RK_HOOK_LOG:-/dev/null}"
else
  echo "hook token=absent home=${HOME:-}" >> "${RK_HOOK_LOG:-/dev/null}"
fi
exit 0
HOOK
chmod 755 "$OPT/hook.sh"

say "== environment"
say "date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
say "kernel: $(uname -r)"
say "distribution: $(. /etc/os-release 2>/dev/null; echo "${PRETTY_NAME:-unknown}")"
say "bubblewrap: $(bwrap --version 2>&1 | head -n 1)"
say "apparmor_restrict_unprivileged_userns: $(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null || echo absent)"
say "action commit: $ACTION_SHA"
say "claude code: $CC_VERSION"
say "probe user: $PROBE_USER (uid $PROBE_UID)"

load_env() {
  local key value
  while IFS='=' read -r key value; do
    [ -n "$key" ] || continue
    printf -v "L_$key" '%s' "$value"
  done < "$1"
}

as_user() {
  local user="$1"
  shift
  if [ "$user" = root ]; then
    (cd "${AS_USER_DIR:-/}" && "$@")
  else
    (cd "${AS_USER_DIR:-/}" && runuser -u "$user" -- "$@")
  fi
}

run_step() {
  local user="$1" file="$2" log="$3"
  shift 3
  as_user "$user" env -i "PATH=$SYS_PATH" "$@" bash --noprofile --norc -eo pipefail "$OPT/steps/$file" > "$log" 2>&1
}

out_value() {
  grep -E "^$2=" "$1" 2>/dev/null | tail -n 1 | cut -d= -f2-
}

build_layout() {
  local name="$1" dir="$BASE/$1" home runner ws literal owner_user=root sib_runner
  mkdir -p "$dir"
  chmod 755 "$dir"
  home="$dir/home"
  case "$name" in
    L0) runner="$dir/runner" ;;
    L1) runner="$home/actions-runner" ;;
    L1r) runner="$home/runners/r1" ;;
    L1s) runner="$home/actions-runner" ;;
    L1t) runner="$dir/real-runner" ;;
    L2|L2e) runner="$dir/runner-other-uid" ;;
    L2h)
      runner="$PROBE_HOME/rk-probe-runner-L2h"
      rm -rf "$runner"
      PROBE_HOME_MODE=$(stat -c %a "$PROBE_HOME")
      chmod 755 "$PROBE_HOME"
      ;;
    L3) runner="$home/actions-runner" ;;
    L4) runner="$home/actions-runner"; owner_user="$PROBE_USER" ;;
    L4h)
      home="$PROBE_HOME"
      runner="$PROBE_HOME/actions-runner"
      owner_user="$PROBE_USER"
      rm -rf "$runner"
      ;;
  esac
  mkdir -p "$runner/bin" "$runner/externals/node/bin" "$runner/_work/_temp/rk-shared/scripts" "$runner/_work/_temp/rk-plugin-sources/rk-skills" "$runner/_work/_temp/_runner_file_commands" "$runner/_work/repo"
  if [ "$name" != L4h ]; then
    mkdir -p "$home/.ssh" "$home/.config/git" "$home/.local/bin" "$home/.claude"
    printf 'export RK=1\n' > "$home/.bashrc"
    printf 'export RK=1\n' > "$home/.profile"
    printf 'ssh-ed25519 AAAA rkprobe\n' > "$home/.ssh/authorized_keys"
    printf '[user]\n\tname = rkprobe\n' > "$home/.gitconfig"
    printf '{}\n' > "$home/.claude/settings.json"
    printf '{"claudeAiOauth":{"accessToken":"rkprobe-synthetic-real-home-credential"}}\n' > "$home/.claude/.credentials.json"
    printf '{}\n' > "$home/.claude.json"
  fi
  printf '{"agentName":"rkprobe"}\n' > "$runner/.runner"
  for f in .credentials .credentials_rsaparams .env .path config.sh run.sh; do printf 'x\n' > "$runner/$f"; done
  printf '#!/bin/sh\nexit 0\n' > "$runner/bin/Runner.Worker"
  printf 'x\n' > "$runner/externals/node/bin/node"
  printf '#!/bin/sh\nexit 0\n' > "$runner/_work/_temp/rk-shared/scripts/patch_claude_comment.sh"
  printf '{}\n' > "$runner/_work/_temp/rk-plugin-sources/rk-skills/marketplace.json"
  printf 'x\n' > "$runner/_work/_temp/_runner_file_commands/set_env_x"
  if [ "$name" = L1t ]; then
    ln -s "$runner" "$home/actions-runner"
  fi
  sib_runner=""
  if [ "$name" = L1r ]; then
    sib_runner="$home/runners/r2"
    mkdir -p "$sib_runner/bin" "$sib_runner/_work/_temp"
    printf '{"agentName":"rkprobe-r2"}\n' > "$sib_runner/.runner"
  fi
  ws="$runner/_work/repo/repo"
  git init -q --bare "$dir/origin.git"
  git init -q "$ws"
  git -C "$ws" -c user.name=rkprobe -c user.email=rk@probe.invalid commit -q --allow-empty -m base
  printf 'base\n' > "$ws/file.txt"
  git -C "$ws" add file.txt
  git -C "$ws" -c user.name=rkprobe -c user.email=rk@probe.invalid commit -q -m base-file
  git -C "$ws" branch -q base-ref
  printf 'head\n' >> "$ws/file.txt"
  git -C "$ws" -c user.name=rkprobe -c user.email=rk@probe.invalid commit -q -am head
  git -C "$ws" remote add origin "$dir/origin.git"
  git -C "$ws" push -q origin HEAD:refs/heads/main base-ref:refs/heads/base
  git -C "$ws" checkout -q --detach HEAD
  if [ "$name" = L4h ]; then
    chown -R "$PROBE_USER" "$dir" "$runner"
  else
    chmod 700 "$home"
    if [ "$owner_user" != root ]; then
      chown -R "$PROBE_USER" "$dir"
    fi
  fi
  case "$name" in
    L2|L3) chown "$PROBE_USER" "$runner" ;;
    L2e) chown "$PROBE_USER" "$runner"; mkdir -p "$runner/.claude"; chown "$PROBE_USER" "$runner/.claude" ;;
  esac
  literal="$ws"
  if [ "$name" = L1s ]; then
    ln -s "$runner" "$dir/alias-runner"
    literal="$dir/alias-runner/_work/repo/repo"
  fi
  {
    printf 'USER=%s\n' "$owner_user"
    printf 'HOME_DIR=%s\n' "$home"
    printf 'RUNNER=%s\n' "$runner"
    printf 'WS=%s\n' "$literal"
    printf 'RT=%s\n' "$runner/_work/_temp"
    printf 'ORIGIN=%s\n' "$dir/origin.git"
    printf 'SIB_RUNNER=%s\n' "$sib_runner"
  } > "$dir/layout.env"
}

layout_has_foreign_ancestor() {
  case "$1" in L2|L2e|L2h|L3) return 0 ;; esac
  return 1
}

layout_is_home_based() {
  case "$1" in L1|L1r|L1s|L1t|L3|L4|L4h) return 0 ;; esac
  return 1
}

write_commands() {
  local file="$1" kind="$2" home="$3" agent="$4" runner="$5" rt="$6" sibling="${7:-}" sib_runner="${8:-}" foreign="${9:-}" targets info
  if [ "$kind" = marker ]; then
    jq -n '["touch .rk-k5-marker; echo K5 ran"]' > "$file"
    return
  fi
  if [ "$kind" = sleep ]; then
    jq -n '["echo K9 sleeping; sleep 120"]' > "$file"
    return
  fi
  targets="$runner/bin $runner/bin/Runner.Worker $runner/externals $runner/.runner $runner/.credentials $runner/.credentials_rsaparams $runner/.env $runner/.path $rt $rt/claude-review-credential-guard.sh $rt/claude-review-settings.json $rt/rk-shared/scripts/patch_claude_comment.sh $rt/rk-plugin-sources $rt/_runner_file_commands $home/.bashrc $home/.profile $home/.ssh $home/.gitconfig $home/.git-credentials $home/.config/git/credentials $home/.claude/settings.json $home/.local/bin"
  if [ "$agent" != "$home" ]; then
    targets="$targets $agent $agent/.gitconfig $agent/.bashrc $agent/.bash_login $agent/.bunfig.toml $agent/.npmrc $agent/.claude $agent/.claude/settings.json $agent/.claude.json"
  fi
  if [ -n "$sibling" ]; then
    targets="$targets $sibling $sibling/.gitconfig $sibling/.local/bin $sibling/.claude"
  fi
  if [ -n "$foreign" ]; then
    targets="$targets $foreign"
  fi
  info="/tmp /var/tmp /dev/shm"
  [ -n "$sib_runner" ] && info="$info $sib_runner $sib_runner/bin $sib_runner/_work/_temp"
  jq -n --arg targets "$targets" --arg home "$home" --arg info "$info" '[
    "for c in \"git status --short\" \"git diff --stat refs/remotes/origin/base HEAD\" \"git fetch origin\" \"git config --local rk.probe.inside 1\"; do out=$($c 2>&1); rc=$?; b=$(printf \"%s\" \"$out\" | grep -m1 -i bwrap); echo \"K1 rc=$rc cmd=[$c] bwrap=[$b]\"; if [ $rc -ne 0 ]; then echo \"K1 err cmd=[$c] $(printf %s \"$out\" | head -c 300 | tr \"\\n\" \" \")\"; fi; done",
    "echo \"K2 env=$(env | grep -c rkprobe-synthetic-anthropic)\"; n=0; for p in /proc/[0-9]*/environ; do if grep -qa rkprobe-synthetic-anthropic \"$p\" 2>/dev/null; then n=$((n+1)); fi; done; echo \"K2 proc=$n\"",
    ("for t in " + $targets + "; do if [ -d \"$t\" ]; then f=\"$t/.rk-probe-new\"; if ( : > \"$f\" ) 2>/dev/null; then echo \"K3 WRITABLE $t\"; rm -f \"$f\"; else echo \"K3 DENIED $t\"; fi; elif [ -e \"$t\" ]; then if ( : >> \"$t\" ) 2>/dev/null; then echo \"K3 WRITABLE $t\"; else echo \"K3 DENIED $t\"; fi; else if ( : > \"$t\" ) 2>/dev/null; then echo \"K3 WRITABLE $t (created)\"; rm -f \"$t\"; else echo \"K3 DENIED $t (missing)\"; fi; fi; done"),
    ("for f in " + $home + "/.claude/.credentials.json " + $home + "/.claude.json; do if cat \"$f\" >/dev/null 2>&1; then echo \"K4 READABLE $f\"; else echo \"K4 DENIED $f\"; fi; done"),
    ("for t in " + $info + "; do f=\"$t/.rk-probe-new\"; if ( : > \"$f\" ) 2>/dev/null; then echo \"K3X WRITABLE $t\"; rm -f \"$f\"; else echo \"K3X DENIED $t\"; fi; done")
  ]' > "$file"
  if [ "$(id -u)" = 0 ]; then chmod 644 "$file"; fi
}

prepare_run() {
  local layout="$1" case_id="$2" run="$3" dir="$BASE/$1" user home ws rt real_home agent temp_home needs stub_scan parent_deny
  load_env "$dir/layout.env"
  user="$L_USER"; home="$L_HOME_DIR"; ws="$L_WS"; rt="$L_RT"
  mkdir -p "$run"
  chmod 755 "$run"
  real_home="$home"
  agent="$home"
  temp_home=""
  needs=false
  stub_scan=false
  parent_deny=false
  case "$case_id" in
    a) ;;
    b) stub_scan=true ;;
    c) needs=true; parent_deny=true; layout_has_foreign_ancestor "$layout" && stub_scan=true ;;
    d)
      : > "$run/contract.out"
      chmod 666 "$run/contract.out"
      if ! run_step "$user" contract.sh "$run/contract.log" "HOME=$home" "GITHUB_WORKSPACE=$ws" "GITHUB_OUTPUT=$run/contract.out" SCRUB=true SCRUB_SELF_HOSTED=false SCRUB_OFF_ACCEPTED=false REPO_PRIVATE=true RUNNER_ENVIRONMENT=self-hosted; then
        echo "contract step failed" > "$run/prepare.err"
        return 1
      fi
      needs=$(out_value "$run/contract.out" needs_temp_home)
      stub_scan=$(out_value "$run/contract.out" stub_scan)
      parent_deny=$(out_value "$run/contract.out" home_parent_deny)
      ;;
  esac
  if [ "$stub_scan" = true ]; then
    if ! run_step root stubs.sh "$run/stubs.log" "GITHUB_WORKSPACE=$ws"; then
      echo "stub step failed" > "$run/prepare.err"
      return 1
    fi
  fi
  : > "$run/agent_home.out"
  chmod 666 "$run/agent_home.out"
  if ! run_step "$user" agent_home.sh "$run/agent_home.log" "HOME=$home" "GITHUB_WORKSPACE=$ws" "GITHUB_OUTPUT=$run/agent_home.out" "NEEDS_TEMP_HOME=$needs" "HOME_PARENT_DENY=$parent_deny"; then
    echo "agent home step failed" > "$run/prepare.err"
    return 1
  fi
  agent=$(out_value "$run/agent_home.out" path)
  temp_home=$(out_value "$run/agent_home.out" temp)
  local sibling home_parent
  home_parent=$(out_value "$run/agent_home.out" parent)
  if [ -n "$home_parent" ]; then
    sibling=$(mktemp -d "$home_parent/home.XXXXXXXXXX")
  else
    sibling=$(mktemp -d /tmp/rk-probe-sibling.XXXXXXXXXX)
  fi
  mkdir -p "$sibling/.local/bin" "$sibling/.claude"
  printf '[user]\n\tname = sibling\n' > "$sibling/.gitconfig"
  chown -R "$user" "$sibling"
  chmod 700 "$sibling"
  local settings_temp="" settings_parent="" settings_parent_deny=false foreign
  if [ "$case_id" = d ]; then
    settings_temp="$temp_home"
    settings_parent="$home_parent"
    settings_parent_deny="$parent_deny"
  fi
  if [ "$user" = root ]; then
    foreign="$PROBE_HOME"
  else
    foreign=$(getent passwd 0 | cut -d: -f6)
  fi
  : > "$run/guard.out"
  chmod 666 "$run/guard.out"
  if ! run_step "$user" guard.sh "$run/guard.log" "GUARD_FILE=$rt/claude-review-credential-guard.sh" "SETTINGS_FILE=$rt/claude-review-settings.json" "REAL_HOME=$real_home" "AGENT_HOME=$agent" "GITHUB_OUTPUT=$run/guard.out"; then
    echo "guard generation failed" > "$run/prepare.err"
    return 1
  fi
  if ! run_step "$user" settings.sh "$run/settings.log" "GITHUB_WORKSPACE=$ws" "RUNNER_TEMP=$rt" "SETTINGS_FILE=$rt/claude-review-settings.json" "GUARD_FILE=$rt/claude-review-credential-guard.sh" "GUARD_OID=$(out_value "$run/guard.out" guard_oid)" "REAL_HOME=$real_home" "TEMP_AGENT_HOME=$settings_temp" "HOME_PARENT=$settings_parent" "HOME_PARENT_DENY=$settings_parent_deny" "GITHUB_OUTPUT=$run/settings.out"; then
    echo "settings generation failed" > "$run/prepare.err"
    return 1
  fi
  cp "$rt/claude-review-settings.json" "$run/settings.shipped.json"
  jq --arg hook "$OPT/hook.sh" '.hooks.PreToolUse[0].hooks += [{"type": "command", "command": $hook}]' "$run/settings.shipped.json" > "$run/settings.probe.json"
  chmod 644 "$run/settings.probe.json"
  {
    printf 'USER=%s\nWS=%s\nRT=%s\nREAL_HOME=%s\nAGENT=%s\nTEMP_HOME=%s\nRUNNER=%s\n' "$user" "$ws" "$rt" "$real_home" "$agent" "$temp_home" "$L_RUNNER"
    printf 'SIBLING=%s\nSIB_RUNNER=%s\nFOREIGN=%s\nPARENT=%s\n' "$sibling" "$L_SIB_RUNNER" "$foreign" "$home_parent"
  } > "$run/run.env"
}

run_claude() {
  local run="$1" mode="$2" commands="$3" extra="${4:-}" user ws rt agent port mock_pid claude_pid status scrub_env settings_args
  load_env "$run/run.env"
  user="$L_USER"; ws="$L_WS"; rt="$L_RT"; agent="$L_AGENT"
  rm -f "$run/port"
  python3 -I "$HERE/mock_messages_api.py" --port-file "$run/port" --script "$commands" --log "$run/mock.jsonl" $extra &
  mock_pid=$!
  for _ in $(seq 1 50); do [ -s "$run/port" ] && break; sleep 0.1; done
  port=$(cat "$run/port" 2>/dev/null)
  [ -n "$port" ] || { kill "$mock_pid" 2>/dev/null; echo "mock did not start" > "$run/claude.err"; return 1; }
  scrub_env="CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1"
  settings_args=(--setting-sources user --settings "$run/settings.probe.json")
  if [ "$mode" = write-route ]; then
    scrub_env="CLAUDE_CODE_SUBPROCESS_ENV_SCRUB="
    settings_args=()
  fi
  date +%s > "$run/start"
  : > "$run/hook.log"
  chmod 666 "$run/hook.log"
  touch "$run/stamp"
  (
    AS_USER_DIR="$ws" as_user "$user" env -i "PATH=$SYS_PATH" "HOME=$agent" "GITHUB_WORKSPACE=$ws" "RUNNER_TEMP=$rt" "GH_TOKEN=$SYNTH_TOKEN" "GITHUB_TOKEN=$SYNTH_TOKEN" "ANTHROPIC_API_KEY=$SYNTH_KEY" "ANTHROPIC_BASE_URL=http://127.0.0.1:$port" "$scrub_env" DISABLE_TELEMETRY=1 DISABLE_ERROR_REPORTING=1 DISABLE_AUTOUPDATER=1 CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 "RK_HOOK_LOG=$run/hook.log" \
      timeout 300 "$CLAUDE" -p "run the probe" --output-format stream-json --verbose --model claude-sonnet-5-5 --allowedTools Bash "${settings_args[@]}"
  ) > "$run/claude.jsonl" 2> "$run/claude.err" &
  claude_pid=$!
  if [ "$mode" = kill ]; then
    for _ in $(seq 1 600); do grep -q '"dispatch"' "$run/mock.jsonl" 2>/dev/null && break; sleep 0.1; done
    sleep 3
    pkill -KILL -P "$claude_pid" 2>/dev/null
    pkill -KILL -f "$CLAUDE" 2>/dev/null
    kill -KILL "$claude_pid" 2>/dev/null
  fi
  wait "$claude_pid"
  status=$?
  echo "$status" > "$run/claude.status"
  kill "$mock_pid" 2>/dev/null
  wait "$mock_pid" 2>/dev/null
  return 0
}

tool_text() {
  jq -r --argjson i "$2" 'select(.event == "tool_result" and .index == $i) | .text' "$1/mock.jsonl" 2>/dev/null
}

tool_error() {
  jq -r --argjson i "$2" 'select(.event == "tool_result" and .index == $i) | .is_error' "$1/mock.jsonl" 2>/dev/null
}

summarize_run() {
  local run="$1" label="$2" k1 k2 k3w k3 bw hook
  k1=$(tool_text "$run" 0)
  k2=$(tool_text "$run" 1)
  k3=$(tool_text "$run" 2)
  bw=$(grep -h -i -m 3 'bwrap' "$run/claude.err" "$run/mock.jsonl" 2>/dev/null | head -n 3 | cut -c1-300)
  hook=$(sort -u "$run/hook.log" 2>/dev/null | tr '\n' ' ')
  {
    echo "-- $label"
    echo "claude exit: $(cat "$run/claude.status" 2>/dev/null)"
    echo "step 0 is_error: $(tool_error "$run" 0)"
    printf '%s\n' "$k1" | grep '^K1' | sed 's/^/  /'
    printf '%s\n' "$k2" | grep '^K2' | sed 's/^/  /'
    printf '%s\n' "$k3" | grep '^K3 WRITABLE' | sed 's/^/  /'
    printf '%s\n' "$(tool_text "$run" 3)" | grep '^K4' | sed 's/^/  /'
    printf '%s\n' "$(tool_text "$run" 4)" | grep '^K3X' | sed 's/^/  /'
    echo "  hook: ${hook:-none}"
    [ -n "$bw" ] && printf '  bwrap output: %s\n' "$bw"
    if [ "$(tool_error "$run" 0)" = true ]; then
      printf '  step 0 output: %s\n' "$(printf '%s' "$k1" | head -c 600 | tr '\n' ' ')"
    fi
  } | tee -a "$RESULTS"
  load_env "$run/run.env"
  k3w=$(printf '%s\n' "$k3" | grep '^K3 WRITABLE' | grep -vxF "K3 WRITABLE $L_AGENT" | grep -c '^K3 WRITABLE')
  RUN_K1=fail
  if [ "$(tool_error "$run" 0)" = false ] && [ "$(printf '%s\n' "$k1" | grep -v 'cmd=\[git config --local' | grep -c '^K1 rc=0 .* bwrap=\[\]$')" = 3 ]; then RUN_K1=pass; fi
  RUN_K2=fail
  if printf '%s\n' "$k2" | grep -qx 'K2 env=0' && printf '%s\n' "$k2" | grep -qx 'K2 proc=0'; then RUN_K2=pass; fi
  RUN_K3_WRITABLE=$k3w
  [ -n "$k3" ] || RUN_K3_WRITABLE=unknown
  RUN_HOOK=unknown
  grep -q 'token=present' "$run/hook.log" 2>/dev/null && RUN_HOOK=present
  grep -q 'token=absent' "$run/hook.log" 2>/dev/null && RUN_HOOK=absent
  echo "  K1 $RUN_K1, K2 $RUN_K2, K3 writable $RUN_K3_WRITABLE, hook token $RUN_HOOK" | tee -a "$RESULTS"
}

placeholders_check() {
  local run="$1" label="$2" found
  load_env "$run/run.env"
  found=$(find "$L_WS" "$L_RUNNER" -xdev -newer "$run/stamp" -type f -size 0 ! -path '*/.git/*' 2>/dev/null | head -n 20 | tr '\n' ' ')
  say "  K6 placeholders after $label: ${found:-none}"
  if as_user "$L_USER" git -C "$L_WS" config --local rk.probe.after 1 2>"$run/git-after.err"; then
    say "  K6 host git config write after $label: ok"
  else
    say "  K6 host git config write after $label: failed $(head -c 200 "$run/git-after.err")"
  fi
}

cleanup_check() {
  local run="$1" label="$2" temp
  load_env "$run/run.env"
  temp="$L_TEMP_HOME"
  if [ -z "$temp" ]; then
    say "  K9 $label: no temporary home"
    return
  fi
  if run_step "$L_USER" cleanup.sh "$run/cleanup-$label.log" "TEMP_AGENT_HOME=$temp" "HOME_PARENT=$L_PARENT" && [ -d "$temp" ] && [ -z "$(ls -A "$temp")" ] && [ "$(stat -c '%a' "$temp")" = 700 ]; then
    say "  K9 $label: cleanup left $temp empty, mode 0700, owner $(stat -c %U "$temp")"
    K9_OK=pass
  else
    say "  K9 $label: cleanup failed $(tr '\n' ' ' < "$run/cleanup-$label.log" | head -c 300)"
    K9_OK=fail
  fi
}

block_check() {
  local layout="$1" store="$2" run="$3" planted
  prepare_run "$layout" d "$run" || { gate fail "K5 $layout $store: preparation failed"; return; }
  load_env "$run/run.env"
  case "$store" in
    real) planted="$L_REAL_HOME/.git-credentials" ;;
    real-xdg) planted="$L_REAL_HOME/.config/git/credentials" ;;
    agent) planted="$L_AGENT/.git-credentials" ;;
  esac
  printf 'https://x-access-token:%s@github.com\n' "$SYNTH_TOKEN" > "$planted"
  [ "$L_USER" = root ] || chown "$L_USER" "$planted"
  write_commands "$run/commands.json" marker "" "" "" ""
  run_claude "$run" scrub "$run/commands.json"
  rm -f "$planted"
  if [ ! -e "$L_WS/.rk-k5-marker" ] && ! tool_text "$run" 0 | grep -q 'K5 ran'; then
    gate pass "K5 $layout: a token in the $store store blocks the tool call"
  else
    gate fail "K5 $layout: a token in the $store store did not block the tool call"
  fi
  rm -f "$L_WS/.rk-k5-marker"
  cleanup_check "$run" "after-K5-$store" >/dev/null
}

say ""
say "== fixtures"
if bash "$HERE/run-fixtures.sh" > "$OUT/fixtures.txt" 2>&1; then
  gate pass "fixture suites ($(tail -n 1 "$OUT/fixtures.txt"))"
  grep -E '^(SKIP|PASS stubs)' "$OUT/fixtures.txt" | sed 's/^/  /' | tee -a "$RESULTS"
else
  grep -E '^(FAIL|fixtures:)' "$OUT/fixtures.txt" | tee -a "$RESULTS"
  gate fail "fixture suites"
fi

LAYOUTS=(L0 L1 L1r L1s L1t L2 L2e)
if [ -n "$PROBE_HOME" ] && [ -d "$PROBE_HOME" ] && [ "$(stat -c %u "$PROBE_HOME")" = "$PROBE_UID" ] && [ ! -e "$PROBE_HOME/.claude" ] && [ ! -e "$PROBE_HOME/.mcp.json" ]; then
  LAYOUTS+=(L2h)
else
  say "layout L2h skipped: $PROBE_USER needs an own home with no .claude or .mcp.json"
fi
LAYOUTS+=(L3 L4)
if [ -n "$PROBE_HOME" ] && [ -d "$PROBE_HOME" ] && [ "$(stat -c %u "$PROBE_HOME")" = "$PROBE_UID" ] && [ ! -e "$PROBE_HOME/actions-runner" ] && [ ! -L "$PROBE_HOME/actions-runner" ]; then
  LAYOUTS+=(L4h)
else
  say "layout L4h skipped: $PROBE_USER needs an own home with no actions-runner"
fi
declare -A CASE_A
for layout in "${LAYOUTS[@]}"; do
  build_layout "$layout"
done

for layout in "${LAYOUTS[@]}"; do
  say ""
  say "== layout $layout"
  for case_id in a b c d; do
    run="$OUT/$layout-$case_id"
    if [ "$case_id" = b ] && ! layout_has_foreign_ancestor "$layout"; then
      say "-- $layout case b: inapplicable, no workspace ancestor is owned by another user ID"
      continue
    fi
    if [ "$case_id" = b ] && [ "$layout" = L4 ]; then
      say "-- $layout case b: inapplicable, the review does not run as root"
      continue
    fi
    if [ "$case_id" = c ] && ! layout_is_home_based "$layout"; then
      say "-- $layout case c: inapplicable, the workspace is not under the home's actions-runner or runners"
      continue
    fi
    if [ "$case_id" = a ] && layout_has_foreign_ancestor "$layout"; then
      mkdir -p "$OUT/$layout-k8-before"
      if prepare_run "$layout" a "$OUT/$layout-k8-before"; then
        load_env "$OUT/$layout-k8-before/run.env"
        write_commands "$OUT/$layout-k8-before/commands.json" probe "$L_REAL_HOME" "$L_AGENT" "$L_RUNNER" "$L_RT" "$L_SIBLING" "$L_SIB_RUNNER" "$L_FOREIGN"
        run_claude "$OUT/$layout-k8-before" write-route "$OUT/$layout-k8-before/commands.json"
      fi
    fi
    if ! prepare_run "$layout" "$case_id" "$run"; then
      say "-- $layout case $case_id: preparation failed: $(cat "$run/prepare.err" 2>/dev/null) $(tail -n 3 "$run"/*.log 2>/dev/null | tr '\n' ' ' | head -c 400)"
      [ "$case_id" = d ] && gate fail "$layout case d: preparation failed"
      continue
    fi
    load_env "$run/run.env"
    write_commands "$run/commands.json" probe "$L_REAL_HOME" "$L_AGENT" "$L_RUNNER" "$L_RT" "$L_SIBLING" "$L_SIB_RUNNER" "$L_FOREIGN"
    run_claude "$run" scrub "$run/commands.json"
    summarize_run "$run" "$layout case $case_id (HOME=$L_AGENT)"
    [ -f "$run/stubs.log" ] && sed 's/^/  stubs: /' "$run/stubs.log" | tee -a "$RESULTS"
    placeholders_check "$run" "$layout case $case_id"
    if [ "$case_id" = a ]; then
      CASE_A[$layout]="$RUN_K1"
    fi
    if [ "$case_id" = d ]; then
      if [ "$RUN_K1" = pass ]; then gate pass "$layout case d: K1 git commands"; else gate fail "$layout case d: K1 git commands"; fi
      if [ "$RUN_K2" = pass ]; then gate pass "$layout case d: K2 Claude credential hidden"; else gate fail "$layout case d: K2 Claude credential hidden"; fi
      if [ "$RUN_K3_WRITABLE" = 0 ]; then gate pass "$layout case d: K3 protected targets"; else gate fail "$layout case d: K3 protected targets ($RUN_K3_WRITABLE writable)"; fi
      if [ "$layout" = L2 ] || [ "$layout" = L2e ]; then
        say "  $layout stub: $(stat -c '%n %F %U %a' "$L_RUNNER/.claude" "$L_RUNNER/.mcp.json" 2>&1 | tr '\n' ' ')"
      fi
      if [ "$layout" = L2h ]; then
        say "  L2h stub: $(stat -c '%n %F %U %a' "$PROBE_HOME/.claude" "$PROBE_HOME/.mcp.json" 2>&1 | tr '\n' ' ')"
        if grep -qF "::warning::$PROBE_HOME/.claude is a root-owned directory in the home directory of $PROBE_USER" "$run/stubs.log"; then gate pass "L2h case d: the root-owned .claude in a user's home is named in a warning"; else gate fail "L2h case d: the root-owned .claude in a user's home is named in a warning"; fi
      fi
      say "  P7 $layout: hook token $RUN_HOOK"
      second="$OUT/$layout-d2"
      if prepare_run "$layout" d "$second"; then
        load_env "$second/run.env"
        write_commands "$second/commands.json" probe "$L_REAL_HOME" "$L_AGENT" "$L_RUNNER" "$L_RT" "$L_SIBLING" "$L_SIB_RUNNER" "$L_FOREIGN"
        run_claude "$second" scrub "$second/commands.json"
        summarize_run "$second" "$layout case d, second run"
        if [ "$RUN_K1" = pass ]; then gate pass "$layout case d: K6 a repeated review succeeds"; else gate fail "$layout case d: K6 a repeated review succeeds"; fi
        cleanup_check "$second" "second-run"
      fi
      cleanup_check "$run" "success"
      load_env "$run/run.env"
      if [ -n "$L_TEMP_HOME" ]; then
        if [ "$K9_OK" = pass ]; then gate pass "$layout K9 cleanup after success"; else gate fail "$layout K9 cleanup after success"; fi
      fi
    else
      cleanup_check "$run" "case-$case_id" >/dev/null
    fi
  done
  if layout_has_foreign_ancestor "$layout"; then
    after="$OUT/$layout-k8-after"
    if prepare_run "$layout" a "$after"; then
      load_env "$after/run.env"
      write_commands "$after/commands.json" probe "$L_REAL_HOME" "$L_AGENT" "$L_RUNNER" "$L_RT" "$L_SIBLING" "$L_SIB_RUNNER" "$L_FOREIGN"
      run_claude "$after" write-route "$after/commands.json"
      before_init=$(jq -c 'select(.type == "system" and .subtype == "init") | {mcp_servers, tools: (.tools | length)}' "$OUT/$layout-k8-before/claude.jsonl" 2>/dev/null | head -n 1)
      after_init=$(jq -c 'select(.type == "system" and .subtype == "init") | {mcp_servers, tools: (.tools | length)}' "$after/claude.jsonl" 2>/dev/null | head -n 1)
      before_exit=$(cat "$OUT/$layout-k8-before/claude.status" 2>/dev/null)
      after_exit=$(cat "$after/claude.status" 2>/dev/null)
      say "  K8 $layout write route before stubs: exit $before_exit init $before_init"
      say "  K8 $layout write route with stubs: exit $after_exit init $after_init"
      if [ -n "$after_init" ] && [ "$before_init" = "$after_init" ] && [ "$before_exit" = "$after_exit" ]; then
        gate pass "$layout K8 write route unchanged with stubs present"
      else
        gate fail "$layout K8 write route unchanged with stubs present"
      fi
    fi
  fi
  if [ "$layout" = L2h ]; then
    rm -rf "$PROBE_HOME/.claude" "$PROBE_HOME/.mcp.json" "$PROBE_HOME/rk-probe-runner-L2h"
    [ -n "${PROBE_HOME_MODE:-}" ] && chmod "$PROBE_HOME_MODE" "$PROBE_HOME"
  fi
  if [ "$layout" = L4h ]; then
    rm -rf "$PROBE_HOME/actions-runner"
  fi
done

say ""
say "== K5 credential guard blocks"
for store in real real-xdg agent; do
  block_check L3 "$store" "$OUT/L3-k5-$store"
done
for store in real real-xdg; do
  block_check L0 "$store" "$OUT/L0-k5-$store"
done

say ""
say "== K9 cleanup after failure and kill"
fail_run="$OUT/L1-k9-fail"
if prepare_run L1 d "$fail_run"; then
  load_env "$fail_run/run.env"
  write_commands "$fail_run/commands.json" probe "$L_REAL_HOME" "$L_AGENT" "$L_RUNNER" "$L_RT" "$L_SIBLING" "$L_SIB_RUNNER" "$L_FOREIGN"
  run_claude "$fail_run" scrub "$fail_run/commands.json" --fail
  say "  forced API failure: claude exit $(cat "$fail_run/claude.status")"
  cleanup_check "$fail_run" "forced-failure"
  if [ "$K9_OK" = pass ]; then gate pass "K9 cleanup after a forced API failure"; else gate fail "K9 cleanup after a forced API failure"; fi
fi
kill_run="$OUT/L1-k9-kill"
if prepare_run L1 d "$kill_run"; then
  write_commands "$kill_run/commands.json" sleep "" "" "" ""
  run_claude "$kill_run" kill "$kill_run/commands.json"
  say "  kill during a tool call: claude exit $(cat "$kill_run/claude.status")"
  cleanup_check "$kill_run" "kill"
  if [ "$K9_OK" = pass ]; then gate pass "K9 cleanup after a kill during a tool call"; else gate fail "K9 cleanup after a kill during a tool call"; fi
  load_env "$kill_run/run.env"
  say "  K6 placeholders after the kill: $(find "$L_WS" "$L_RUNNER" -xdev -newer "$kill_run/stamp" -type f -size 0 ! -path '*/.git/*' 2>/dev/null | head -n 20 | tr '\n' ' ')"
fi

say ""
say "== decision inputs"
for layout in L1 L1r L1s L1t L4 L4h L2 L3; do
  say "  case a K1 on $layout: ${CASE_A[$layout]:-not run}"
done
say "  P1: home-based layouts need the temporary home if any of L1, L1r, L1s, L1t, L4, or L4h fails case a."
  say "  case a K1 on L2h: ${CASE_A[L2h]:-not run}"
  say "  P2: the stub step is needed if L2 or L2h fails case a."
say "  P3 to P10: read the case c and case d blocks, the K3 writable lines, the hook token lines, the K6 lines, and the K8 lines above."

say ""
say "probe: $FAILURES gate failures"
[ "$FAILURES" = 0 ]
