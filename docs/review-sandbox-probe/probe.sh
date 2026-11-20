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
PROBE_HOME_STAT=$(stat -c '%a %U' "$PROBE_HOME" 2>&1)
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
say "probe user: $PROBE_USER (uid $PROBE_UID), home $PROBE_HOME mode and owner at start: $PROBE_HOME_STAT"

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
  mkdir -p "$runner/bin" "$runner/externals/node/bin" "$runner/_work/_temp/rk-shared/scripts" "$runner/_work/_temp/rk-plugin-sources/rk-skills" "$runner/_work/_temp/_runner_file_commands" "$runner/_work/repo" "$runner/_work/_actions/anthropics/claude-code-action/pin/bin" "$runner/_work/_tool/go/1.0.0/x64" "$runner/_work/other/other/.git"
  if [ "$name" = L4h ]; then
    L4H_PROFILE_STATE=missing
    L4H_BASH_PROFILE_SAVED=false
    rm -f "$dir/profile.orig" "$dir/bash_profile.orig"
    say "  L4h start: home entries: $(ls -A "$PROBE_HOME" | tr '\n' ' ')"
    if [ -e "$PROBE_HOME/.bash_profile" ] || [ -L "$PROBE_HOME/.bash_profile" ]; then
      mv "$PROBE_HOME/.bash_profile" "$dir/bash_profile.orig"
      L4H_BASH_PROFILE_SAVED=true
    fi
    if [ -f "$PROBE_HOME/.profile" ]; then
      cp -p "$PROBE_HOME/.profile" "$dir/profile.orig"
      L4H_PROFILE_STATE=saved
    fi
    printf '\nPATH="$PATH:/rk-probe-profile-marker"\n' >> "$PROBE_HOME/.profile"
    chown "$PROBE_USER" "$PROBE_HOME/.profile"
    say "  L4h start: .profile $L4H_PROFILE_STATE, .bash_profile moved aside: $L4H_BASH_PROFILE_SAVED"
  else
    mkdir -p "$home/.ssh" "$home/.config/git" "$home/.local/bin" "$home/.claude"
    if [ "$name" != L4 ]; then
      printf 'export RK=1\n' > "$home/.bashrc"
      printf 'export RK=1\n' > "$home/.profile"
    fi
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
  printf '#!/bin/sh\nexit 0\n' > "$runner/_work/_actions/anthropics/claude-code-action/pin/bin/bun"
  printf '[core]\n' > "$runner/_work/other/other/.git/config"
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
  targets="$runner/bin $runner/bin/Runner.Worker $runner/externals $runner/.runner $runner/.credentials $runner/.credentials_rsaparams $runner/.env $runner/.path $rt $rt/claude-review-credential-guard.sh $rt/claude-review-settings.json $rt/rk-shared/scripts/patch_claude_comment.sh $rt/rk-plugin-sources $rt/_runner_file_commands $runner/_work/_actions $runner/_work/_actions/anthropics/claude-code-action/pin/bin $runner/_work/_actions/anthropics/claude-code-action/pin/bin/bun $runner/_work/_tool $runner/_work/_tool/go/1.0.0/x64 $runner/_work/other $runner/_work/other/other/.git $runner/_work/other/other/.git/config $home/.bashrc $home/.profile $home/.bash_profile $home/.bash_login $home/.ssh $home/.gitconfig $home/.git-credentials $home/.config/git/credentials $home/.claude/settings.json $home/.local/bin $home/.bun $home/.bun/bin"
  if [ "$agent" != "$home" ]; then
    targets="$targets $agent $agent/.gitconfig $agent/.bashrc $agent/.bash_profile $agent/.bash_login $agent/.bash_logout $agent/.profile $agent/.zshrc $agent/.zshenv $agent/.zprofile $agent/.zlogin $agent/.zlogout $agent/.bunfig.toml $agent/.npmrc $agent/.yarnrc $agent/.yarnrc.yml $agent/.netrc $agent/.config/git $agent/.config/pip $agent/.config/gh $agent/.pip $agent/.local/bin $agent/.bun $agent/.bun/bin $agent/.ssh $agent/.claude $agent/.claude/settings.json $agent/.claude.json"
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
  if ! run_step "$user" settings.sh "$run/settings.log" "GITHUB_WORKSPACE=$ws" "RUNNER_TEMP=$rt" "RUNNER_TOOL_CACHE=$(dirname "$rt")/_tool" "SETTINGS_FILE=$rt/claude-review-settings.json" "GUARD_FILE=$rt/claude-review-credential-guard.sh" "GUARD_OID=$(out_value "$run/guard.out" guard_oid)" "REAL_HOME=$real_home" "TEMP_AGENT_HOME=$settings_temp" "HOME_PARENT=$settings_parent" "HOME_PARENT_DENY=$settings_parent_deny" "GITHUB_OUTPUT=$run/settings.out"; then
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
  if run_step "$L_USER" cleanup.sh "$run/cleanup-$label.log" "TEMP_AGENT_HOME=$temp" "HOME_PARENT=$L_PARENT" && [ -d "$temp" ] && [ -z "$(ls -A "$temp")" ] && [ -z "$(find "$temp" -maxdepth 0 -perm /077 -print)" ]; then
    say "  K9 $label: cleanup left $temp empty, mode $(stat -c %a "$temp"), owner $(stat -c %U "$temp")"
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
  grep -E '^(SKIP|PASS stubs|PASS agent home)' "$OUT/fixtures.txt" | sed 's/^/  /' | tee -a "$RESULTS"
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
    if [ "$case_id" = d ]; then
      load_env "$BASE/$layout/layout.env"
      say "  $layout before case d: removed the .bash_profile that cases a to c left in the job home: $(stat -c '%U %a %s bytes' "$L_HOME_DIR/.bash_profile" 2>&1)"
      rm -f "$L_HOME_DIR/.bash_profile"
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
      say "  $layout job home .bash_profile: $(stat -c '%U %a %s bytes' "$L_REAL_HOME/.bash_profile" 2>&1), content: $(head -c 200 "$L_REAL_HOME/.bash_profile" 2>&1 | tr '\n' ' ')"
      printf '%s\n' "$(tool_text "$run" 2)" | grep -E "^K3 [A-Z]+ $L_REAL_HOME/\.bash_(profile|login)( |$)" | sed "s/^/  $layout /" | tee -a "$RESULTS"
      path_targets="$L_REAL_HOME/.local/bin $L_REAL_HOME/.bun $L_REAL_HOME/.bun/bin $L_RUNNER/_work/_actions/anthropics/claude-code-action/pin/bin/bun $L_RUNNER/_work/_tool $L_RUNNER/_work/other/other/.git/config"
      if [ "$L_AGENT" != "$L_REAL_HOME" ]; then
        path_targets="$path_targets $L_AGENT/.local/bin $L_AGENT/.bun $L_AGENT/.bun/bin $L_AGENT/.ssh $L_AGENT/.config/git $L_AGENT/.config/gh"
      fi
      for t in $path_targets; do
        printf '%s\n' "$(tool_text "$run" 2)" | awk -v t="$t" '$1 == "K3" && $3 == t' | sed "s/^/  $layout /" | tee -a "$RESULTS"
      done
      if [ "$layout" = L4h ]; then
        login_out=$(runuser -u "$PROBE_USER" -- env -i "HOME=$PROBE_HOME" PATH=/usr/bin:/bin /bin/bash -l -c 'printf %s "$PATH"' 2>&1)
        login_want=/rk-probe-profile-marker
      elif [ "$layout" != L4 ]; then
        login_out=$(AS_USER_DIR=/ as_user "$L_USER" env -i "HOME=$L_REAL_HOME" PATH=/usr/bin:/bin /bin/bash -l -c 'printf %s "RK=${RK:-}"' 2>&1)
        login_want=RK=1
      fi
      if [ "$layout" != L4 ]; then
        say "  $layout bash login shell after case d: $login_out"
        case ":$login_out:" in
          *:"$login_want":*) gate pass "$layout case d: a bash login shell still reads .profile" ;;
          *) gate fail "$layout case d: a bash login shell still reads .profile" ;;
        esac
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
    case "$L4H_PROFILE_STATE" in
      saved) cp -p "$BASE/L4h/profile.orig" "$PROBE_HOME/.profile" ;;
      missing) rm -f "$PROBE_HOME/.profile" ;;
    esac
    if [ "$L4H_BASH_PROFILE_SAVED" = true ]; then
      rm -f "$PROBE_HOME/.bash_profile"
      mv "$BASE/L4h/bash_profile.orig" "$PROBE_HOME/.bash_profile"
    fi
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

