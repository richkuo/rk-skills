#!/usr/bin/env bash
set -uo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
REPO_ROOT=$(cd "$HERE/../.." && pwd -P)
WORKFLOW="$REPO_ROOT/.github/workflows/claude-run.yml"
EXTRACT="$HERE/extract-step.mjs"
SCRATCH=$(mktemp -d "${TMPDIR:-/tmp}/rk-fixtures.XXXXXXXX")
PASS=0
FAIL=0
LAST_STATUS=0
LAST_LOG=""
SYNTH_TOKEN="ghs_rkprobeSyntheticJobToken0000000000000"

cleanup_scratch() {
  chmod -R u+rwx "$SCRATCH" 2>/dev/null || true
  rm -rf "$SCRATCH"
}
trap cleanup_scratch EXIT

ok() {
  PASS=$((PASS + 1))
  printf 'PASS %s\n' "$1"
}

bad() {
  FAIL=$((FAIL + 1))
  printf 'FAIL %s\n' "$1"
  if [ -n "$LAST_LOG" ] && [ -f "$LAST_LOG" ]; then
    sed 's/^/    | /' "$LAST_LOG"
  fi
}

expect_status() {
  if [ "$LAST_STATUS" = "$1" ]; then ok "$2"; else bad "$2 (exit $LAST_STATUS, expected $1)"; fi
}

expect_output() {
  local file="$1" key="$2" value="$3" label="$4" got
  got=$(grep -E "^${key}=" "$file" 2>/dev/null | tail -n 1 | cut -d= -f2-)
  if [ "$got" = "$value" ]; then ok "$label"; else bad "$label ($key='$got', expected '$value')"; fi
}

expect_log() {
  if grep -qF -- "$1" "$LAST_LOG"; then ok "$2"; else bad "$2 (log lacks: $1)"; fi
}

step_script() {
  local out="$SCRATCH/step-$RANDOM-$RANDOM.sh"
  bun "$EXTRACT" "$WORKFLOW" "$@" > "$out" || { echo "cannot extract step: $1" >&2; exit 2; }
  printf '%s' "$out"
}

run_script() {
  local script="$1"
  shift
  LAST_LOG="$SCRATCH/log-$RANDOM-$RANDOM.txt"
  env "$@" bash --noprofile --norc -eo pipefail "$script" > "$LAST_LOG" 2>&1
  LAST_STATUS=$?
}

contract_env() {
  printf '%s\n' \
    "PATH=$PATH" \
    "HOME=$1" \
    "GITHUB_WORKSPACE=$2" \
    "GITHUB_OUTPUT=$3" \
    "SCRUB=${SCRUB:-true}" \
    "SCRUB_SELF_HOSTED=${SCRUB_SELF_HOSTED:-false}" \
    "SCRUB_OFF_ACCEPTED=${SCRUB_OFF_ACCEPTED:-false}" \
    "REPO_PRIVATE=${REPO_PRIVATE:-false}" \
    "ISSUE_PR_URL=${ISSUE_PR_URL:-}" \
    "ISSUE_AUTHOR_ASSOC=${ISSUE_AUTHOR_ASSOC:-}" \
    "ISSUE_AUTHOR_LOGIN=${ISSUE_AUTHOR_LOGIN:-}" \
    "PR_AUTHOR_ASSOC=${PR_AUTHOR_ASSOC:-}" \
    "PR_AUTHOR_LOGIN=${PR_AUTHOR_LOGIN:-}" \
    "RUNNER_ENVIRONMENT=${RUNNER_ENVIRONMENT_IN:-github-hosted}"
}

run_contract() {
  local home="$1" ws="$2" out="$3" script envs=()
  script=$(step_script "Resolve the review execution contract")
  : > "$out"
  while IFS= read -r line; do envs+=("$line"); done < <(contract_env "$home" "$ws" "$out")
  run_script "$script" -i "${envs[@]}"
}

