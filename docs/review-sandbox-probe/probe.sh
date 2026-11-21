#!/usr/bin/env bash
set -uo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
REPO_ROOT=$(cd "$HERE/../.." && pwd -P)
WORKFLOW="$REPO_ROOT/.github/workflows/claude-run.yml"
OUT=${RK_PROBE_OUT:-/var/tmp/rk-review-sandbox-probe}
BASE=${RK_PROBE_BASE:-/srv/rk-review-sandbox-probe}
BASE2=${RK_PROBE_BASE2:-/var/lib/rk-review-sandbox-probe}
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

rm -rf "$OUT" "$BASE" "$BASE2" "$OPT"
mkdir -p "$OUT" "$BASE" "$BASE2" "$OPT/steps"
chmod 755 "$BASE" "$BASE2" "$OPT" "$OPT/steps"
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
shared() {
  cp "$REPO_ROOT/templates/claude-workflow/scripts/$1" "$OPT/steps/$2" || die "cannot copy $1"
  chmod 644 "$OPT/steps/$2"
}
shared review_sandbox_preflight.sh preflight.sh
shared review_record_work_entries.sh entries_before.sh
extract "Check that no work directory entry appeared while Claude ran" entries_after.sh
shared review_ancestor_stubs.sh stubs.sh
shared review_agent_home.sh agent_home.sh
shared review_write_guard.sh guard.sh
shared review_write_settings.sh settings.sh
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

layout_shape() {
  case "$1" in
    L*w) printf '%s' "${1%w}" ;;
    *) printf '%s' "$1" ;;
  esac
}

layout_dir() {
  case "$1" in
    L*w) printf '%s' "$BASE2/$1" ;;
    *) printf '%s' "$BASE/$1" ;;
  esac
}

layout_is_second_base() {
  case "$1" in L*w) return 0 ;; esac
  return 1
}

build_layout() {
  local name="$1" dir shape home runner ws literal owner_user=root sib_runner tool_cache
  dir=$(layout_dir "$name")
  shape=$(layout_shape "$name")
  mkdir -p "$dir"
  chmod 755 "$dir"
  home="$dir/home"
  case "$shape" in
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
    L5) runner="$home/actions-runner-rk" ;;
    L6)
      runner="$dir/runner"
      mkdir -p "$runner" "$dir/elsewhere/work"
      ln -s "$dir/elsewhere/work" "$runner/_work"
      ;;
  esac
  case "$name" in
    L5w) tool_cache="$runner/tool-cache" ;;
    L0w) tool_cache="$dir/tool-cache" ;;
    *) tool_cache="$runner/_work/_tool" ;;
  esac
  mkdir -p "$tool_cache/rk-tool"
  printf 'rk-tool\n' > "$tool_cache/rk-tool/marker"
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
    if [ "$shape" != L4 ]; then
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
  if [ "$shape" = L1t ]; then
    ln -s "$runner" "$home/actions-runner"
  fi
  sib_runner=""
  if [ "$shape" = L1r ]; then
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
  case "$shape" in
    L2|L3) chown "$PROBE_USER" "$runner" ;;
    L2e) chown "$PROBE_USER" "$runner"; mkdir -p "$runner/.claude"; chown "$PROBE_USER" "$runner/.claude" ;;
  esac
  literal="$ws"
  if [ "$shape" = L1s ]; then
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
    printf 'TOOL_CACHE=%s\n' "$tool_cache"
  } > "$dir/layout.env"
}

layout_has_foreign_ancestor() {
  case "$(layout_shape "$1")" in L2|L2e|L2h|L3) return 0 ;; esac
  return 1
}

layout_is_home_based() {
  case "$(layout_shape "$1")" in L1|L1r|L1s|L1t|L3|L4|L4h) return 0 ;; esac
  return 1
}

layout_runs_as_root() {
  case "$(layout_shape "$1")" in L4|L4h) return 1 ;; esac
  return 0
}