POLICY_BASE="$BASE/policy"
POLICY_ACTION="$OPT/action"
POLICY_BUN="$OPT/bin/bun"
POLICY_STUBS="$OPT/policy-stubs"
POLICY_MARKET="$POLICY_BASE/market"
POLICY_PLUGIN=rk-probe-plugin
POLICY_MD_MARKER=rk-policy-claude-md-marker
POLICY_INTERPRETER_LIST=/usr/bin/python3:/usr/local/bin/python3
TAG_PREFIX='--permission-mode acceptEdits --allowedTools "Glob,Grep,LS,Read"'

policy_setup() {
  local log="$OUT/policy-setup.log"
  rm -rf "$POLICY_ACTION" "$POLICY_BASE"
  mkdir -p "$POLICY_ACTION" "$OPT/bin" "$POLICY_STUBS" "$POLICY_BASE"
  chmod 755 "$POLICY_BASE"
  git init -q "$POLICY_ACTION" &&
    git -C "$POLICY_ACTION" fetch -q --depth 1 https://github.com/anthropics/claude-code-action "$ACTION_SHA" >> "$log" 2>&1 &&
    git -C "$POLICY_ACTION" checkout -q FETCH_HEAD >> "$log" 2>&1 || return 1
  [ "$(git -C "$POLICY_ACTION" rev-parse HEAD)" = "$ACTION_SHA" ] || return 1
  (cd "$POLICY_ACTION/base-action" && bun install --frozen-lockfile) >> "$log" 2>&1 || return 1
  cp "$(command -v bun)" "$POLICY_BUN" || return 1
  printf '#!/bin/sh\n[ "${RK_FAKE_COMPARE:-ahead}" = fail ] && exit 1\nprintf "%%s\\n" "${RK_FAKE_COMPARE:-ahead}"\n' > "$POLICY_STUBS/gh"
  chmod 755 "$POLICY_STUBS/gh"
  cp "$WORKFLOW" "$OPT/steps/claude-run.yml"
  extract "Resolve immutable runtime revisions" policy_runtime.sh
  extract "Stage the command policy outside the workspace" policy_stage.sh
  extract "Compose Claude prompt" policy_compose.sh
  extract "Check the staged command policy before Claude runs" policy_check.sh
  extract "Remove the staged command policy" policy_cleanup.sh
  mkdir -p "$POLICY_MARKET/.claude-plugin" "$POLICY_MARKET/plugins/$POLICY_PLUGIN/.claude-plugin" "$POLICY_MARKET/plugins/$POLICY_PLUGIN/commands"
  jq -n --arg p "$POLICY_PLUGIN" '{name: "rk-probe-market", owner: {name: "rk probe"}, plugins: [{name: $p, source: ("./plugins/" + $p), description: "Probe fixture plugin"}]}' > "$POLICY_MARKET/.claude-plugin/marketplace.json"
  jq -n --arg p "$POLICY_PLUGIN" '{name: $p, version: "0.0.1", description: "Probe fixture plugin"}' > "$POLICY_MARKET/plugins/$POLICY_PLUGIN/.claude-plugin/plugin.json"
  printf -- '---\ndescription: Probe fixture command\n---\nSay ok.\n' > "$POLICY_MARKET/plugins/$POLICY_PLUGIN/commands/rk-probe.md"
  local caller="$POLICY_BASE/caller"
  mkdir -p "$caller/.claude/hooks"
  git init -q -b main "$caller"
  cp "$HERE/command_policy_fixture.py" "$caller/.claude/hooks/command_policy.py"
  printf '# Probe workspace\n\nThe probe marker is %s.\n' "$POLICY_MD_MARKER" > "$caller/CLAUDE.md"
  git -C "$caller" add -A
  git -C "$caller" -c user.name=rkprobe -c user.email=rk@probe.invalid commit -q -m policy
  POLICY_SHA=$(git -C "$caller" rev-parse HEAD)
  printf 'import sys\nsys.exit(0)\n' > "$caller/.claude/hooks/command_policy.py"
  git -C "$caller" add -A
  git -C "$caller" -c user.name=rkprobe -c user.email=rk@probe.invalid commit -q -m pull-request
  git -C "$caller" branch -q pr
  git -C "$caller" branch -q other
  chmod -R a+rX "$OPT" "$POLICY_BASE"
}