test_contract() {
  echo "== contract"
  local home="$SCRATCH/contract-home" ws="$SCRATCH/contract-ws" a b
  mkdir -p "$home" "$ws"

  a="$SCRATCH/contract-a.out"
  run_contract "$home" "$ws" "$a"
  expect_status 0 "contract: hosted default runs"
  expect_output "$a" scrub 1 "contract: hosted default keeps the scrub on"
  expect_output "$a" needs_temp_home false "contract: hosted default uses the real home"
  expect_output "$a" stub_scan false "contract: hosted default makes no stubs"
  expect_output "$a" real_home "$home" "contract: records the job home"

  b="$SCRATCH/contract-b.out"
  SCRUB_SELF_HOSTED=true run_contract "$home" "$ws" "$b"
  expect_status 0 "contract: review_subprocess_scrub_self_hosted true runs"
  if cmp -s "$a" "$b"; then ok "contract: review_subprocess_scrub_self_hosted changes no output"; else bad "contract: review_subprocess_scrub_self_hosted changes the outputs"; fi
  expect_log "review_subprocess_scrub_self_hosted is ignored" "contract: notice for the ignored input"

  for assoc in CONTRIBUTOR NONE FIRST_TIME_CONTRIBUTOR ""; do
    for accepted in true false; do
      SCRUB=false SCRUB_OFF_ACCEPTED=$accepted PR_AUTHOR_ASSOC=$assoc PR_AUTHOR_LOGIN=someone run_contract "$home" "$ws" "$SCRATCH/c.out"
      expect_status 1 "contract: scrub off refuses author '${assoc:-empty}' with acceptance $accepted"
      if grep -q '^scrub=' "$SCRATCH/c.out"; then bad "contract: refused run wrote an output"; fi
    done
  done

  for assoc in OWNER MEMBER COLLABORATOR; do
    for accepted in false true; do
      SCRUB=false SCRUB_OFF_ACCEPTED=$accepted PR_AUTHOR_ASSOC=$assoc PR_AUTHOR_LOGIN=trusted run_contract "$home" "$ws" "$SCRATCH/pr.out"
      cp "$LAST_LOG" "$SCRATCH/pr.log"
      local pr_status=$LAST_STATUS
      SCRUB=false SCRUB_OFF_ACCEPTED=$accepted ISSUE_PR_URL=https://api.github.com/repos/o/r/pulls/1 ISSUE_AUTHOR_ASSOC=$assoc ISSUE_AUTHOR_LOGIN=trusted PR_AUTHOR_ASSOC=CONTRIBUTOR run_contract "$home" "$ws" "$SCRATCH/comment.out"
      if [ "$pr_status" = "$LAST_STATUS" ] && cmp -s "$SCRATCH/pr.out" "$SCRATCH/comment.out"; then ok "contract: $assoc with acceptance $accepted gives the same result for review and comment payloads"; else bad "contract: $assoc with acceptance $accepted differs between review and comment payloads"; fi
      if [ "$accepted" = false ]; then
        expect_status 1 "contract: scrub off refuses trusted $assoc without acceptance"
      else
        expect_status 0 "contract: scrub off runs for trusted $assoc with acceptance"
        expect_output "$SCRATCH/comment.out" scrub 0 "contract: accepted scrub off emits scrub=0 for $assoc"
        expect_output "$SCRATCH/comment.out" needs_temp_home false "contract: accepted scrub off uses the real home for $assoc"
        expect_log "tool subprocesses can see the Claude credential" "contract: accepted scrub off warns about the exposure for $assoc"
      fi
    done
  done

  SCRUB=false SCRUB_OFF_ACCEPTED=false PR_AUTHOR_ASSOC=NONE PR_AUTHOR_LOGIN='claude[bot]' run_contract "$home" "$ws" "$SCRATCH/c.out"
  expect_status 1 "contract: scrub off refuses claude[bot] without acceptance"
  SCRUB=false SCRUB_OFF_ACCEPTED=true PR_AUTHOR_ASSOC=NONE PR_AUTHOR_LOGIN='claude[bot]' run_contract "$home" "$ws" "$SCRATCH/c.out"
  expect_status 0 "contract: scrub off runs for claude[bot] with acceptance"
  expect_output "$SCRATCH/c.out" scrub 0 "contract: claude[bot] accepted scrub off emits scrub=0"

  SCRUB=false SCRUB_OFF_ACCEPTED=true ISSUE_PR_URL=https://api.github.com/repos/o/r/pulls/1 ISSUE_AUTHOR_ASSOC=CONTRIBUTOR PR_AUTHOR_ASSOC=OWNER run_contract "$home" "$ws" "$SCRATCH/c.out"
  expect_status 1 "contract: a comment payload reads the issue author, not the pull_request field"

  run_contract "" "$ws" "$SCRATCH/c.out"
  expect_status 1 "contract: an empty HOME stops the run"

  if [ "$(uname -s)" = "Linux" ]; then
    test_contract_linux
  else
    echo "SKIP contract layouts: they need Linux"
  fi
}