k12_command() {
  local run="$1" t1l t2l
  load_env "$run/run.env"
  t1l=$(dirname "$L_RT")
  t2l=$(dirname "$L_WS")
  printf 'n=%q; ws=%q; tc=%q; runner=%q; work=%q; ' "$L_NONCE" "$L_WS" "$L_TOOL_CACHE" "$L_RUNNER" "$L_WORK_DIR"
  printf 'k12() { l=$1; d=$2; r=$3; b="$d/rk-k12-$n-$l-$r"; '
  printf 'if ( : > "$b-file" ) 2>/dev/null; then echo "K12 $l $r file WRITABLE"; else echo "K12 $l $r file DENIED"; fi; '
  printf 'if mkdir "$b-dir" 2>/dev/null; then echo "K12 $l $r mkdir WRITABLE"; else echo "K12 $l $r mkdir DENIED"; fi; '
  printf 's="$ws/.rk-k12-$n-$l-$r-src"; : > "$s" 2>/dev/null; if mv "$s" "$b-mv" 2>/dev/null; then echo "K12 $l $r mv WRITABLE"; else echo "K12 $l $r mv DENIED"; fi; '
  printf 'if ln -s /nonexistent "$b-ln" 2>/dev/null; then echo "K12 $l $r ln WRITABLE"; else echo "K12 $l $r ln DENIED"; fi; }; '
  printf 'for r in pre post; do '
  printf 'if [ "$r" = post ]; then '
  printf 'if mount -o remount,rw,bind "$work" 2>/dev/null; then echo "K12 remount ACCEPTED"; else echo "K12 remount REFUSED"; fi; '
  printf 'if umount "$work" 2>/dev/null; then echo "K12 umount ACCEPTED"; else echo "K12 umount REFUSED"; fi; '
  printf 'if umount -l "$work" 2>/dev/null; then echo "K12 lazy umount ACCEPTED"; else echo "K12 lazy umount REFUSED"; fi; fi; '
  printf 'k12 T1L %q "$r"; k12 T1R %q "$r"; k12 T2L %q "$r"; k12 T2R %q "$r"; done; ' "$t1l" "$L_WORK_DIR" "$t2l" "$(dirname "$L_WS_RESOLVED")"
  printf 'if cat "$tc/rk-tool/marker" >/dev/null 2>&1; then echo "K15 READ ok"; else echo "K15 READ denied"; fi; '
  printf 'if ( : > "$tc/rk-k15-$n" ) 2>/dev/null; then echo "K15 WRITE WRITABLE"; else echo "K15 WRITE DENIED"; fi; '
  printf 'for f in "$runner/.credentials" "$runner/.runner"; do if cat "$f" >/dev/null 2>&1; then echo "K3R READABLE $f"; else echo "K3R DENIED $f"; fi; done'
}

write_commands() {
  local file="$1" kind="$2" home="${3:-}" agent="${4:-}" runner="${5:-}" rt="${6:-}" sibling="${7:-}" sib_runner="${8:-}" foreign="${9:-}" k12_run="${10:-}" targets info k12=""
  if [ "$kind" = marker ]; then
    jq -n '["touch .rk-k5-marker; echo K5 ran"]' > "$file"
    return
  fi
  if [ "$kind" = nobwrap ]; then
    jq -n '["echo K11 ran"]' > "$file"
    if [ "$(id -u)" = 0 ]; then chmod 644 "$file"; fi
    return
  fi
  if [ "$kind" = loop ]; then
    jq -n --arg t1 "$home" --arg t2 "$agent" --arg tag "rk-k13-$runner" --arg beat "$rt" '[
      ("echo K13 looping; bash -c '"'"'i=0; while [ $i -lt 120 ]; do : > \"$3\" 2>/dev/null; : > \"$1\" 2>/dev/null; : > \"$2\" 2>/dev/null; i=$((i+1)); sleep 1; done'"'"' " + $tag + " " + ($t1 | @sh) + " " + ($t2 | @sh) + " " + ($beat | @sh))
    ]' > "$file"
    if [ "$(id -u)" = 0 ]; then chmod 644 "$file"; fi
    return
  fi
  if [ -n "$k12_run" ]; then
    k12=$(k12_command "$k12_run")
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
  jq -n --arg targets "$targets" --arg home "$home" --arg info "$info" --arg k12 "$k12" '[
    "for c in \"git status --short\" \"git diff --stat refs/remotes/origin/base HEAD\" \"git fetch origin\" \"git config --local rk.probe.inside 1\"; do out=$($c 2>&1); rc=$?; b=$(printf \"%s\" \"$out\" | grep -m1 -i bwrap); echo \"K1 rc=$rc cmd=[$c] bwrap=[$b]\"; if [ $rc -ne 0 ]; then echo \"K1 err cmd=[$c] $(printf %s \"$out\" | head -c 300 | tr \"\\n\" \" \")\"; fi; done",
    "echo \"K2 env=$(env | grep -c rkprobe-synthetic-anthropic)\"; n=0; for p in /proc/[0-9]*/environ; do if grep -qa rkprobe-synthetic-anthropic \"$p\" 2>/dev/null; then n=$((n+1)); fi; done; echo \"K2 proc=$n\"",
    ("for t in " + $targets + "; do if [ -d \"$t\" ]; then f=\"$t/.rk-probe-new\"; if ( : > \"$f\" ) 2>/dev/null; then echo \"K3 WRITABLE $t\"; rm -f \"$f\"; else echo \"K3 DENIED $t\"; fi; elif [ -e \"$t\" ]; then if ( : >> \"$t\" ) 2>/dev/null; then echo \"K3 WRITABLE $t\"; else echo \"K3 DENIED $t\"; fi; else if ( : > \"$t\" ) 2>/dev/null; then echo \"K3 WRITABLE $t (created)\"; rm -f \"$t\"; else echo \"K3 DENIED $t (missing)\"; fi; fi; done"),
    ("for f in " + $home + "/.claude/.credentials.json " + $home + "/.claude.json; do if cat \"$f\" >/dev/null 2>&1; then echo \"K4 READABLE $f\"; else echo \"K4 DENIED $f\"; fi; done"),
    ("for t in " + $info + "; do f=\"$t/.rk-probe-new\"; if ( : > \"$f\" ) 2>/dev/null; then echo \"K3X WRITABLE $t\"; rm -f \"$f\"; else echo \"K3X DENIED $t\"; fi; done")
  ] + (if $k12 == "" then [] else [$k12] end)' > "$file"
  if [ "$(id -u)" = 0 ]; then chmod 644 "$file"; fi
}