policy_project_hooks() {
  local ws="$1" file="$2" marker="$3"
  mkdir -p "$ws/.claude"
  jq -n --arg m "$marker" '{hooks: {PreToolUse: [{matcher: "*", hooks: [{type: "command", command: ("touch " + $m)}]}], SessionStart: [{hooks: [{type: "command", command: ("touch " + $m + ".session")}]}]}}' > "$ws/.claude/$file"
}

policy_prepare() {
  local run="$1" ws="$1/ws" rt="$1/rt" home="$1/home"
  rm -rf "$run"
  mkdir -p "$run" "$rt/rk-shared" "$home" "$run/markers"
  cp -R "$REPO_ROOT/templates/claude-workflow/prompts" "$rt/rk-shared/prompts"
  git clone -q "$POLICY_BASE/caller" "$ws"
  git -C "$ws" checkout -q other
  policy_project_hooks "$ws" settings.json "$run/markers/project-other"
  git -C "$ws" add -A
  git -C "$ws" -c user.name=rkprobe -c user.email=rk@probe.invalid commit -q -m other-hooks
  git -C "$ws" checkout -q pr
  policy_project_hooks "$ws" settings.json "$run/markers/project-shared"
  jq -n --arg m "$run/markers/mcp-server" '{mcpServers: {"rk-probe-mcp": {command: "/bin/sh", args: ["-c", ("touch " + $m + "; exec cat")]}}}' > "$ws/.mcp.json"
  git -C "$ws" add -A
  git -C "$ws" -c user.name=rkprobe -c user.email=rk@probe.invalid commit -q -m pr-hooks
  policy_project_hooks "$ws" settings.local.json "$run/markers/project-local"
  git -C "$ws" -c advice.detachedHead=false clone -q "$POLICY_BASE/caller" "$ws/.rk-command-policy"
  git -C "$ws/.rk-command-policy" -c advice.detachedHead=false checkout -q --detach "$POLICY_SHA"
  printf 'run the probe\n' > "$run/prompt.txt"
  chown -R "$PROBE_USER" "$run"
  chmod 755 "$run"
  : > "$run/stage.out"
  chown "$PROBE_USER" "$run/stage.out"
  AS_USER_DIR="$ws" as_user "$PROBE_USER" env -i "PATH=$POLICY_STUBS:$SYS_PATH" "HOME=$home" "RUNNER_TEMP=$rt" "GITHUB_OUTPUT=$run/stage.out" \
    "COMMAND_POLICY_SHA=$POLICY_SHA" "COMMAND_POLICY_PROOF_ACTION_SHA=$ACTION_SHA" "POLICY_INTERPRETERS=$POLICY_INTERPRETER_LIST" \
    "POLICY_WORKFLOW_FILE=$OPT/steps/claude-run.yml" "POLICY_DIR=$rt/rk-command-policy" "POLICY_WORKSPACE=$ws" "AGENT_HOME=$home" \
    "GH_TOKEN=$SYNTH_TOKEN" "REPO=owner/repo" "DEFAULT_BRANCH=main" \
    "POLICY_MAIN_MARKETPLACES=$POLICY_MARKET"$'\n' "POLICY_MAIN_PLUGINS=$POLICY_PLUGIN@rk-probe-market"$'\n' \
    "POLICY_GUIDE_MARKETPLACES=$POLICY_MARKET"$'\n' "POLICY_GUIDE_PLUGINS=$POLICY_PLUGIN@rk-probe-market"$'\n' \
    bash --noprofile --norc -eo pipefail "$OPT/steps/policy_stage.sh" > "$run/stage.log" 2>&1 || return 1
  local shape out
  for shape in implement fix-pr off; do
    out="$run/compose-$shape.out"
    : > "$out"
    chown "$PROBE_USER" "$out"
    AS_USER_DIR="$ws" as_user "$PROBE_USER" env -i "PATH=$SYS_PATH" "HOME=$home" "RUNNER_TEMP=$rt" "GITHUB_OUTPUT=$out" \
      "CLAUDE_HARNESS=anthropics/claude-code-action@v1" "MODEL_ID=claude-sonnet-5-5" "EFFORT=low" "MODE=${shape/off/implement}" "FLOW=" "EXTRA_ALLOWED=" \
      "DEFAULT_BRANCH=main" "HEAD_SHA=" "BASE_SHA=" "SETTINGS_FILE=$rt/claude-review-settings.json" "GH_TOKEN=$SYNTH_TOKEN" \
      "COMMAND_POLICY=$([ "$shape" = off ] && echo false || echo true)" "POLICY_SETTINGS=$(out_value "$run/stage.out" settings_file)" "POLICY_WORKSPACE=$ws" \
      bash --noprofile --norc -eo pipefail "$OPT/steps/policy_compose.sh" > "$run/compose-$shape.log" 2>&1 || return 1
  done
}