test_contract_linux() {
  local root="$SCRATCH/layouts" home ws out
  home="$root/home-a"
  ws="$home/actions-runner/_work/repo/repo"
  mkdir -p "$ws"
  out="$SCRATCH/l1.out"
  RUNNER_ENVIRONMENT_IN=self-hosted run_contract "$home" "$ws" "$out"
  expect_status 0 "contract linux: home-based layout runs"
  expect_output "$out" scrub 1 "contract linux: home-based layout keeps the scrub on"
  expect_output "$out" needs_temp_home true "contract linux: home-based actions-runner layout selects a temporary home"
  expect_output "$out" stub_scan "$([ "$(id -u)" = 0 ] && echo true || echo false)" "contract linux: stub scan follows the user ID"

  ws="$home/runners/r1/_work/repo/repo"
  mkdir -p "$ws"
  RUNNER_ENVIRONMENT_IN=self-hosted run_contract "$home" "$ws" "$out"
  expect_output "$out" needs_temp_home true "contract linux: home-based runners layout selects a temporary home"

  ln -s "$home/actions-runner" "$root/runner-alias"
  RUNNER_ENVIRONMENT_IN=self-hosted run_contract "$home" "$root/runner-alias/_work/repo/repo" "$out"
  expect_output "$out" needs_temp_home true "contract linux: a symlinked path into the home-based layout selects a temporary home"

  mkdir -p "$root/real-runner/_work/repo/repo" "$root/home-b"
  ln -s "$root/real-runner" "$root/home-b/actions-runner"
  RUNNER_ENVIRONMENT_IN=self-hosted run_contract "$root/home-b" "$root/real-runner/_work/repo/repo" "$out"
  expect_output "$out" needs_temp_home true "contract linux: a workspace under the target of a symlinked home actions-runner path selects a temporary home"

  ws="$root/plain/_work/repo/repo"
  mkdir -p "$ws"
  RUNNER_ENVIRONMENT_IN=self-hosted run_contract "$home" "$ws" "$out"
  expect_output "$out" needs_temp_home false "contract linux: a layout outside the home uses the real home"
  expect_output "$out" scrub 1 "contract linux: a layout outside the home keeps the scrub on"

  SCRUB_SELF_HOSTED=true RUNNER_ENVIRONMENT_IN=self-hosted run_contract "$home" "$home/actions-runner/_work/repo/repo" "$SCRATCH/l1b.out"
  RUNNER_ENVIRONMENT_IN=self-hosted run_contract "$home" "$home/actions-runner/_work/repo/repo" "$SCRATCH/l1a.out"
  if cmp -s "$SCRATCH/l1a.out" "$SCRATCH/l1b.out"; then ok "contract linux: review_subprocess_scrub_self_hosted changes no layout output"; else bad "contract linux: review_subprocess_scrub_self_hosted changes the layout outputs"; fi
}