prepare_run() {
  local layout="$1" case_id="$2" run="$3" dir user home ws rt real_home agent temp_home needs stub_scan parent_deny work_dir="" work_parent="" entries_oid="" nonce
  dir=$(layout_dir "$layout")
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
  nonce=$(od -An -N6 -tx1 /dev/urandom | tr -d ' \n')
  case "$case_id" in
    a) ;;
    b) stub_scan=true ;;
    c) needs=true; parent_deny=true; layout_has_foreign_ancestor "$layout" && stub_scan=true ;;
    d)
      : > "$run/contract.out"
      chmod 666 "$run/contract.out"
      if ! run_step "$user" contract.sh "$run/contract.log" "HOME=$home" "GITHUB_WORKSPACE=$ws" "RUNNER_TEMP=$rt" "GITHUB_OUTPUT=$run/contract.out" SCRUB=true SCRUB_SELF_HOSTED=false SCRUB_OFF_ACCEPTED=false REPO_PRIVATE=true RUNNER_ENVIRONMENT=self-hosted; then
        echo "contract step failed" > "$run/prepare.err"
        return 1
      fi
      needs=$(out_value "$run/contract.out" needs_temp_home)
      stub_scan=$(out_value "$run/contract.out" stub_scan)
      parent_deny=$(out_value "$run/contract.out" home_parent_deny)
      work_dir=$(out_value "$run/contract.out" work_dir)
      work_parent=$(out_value "$run/contract.out" work_parent)
      if [ "$parent_deny" = true ] && ! AS_USER_DIR="$ws" run_step "$user" preflight.sh "$run/preflight.log" "GITHUB_WORKSPACE=$ws" "WORK_DIR=$work_dir" "WORK_PARENT=$work_parent"; then
        echo "preflight step failed" > "$run/prepare.err"
        return 1
      fi
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
  if ! run_step "$user" settings.sh "$run/settings.log" "GITHUB_WORKSPACE=$ws" "RUNNER_TEMP=$rt" "RUNNER_TOOL_CACHE=$L_TOOL_CACHE" "SETTINGS_FILE=$rt/claude-review-settings.json" "GUARD_FILE=$rt/claude-review-credential-guard.sh" "GUARD_OID=$(out_value "$run/guard.out" guard_oid)" "REAL_HOME=$real_home" "AGENT_HOME=$agent" "TEMP_AGENT_HOME=$settings_temp" "HOME_PARENT=$settings_parent" "HOME_PARENT_DENY=$settings_parent_deny" "WORK_DIR=$work_dir" "WORK_PARENT=$work_parent" "GITHUB_OUTPUT=$run/settings.out"; then
    echo "settings generation failed" > "$run/prepare.err"
    return 1
  fi
  if [ "$case_id" = d ] && [ "$parent_deny" = true ]; then
    : > "$run/entries.out"
    chmod 666 "$run/entries.out"
    if ! run_step "$user" entries_before.sh "$run/entries-before.log" "GITHUB_WORKSPACE=$ws" "WORK_DIR=$work_dir" "ENTRIES_FILE=$rt/claude-review-work-entries.txt" "GITHUB_OUTPUT=$run/entries.out"; then
      echo "work entries step failed" > "$run/prepare.err"
      return 1
    fi
    entries_oid=$(out_value "$run/entries.out" oid)
  fi
  cp "$rt/claude-review-settings.json" "$run/settings.shipped.json"
  jq --arg hook "$OPT/hook.sh" '.hooks.PreToolUse[0].hooks += [{"type": "command", "command": $hook}]' "$run/settings.shipped.json" > "$run/settings.probe.json"
  chmod 644 "$run/settings.probe.json"
  {
    printf 'USER=%s\nWS=%s\nRT=%s\nREAL_HOME=%s\nAGENT=%s\nTEMP_HOME=%s\nRUNNER=%s\n' "$user" "$ws" "$rt" "$real_home" "$agent" "$temp_home" "$L_RUNNER"
    printf 'SIBLING=%s\nSIB_RUNNER=%s\nFOREIGN=%s\nPARENT=%s\n' "$sibling" "$L_SIB_RUNNER" "$foreign" "$home_parent"
    printf 'WORK_DIR=%s\nWORK_PARENT=%s\nWS_RESOLVED=%s\nENTRIES_OID=%s\nNONCE=%s\nTOOL_CACHE=%s\nLAYOUT=%s\n' "$work_dir" "$work_parent" "$(cd -P "$ws" && pwd -P)" "$entries_oid" "$nonce" "$L_TOOL_CACHE" "$layout"
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
  local wrap=()
  if [ "$mode" = nobwrap ]; then
    wrap=(unshare -m --propagation private /bin/sh -c 'for p in /usr/bin/bwrap /bin/bwrap /usr/local/bin/bwrap; do if [ -e "$p" ]; then mount --bind /dev/null "$p" || exit 97; fi; done; exec "$@"' sh)
  fi
  (
    AS_USER_DIR="$ws" as_user "$user" "${wrap[@]}" env -i "PATH=$SYS_PATH" "HOME=$agent" "GITHUB_WORKSPACE=$ws" "RUNNER_TEMP=$rt" "GH_TOKEN=$SYNTH_TOKEN" "GITHUB_TOKEN=$SYNTH_TOKEN" "ANTHROPIC_API_KEY=$SYNTH_KEY" "ANTHROPIC_BASE_URL=http://127.0.0.1:$port" "$scrub_env" DISABLE_TELEMETRY=1 DISABLE_ERROR_REPORTING=1 DISABLE_AUTOUPDATER=1 CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 "RK_HOOK_LOG=$run/hook.log" \
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
  local run="$1" label="$2" k1 k2 k3w k3 bw hook line path hidden
  k1=$(tool_text "$run" 0)
  k2=$(tool_text "$run" 1)
  k3=$(tool_text "$run" 2)
  load_env "$run/run.env"
  k3=$(printf '%s\n' "$k3" | while IFS= read -r line; do
    case "$line" in
      "K3 WRITABLE "*" (created)")
        path=${line#K3 WRITABLE }
        path=${path% (created)}
        if [ -e "$path" ] || [ -L "$path" ]; then
          printf 'K3 HIDDEN %s\n' "$path"
          continue
        fi
        if [ "$L_AGENT" = "$L_REAL_HOME" ]; then
          case "$path" in
            "$L_REAL_HOME"/*)
              printf 'K3 JOB HOME %s\n' "$path"
              continue
              ;;
          esac
        fi
        ;;
    esac
    printf '%s\n' "$line"
  done)
  bw=$(grep -h -i -m 3 'bwrap' "$run/claude.err" "$run/mock.jsonl" 2>/dev/null | head -n 3 | cut -c1-300)
  hook=$(sort -u "$run/hook.log" 2>/dev/null | tr '\n' ' ')
  {
    echo "-- $label"
    echo "claude exit: $(cat "$run/claude.status" 2>/dev/null)"
    echo "step 0 is_error: $(tool_error "$run" 0)"
    printf '%s\n' "$k1" | grep '^K1' | sed 's/^/  /'
    printf '%s\n' "$k2" | grep '^K2' | sed 's/^/  /'
    printf '%s\n' "$k3" | grep '^K3 WRITABLE' | sed 's/^/  /'
    hidden=$(printf '%s\n' "$k3" | grep -c '^K3 HIDDEN')
    [ "$hidden" = 0 ] || echo "  K3 targets hidden by the empty runner directory: $hidden"
    printf '%s\n' "$k3" | grep '^K3 JOB HOME' | sed 's/^/  /; s/$/ (missing on the host and created by a command; a job home entry outside the work directory boundary, reported only)/'
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

host_matches() {
  local dir="$1" pattern="$2"
  [ -d "$dir" ] || return 0
  find "$dir" -mindepth 1 -maxdepth 1 -name "$pattern" -print 2>/dev/null
}

k12_report() {
  local run="$1" label="$2" text t1_dir t2_dir t1_host t2_host k15_host lines
  load_env "$run/run.env"
  text=$(tool_text "$run" 5)
  t1_dir="$L_WORK_DIR"
  t2_dir=$(dirname "$L_WS_RESOLVED")
  t1_host=$(host_matches "$t1_dir" "rk-k12-$L_NONCE-T1*")
  t2_host=$(host_matches "$t2_dir" "rk-k12-$L_NONCE-T2*")
  k15_host=$(host_matches "$L_TOOL_CACHE" "rk-k15-$L_NONCE")
  {
    for target in T1 T2; do
      lines=$(printf '%s\n' "$text" | grep -E "^K12 ${target}[LR] ")
      printf '  K12 %s inside the sandbox: %s denied, %s writable\n' "$target" "$(printf '%s\n' "$lines" | grep -c ' DENIED$')" "$(printf '%s\n' "$lines" | grep -c ' WRITABLE$')"
      printf '%s\n' "$lines" | grep ' WRITABLE$' | sed 's/^/    /'
    done
    printf '%s\n' "$text" | grep -E '^K12 (remount|umount|lazy umount) ' | sed 's/^/  /'
    printf '  K12 host T1 (new work directory entry): %s\n' "$( [ -n "$t1_host" ] && printf 'present %s' "$(printf '%s' "$t1_host" | tr '\n' ' ')" || printf absent)"
    printf '  K12 host T2 (new workspace sibling): %s\n' "$( [ -n "$t2_host" ] && printf 'present %s' "$(printf '%s' "$t2_host" | tr '\n' ' ')" || printf absent)"
    printf '%s\n' "$text" | grep -E '^K15 ' | sed 's/^/  /'
    printf '  K15 host write: %s\n' "$( [ -n "$k15_host" ] && printf present || printf absent)"
    printf '%s\n' "$text" | grep -E '^K3R ' | sed 's/^/  /'
  } | tee -a "$RESULTS"
  RUN_K12_T1=fail
  if [ "$(printf '%s\n' "$text" | grep -cE '^K12 T1[LR] (pre|post) (file|mkdir|mv|ln) DENIED$')" = 16 ] && [ -z "$t1_host" ]; then RUN_K12_T1=pass; fi
  RUN_K12_T2=fail
  if [ "$(printf '%s\n' "$text" | grep -cE '^K12 T2[LR] (pre|post) (file|mkdir|mv|ln) DENIED$')" = 16 ] && [ -z "$t2_host" ]; then RUN_K12_T2=pass; fi
  RUN_K14_T1=absent
  [ -n "$t1_host" ] && RUN_K14_T1=present
  RUN_K14_T2=absent
  [ -n "$t2_host" ] && RUN_K14_T2=present
  RUN_K15=fail
  if printf '%s\n' "$text" | grep -qx 'K15 READ ok' && printf '%s\n' "$text" | grep -qx 'K15 WRITE DENIED' && [ -z "$k15_host" ]; then RUN_K15=pass; fi
  RUN_K3R=fail
  if [ "$(printf '%s\n' "$text" | grep -c '^K3R DENIED ')" = 2 ]; then RUN_K3R=pass; fi
  RUN_RUNNER_HIDDEN=false
  if [ "$(cd -P "$L_RUNNER" 2>/dev/null && pwd -P)" = "$L_WORK_PARENT" ]; then RUN_RUNNER_HIDDEN=true; fi
  {
    host_matches "$t1_dir" "rk-k12-$L_NONCE-*"
    host_matches "$t2_dir" "rk-k12-$L_NONCE-*"
    host_matches "$L_WS_RESOLVED" ".rk-k12-$L_NONCE-*"
    host_matches "$L_TOOL_CACHE" "rk-k15-$L_NONCE"
  } | sort -u | while IFS= read -r path; do
    [ -n "$path" ] && rm -rf -- "$path"
  done
  : "$label"
}

entries_check() {
  local run="$1" label="$2"
  load_env "$run/run.env"
  ENTRIES_OK=skip
  [ -n "$L_ENTRIES_OID" ] || return 0
  if run_step "$L_USER" entries_after.sh "$run/entries-after-$label.log" "GITHUB_WORKSPACE=$L_WS" "WORK_DIR=$L_WORK_DIR" "ENTRIES_FILE=$L_RT/claude-review-work-entries.txt" "ENTRIES_OID=$L_ENTRIES_OID"; then
    ENTRIES_OK=pass
  else
    ENTRIES_OK=fail
    say "  work entries after $label: $(tr '\n' ' ' < "$run/entries-after-$label.log" | head -c 600)"
  fi
}

control_check() {
  local layout="$1" mode="$2" run="$OUT/$1-k14-control"
  if ! prepare_run "$layout" d "$run"; then
    gate fail "$layout K14 control: preparation failed"
    return
  fi
  jq 'del(.sandbox.filesystem.denyRead, .sandbox.filesystem.allowRead)' "$run/settings.probe.json" > "$run/settings.control.json"
  mv "$run/settings.control.json" "$run/settings.probe.json"
  chmod 644 "$run/settings.probe.json"
  load_env "$run/run.env"
  write_commands "$run/commands.json" probe "$L_REAL_HOME" "$L_AGENT" "$L_RUNNER" "$L_RT" "$L_SIBLING" "$L_SIB_RUNNER" "$L_FOREIGN" "$run"
  run_claude "$run" scrub "$run/commands.json"
  say "-- $layout K14 control run without the read rules"
  k12_report "$run" "$layout K14 control"
  if [ "$mode" = report ]; then
    say "  K14 $layout control, reported only: T1 $RUN_K14_T1, T2 $RUN_K14_T2, first tool result: $(tool_text "$run" 0 | head -c 300 | tr '\n' ' ')"
  elif [ "$RUN_K14_T1" = present ] && [ "$RUN_K14_T2" = present ]; then
    gate pass "$layout K14 control: without the read rules a new work directory entry and a new workspace sibling reach the host"
  else
    gate fail "$layout K14 control: without the read rules a new work directory entry and a new workspace sibling reach the host (T1 $RUN_K14_T1, T2 $RUN_K14_T2)"
  fi
  cleanup_check "$run" "k14-control" >/dev/null
}

kill_check() {
  local layout="$1" run="$OUT/$1-k13-kill" t1 t2 tag beat polls=0 seen=false leaked=false ran=false survivors
  if ! prepare_run "$layout" d "$run"; then
    gate fail "K13 $layout: preparation failed"
    return
  fi
  load_env "$run/run.env"
  t1="$L_WORK_DIR/rk-k13-$L_NONCE"
  t2="$(dirname "$L_WS_RESOLVED")/rk-k13-$L_NONCE"
  tag="rk-k13-$L_NONCE"
  beat="$L_WS_RESOLVED/.rk-k13-$L_NONCE-alive"
  write_commands "$run/commands.json" loop "$t1" "$t2" "$L_NONCE" "$beat"
  run_claude "$run" kill "$run/commands.json"
  say "  kill during a tool call on $layout: claude exit $(cat "$run/claude.status")"
  for _ in $(seq 1 10); do
    if [ -e "$t1" ] || [ -L "$t1" ] || [ -e "$t2" ] || [ -L "$t2" ]; then leaked=true; fi
    pgrep -f "$tag" >/dev/null 2>&1 || break
    seen=true
    polls=$((polls + 1))
    sleep 1
  done
  survivors=$(pgrep -fc "$tag" 2>/dev/null || true)
  pkill -KILL -f "$tag" 2>/dev/null
  for _ in $(seq 1 20); do
    pgrep -f "$tag" >/dev/null 2>&1 || break
    sleep 0.5
  done
  if [ -e "$t1" ] || [ -L "$t1" ] || [ -e "$t2" ] || [ -L "$t2" ]; then leaked=true; fi
  if [ -e "$beat" ]; then ran=true; fi
  say "  K13 $layout: the loop ran in the sandbox: $ran, a sandboxed process outlived the kill: $seen, polls while it ran: $polls, processes left after the polls: ${survivors:-0}, targets on the host: $leaked"
  rm -f -- "$beat"
  if [ "$ran" = true ] && [ "$leaked" = false ]; then
    gate pass "K13 $layout: a sandboxed loop that outlives the kill creates no work directory entry or workspace sibling"
  else
    gate fail "K13 $layout: a sandboxed loop that outlives the kill creates no work directory entry or workspace sibling (loop ran: $ran, targets on the host: $leaked)"
  fi
  rm -f -- "$t1" "$t2"
  entries_check "$run" kill
  if [ "$ENTRIES_OK" = pass ]; then gate pass "$layout work entries: no new entry after a kill"; else gate fail "$layout work entries: no new entry after a kill ($ENTRIES_OK)"; fi
  cleanup_check "$run" "kill"
  load_env "$run/run.env"
  if [ -n "$L_TEMP_HOME" ]; then
    if [ "$K9_OK" = pass ]; then gate pass "K9 cleanup after a kill during a tool call on $layout"; else gate fail "K9 cleanup after a kill during a tool call on $layout"; fi
  fi
  say "  K6 placeholders after the kill on $layout: $(find "$L_WS" "$L_RUNNER" -xdev -newer "$run/stamp" -type f -size 0 ! -path '*/.git/*' 2>/dev/null | head -n 20 | tr '\n' ' ')"
}

nobwrap_check() {
  local run="$OUT/L1-k11-nobwrap" text status
  if ! prepare_run L1 d "$run"; then
    say "  K11: preparation failed: $(cat "$run/prepare.err" 2>/dev/null)"
    gate fail "K11 Claude Code runs no Bash call when bubblewrap is masked (preparation failed, so the check did not run)"
    return
  fi
  write_commands "$run/commands.json" nobwrap "" "" "" ""
  run_claude "$run" nobwrap "$run/commands.json"
  text=$(tool_text "$run" 0)
  status=$(cat "$run/claude.status" 2>/dev/null)
  say "  K11 with bubblewrap masked: claude exit ${status:-none}, tool result is_error ${text:+$(tool_error "$run" 0)}, output: $(printf '%s' "$text" | head -c 300 | tr '\n' ' '), Claude Code error output: $(grep -v '^[[:space:]]*$' "$run/claude.err" 2>/dev/null | head -n 2 | head -c 400 | tr '\n' ' ')"
  if printf '%s\n' "$text" | grep -qx 'K11 ran'; then
    gate fail "K11 Claude Code runs no Bash call when bubblewrap is masked (Claude Code ran the Bash call, so the preflight step is the only guard against a missing sandbox)"
  elif [ "$status" = 97 ]; then
    gate fail "K11 Claude Code runs no Bash call when bubblewrap is masked (the bubblewrap mask failed, so the check did not run)"
  elif [ -n "$status" ] && [ "$status" != 0 ] && [ -z "$text" ] && grep -qF 'bubblewrap is required' "$run/claude.err" 2>/dev/null; then
    gate pass "K11 Claude Code runs no Bash call when bubblewrap is masked"
  else
    gate fail "K11 Claude Code runs no Bash call when bubblewrap is masked (Claude Code exited ${status:-with no status} without the missing bubblewrap error, so the check did not show a refusal)"
  fi
  cleanup_check "$run" "k11" >/dev/null
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
LAYOUTS+=(L5 L6 L0w L1w L1rw L1sw L1tw L2w L2ew L3w L4w L5w L6w)
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
    if [ "$case_id" = b ] && ! layout_runs_as_root "$layout"; then
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
      load_env "$(layout_dir "$layout")/layout.env"
      say "  $layout before case d: removed the .bash_profile that cases a to c left in the job home: $(stat -c '%U %a %s bytes' "$L_HOME_DIR/.bash_profile" 2>&1)"
      rm -f "$L_HOME_DIR/.bash_profile"
    fi
    if ! prepare_run "$layout" "$case_id" "$run"; then
      say "-- $layout case $case_id: preparation failed: $(cat "$run/prepare.err" 2>/dev/null) $(tail -n 3 "$run"/*.log 2>/dev/null | tr '\n' ' ' | head -c 400)"
      [ "$case_id" = d ] && gate fail "$layout case d: preparation failed"
      continue
    fi
    load_env "$run/run.env"
    k12_run=""
    [ "$case_id" = d ] && k12_run="$run"
    write_commands "$run/commands.json" probe "$L_REAL_HOME" "$L_AGENT" "$L_RUNNER" "$L_RT" "$L_SIBLING" "$L_SIB_RUNNER" "$L_FOREIGN" "$k12_run"
    run_claude "$run" scrub "$run/commands.json"
    summarize_run "$run" "$layout case $case_id (HOME=$L_AGENT)"
    if [ "$case_id" = d ]; then
      entries_check "$run" success
      k12_report "$run" "$layout case d"
      load_env "$run/run.env"
      say "  $layout boundary: work directory $L_WORK_DIR, hidden parent $L_WORK_PARENT, tool cache $L_TOOL_CACHE"
    fi
    [ -f "$run/stubs.log" ] && sed 's/^/  stubs: /' "$run/stubs.log" | tee -a "$RESULTS"
    placeholders_check "$run" "$layout case $case_id"
    if [ "$case_id" = a ]; then
      CASE_A[$layout]="$RUN_K1"
    fi
    if [ "$case_id" = d ]; then
      if [ "$RUN_K1" = pass ]; then gate pass "$layout case d: K1 git commands"; else gate fail "$layout case d: K1 git commands"; fi
      if [ "$RUN_K2" = pass ]; then gate pass "$layout case d: K2 Claude credential hidden"; else gate fail "$layout case d: K2 Claude credential hidden"; fi
      if [ "$RUN_K3_WRITABLE" = 0 ]; then gate pass "$layout case d: K3 protected targets"; else gate fail "$layout case d: K3 protected targets ($RUN_K3_WRITABLE writable)"; fi
      if [ "$RUN_K12_T1" = pass ]; then gate pass "$layout case d: K12 a new work directory entry is denied"; else gate fail "$layout case d: K12 a new work directory entry is denied"; fi
      if [ "$RUN_K12_T2" = pass ]; then gate pass "$layout case d: K12 a new workspace sibling is denied"; else gate fail "$layout case d: K12 a new workspace sibling is denied"; fi
      if [ "$RUN_K15" = pass ]; then gate pass "$layout case d: K15 the tool cache is readable and not writable"; else gate fail "$layout case d: K15 the tool cache is readable and not writable"; fi
      if [ "$RUN_RUNNER_HIDDEN" = true ]; then
        if [ "$RUN_K3R" = pass ]; then gate pass "$layout case d: K3R the runner credential files cannot be read"; else gate fail "$layout case d: K3R the runner credential files cannot be read"; fi
      else
        say "  $layout K3R: the runner directory is not the hidden parent, so the credential file reads are reported only"
      fi
      if [ "$ENTRIES_OK" = pass ]; then gate pass "$layout case d: work entries: no new entry after the run"; else gate fail "$layout case d: work entries: no new entry after the run ($ENTRIES_OK)"; fi
      case "$(layout_shape "$layout")" in
        L2|L2e) say "  $layout stub: $(stat -c '%n %F %U %a' "$L_RUNNER/.claude" "$L_RUNNER/.mcp.json" 2>&1 | tr '\n' ' ')" ;;
      esac
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
      elif [ "$(layout_shape "$layout")" != L4 ]; then
        login_out=$(AS_USER_DIR=/ as_user "$L_USER" env -i "HOME=$L_REAL_HOME" PATH=/usr/bin:/bin /bin/bash -l -c 'printf %s "RK=${RK:-}"' 2>&1)
        login_want=RK=1
      fi
      if [ "$(layout_shape "$layout")" != L4 ]; then
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
        entries_check "$second" second-run
        if [ "$ENTRIES_OK" = pass ]; then gate pass "$layout case d: work entries: no new entry after a repeated run"; else gate fail "$layout case d: work entries: no new entry after a repeated run ($ENTRIES_OK)"; fi
        cleanup_check "$second" "second-run"
      fi
      if [ "$layout" = L2ew ]; then
        control_check "$layout" report
      elif layout_is_second_base "$layout" || [ "$layout" = L2h ] || [ "$layout" = L4h ]; then
        control_check "$layout" gate
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
  entries_check "$fail_run" forced-failure
  if [ "$ENTRIES_OK" = pass ]; then gate pass "L1 work entries: no new entry after a forced API failure"; else gate fail "L1 work entries: no new entry after a forced API failure ($ENTRIES_OK)"; fi
  cleanup_check "$fail_run" "forced-failure"
  if [ "$K9_OK" = pass ]; then gate pass "K9 cleanup after a forced API failure"; else gate fail "K9 cleanup after a forced API failure"; fi
fi

say ""
say "== K13 a sandboxed loop that outlives a kill"
for layout in L1 L5w; do
  kill_check "$layout"
done

say ""
say "== K11 bubblewrap masked"
nobwrap_check

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