policy_args() {
  awk -v key="$2" '
    state == 0 && index($0, key "<<") == 1 { delim = substr($0, length(key) + 3); state = 1; next }
    state == 1 && $0 == delim { exit }
    state == 1 { print }
  ' "$1"
}

policy_launch_args() {
  local run="$1" shape="$2"
  case "$shape" in
    implement) printf '%s %s' "$TAG_PREFIX" "$(policy_args "$run/compose-implement.out" claude_args)" ;;
    fix-pr) printf '%s %s' "$TAG_PREFIX" "$(policy_args "$run/compose-fix-pr.out" claude_args)" ;;
    guide) policy_args "$run/compose-implement.out" guide_claude_args ;;
    off) printf '%s %s' "$TAG_PREFIX" "$(policy_args "$run/compose-off.out" claude_args)" ;;
  esac
}

policy_check_run() {
  local run="$1" phase="$2" args="$3" before="${4:-}" execfile="${5:-}"
  : > "$run/check.out"
  chown "$PROBE_USER" "$run/check.out"
  AS_USER_DIR="$run/ws" as_user "$PROBE_USER" env -i "PATH=$SYS_PATH" "HOME=$run/home" "GITHUB_OUTPUT=$run/check.out" "PHASE=$phase" "POLICY_ARGS=$args" \
    "POLICY_CALLS_BEFORE=$before" "EXECUTION_FILE=$execfile" \
    "POLICY_DIR=$(out_value "$run/stage.out" dir)" "POLICY_CHECKER=$(out_value "$run/stage.out" checker)" "POLICY_CHECKER_OID=$(out_value "$run/stage.out" checker_oid)" \
    "POLICY_SETTINGS=$(out_value "$run/stage.out" settings_file)" "POLICY_SETTINGS_OID=$(out_value "$run/stage.out" settings_oid)" \
    "POLICY_INTERPRETER=$(out_value "$run/stage.out" interpreter)" "POLICY_INTERPRETER_REAL=$(out_value "$run/stage.out" interpreter_real)" "POLICY_INTERPRETER_OID=$(out_value "$run/stage.out" interpreter_oid)" \
    "POLICY_CALL_RECORD=$(out_value "$run/stage.out" call_record)" "POLICY_USER_SETTINGS=$(out_value "$run/stage.out" user_settings)" \
    "POLICY_USER_SETTINGS_DIGEST=$(out_value "$run/stage.out" user_settings_digest)" "POLICY_USER_SETTINGS_KEYS=$(out_value "$run/stage.out" user_settings_keys)" \
    "POLICY_USER_SETTINGS_BASE=$(out_value "$run/stage.out" user_settings_base)" "POLICY_USER_SETTINGS_ALLOWED=$(out_value "$run/stage.out" user_settings_allowed)" \
    "POLICY_WORKSPACE=$run/ws" "POLICY_MANAGED_DIRS=/etc/claude-code" \
    bash --noprofile --norc -e -o pipefail "$OPT/steps/policy_check.sh" > "$run/check-$phase.log" 2>&1
}