make_guard() {
  local dir="$1" script
  script=$(step_script "Stage the pull request under review" 'rm -f "$GUARD_FILE" "$SETTINGS_FILE"' 'echo "guard_oid=$GUARD_OID" >> "$GITHUB_OUTPUT"')
  run_script "$script" -i "PATH=$PATH" "GUARD_FILE=$dir/guard.sh" "SETTINGS_FILE=$dir/settings.json" "REAL_HOME=$dir/real-home" "AGENT_HOME=$dir/agent-home" "XDG_CONFIG_HOME=$dir/xdg" "GITHUB_OUTPUT=$dir/guard.out"
}

guard_run() {
  local dir="$1"
  shift
  LAST_LOG="$SCRATCH/log-$RANDOM-$RANDOM.txt"
  (cd "$dir/ws" && env -i "PATH=$PATH" "HOME=$dir/agent-home" "GITHUB_WORKSPACE=$dir/ws" "RUNNER_TEMP=$dir/runner-temp" "$@" bash "$dir/guard.sh" ${GUARD_ARGS:-}) > "$LAST_LOG" 2>&1
  LAST_STATUS=$?
}

fresh_guard_tree() {
  local dir="$1"
  rm -rf "$dir"
  mkdir -p "$dir/ws" "$dir/runner-temp" "$dir/real-home/.config/git" "$dir/agent-home/.config/git" "$dir/xdg/git"
  git -C "$dir/ws" init -q
  make_guard "$dir"
}

test_guard() {
  echo "== guard"
  local dir="$SCRATCH/guard" store
  fresh_guard_tree "$dir"
  expect_status 0 "guard: generation runs"
  if head -n 4 "$dir/guard.sh" | grep -q "^RK_REAL_HOME="; then ok "guard: header carries the job home"; else bad "guard: header lacks the job home"; fi
  if [ "$(git hash-object "$dir/guard.sh")" = "$(grep '^guard_oid=' "$dir/guard.out" | cut -d= -f2)" ]; then ok "guard: recorded hash matches the generated file"; else bad "guard: recorded hash differs"; fi

  guard_run "$dir" "GH_TOKEN=$SYNTH_TOKEN"
  expect_status 0 "guard: clean tree passes"

  guard_run "$dir"
  expect_status 2 "guard: empty GH_TOKEN and GITHUB_TOKEN block"

  for store in real-home/.git-credentials real-home/.config/git/credentials agent-home/.git-credentials agent-home/.config/git/credentials xdg/git/credentials runner-temp/leak.txt; do
    fresh_guard_tree "$dir"
    printf 'https://x-access-token:%s@github.com\n' "$SYNTH_TOKEN" > "$dir/$store"
    guard_run "$dir" "GH_TOKEN=$SYNTH_TOKEN"
    expect_status 2 "guard: a token in $store blocks"
    expect_log "$store" "guard: the block names $store"
  done

  fresh_guard_tree "$dir"
  git config --file "$dir/real-home/.gitconfig" http.https://github.com/.extraheader "AUTHORIZATION: basic x"
  guard_run "$dir" "GH_TOKEN=$SYNTH_TOKEN"
  expect_status 2 "guard: an extraheader in the job home gitconfig blocks"

  fresh_guard_tree "$dir"
  git config --file "$dir/agent-home/.gitconfig" rk.leak "$SYNTH_TOKEN"
  guard_run "$dir" "GH_TOKEN=$SYNTH_TOKEN"
  expect_status 2 "guard: a token in the agent home gitconfig blocks"

  fresh_guard_tree "$dir"
  rm -rf "$dir/ws/.git"
  guard_run "$dir" "GH_TOKEN=$SYNTH_TOKEN"
  expect_status 2 "guard: a workspace that git does not open blocks"

  fresh_guard_tree "$dir"
  mkdir -p "$dir/runner-temp/_runner_file_commands"
  printf 'github_token<<ghadelimiter_0123abcd\n%s\nghadelimiter_0123abcd\n' "$SYNTH_TOKEN" > "$dir/runner-temp/_runner_file_commands/set_output_x"
  guard_run "$dir" "GH_TOKEN=$SYNTH_TOKEN"
  expect_status 2 "guard: the action output file blocks before the action ends"
  GUARD_ARGS=--after-action guard_run "$dir" "GH_TOKEN=$SYNTH_TOKEN"
  expect_status 0 "guard: the action output file passes after the action"
}

make_settings() {
  local dir="$1" temp_home="$2" script
  script=$(step_script "Stage the pull request under review" 'cat > "$SETTINGS_FILE" <<EOF' 'chmod 400 "$SETTINGS_FILE"')
  rm -f "$dir/settings.json"
  run_script "$script" -i "PATH=$PATH" "GITHUB_WORKSPACE=$dir/runner/_work/repo/repo" "RUNNER_TEMP=${RUNNER_TEMP_IN:-$dir/runner/_work/_temp}" "SETTINGS_FILE=$dir/settings.json" "GUARD_FILE=$dir/guard.sh" "GUARD_OID=0123" "REAL_HOME=$dir/real-home" "TEMP_AGENT_HOME=$temp_home" "GITHUB_OUTPUT=$dir/settings.out"
}

deny_has() {
  if jq -e --arg p "$2" '.sandbox.filesystem.denyWrite | index($p)' "$1" >/dev/null 2>&1; then ok "$3"; else bad "$3"; fi
}

test_settings() {
  echo "== settings"
  local dir="$SCRATCH/settings" agent="$SCRATCH/settings/agent" hook_cmd
  rm -rf "$dir"
  mkdir -p "$dir/runner/_work/repo/repo" "$dir/runner/_work/_temp" "$dir/runner/bin" "$dir/runner/externals" "$dir/real-home/.ssh" "$agent/.local/bin" "$agent/.bun" "$agent/.config/git"
  touch "$dir/runner/.runner" "$dir/runner/.credentials" "$dir/real-home/.bashrc" "$agent/.gitconfig" "$dir/guard.sh"

  make_settings "$dir" ""
  expect_status 0 "settings: real-home run writes the settings"
  if jq -e '(.sandbox == null) and (.claudeMdExcludes | length) == 10 and (.hooks.PreToolUse | length) == 1' "$dir/settings.json" >/dev/null; then ok "settings: real-home run keeps the baseline settings"; else bad "settings: real-home run changed the baseline settings"; fi

  make_settings "$dir" "$agent"
  expect_status 0 "settings: temporary-home run writes the settings"
  deny_has "$dir/settings.json" "$dir/runner/_work/_temp" "settings: RUNNER_TEMP is protected"
  deny_has "$dir/settings.json" "$agent" "settings: the whole temporary agent home is protected"
  deny_has "$dir/settings.json" "$dir/real-home/.bashrc" "settings: a real-home startup file is protected"
  deny_has "$dir/settings.json" "$dir/real-home/.ssh" "settings: the real-home ssh directory is protected"
  deny_has "$dir/settings.json" "$dir/runner/.credentials" "settings: the runner credential file is protected"
  deny_has "$dir/settings.json" "$dir/runner/bin" "settings: the runner binaries are protected"
  if jq -e '(.claudeMdExcludes | length) == 10 and (.hooks.PreToolUse | length) == 1' "$dir/settings.json" >/dev/null; then ok "settings: temporary-home run keeps the exclusions and the hook"; else bad "settings: temporary-home run lost the exclusions or the hook"; fi
  if jq -e --arg w "$dir/runner/_work/repo/repo" '[.sandbox.filesystem.denyWrite[] | select(($w + "/") | startswith(. + "/"))] | length == 0' "$dir/settings.json" >/dev/null; then ok "settings: no protected path contains the workspace"; else bad "settings: a protected path contains the workspace"; fi

  make_settings "$dir" "$SCRATCH/settings/missing-agent-home"
  expect_status 1 "settings: a missing required target stops the run"

  RUNNER_TEMP_IN="$dir/runner/_work" make_settings "$dir" "$agent"
  expect_status 1 "settings: a protected path that contains the workspace stops the run"

  make_settings "$dir" ""
  hook_cmd=$(jq -r '.hooks.PreToolUse[0].hooks[0].command' "$dir/settings.json")
  printf 'exit 0\n' > "$dir/guard.sh"
  LAST_LOG="$SCRATCH/hook.log"
  bash -c "$hook_cmd" > "$LAST_LOG" 2>&1
  LAST_STATUS=$?
  expect_status 2 "settings: the hook refuses a guard whose hash changed"
}