policy_launch() {
  local run="$1" args="$2" commands="$3" port mock_pid status
  rm -f "$run/port" "$run/mock.jsonl" "$run/rt/claude-execution-output.json"
  python3 -I "$HERE/mock_messages_api.py" --port-file "$run/port" --script "$commands" --log "$run/mock.jsonl" --marker "$POLICY_MD_MARKER" &
  mock_pid=$!
  for _ in $(seq 1 50); do [ -s "$run/port" ] && break; sleep 0.1; done
  port=$(cat "$run/port" 2>/dev/null)
  [ -n "$port" ] || { kill "$mock_pid" 2>/dev/null; echo "mock did not start" > "$run/launch.err"; return 1; }
  : > "$run/action.out"
  chown "$PROBE_USER" "$run/action.out"
  (
    AS_USER_DIR="$run/ws" as_user "$PROBE_USER" env -i "PATH=$SYS_PATH" "HOME=$run/home" "RUNNER_TEMP=$run/rt" "GITHUB_WORKSPACE=$run/ws" "GITHUB_OUTPUT=$run/action.out" \
      "ANTHROPIC_API_KEY=$SYNTH_KEY" "ANTHROPIC_BASE_URL=http://127.0.0.1:$port" "INPUT_PROMPT_FILE=$run/prompt.txt" "INPUT_CLAUDE_ARGS=$args" \
      "INPUT_PATH_TO_CLAUDE_CODE_EXECUTABLE=$CLAUDE" "INPUT_PLUGIN_MARKETPLACES=$POLICY_MARKET" "INPUT_PLUGINS=$POLICY_PLUGIN@rk-probe-market" \
      "INPUT_SHOW_FULL_OUTPUT=true" "CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1" DISABLE_TELEMETRY=1 DISABLE_ERROR_REPORTING=1 DISABLE_AUTOUPDATER=1 \
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 timeout 300 "$POLICY_BUN" run "$POLICY_ACTION/base-action/src/index.ts"
  ) > "$run/launch.log" 2>&1
  status=$?
  echo "$status" > "$run/launch.status"
  kill "$mock_pid" 2>/dev/null
  wait "$mock_pid" 2>/dev/null
  return 0
}

policy_result() {
  jq -r --argjson i "$2" 'select(.event == "tool_result" and .index == $i) | .text' "$1/mock.jsonl" 2>/dev/null
}

policy_note() {
  local run="$1" label="$2"
  say "  $label: launch exit $(cat "$run/launch.status" 2>/dev/null), tool results: $(jq -r 'select(.event == "tool_result") | "[\(.index) error=\(.is_error)] \(.text | gsub("\n"; " ") | .[0:160])"' "$run/mock.jsonl" 2>/dev/null | tr '\n' ' ' | head -c 900)"
  if [ "$(cat "$run/launch.status" 2>/dev/null)" != 0 ]; then
    say "  $label: launch log tail: $(tail -n 8 "$run/launch.log" 2>/dev/null | tr '\n' ' ' | head -c 900)"
  fi
}

policy_write_commands() {
  local file="$1"
  shift
  jq -n '$ARGS.positional' --args "$@" > "$file"
  chmod 644 "$file"
}

policy_block_cmd() {
  printf 'git log -1 --format=tformat:%s --output=%s' "$2" "$1"
}