test_cleanup() {
  echo "== cleanup"
  local script t target
  script=$(step_script "Empty the temporary agent home")
  target="$SCRATCH/outside-target"
  printf 'keep\n' > "$target"

  t=$(mktemp -d /tmp/rk-claude-home.XXXXXXXXXX)
  mkdir -p "$t/.local/bin" "$t/.bun/bin" "$t/deep/a/b" "$t/locked"
  printf 'x\n' > "$t/.local/bin/claude"
  printf 'x\n' > "$t/deep/a/b/file"
  ln -s "$target" "$t/link-to-outside"
  ln -s "$SCRATCH" "$t/link-to-dir"
  printf 'x\n' > "$t/locked/file"
  chmod 000 "$t/locked"
  run_script "$script" -i "PATH=$PATH" "TEMP_AGENT_HOME=$t"
  expect_status 0 "cleanup: a populated home is emptied"
  if [ -d "$t" ] && [ -z "$(ls -A "$t")" ]; then ok "cleanup: the home is empty and still exists"; else bad "cleanup: the home is missing or not empty"; fi
  if [ "$(find "$t" -maxdepth 0 -perm 700 -print)" = "$t" ]; then ok "cleanup: the home is mode 0700"; else bad "cleanup: the home is not mode 0700"; fi
  if [ "$(cat "$target")" = keep ] && [ -d "$SCRATCH" ]; then ok "cleanup: symlink targets are untouched"; else bad "cleanup: a symlink target changed"; fi
  rmdir "$t"

  t=$(mktemp -d /tmp/rk-claude-home.XXXXXXXXXX)
  rmdir "$t"
  mkdir -p "$SCRATCH/link-target"
  printf 'keep\n' > "$SCRATCH/link-target/file"
  ln -s "$SCRATCH/link-target" "$t"
  run_script "$script" -i "PATH=$PATH" "TEMP_AGENT_HOME=$t"
  expect_status 1 "cleanup: a symlink in place of the home is refused"
  if [ -f "$SCRATCH/link-target/file" ]; then ok "cleanup: the symlink target is untouched"; else bad "cleanup: the symlink target changed"; fi
  rm -f "$t"

  t=$(mktemp -d /tmp/rk-claude-home.XXXXXXXXXX)
  rmdir "$t"
  printf 'x\n' > "$t"
  run_script "$script" -i "PATH=$PATH" "TEMP_AGENT_HOME=$t"
  expect_status 1 "cleanup: a file in place of the home is refused"
  rm -f "$t"

  mkdir -p "$SCRATCH/not-a-home"
  run_script "$script" -i "PATH=$PATH" "TEMP_AGENT_HOME=$SCRATCH/not-a-home"
  expect_status 1 "cleanup: a path with another name is refused"

  if [ "$(id -u)" = 0 ] && [ -n "${RK_PROBE_USER:-}" ]; then
    t=$(mktemp -d /tmp/rk-claude-home.XXXXXXXXXX)
    printf 'x\n' > "$t/file"
    chown -R "$RK_PROBE_USER" "$t"
    run_script "$script" -i "PATH=$PATH" "TEMP_AGENT_HOME=$t"
    expect_status 1 "cleanup: a home owned by another user is refused"
    if [ -f "$t/file" ]; then ok "cleanup: the other user's home is untouched"; else bad "cleanup: the other user's home changed"; fi
    rm -rf "$t"
  else
    echo "SKIP cleanup wrong-owner case: it needs root and RK_PROBE_USER"
  fi
}