policy_cp1_shape() {
  local shape="$1" run="$POLICY_BASE/cp1-$1" args block allow
  if ! policy_prepare "$run"; then
    gate fail "CP1 $shape: preparation failed: $(tail -n 3 "$run"/stage.log "$run"/compose-*.log 2>/dev/null | tr '\n' ' ' | head -c 600)"
    return 1
  fi
  args=$(policy_launch_args "$run" "$shape")
  block="$run/markers/block"
  allow="$run/markers/allow"
  policy_write_commands "$run/commands.json" "$(policy_block_cmd "$block" rk-policy-block-marker)" "$(policy_block_cmd "$allow" ok)"
  if [ "$shape" = guide ]; then
    policy_check_run "$run" before-guide "$args"
  else
    policy_check_run "$run" before-main "$args"
  fi
  POLICY_BEFORE_STATUS=$?
  POLICY_BEFORE_LINES=$(out_value "$run/check.out" call_lines)
  policy_launch "$run" "$args" "$run/commands.json"
  policy_note "$run" "CP1 $shape"
  if [ ! -e "$block" ] && policy_result "$run" 0 | grep -qF "rk-policy-fixture: the command policy blocked" && [ -e "$allow" ]; then
    gate pass "CP1 $shape: the staged policy blocks the block marker command and allows the harmless command"
  else
    gate fail "CP1 $shape: block marker file present: $([ -e "$block" ] && echo yes || echo no), fixture message in the result: $(policy_result "$run" 0 | grep -qF 'rk-policy-fixture' && echo yes || echo no), allow marker file present: $([ -e "$allow" ] && echo yes || echo no)"
  fi
  if [ -n "$(find "$run/markers" -name 'project-*' -print -quit)" ]; then
    gate fail "CP3 $shape: a hook from the workspace settings ran: $(ls "$run/markers" | tr '\n' ' ')"
  else
    gate pass "CP3 $shape: no hook from the workspace settings or local settings ran"
  fi
  if [ -e "$run/markers/mcp-server" ]; then
    gate fail "CP3 $shape: a server from the workspace .mcp.json started"
  else
    gate pass "CP3 $shape: no server from the workspace .mcp.json started"
  fi
}

policy_cp2_case() {
  local name="$1" mutate="$2" marker_word="$3" run="$POLICY_BASE/cp2-$1" args settings block
  if ! policy_prepare "$run"; then
    gate fail "CP2 $name: preparation failed"
    return
  fi
  args=$(policy_launch_args "$run" implement)
  settings=$(out_value "$run/stage.out" settings_file)
  block="$run/markers/block"
  case "$mutate" in
    missing-interpreter|control)
      jq --arg ctl "$mutate" '.hooks.PreToolUse[0].hooks[0].command |= sub("^[^ ]+"; "/nonexistent/rk-probe/python3") | if $ctl == "control" then del(.hooks.PreToolUse[0].hooks[0].onFailure) else . end' "$settings" > "$run/settings-$mutate.json"
      chmod 644 "$run/settings-$mutate.json"
      args="${args/"$settings"/$run/settings-$mutate.json}"
      ;;
    removed)
      chmod 700 "$(dirname "$settings")"
      rm -f "$(out_value "$run/stage.out" checker)"
      chmod 500 "$(dirname "$settings")"
      ;;
    changed)
      local checker
      checker=$(out_value "$run/stage.out" checker)
      chmod 700 "$(dirname "$settings")"
      chmod 600 "$checker"
      printf 'import sys\nsys.exit(0)\n' > "$checker"
      chmod 400 "$checker"
      chmod 500 "$(dirname "$settings")"
      ;;
  esac
  policy_write_commands "$run/commands.json" "$(policy_block_cmd "$block" "$marker_word")"
  policy_launch "$run" "$args" "$run/commands.json"
  policy_note "$run" "CP2 $name"
  if [ "$mutate" = control ]; then
    say "  CP2 control without onFailure, interpreter missing: the command $([ -e "$block" ] && echo ran || echo was blocked) (reported only)"
    return
  fi
  if [ ! -e "$block" ]; then
    gate pass "CP2 $name: the tool call is blocked"
  else
    gate fail "CP2 $name: the tool call ran"
  fi
}

policy_cp3_switch() {
  local run="$POLICY_BASE/cp3-switch" args wt
  if ! policy_prepare "$run"; then
    gate fail "CP3 branch and worktree change: preparation failed"
    return
  fi
  args=$(policy_launch_args "$run" implement)
  wt="$run/worktree"
  policy_write_commands "$run/commands.json" \
    "$(policy_block_cmd "$run/markers/block-1" rk-policy-block-marker)" \
    "git checkout -q other" \
    "$(policy_block_cmd "$run/markers/block-2" rk-policy-block-marker)" \
    "git worktree add -q --detach $wt other" \
    "git -C $wt log -1 --format=tformat:rk-policy-block-marker --output=$run/markers/block-3"
  policy_launch "$run" "$args" "$run/commands.json"
  policy_note "$run" "CP3 branch and worktree change"
  local head
  head=$(git -C "$run/ws" rev-parse --abbrev-ref HEAD 2>/dev/null)
  say "  CP3 workspace branch after the launch: $head; worktree present: $([ -d "$wt" ] && echo yes || echo no)"
  if [ "$head" = other ] && [ -d "$wt" ] && [ ! -e "$run/markers/block-1" ] && [ ! -e "$run/markers/block-2" ] && [ ! -e "$run/markers/block-3" ] && [ -z "$(find "$run/markers" -name 'project-*' -print -quit)" ]; then
    gate pass "CP3: after a branch change and in a new worktree, the staged policy still blocks and no workspace hook runs"
  else
    gate fail "CP3: branch change or worktree: markers present: $(ls "$run/markers" | tr '\n' ' ')"
  fi
  if jq -e 'select(.type == "system" and .subtype == "init") | .tools | index("EnterWorktree")' "$run/rt/claude-execution-output.json" >/dev/null 2>&1 || jq -e '.[] | select(.type == "system" and .subtype == "init") | .tools | index("EnterWorktree")' "$run/rt/claude-execution-output.json" >/dev/null 2>&1; then
    say "  CP3 EnterWorktree: the runtime offers the tool; this probe does not call it (reported only)"
  else
    say "  CP3 EnterWorktree: the runtime does not list the tool in this launch (reported only)"
  fi
}