test_agent_home() {
  echo "== agent home"
  if [ "$(uname -s)" != "Linux" ]; then
    echo "SKIP agent home: it needs Linux"
    return
  fi
  local script out ws="$SCRATCH/ah-ws" t
  mkdir -p "$ws"
  script=$(step_script "Select the agent home")
  out="$SCRATCH/ah.out"
  : > "$out"
  run_script "$script" -i "PATH=$PATH" "HOME=$SCRATCH" "GITHUB_WORKSPACE=$ws" "GITHUB_OUTPUT=$out" "NEEDS_TEMP_HOME=false"
  expect_status 0 "agent home: real-home selection runs"
  expect_output "$out" path "$SCRATCH" "agent home: real-home selection keeps HOME"
  expect_output "$out" temp "" "agent home: real-home selection has no temporary home"

  : > "$out"
  run_script "$script" -i "PATH=$PATH" "HOME=$SCRATCH" "GITHUB_WORKSPACE=$ws" "GITHUB_OUTPUT=$out" "NEEDS_TEMP_HOME=true"
  expect_status 0 "agent home: temporary-home selection runs"
  t=$(grep '^temp=' "$out" | cut -d= -f2-)
  case "$t" in
    /tmp/rk-claude-home.??????????) ok "agent home: the temporary home has the expected name" ;;
    *) bad "agent home: unexpected temporary home '$t'" ;;
  esac
  expect_output "$out" path "$t" "agent home: HOME is the temporary home"
  if [ -d "$t" ] && [ "$(stat -c '%a %u' "$t")" = "700 $(id -u)" ]; then ok "agent home: the temporary home is mode 0700 and owned by this user"; else bad "agent home: wrong mode or owner on $t"; fi
  if git config --file "$t/.gitconfig" --get-all safe.directory | grep -qxF "$ws"; then ok "agent home: safe.directory names the workspace"; else bad "agent home: safe.directory lacks the workspace"; fi
  rm -rf "$t"
}

stub_run() {
  local ws="$1" script
  script=$(step_script "Prepare workspace ancestor stubs for the scrub sandbox")
  run_script "$script" -i "PATH=$PATH" "GITHUB_WORKSPACE=$ws"
}