policy_init_record() {
  jq -c '(if type == "array" then .[] else . end) | select(.type == "system" and .subtype == "init")' "$1/rt/claude-execution-output.json" 2>/dev/null | head -n 1
}

say ""
say "== command policy (CP1 to CP8)"
if ! policy_setup; then
  gate fail "CP setup: cannot fetch or install the action at $ACTION_SHA ($(tail -n 5 "$OUT/policy-setup.log" 2>/dev/null | tr '\n' ' ' | head -c 400))"
else
  say "  action source: $(git -C "$POLICY_ACTION" rev-parse HEAD), launched through base-action/src/index.ts with bun $("$POLICY_BUN" --version 2>/dev/null)"
  for shape in implement fix-pr guide; do
    policy_cp1_shape "$shape"
    if [ "$shape" = implement ]; then
      cp1="$POLICY_BASE/cp1-implement"
      if [ "$POLICY_BEFORE_STATUS" = 0 ]; then gate pass "CP6 before phase: the check passes on the real staged policy"; else gate fail "CP6 before phase: $(tail -n 3 "$cp1/check-before-main.log" | tr '\n' ' ')"; fi
      lines=$(wc -l < "$(out_value "$cp1/stage.out" call_record)" 2>/dev/null | tr -d ' ')
      if [ "${lines:-0}" -ge 1 ]; then gate pass "CP7: the call record has $lines lines after the launch"; else gate fail "CP7: the call record has no line after the launch"; fi
      init=$(policy_init_record "$cp1")
      if grep -q "\"event\": \"marker\", \"text\": \"$POLICY_MD_MARKER\"" "$cp1/mock.jsonl" 2>/dev/null; then gate pass "CP4: a request holds the workspace CLAUDE.md marker"; else gate fail "CP4: no request holds the workspace CLAUDE.md marker"; fi
      if printf '%s' "$init" | grep -qF "$POLICY_PLUGIN"; then gate pass "CP4: the init record lists the fixture plugin"; else gate fail "CP4: the init record does not list the fixture plugin"; fi
      say "  CP4 report: init plugins: $(printf '%s' "$init" | jq -c '.plugins // "none"' 2>/dev/null | head -c 300); mcp servers: $(printf '%s' "$init" | jq -c '.mcp_servers // "none"' 2>/dev/null | head -c 300); skills: $(printf '%s' "$init" | jq -c '.skills // "none"' 2>/dev/null | head -c 300)"
      say "  CP6 user settings after the launch: $(jq -c '{keys: keys, enableAllProjectMcpServers, enabledPlugins, extraKnownMarketplaces}' "$cp1/home/.claude/settings.json" 2>&1 | head -c 600)"
      if policy_check_run "$cp1" after-main "$(policy_launch_args "$cp1" implement)" "$POLICY_BEFORE_LINES" "$cp1/rt/claude-execution-output.json"; then
        gate pass "CP6: the after-phase check passes after a real launch with a plugin install"
      else
        gate fail "CP6: the after-phase check fails after a real launch: $(grep '::error::' "$cp1/check-after-main.log" | tr '\n' ' ' | head -c 600)"
      fi
      cp -p "$cp1/home/.claude/settings.json" "$cp1/settings.after-launch.json"
      jq '.extraKnownMarketplaces["rk-probe-extra"] = {"source": {"source": "directory", "path": "/tmp/rk-probe-extra"}}' "$cp1/settings.after-launch.json" > "$cp1/home/.claude/settings.json"
      chown "$PROBE_USER" "$cp1/home/.claude/settings.json"
      if policy_check_run "$cp1" after-main "$(policy_launch_args "$cp1" implement)" "$POLICY_BEFORE_LINES" "$cp1/rt/claude-execution-output.json"; then
        gate fail "CP6: the after-phase check passes after a marketplace was added to the user settings"
      elif grep -qF 'extraKnownMarketplaces holds the entry "rk-probe-extra"' "$cp1/check-after-main.log"; then
        gate pass "CP6: a marketplace added to the user settings fails the after-phase check"
      else
        gate fail "CP6: the added marketplace failed the check for another reason: $(grep '::error::' "$cp1/check-after-main.log" | tr '\n' ' ' | head -c 400)"
      fi
      jq '.enabledPlugins["rk-probe-extra@rk-probe-market"] = true' "$cp1/settings.after-launch.json" > "$cp1/home/.claude/settings.json"
      chown "$PROBE_USER" "$cp1/home/.claude/settings.json"
      if policy_check_run "$cp1" after-main "$(policy_launch_args "$cp1" implement)" "$POLICY_BEFORE_LINES" "$cp1/rt/claude-execution-output.json"; then
        gate fail "CP6: the after-phase check passes after a plugin was enabled in the user settings"
      elif grep -qF 'enabledPlugins holds the entry "rk-probe-extra@rk-probe-market"' "$cp1/check-after-main.log"; then
        gate pass "CP6: a plugin enabled in the user settings fails the after-phase check"
      else
        gate fail "CP6: the added plugin failed the check for another reason: $(grep '::error::' "$cp1/check-after-main.log" | tr '\n' ' ' | head -c 400)"
      fi
      jq '.hooks = {"PreToolUse": []}' "$cp1/settings.after-launch.json" > "$cp1/home/.claude/settings.json"
      chown "$PROBE_USER" "$cp1/home/.claude/settings.json"
      if policy_check_run "$cp1" after-main "$(policy_launch_args "$cp1" implement)" "$POLICY_BEFORE_LINES" "$cp1/rt/claude-execution-output.json"; then
        gate fail "CP6: the after-phase check passes after a hooks key was added to the user settings"
      else
        if grep -qF 'changed top-level keys: hooks' "$cp1/check-after-main.log"; then gate pass "CP6: a hooks key added to the user settings fails the after-phase check"; else gate fail "CP6: the after-phase check failed for another reason: $(grep '::error::' "$cp1/check-after-main.log" | tr '\n' ' ' | head -c 400)"; fi
      fi
    fi
  done

  policy_cp2_case missing-interpreter missing-interpreter rk-policy-block-marker
  policy_cp2_case removed removed rk-policy-block-marker
  policy_cp2_case changed changed rk-policy-block-marker
  policy_cp2_case raises none rk-policy-crash-marker
  policy_cp2_case sleeps none rk-policy-sleep-marker
  policy_cp2_case control control rk-policy-block-marker

  policy_cp3_switch

  cp5="$POLICY_BASE/cp5"
  if policy_prepare "$cp5"; then
    mkdir -p "$cp5/home/.claude"
    printf '{"disableAllHooks": true}\n' > "$cp5/home/.claude/settings.json"
    chown -R "$PROBE_USER" "$cp5/home/.claude"
    policy_write_commands "$cp5/commands.json" "$(policy_block_cmd "$cp5/markers/block" rk-policy-block-marker)"
    policy_launch "$cp5" "$(policy_launch_args "$cp5" implement)" "$cp5/commands.json"
    policy_note "$cp5" "CP5"
    if [ ! -e "$cp5/markers/block" ]; then gate pass "CP5: disableAllHooks true in the user settings does not turn the policy hook off"; else gate fail "CP5: disableAllHooks true in the user settings turned the policy hook off"; fi
  else
    gate fail "CP5: preparation failed"
  fi

  cp7="$POLICY_BASE/cp7-control"
  if policy_prepare "$cp7"; then
    policy_check_run "$cp7" before-main "$(policy_launch_args "$cp7" implement)"
    before_lines=$(out_value "$cp7/check.out" call_lines)
    policy_write_commands "$cp7/commands.json" "$(policy_block_cmd "$cp7/markers/allow" ok)"
    policy_launch "$cp7" "$(policy_launch_args "$cp7" off)" "$cp7/commands.json"
    policy_note "$cp7" "CP7 control"
    if [ -e "$cp7/markers/allow" ] && ! policy_check_run "$cp7" after-main "$(policy_launch_args "$cp7" implement)" "$before_lines" "$cp7/rt/claude-execution-output.json" && grep -qF 'the policy hook did not run' "$cp7/check-after-main.log"; then
      gate pass "CP7: a launch without the policy settings flags fails the after-phase check"
    else
      gate fail "CP7: the control launch did not fail the after-phase check (allow marker: $([ -e "$cp7/markers/allow" ] && echo present || echo absent)); $(tail -n 2 "$cp7/check-after-main.log" | tr '\n' ' ' | head -c 300)"
    fi
    if [ -e "$cp7/markers/mcp-server" ]; then
      gate pass "CP3 control: a launch without the policy settings flags starts the workspace .mcp.json server, so the CP3 server gates can fail"
    else
      gate fail "CP3 control: the workspace .mcp.json server did not start in the launch without the policy settings flags, so the CP3 server gates prove nothing; init record: $(policy_init_record "$cp7" | jq -c '.mcp_servers // "none"' 2>/dev/null | head -c 300)"
    fi
  else
    gate fail "CP7 control: preparation failed"
  fi
fi

PROOF_SHA=$(bun "$HERE/extract-step.mjs" "$WORKFLOW" "Stage the command policy outside the workspace" --field env.COMMAND_POLICY_PROOF_ACTION_SHA 2>/dev/null)
say "  recorded hook proof action commit: ${PROOF_SHA:-none}; pinned action commit: $ACTION_SHA; Claude Code: $CC_VERSION"
if [ "$PROOF_SHA" = "$ACTION_SHA" ]; then
  gate pass "CP8: COMMAND_POLICY_PROOF_ACTION_SHA equals the pinned action commit"
else
  gate fail "CP8: COMMAND_POLICY_PROOF_ACTION_SHA (${PROOF_SHA:-empty}) differs from the pinned action commit $ACTION_SHA"
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