test_stubs() {
  echo "== stubs"
  if [ "$(uname -s)" != "Linux" ] || [ "$(id -u)" != 0 ] || [ -z "${RK_PROBE_USER:-}" ]; then
    echo "SKIP stubs: they need Linux, root, and RK_PROBE_USER"
    return
  fi
  local root="$SCRATCH/stubs" foreign ws pids
  rm -rf "$root"
  mkdir -p "$root/runner-x/_work/repo/repo"
  chmod 755 "$SCRATCH" "$root"
  foreign="$root/runner-x"
  ws="$foreign/_work/repo/repo"
  chown "$RK_PROBE_USER" "$foreign"

  stub_run "$ws"
  expect_status 0 "stubs: first apply runs"
  if [ "$(stat -c '%F %u %a' "$foreign/.claude")" = "directory 0 755" ]; then ok "stubs: .claude is a root-owned 0755 directory"; else bad "stubs: .claude has the wrong type, owner, or mode"; fi
  if [ "$(stat -c '%F %u %a' "$foreign/.mcp.json")" = "regular file 0 644" ]; then ok "stubs: .mcp.json is a root-owned 0644 file"; else bad "stubs: .mcp.json has the wrong type, owner, or mode"; fi
  if [ ! -e "$foreign/_work/.claude" ] && [ ! -e "$root/.claude" ]; then ok "stubs: root-owned ancestors get no stubs"; else bad "stubs: a root-owned ancestor got a stub"; fi
  if compgen -G "$foreign/.mcp.json.rk-*" >/dev/null; then bad "stubs: a temporary file was left behind"; else ok "stubs: no temporary file is left"; fi

  stub_run "$ws"
  expect_status 0 "stubs: second apply runs"
  expect_log "kept: $foreign/.claude" "stubs: second apply keeps .claude"
  expect_log "kept: $foreign/.mcp.json" "stubs: second apply keeps .mcp.json"

  rm -rf "$foreign/.claude" "$foreign/.mcp.json"
  pids=""
  for n in 1 2 3 4; do
    (stub_run "$ws"; echo "$LAST_STATUS" > "$SCRATCH/par-$n") &
    pids="$pids $!"
  done
  wait $pids
  if [ "$(cat "$SCRATCH"/par-*)" = "$(printf '0\n0\n0\n0')" ]; then ok "stubs: parallel applies all succeed"; else bad "stubs: a parallel apply failed"; fi
  if [ "$(cat "$foreign/.mcp.json")" = '{"mcpServers":{}}' ]; then ok "stubs: parallel applies leave one complete .mcp.json"; else bad "stubs: .mcp.json content is wrong after parallel applies"; fi

  rm -rf "$foreign/.claude" "$foreign/.mcp.json"
  ln -s /etc "$foreign/.claude"
  stub_run "$ws"
  expect_status 1 "stubs: a symlinked .claude is refused"
  if [ "$(readlink "$foreign/.claude")" = /etc ]; then ok "stubs: the symlink is unchanged"; else bad "stubs: the symlink changed"; fi
  rm -f "$foreign/.claude" "$foreign/.mcp.json"

  printf 'x' > "$foreign/.claude"
  stub_run "$ws"
  expect_status 1 "stubs: a file named .claude is refused"
  rm -f "$foreign/.claude" "$foreign/.mcp.json"
  rm -rf "$foreign/.claude"

  mkdir "$foreign/.mcp.json"
  stub_run "$ws"
  expect_status 1 "stubs: a directory named .mcp.json is refused"
  rmdir "$foreign/.mcp.json"

  ln -s /etc/hostname "$foreign/.mcp.json"
  stub_run "$ws"
  expect_status 1 "stubs: a symlinked .mcp.json is refused"
  rm -f "$foreign/.mcp.json"

  rm -rf "$foreign/.claude" "$foreign/.mcp.json"
  mkdir -p "$root/other/_work/repo/repo"
  chown "$RK_PROBE_USER" "$root/other"
  mv "$foreign" "$root/runner-real"
  ln -s "$root/other" "$foreign"
  stub_run "$ws"
  expect_status 0 "stubs: a symlinked ancestor path runs"
  if [ -d "$root/other/.claude" ] && [ ! -L "$root/other/.claude" ] && [ ! -e "$root/runner-real/.claude" ]; then ok "stubs: a symlinked ancestor gets stubs only at its canonical path"; else bad "stubs: a symlinked ancestor was not handled at its canonical path"; fi
  rm -f "$foreign"
  mv "$root/runner-real" "$foreign"

  mkdir -p "$root/plain/_work/repo/repo"
  stub_run "$root/plain/_work/repo/repo"
  expect_status 0 "stubs: a root-owned layout runs"
  if [ -z "$(find "$root/plain" -name .claude -o -name .mcp.json)" ]; then ok "stubs: a root-owned layout gets no stubs"; else bad "stubs: a root-owned layout got stubs"; fi
}

for tool in bun git jq; do
  command -v "$tool" >/dev/null 2>&1 || { echo "missing $tool" >&2; exit 2; }
done

SUITES=("$@")
[ "${#SUITES[@]}" -gt 0 ] || SUITES=(contract guard settings cleanup agent_home stubs)
for suite in "${SUITES[@]}"; do
  case "$suite" in
    contract) test_contract ;;
    guard) test_guard ;;
    settings) test_settings ;;
    cleanup) test_cleanup ;;
    agent_home) test_agent_home ;;
    stubs) test_stubs ;;
    *) echo "unknown suite: $suite" >&2; exit 2 ;;
  esac
done

echo "fixtures: $PASS passed, $FAIL failed"
[ "$FAIL" = 0 ]
