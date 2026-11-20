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
  expect_output "$a" home_parent_deny false "contract: hosted default protects no home parent"
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
  expect_output "$out" home_parent_deny true "contract linux: a self-hosted Linux review protects the temporary home parent"

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
  expect_output "$out" home_parent_deny true "contract linux: a layout outside the home still protects the temporary home parent"

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
  local dir="$1" temp_home="$2" parent="${3:-}" parent_deny="${4:-}" script
  if [ -z "$parent_deny" ]; then
    if [ -n "$parent" ]; then parent_deny=true; else parent_deny=false; fi
  fi
  script=$(step_script "Stage the pull request under review" 'cat > "$SETTINGS_FILE" <<EOF' 'chmod 400 "$SETTINGS_FILE"')
  rm -f "$dir/settings.json"
  run_script "$script" -i "PATH=$PATH" "GITHUB_WORKSPACE=$dir/runner/_work/repo/repo" "RUNNER_TEMP=${RUNNER_TEMP_IN:-$dir/runner/_work/_temp}" "RUNNER_TOOL_CACHE=${RUNNER_TOOL_CACHE_IN:-}" "SETTINGS_FILE=$dir/settings.json" "GUARD_FILE=$dir/guard.sh" "GUARD_OID=0123" "REAL_HOME=$dir/real-home" "TEMP_AGENT_HOME=$temp_home" "HOME_PARENT=$parent" "HOME_PARENT_DENY=$parent_deny" "GITHUB_OUTPUT=$dir/settings.out"
}

deny_has() {
  if jq -e --arg p "$2" '.sandbox.filesystem.denyWrite | index($p)' "$1" >/dev/null 2>&1; then ok "$3"; else bad "$3"; fi
}

test_settings() {
  echo "== settings"
  local dir="$SCRATCH/settings" parent="$SCRATCH/settings/homes" agent="$SCRATCH/settings/homes/agent" hook_cmd
  rm -rf "$dir"
  mkdir -p "$dir/runner/_work/repo/repo" "$dir/runner/_work/_temp" "$dir/runner/_work/_actions/owner/action/pin/bin" "$dir/runner/_work/other/other/.git" "$dir/runner/bin" "$dir/runner/externals" "$dir/real-home/.ssh" "$agent/.local/bin" "$agent/.bun/bin" "$agent/.config/git" "$agent/.config/pip" "$agent/.config/gh" "$agent/.pip" "$agent/.ssh" "$agent/.claude"
  touch "$dir/runner/.runner" "$dir/runner/.credentials" "$dir/real-home/.bashrc" "$dir/real-home/.bash_profile" "$dir/real-home/.npmrc" "$dir/guard.sh"
  for f in .bashrc .bash_profile .bash_login .bash_logout .profile .zshrc .zshenv .zprofile .zlogin .zlogout .bunfig.toml .npmrc .yarnrc .yarnrc.yml .netrc .gitconfig .claude.json; do
    touch "$agent/$f"
  done

  make_settings "$dir" ""
  expect_status 0 "settings: real-home run writes the settings"
  if jq -e '(.sandbox == null) and (.claudeMdExcludes | length) == 10 and (.hooks.PreToolUse | length) == 1' "$dir/settings.json" >/dev/null; then ok "settings: real-home run keeps the baseline settings"; else bad "settings: real-home run changed the baseline settings"; fi

  make_settings "$dir" "" "$parent"
  expect_status 0 "settings: real-home run on self-hosted Linux writes the settings"
  deny_has "$dir/settings.json" "$parent" "settings: real-home run on self-hosted Linux protects the temporary home parent"
  deny_has "$dir/settings.json" "$dir/runner/_work/_temp" "settings: real-home run on self-hosted Linux protects RUNNER_TEMP"
  deny_has "$dir/settings.json" "$dir/runner/.credentials" "settings: real-home run on self-hosted Linux protects the runner credential file"
  deny_has "$dir/settings.json" "$dir/real-home/.bashrc" "settings: real-home run on self-hosted Linux protects a job home startup file"

  make_settings "$dir" "" "$dir/missing-parent"
  expect_status 1 "settings: a missing temporary home parent stops the run"

  make_settings "$dir" "" "" true
  expect_status 0 "settings: a self-hosted Linux run with no usable home parent writes the settings"
  deny_has "$dir/settings.json" "$dir/runner/_work/_temp" "settings: a self-hosted Linux run with no usable home parent still protects RUNNER_TEMP"
  deny_has "$dir/settings.json" "$dir/runner/.credentials" "settings: a self-hosted Linux run with no usable home parent still protects the runner credential file"
  if jq -e --arg p "$parent" '.sandbox.filesystem.denyWrite | index($p) | not' "$dir/settings.json" >/dev/null 2>&1; then ok "settings: a self-hosted Linux run with no usable home parent adds no parent entry"; else bad "settings: a self-hosted Linux run with no usable home parent added a parent entry"; fi

  make_settings "$dir" "$agent" "$parent"
  expect_status 0 "settings: temporary-home run writes the settings"
  deny_has "$dir/settings.json" "$dir/runner/_work/_temp" "settings: RUNNER_TEMP is protected"
  deny_has "$dir/settings.json" "$parent" "settings: the parent of every temporary home is protected"
  deny_has "$dir/settings.json" "$dir/real-home/.bashrc" "settings: a real-home startup file is protected"
  deny_has "$dir/settings.json" "$dir/real-home/.bash_profile" "settings: the real-home .bash_profile is protected"
  deny_has "$dir/settings.json" "$dir/real-home/.npmrc" "settings: the real-home .npmrc is protected"
  deny_has "$dir/settings.json" "$dir/real-home/.ssh" "settings: the real-home ssh directory is protected"
  deny_has "$dir/settings.json" "$dir/runner/.credentials" "settings: the runner credential file is protected"
  deny_has "$dir/settings.json" "$dir/runner/bin" "settings: the runner binaries are protected"
  deny_has "$dir/settings.json" "$agent/.local/bin" "settings: the temporary home program directory that the action adds to PATH is protected"
  deny_has "$dir/settings.json" "$agent/.bun" "settings: the temporary home Bun directory that the action adds to PATH is protected"
  deny_has "$dir/settings.json" "$agent/.gitconfig" "settings: the temporary home git config is protected"
  deny_has "$dir/settings.json" "$agent/.config/git" "settings: the temporary home git config directory is protected"
  deny_has "$dir/settings.json" "$agent/.ssh" "settings: the temporary home ssh directory is protected"
  if jq -e '(.claudeMdExcludes | length) == 10 and (.hooks.PreToolUse | length) == 1' "$dir/settings.json" >/dev/null; then ok "settings: temporary-home run keeps the exclusions and the hook"; else bad "settings: temporary-home run lost the exclusions or the hook"; fi
  if jq -e --arg w "$dir/runner/_work/repo/repo" '[.sandbox.filesystem.denyWrite[] | select(($w + "/") | startswith(. + "/"))] | length == 0' "$dir/settings.json" >/dev/null; then ok "settings: no protected path contains the workspace"; else bad "settings: a protected path contains the workspace"; fi

  deny_has "$dir/settings.json" "$dir/runner/_work/_actions" "settings: the runner action cache is protected"
  deny_has "$dir/settings.json" "$dir/runner/_work/other" "settings: another workspace of the runner is protected"
  if jq -e --arg p "$dir/runner/_work/repo" '.sandbox.filesystem.denyWrite | index($p) | not' "$dir/settings.json" >/dev/null 2>&1; then ok "settings: the work directory entry that holds the workspace is not protected"; else bad "settings: the work directory entry that holds the workspace is protected"; fi

  rm -rf "$dir/tool-cache"
  RUNNER_TOOL_CACHE_IN="$dir/tool-cache" make_settings "$dir" "$agent" "$parent"
  expect_status 0 "settings: a run with a missing tool cache writes the settings"
  if [ -d "$dir/tool-cache" ]; then ok "settings: a missing tool cache is created"; else bad "settings: the missing tool cache was not created"; fi
  deny_has "$dir/settings.json" "$dir/tool-cache" "settings: the tool cache is protected"

  RUNNER_TEMP_IN="$dir/missing-runner-temp" make_settings "$dir" "$agent" "$parent"
  expect_status 1 "settings: a missing required target stops the run"

  mv "$agent/.local/bin" "$agent/.local/bin.away"
  make_settings "$dir" "$agent" "$parent"
  expect_status 1 "settings: a missing temporary home entry stops the run"
  mv "$agent/.local/bin.away" "$agent/.local/bin"

  RUNNER_TEMP_IN="$dir/runner/_work" make_settings "$dir" "$agent" "$parent"
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
  local script t target parent
  script=$(step_script "Empty the temporary agent home")
  parent="$SCRATCH/cleanup-home/.rk-claude-homes"
  mkdir -p "$parent"
  chmod 700 "$parent"
  target="$SCRATCH/outside-target"
  printf 'keep\n' > "$target"

  t=$(mktemp -d "$parent/home.XXXXXXXXXX")
  mkdir -p "$t/.local/bin" "$t/.bun/bin" "$t/deep/a/b" "$t/locked"
  printf 'x\n' > "$t/.local/bin/claude"
  printf 'x\n' > "$t/deep/a/b/file"
  ln -s "$target" "$t/link-to-outside"
  ln -s "$SCRATCH" "$t/link-to-dir"
  printf 'x\n' > "$t/locked/file"
  chmod 000 "$t/locked"
  run_script "$script" -i "PATH=$PATH" "TEMP_AGENT_HOME=$t" "HOME_PARENT=$parent"
  expect_status 0 "cleanup: a populated home is emptied"
  if [ -d "$t" ] && [ -z "$(ls -A "$t")" ]; then ok "cleanup: the home is empty and still exists"; else bad "cleanup: the home is missing or not empty"; fi
  if [ "$(find "$t" -maxdepth 0 -perm 700 -print)" = "$t" ]; then ok "cleanup: the home is mode 0700"; else bad "cleanup: the home is not mode 0700"; fi
  if [ "$(cat "$target")" = keep ] && [ -d "$SCRATCH" ]; then ok "cleanup: symlink targets are untouched"; else bad "cleanup: a symlink target changed"; fi
  rmdir "$t"

  t=$(mktemp -d "$parent/home.XXXXXXXXXX")
  rmdir "$t"
  mkdir -p "$SCRATCH/link-target"
  printf 'keep\n' > "$SCRATCH/link-target/file"
  ln -s "$SCRATCH/link-target" "$t"
  run_script "$script" -i "PATH=$PATH" "TEMP_AGENT_HOME=$t" "HOME_PARENT=$parent"
  expect_status 1 "cleanup: a symlink in place of the home is refused"
  if [ -f "$SCRATCH/link-target/file" ]; then ok "cleanup: the symlink target is untouched"; else bad "cleanup: the symlink target changed"; fi
  rm -f "$t"

  t=$(mktemp -d "$parent/home.XXXXXXXXXX")
  rmdir "$t"
  printf 'x\n' > "$t"
  run_script "$script" -i "PATH=$PATH" "TEMP_AGENT_HOME=$t" "HOME_PARENT=$parent"
  expect_status 1 "cleanup: a file in place of the home is refused"
  rm -f "$t"

  mkdir -p "$SCRATCH/not-a-home"
  run_script "$script" -i "PATH=$PATH" "TEMP_AGENT_HOME=$SCRATCH/not-a-home" "HOME_PARENT=$parent"
  expect_status 1 "cleanup: a path with another name is refused"

  t=$(mktemp -d /tmp/rk-claude-home.XXXXXXXXXX)
  run_script "$script" -i "PATH=$PATH" "TEMP_AGENT_HOME=$t" "HOME_PARENT=$parent"
  expect_status 1 "cleanup: a home outside this user's parent directory is refused"
  rmdir "$t"

  t=$(mktemp -d "$parent/home.XXXXXXXXXX")
  printf 'x\n' > "$t/file"
  run_script "$script" -i "PATH=$PATH" "TEMP_AGENT_HOME=$t"
  expect_status 1 "cleanup: a home with no parent directory output is refused"
  run_script "$script" -i "PATH=$PATH" "TEMP_AGENT_HOME=$t" "HOME_PARENT=$SCRATCH/cleanup-home"
  expect_status 1 "cleanup: a parent directory with another name is refused"
  mkdir -p "$SCRATCH/cleanup-alias"
  ln -s "$parent" "$SCRATCH/cleanup-alias/.rk-claude-homes"
  run_script "$script" -i "PATH=$PATH" "TEMP_AGENT_HOME=$SCRATCH/cleanup-alias/.rk-claude-homes/$(basename "$t")" "HOME_PARENT=$SCRATCH/cleanup-alias/.rk-claude-homes"
  expect_status 1 "cleanup: a symlinked parent directory is refused"
  if [ -f "$t/file" ]; then ok "cleanup: a refused home is untouched"; else bad "cleanup: a refused home changed"; fi
  rm -rf "$t"

  if [ "$(id -u)" = 0 ] && [ -n "${RK_PROBE_USER:-}" ]; then
    t=$(mktemp -d "$parent/home.XXXXXXXXXX")
    printf 'x\n' > "$t/file"
    chown -R "$RK_PROBE_USER" "$t"
    run_script "$script" -i "PATH=$PATH" "TEMP_AGENT_HOME=$t" "HOME_PARENT=$parent"
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
  local script out ws="$SCRATCH/ah-ws" t parent pw_home old_empty old_full fresh_empty
  mkdir -p "$ws"
  script=$(step_script "Select the agent home")
  out="$SCRATCH/ah.out"
  : > "$out"
  run_script "$script" -i "PATH=$PATH" "HOME=$SCRATCH" "GITHUB_WORKSPACE=$ws" "GITHUB_OUTPUT=$out" "NEEDS_TEMP_HOME=false"
  expect_status 0 "agent home: real-home selection runs"
  expect_output "$out" path "$SCRATCH" "agent home: real-home selection keeps HOME"
  expect_output "$out" temp "" "agent home: real-home selection has no temporary home"

  expect_output "$out" parent "" "agent home: real-home selection off self-hosted Linux has no home parent"
  if [ ! -e "$SCRATCH/.bun" ]; then ok "agent home: real-home selection off self-hosted Linux creates no program directory"; else bad "agent home: real-home selection off self-hosted Linux created $SCRATCH/.bun"; fi

  pw_home=$(getent passwd "$(id -u)" | cut -d: -f6)
  parent="$(cd -P "$pw_home" && pwd -P)/.rk-claude-homes"
  if [ ! -e "$parent" ] && [ ! -L "$parent" ]; then
    mkdir -p "$SCRATCH/parent-target"
    ln -s "$SCRATCH/parent-target" "$parent"
    : > "$out"
    run_script "$script" -i "PATH=$PATH" "HOME=$SCRATCH" "GITHUB_WORKSPACE=$ws" "GITHUB_OUTPUT=$out" "NEEDS_TEMP_HOME=true" "HOME_PARENT_DENY=true"
    expect_status 1 "agent home: a symlink in place of the home parent is refused"
    if [ -z "$(ls -A "$SCRATCH/parent-target")" ]; then ok "agent home: the symlink target is untouched"; else bad "agent home: a home was created through the symlink"; fi
    rm -f "$parent"
  else
    echo "SKIP agent home symlinked parent case: $parent already exists"
  fi

  : > "$out"
  run_script "$script" -i "PATH=$PATH" "HOME=$SCRATCH" "GITHUB_WORKSPACE=$ws" "GITHUB_OUTPUT=$out" "NEEDS_TEMP_HOME=false" "HOME_PARENT_DENY=true"
  expect_status 0 "agent home: real-home selection on self-hosted Linux runs"
  expect_output "$out" path "$SCRATCH" "agent home: real-home selection on self-hosted Linux keeps HOME"
  expect_output "$out" parent "$parent" "agent home: real-home selection on self-hosted Linux names the home parent"
  if grep -qF '. "$HOME/.profile"' "$SCRATCH/.bash_profile" 2>/dev/null; then ok "agent home: real-home selection on self-hosted Linux creates a .bash_profile that loads .profile"; else bad "agent home: real-home selection on self-hosted Linux did not create the .bash_profile loader"; fi
  if [ -d "$SCRATCH/.local/bin" ] && [ -d "$SCRATCH/.bun/bin" ]; then ok "agent home: real-home selection on self-hosted Linux creates the program directories that the action adds to PATH"; else bad "agent home: real-home selection on self-hosted Linux did not create .local/bin and .bun/bin"; fi
  if [ -d "$parent" ] && [ ! -L "$parent" ] && [ "$(stat -c '%a %u' "$parent")" = "700 $(id -u)" ]; then ok "agent home: the home parent is a mode-0700 directory owned by this user"; else bad "agent home: wrong type, mode, or owner on $parent"; fi
  case "$parent" in
    /tmp/*) bad "agent home: the home parent is in /tmp, where another user ID can create it first" ;;
    *) ok "agent home: the home parent is in the passwd home directory of this user" ;;
  esac

  old_empty=$(mktemp -d "$parent/home.XXXXXXXXXX")
  old_full=$(mktemp -d "$parent/home.XXXXXXXXXX")
  fresh_empty=$(mktemp -d "$parent/home.XXXXXXXXXX")
  printf 'x\n' > "$old_full/.bashrc"
  touch -d '2 days ago' "$old_empty" "$old_full"
  : > "$out"
  run_script "$script" -i "PATH=$PATH" "HOME=$SCRATCH" "GITHUB_WORKSPACE=$ws" "GITHUB_OUTPUT=$out" "NEEDS_TEMP_HOME=false" "HOME_PARENT_DENY=true"
  expect_status 0 "agent home: a run with old homes in the parent runs"
  if [ ! -e "$old_empty" ]; then ok "agent home: an empty home older than one day is removed"; else bad "agent home: an empty home older than one day stays"; fi
  if [ -f "$old_full/.bashrc" ]; then ok "agent home: an old home that is not empty is kept"; else bad "agent home: an old home that is not empty was removed"; fi
  if [ -d "$fresh_empty" ]; then ok "agent home: a new empty home is kept"; else bad "agent home: a new empty home was removed"; fi
  rm -rf "$old_full" "$fresh_empty"

  : > "$out"
  run_script "$script" -i "PATH=$PATH" "HOME=$SCRATCH" "GITHUB_WORKSPACE=$ws" "GITHUB_OUTPUT=$out" "NEEDS_TEMP_HOME=true" "HOME_PARENT_DENY=false"
  expect_status 1 "agent home: a temporary home without a protected parent is refused"

  mkdir -p "$SCRATCH/ah-home/.config"
  printf 'keep\n' > "$SCRATCH/ah-home/.bashrc"
  printf 'keep\n' > "$SCRATCH/ah-home/.config/keep"
  : > "$out"
  run_script "$script" -i "PATH=$PATH" "HOME=$SCRATCH/ah-home" "GITHUB_WORKSPACE=$ws" "GITHUB_OUTPUT=$out" "NEEDS_TEMP_HOME=true" "HOME_PARENT_DENY=true"
  expect_status 0 "agent home: temporary-home selection runs"
  if [ "$(cat "$SCRATCH/ah-home/.bashrc")" = keep ] && [ "$(cat "$SCRATCH/ah-home/.config/keep")" = keep ]; then ok "agent home: existing job home entries are unchanged"; else bad "agent home: an existing job home entry changed"; fi
  if [ -f "$SCRATCH/ah-home/.bash_profile" ] && grep -qF '. "$HOME/.profile"' "$SCRATCH/ah-home/.bash_profile" && [ -f "$SCRATCH/ah-home/.bash_login" ] && [ -f "$SCRATCH/ah-home/.git-credentials" ] && [ -f "$SCRATCH/ah-home/.npmrc" ] && [ -d "$SCRATCH/ah-home/.ssh" ] && [ -d "$SCRATCH/ah-home/.local/bin" ] && [ -d "$SCRATCH/ah-home/.config/gh" ] && [ "$(cat "$SCRATCH/ah-home/.claude.json")" = '{}' ]; then ok "agent home: missing protected job home entries are created"; else bad "agent home: a missing protected job home entry was not created"; fi
  if [ -d "$SCRATCH/ah-home/.bun/bin" ]; then ok "agent home: a missing job home Bun directory is created"; else bad "agent home: the job home Bun directory was not created"; fi
  if [ "$(stat -c '%a' "$SCRATCH/ah-home/.git-credentials") $(stat -c '%a' "$SCRATCH/ah-home/.ssh")" = "600 700" ]; then ok "agent home: created job home entries have no group or other permissions"; else bad "agent home: a created job home entry is open to group or others"; fi
  printf 'export RK_LATE=late\n' > "$SCRATCH/ah-home/.bash_login"
  login_env=$(env -i "HOME=$SCRATCH/ah-home" PATH=/usr/bin:/bin bash -l -c 'printf %s "${RK_LATE:-}"' 2>/dev/null)
  if [ "$login_env" = late ]; then ok "agent home: a bash login shell reads content written later to the created .bash_login"; else bad "agent home: a bash login shell skips content written later to the created .bash_login ('$login_env')"; fi
  t=$(grep '^temp=' "$out" | cut -d= -f2-)
  for variant in profile login; do
    vhome="$SCRATCH/ah-$variant"
    mkdir -p "$vhome"
    printf 'export RK_PROFILE_MARK=profile\n' > "$vhome/.profile"
    if [ "$variant" = login ]; then printf 'export RK_LOGIN_MARK=login\n' > "$vhome/.bash_login"; fi
    vout="$SCRATCH/ah-$variant.out"
    : > "$vout"
    run_script "$script" -i "PATH=$PATH" "HOME=$vhome" "GITHUB_WORKSPACE=$ws" "GITHUB_OUTPUT=$vout" "NEEDS_TEMP_HOME=true" "HOME_PARENT_DENY=true"
    expect_status 0 "agent home: temporary-home selection with a job home .$variant runs"
    login_env=$(env -i "HOME=$vhome" PATH=/usr/bin:/bin bash -l -c 'printf "%s-%s" "${RK_LOGIN_MARK:-}" "${RK_PROFILE_MARK:-}"' 2>/dev/null)
    if [ "$variant" = profile ]; then want="-profile"; else want="login-"; fi
    if [ -f "$vhome/.bash_profile" ] && [ "$login_env" = "$want" ]; then ok "agent home: with a job home .$variant and no .bash_profile, a bash login shell reads the same file as before"; else bad "agent home: with a job home .$variant, a bash login shell gave '$login_env', expected '$want'"; fi
    vt=$(grep '^temp=' "$vout" | cut -d= -f2-)
    case "$vt" in "$parent"/home.??????????) rm -rf "$vt" ;; esac
  done
  case "$t" in
    "$parent"/home.??????????) ok "agent home: the temporary home is in the protected parent" ;;
    *) bad "agent home: unexpected temporary home '$t'" ;;
  esac
  expect_output "$out" path "$t" "agent home: HOME is the temporary home"
  expect_output "$out" parent "$parent" "agent home: the output names the home parent"
  if [ -d "$t" ] && [ "$(stat -c '%a %u' "$t")" = "700 $(id -u)" ]; then ok "agent home: the temporary home is mode 0700 and owned by this user"; else bad "agent home: wrong mode or owner on $t"; fi
  if git config --file "$t/.gitconfig" --get-all safe.directory | grep -qxF "$ws"; then ok "agent home: safe.directory names the workspace"; else bad "agent home: safe.directory lacks the workspace"; fi
  if [ -f "$t/.bash_login" ] && [ -f "$t/.npmrc" ] && [ -d "$t/.local/bin" ] && [ -d "$t/.config/gh" ] && [ "$(cat "$t/.claude.json")" = '{}' ]; then ok "agent home: the sandbox's own home entries exist before the run"; else bad "agent home: a sandbox home entry is missing"; fi
  if [ -d "$t/.bun/bin" ]; then ok "agent home: the temporary home Bun directory exists before the run"; else bad "agent home: the temporary home Bun directory is missing"; fi
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

  local uhome uid
  uhome=$(getent passwd "$RK_PROBE_USER" | cut -d: -f6)
  uid=$(id -u "$RK_PROBE_USER")
  if [ -z "$uhome" ] || [ ! -d "$uhome" ] || [ "$(stat -c %u "$uhome")" != "$uid" ] || [ -e "$uhome/.claude" ] || [ -e "$uhome/.mcp.json" ] || [ -e "$uhome/rk-fixture-runner" ]; then
    echo "SKIP stubs home case: $RK_PROBE_USER needs an own home with no .claude, .mcp.json, or rk-fixture-runner"
    return
  fi
  mkdir -p "$uhome/rk-fixture-runner/_work/repo/repo"
  stub_run "$uhome/rk-fixture-runner/_work/repo/repo"
  expect_status 0 "stubs: a workspace under a user's home runs"
  if [ "$(stat -c '%F %u %a' "$uhome/.claude")" = "directory 0 755" ]; then ok "stubs: a new .claude in a user's home is a root-owned 0755 directory"; else bad "stubs: a new .claude in a user's home has the wrong type, owner, or mode"; fi
  if [ "$(stat -c '%F %u %a' "$uhome/.mcp.json")" = "regular file 0 644" ]; then ok "stubs: .mcp.json in a user's home is root-owned"; else bad "stubs: .mcp.json in a user's home has the wrong type, owner, or mode"; fi
  expect_log "::warning::$uhome/.claude is a root-owned directory in the home directory of $RK_PROBE_USER" "stubs: a root-owned .claude in a user's home is named in a warning"
  expect_log "sudo rm -r $uhome/.claude" "stubs: the warning gives the removal command"
  stub_run "$uhome/rk-fixture-runner/_work/repo/repo"
  expect_status 0 "stubs: a second apply under a user's home runs"
  expect_log "kept: $uhome/.claude" "stubs: a second apply keeps the .claude in a user's home"
  expect_log "::warning::$uhome/.claude is a root-owned directory" "stubs: a second apply warns again"
  rm -rf "$uhome/.claude" "$uhome/.mcp.json"
  mkdir "$uhome/.claude"
  chown "$RK_PROBE_USER" "$uhome/.claude"
  stub_run "$uhome/rk-fixture-runner/_work/repo/repo"
  expect_status 0 "stubs: a user-owned .claude in the user's home runs"
  expect_log "kept: $uhome/.claude" "stubs: a user-owned .claude in the user's home is kept"
  if grep -qF "::warning::$uhome/.claude" "$LAST_LOG"; then bad "stubs: a user-owned .claude got the root-owned warning"; else ok "stubs: a user-owned .claude gets no warning"; fi
  if [ "$(stat -c '%u' "$uhome/.claude")" = "$uid" ]; then ok "stubs: the user-owned .claude is unchanged"; else bad "stubs: the user-owned .claude changed owner"; fi
  rm -rf "$uhome/.claude" "$uhome/.mcp.json" "$uhome/rk-fixture-runner"
}

heredoc_output() {
  awk -v key="$2" '
    state == 0 && index($0, key "<<") == 1 { delim = substr($0, length(key) + 3); state = 1; next }
    state == 1 && $0 == delim { exit }
    state == 1 { print }
  ' "$1"
}

field_of() {
  bun "$EXTRACT" "$WORKFLOW" "$1" --field "$2" 2>/dev/null
}

expect_field() {
  local got
  got=$(field_of "$1" "$2")
  if [ "$got" = "$3" ]; then ok "$4"; else bad "$4 ('$got', expected '$3')"; fi
}

policy_runtime() {
  local out="$1" script
  shift
  script=$(step_script "Resolve immutable runtime revisions")
  : > "$out"
  run_script "$script" -i "PATH=$PATH" "GITHUB_OUTPUT=$out" "WORKFLOW_SHA=0123456789abcdef0123456789abcdef01234567" "PLUGINS_OFFICIAL_SHA=e0ab6e51219eef74e417a0e1d89e5d53e5e763d4" "$@"
}

policy_commit() {
  local repo="$1" label="$2"
  git -C "$repo" add -A
  git -C "$repo" -c user.name=rkfixture -c user.email=rk@fixture.invalid commit -q --allow-empty -m "$label"
  git -C "$repo" rev-parse HEAD
}

policy_caller() {
  local repo="$POLICY_ROOT/caller"
  rm -rf "$repo"
  mkdir -p "$repo/.claude/hooks"
  git -C "$repo" init -q
  printf 'caller\n' > "$repo/README.md"
  cp "$HERE/command_policy_fixture.py" "$repo/.claude/hooks/command_policy.py"
  C_GOOD=$(policy_commit "$repo" good)
  printf '\n' >> "$repo/README.md"
  C_OTHER=$(policy_commit "$repo" other)
  git -C "$repo" checkout -q --detach "$C_GOOD"
  rm "$repo/.claude/hooks/command_policy.py"
  C_MISSING=$(policy_commit "$repo" missing)
  git -C "$repo" checkout -q --detach "$C_GOOD"
  rm "$repo/.claude/hooks/command_policy.py"
  ln -s ../../README.md "$repo/.claude/hooks/command_policy.py"
  C_SYMLINK=$(policy_commit "$repo" symlink)
  git -C "$repo" checkout -q --detach "$C_GOOD"
  mkdir -p "$repo/policy-real"
  git -C "$repo" mv .claude/hooks/command_policy.py policy-real/command_policy.py
  rmdir "$repo/.claude/hooks"
  ln -s ../policy-real "$repo/.claude/hooks"
  C_DIRLINK=$(policy_commit "$repo" dirlink)
  git -C "$repo" checkout -q --detach "$C_GOOD"
  : > "$repo/.claude/hooks/command_policy.py"
  C_EMPTY=$(policy_commit "$repo" empty)
  git -C "$repo" checkout -q --detach "$C_GOOD"
  printf 'def broken(:\n' > "$repo/.claude/hooks/command_policy.py"
  C_SYNTAX=$(policy_commit "$repo" syntax)
  git -C "$repo" checkout -q --detach "$C_GOOD"
}

policy_stage() {
  local ws="$1" rt="$2" sha="$3" checkout_sha="${4:-$3}" script out="$POLICY_ROOT/stage.out"
  script=$(step_script "Stage the command policy outside the workspace")
  if [ -d "$rt/rk-command-policy" ] && [ ! -L "$rt/rk-command-policy" ]; then chmod -R u+rwx "$rt/rk-command-policy"; rm -rf "$rt/rk-command-policy"; fi
  rm -rf "$ws/.rk-command-policy"
  mkdir -p "$ws" "$rt" "$POLICY_ROOT/home"
  git -c advice.detachedHead=false clone -q "$POLICY_ROOT/caller" "$ws/.rk-command-policy"
  git -C "$ws/.rk-command-policy" checkout -q --detach "$checkout_sha"
  : > "$out"
  LAST_LOG="$SCRATCH/log-$RANDOM-$RANDOM.txt"
  (cd "$ws" && env -i "PATH=$POLICY_STUBS:$PATH" "HOME=$POLICY_ROOT/home" "RUNNER_TEMP=$rt" "GITHUB_OUTPUT=$out" \
    "COMMAND_POLICY_SHA=$sha" "COMMAND_POLICY_PROOF_ACTION_SHA=${PROOF_SHA_IN-$POLICY_PIN}" \
    "POLICY_INTERPRETERS=${INTERPRETERS_IN:-$POLICY_PYTHON}" "POLICY_WORKFLOW_FILE=${WORKFLOW_FILE_IN:-$WORKFLOW}" \
    "POLICY_DIR=$rt/rk-command-policy" "POLICY_WORKSPACE=$ws" "AGENT_HOME=$POLICY_ROOT/home" \
    "GH_TOKEN=$SYNTH_TOKEN" "REPO=owner/repo" "DEFAULT_BRANCH=${DEFAULT_BRANCH_IN:-main}" "RK_FAKE_COMPARE=${COMPARE_IN:-ahead}" \
    bash --noprofile --norc -eo pipefail "$script") > "$LAST_LOG" 2>&1
  LAST_STATUS=$?
  STAGE_OUT="$out"
}

policy_check() {
  local phase="$1" args="$2" before="${3:-}" execfile="${4:-}" script
  script=$(step_script "Check the staged command policy before Claude runs")
  : > "$POLICY_ROOT/check.out"
  run_script "$script" -i "PATH=$PATH" "GITHUB_OUTPUT=$POLICY_ROOT/check.out" "PHASE=$phase" "POLICY_ARGS=$args" "POLICY_CALLS_BEFORE=$before" "EXECUTION_FILE=$execfile" \
    "POLICY_DIR=$(out_of dir)" "POLICY_CHECKER=$(out_of checker)" "POLICY_CHECKER_OID=$(out_of checker_oid)" "POLICY_SETTINGS=$(out_of settings_file)" "POLICY_SETTINGS_OID=$(out_of settings_oid)" \
    "POLICY_INTERPRETER=$(out_of interpreter)" "POLICY_INTERPRETER_REAL=$(out_of interpreter_real)" "POLICY_INTERPRETER_OID=$(out_of interpreter_oid)" "POLICY_CALL_RECORD=$(out_of call_record)" \
    "POLICY_USER_SETTINGS=$(out_of user_settings)" "POLICY_USER_SETTINGS_DIGEST=$(out_of user_settings_digest)" "POLICY_USER_SETTINGS_KEYS=$(out_of user_settings_keys)" \
    "POLICY_WORKSPACE=$POLICY_WS" "POLICY_MANAGED_DIRS=${MANAGED_IN:-$POLICY_ROOT/no-managed}"
}

out_of() {
  grep -E "^$1=" "$STAGE_OUT" | tail -n 1 | cut -d= -f2-
}

policy_suffix() {
  printf ' --setting-sources user --settings "%s" --add-dir "%s"' "$(out_of settings_file)" "$POLICY_WS"
}

policy_compose() {
  local out="$1" mode="$2" flow="$3" policy="$4" settings="$5" script
  script=$(step_script "Compose Claude prompt")
  : > "$out"
  LAST_LOG="$SCRATCH/log-$RANDOM-$RANDOM.txt"
  (cd "$POLICY_ROOT/compose-ws" && env -i "PATH=$PATH" "HOME=$POLICY_ROOT/home" "RUNNER_TEMP=$POLICY_ROOT/compose-rt" "GITHUB_OUTPUT=$out" \
    "CLAUDE_HARNESS=anthropics/claude-code-action@v1" "MODEL_ID=claude-opus-5-5" "EFFORT=high" "MODE=$mode" "FLOW=$flow" "EXTRA_ALLOWED=${EXTRA_IN:-}" \
    "DEFAULT_BRANCH=main" "HEAD_SHA=1111111111111111111111111111111111111111" "BASE_SHA=2222222222222222222222222222222222222222" \
    "SETTINGS_FILE=$POLICY_ROOT/compose-rt/claude-review-settings.json" "GH_TOKEN=$SYNTH_TOKEN" \
    "COMMAND_POLICY=$policy" "POLICY_SETTINGS=$settings" "POLICY_WORKSPACE=$POLICY_WS" \
    bash --noprofile --norc -eo pipefail "$script") > "$LAST_LOG" 2>&1
  LAST_STATUS=$?
}

test_policy() {
  echo "== policy"
  POLICY_ROOT="$SCRATCH/policy"
  POLICY_WS="$POLICY_ROOT/ws"
  POLICY_STUBS="$POLICY_ROOT/stubs"
  rm -rf "$POLICY_ROOT"
  mkdir -p "$POLICY_ROOT" "$POLICY_STUBS" "$POLICY_ROOT/no-managed"
  printf '#!/bin/sh\n[ "$RK_FAKE_COMPARE" = fail ] && exit 1\nprintf "%%s\\n" "$RK_FAKE_COMPARE"\n' > "$POLICY_STUBS/gh"
  chmod 755 "$POLICY_STUBS/gh"
  POLICY_PYTHON=$(command -v python3)
  POLICY_PIN=$(grep -oE 'anthropics/claude-code-action@[0-9a-f]{40}' "$WORKFLOW" | head -n 1 | cut -d@ -f2)
  local good_sha="0123456789abcdef0123456789abcdef01234567" mode out rt="$POLICY_ROOT/rt" settings hook_cmd

  for mode in implement fix-pr fix-pr-review; do
    for bad_sha in "" 0123456 0123456789ABCDEF0123456789ABCDEF01234567 "$good_sha"$'\n'"$good_sha"; do
      policy_runtime "$POLICY_ROOT/rt.out" "MODE=$mode" "COMMAND_POLICY=true" "COMMAND_POLICY_SHA=$bad_sha"
      expect_status 1 "policy revision: $mode refuses the revision '$(printf '%s' "$bad_sha" | head -c 12 | tr '\n' ' ')'"
      if grep -q '^command_policy=' "$POLICY_ROOT/rt.out"; then bad "policy revision: a refused $mode run wrote an output"; fi
    done
    policy_runtime "$POLICY_ROOT/rt.out" "MODE=$mode" "COMMAND_POLICY=true" "COMMAND_POLICY_SHA=$good_sha"
    expect_status 0 "policy revision: $mode accepts a full revision"
    expect_output "$POLICY_ROOT/rt.out" command_policy true "policy revision: $mode emits command_policy=true"
    expect_output "$POLICY_ROOT/rt.out" command_policy_sha "$good_sha" "policy revision: $mode emits the revision"
    policy_runtime "$POLICY_ROOT/rt.out" "MODE=$mode" "COMMAND_POLICY=false" "COMMAND_POLICY_SHA=not-a-sha"
    expect_status 0 "policy revision: $mode with the opt-in off runs with any revision text"
    expect_output "$POLICY_ROOT/rt.out" command_policy false "policy revision: $mode with the opt-in off emits command_policy=false"
  done
  policy_runtime "$POLICY_ROOT/rt.out" "MODE=review" "COMMAND_POLICY=true" "COMMAND_POLICY_SHA="
  expect_status 0 "policy revision: review ignores the opt-in"
  expect_output "$POLICY_ROOT/rt.out" command_policy false "policy revision: review emits command_policy=false"

  expect_field "Checkout the caller command policy" with.repository '${{ github.repository }}' "policy checkout: reads the calling repository"
  expect_field "Checkout the caller command policy" with.ref '${{ steps.runtime_sources.outputs.command_policy_sha }}' "policy checkout: reads the validated revision"
  expect_field "Checkout the caller command policy" with.path .rk-command-policy "policy checkout: uses its own path"
  expect_field "Checkout the caller command policy" with.fetch-depth 1 "policy checkout: fetches one commit"
  expect_field "Checkout the caller command policy" with.persist-credentials false "policy checkout: keeps no credential"
  expect_field "Checkout the caller command policy" if "steps.runtime_sources.outputs.command_policy == 'true'" "policy checkout: runs only with the opt-in"
  expect_field "Run Claude Code" with.claude_args '${{ steps.compose_prompt.outputs.claude_args }}' "policy launch: the main launch reads claude_args"
  expect_field "Revise CLAUDE.md with session learnings" with.claude_args '${{ steps.compose_prompt.outputs.guide_claude_args }}' "policy launch: the guide revision reads guide_claude_args"
  expect_field "Run Claude Code" env.CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD '${{ steps.command_policy.outputs.instructions_env }}' "policy launch: the main launch loads instruction files from added directories"
  expect_field "Revise CLAUDE.md with session learnings" env.CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD '${{ steps.command_policy.outputs.instructions_env }}' "policy launch: the guide revision loads instruction files from added directories"

  policy_caller
  policy_stage "$POLICY_WS" "$rt" "$C_GOOD" "$C_GOOD"
  expect_status 0 "policy stage: a good policy is staged"
  settings=$(out_of settings_file)
  if [ "$(find "$rt/rk-command-policy" -maxdepth 0 -perm 0500 -print)" = "$rt/rk-command-policy" ] && [ -n "$(find "$(out_of checker)" -perm 0400 -print)" ] && [ -n "$(find "$settings" -perm 0400 -print)" ] && [ -n "$(find "$(out_of call_record)" -perm 0600 -print)" ]; then ok "policy stage: the directory is 0500, the checker and settings 0400, the call record 0600"; else bad "policy stage: wrong modes in the staged directory"; fi
  if [ ! -e "$POLICY_WS/.rk-command-policy" ]; then ok "policy stage: the scratch checkout is removed"; else bad "policy stage: the scratch checkout stays"; fi
  if cmp -s "$(out_of checker)" "$HERE/command_policy_fixture.py"; then ok "policy stage: the staged checker is the committed file"; else bad "policy stage: the staged checker differs from the committed file"; fi
  if jq -e --arg c "$(out_of checker)" --arg h "$(out_of checker_sha256)" --arg r "$(out_of call_record)" '
      .disableAllHooks == false and (keys | sort) == ["disableAllHooks", "hooks"] and (.hooks | keys) == ["PreToolUse"]
      and (.hooks.PreToolUse | length) == 1 and .hooks.PreToolUse[0].matcher == "Bash" and (.hooks.PreToolUse[0].hooks | length) == 1
      and .hooks.PreToolUse[0].hooks[0].type == "command" and .hooks.PreToolUse[0].hooks[0].timeout == 30 and .hooks.PreToolUse[0].hooks[0].onFailure == "block"
      and (.hooks.PreToolUse[0].hooks[0].command | startswith("/") and contains(" -I -c ") and contains($c) and contains($h) and contains($r))' "$settings" >/dev/null; then ok "policy stage: the settings file has the expected shape"; else bad "policy stage: the settings file shape is wrong"; fi
  expect_output "$STAGE_OUT" instructions_env 1 "policy stage: instruction files from added directories are turned on"
  expect_output "$STAGE_OUT" interpreter "$POLICY_PYTHON" "policy stage: the interpreter comes from the fixed list"

  hook_cmd=$(jq -r '.hooks.PreToolUse[0].hooks[0].command' "$settings")
  for pair in "rk-policy-block-marker:2" "echo harmless:0" "rk-policy-crash-marker:2"; do
    LAST_LOG="$SCRATCH/hook-$RANDOM.log"
    (cd "$POLICY_WS" && jq -cn --arg c "${pair%:*}" '{tool_name: "Bash", tool_input: {command: $c}, cwd: "/"}' | /bin/sh -c "$hook_cmd") > "$LAST_LOG" 2>&1
    LAST_STATUS=$?
    expect_status "${pair##*:}" "policy hook: the command '${pair%:*}' exits ${pair##*:}"
  done
  if [ "$(wc -l < "$(out_of call_record)" | tr -d ' ')" = 3 ]; then ok "policy hook: each run adds one call record line"; else bad "policy hook: the call record has $(wc -l < "$(out_of call_record)") lines, expected 3"; fi

  local spaced="$POLICY_ROOT/runner temp"
  policy_stage "$POLICY_WS" "$spaced" "$C_GOOD" "$C_GOOD"
  expect_status 0 "policy stage: a RUNNER_TEMP with a space is staged"
  hook_cmd=$(jq -r '.hooks.PreToolUse[0].hooks[0].command' "$(out_of settings_file)")
  for pair in "rk-policy-block-marker:2" "echo harmless:0"; do
    LAST_LOG="$SCRATCH/hook-$RANDOM.log"
    (cd "$POLICY_WS" && jq -cn --arg c "${pair%:*}" '{tool_name: "Bash", tool_input: {command: $c}}' | /bin/sh -c "$hook_cmd") > "$LAST_LOG" 2>&1
    LAST_STATUS=$?
    expect_status "${pair##*:}" "policy hook: with a space in RUNNER_TEMP, '${pair%:*}' exits ${pair##*:}"
  done
  chmod -R u+rwx "$spaced"

  policy_stage "$POLICY_WS" "$rt" "$C_GOOD" "$C_OTHER"
  expect_status 1 "policy stage: a checkout at another commit is refused"
  expect_log "which differs from command_policy_sha" "policy stage: a checkout at another commit is refused (reason)"
  policy_stage "$POLICY_WS" "$rt" "$C_MISSING" "$C_MISSING"
  expect_status 1 "policy stage: a missing checker is refused"
  expect_log "is missing at" "policy stage: a missing checker is refused (reason)"
  policy_stage "$POLICY_WS" "$rt" "$C_SYMLINK" "$C_SYMLINK"
  expect_status 1 "policy stage: a symlinked checker is refused"
  expect_log "is not a regular file at" "policy stage: a symlinked checker is refused (reason)"
  policy_stage "$POLICY_WS" "$rt" "$C_DIRLINK" "$C_DIRLINK"
  expect_status 1 "policy stage: a symlinked .claude/hooks is refused"
  expect_log "is missing at" "policy stage: a symlinked .claude/hooks is refused (reason)"
  policy_stage "$POLICY_WS" "$rt" "$C_EMPTY" "$C_EMPTY"
  expect_status 1 "policy stage: an empty checker is refused"
  expect_log "is empty at" "policy stage: an empty checker is refused (reason)"
  policy_stage "$POLICY_WS" "$rt" "$C_SYNTAX" "$C_SYNTAX"
  expect_status 1 "policy stage: a checker with a syntax error is refused"
  expect_log "does not compile" "policy stage: a checker with a syntax error is refused (reason)"
  INTERPRETERS_IN="$POLICY_ROOT/none/python3:/nonexistent/python3" policy_stage "$POLICY_WS" "$rt" "$C_GOOD" "$C_GOOD"
  expect_status 1 "policy stage: no interpreter in the list is refused"
  expect_log "no hook interpreter" "policy stage: no interpreter in the list is refused (reason)"
  INTERPRETERS_IN="python3" policy_stage "$POLICY_WS" "$rt" "$C_GOOD" "$C_GOOD"
  expect_status 1 "policy stage: a relative interpreter name is refused"
  expect_log "no hook interpreter" "policy stage: a relative interpreter name is refused (reason)"
  mkdir -p "$POLICY_WS/bin"
  ln -sf "$POLICY_PYTHON" "$POLICY_WS/bin/python3"
  INTERPRETERS_IN="$POLICY_WS/bin/python3" policy_stage "$POLICY_WS" "$rt" "$C_GOOD" "$C_GOOD"
  expect_status 1 "policy stage: an interpreter path inside the workspace is refused"
  expect_log "where a session can change it" "policy stage: an interpreter path inside the workspace is refused (reason)"
  rm -rf "${POLICY_WS:?}/bin"
  PROOF_SHA_IN=1111111111111111111111111111111111111111 policy_stage "$POLICY_WS" "$rt" "$C_GOOD" "$C_GOOD"
  expect_status 1 "policy stage: a pinned action that differs from the proof commit is refused"
  expect_log "that the hook proof ran against" "policy stage: a pinned action that differs from the proof commit is refused (reason)"
  PROOF_SHA_IN="" policy_stage "$POLICY_WS" "$rt" "$C_GOOD" "$C_GOOD"
  expect_status 1 "policy stage: an empty proof commit is refused"
  expect_log "no hook proof is recorded" "policy stage: an empty proof commit is refused (reason)"
  awk '!done && /uses: anthropics\/claude-code-action@[0-9a-f]+/ { sub(/@[0-9a-f]+/, "@v1"); done = 1 } { print }' "$WORKFLOW" > "$POLICY_ROOT/tag-workflow.yml"
  if grep -q 'uses: anthropics/claude-code-action@v1 ' "$POLICY_ROOT/tag-workflow.yml"; then ok "policy stage: the tag fixture holds a tag pin"; else bad "policy stage: the tag fixture holds no tag pin"; fi
  WORKFLOW_FILE_IN="$POLICY_ROOT/tag-workflow.yml" policy_stage "$POLICY_WS" "$rt" "$C_GOOD" "$C_GOOD"
  expect_status 1 "policy stage: an action step pinned to a tag is refused"
  expect_log "does not pin anthropics/claude-code-action to a full commit" "policy stage: an action step pinned to a tag is refused (reason)"
  for status in behind diverged fail; do
    COMPARE_IN="$status" policy_stage "$POLICY_WS" "$rt" "$C_GOOD" "$C_GOOD"
    expect_status 1 "policy stage: a default branch compare that reports $status is refused"
    if [ "$status" = fail ]; then expect_log "failed." "policy stage: the failed compare is named"; else expect_log "is not on the default branch" "policy stage: the $status compare is named"; fi
  done
  COMPARE_IN=identical policy_stage "$POLICY_WS" "$rt" "$C_GOOD" "$C_GOOD"
  expect_status 0 "policy stage: a revision identical to the default branch is staged"
  DEFAULT_BRANCH_IN='main;x' policy_stage "$POLICY_WS" "$rt" "$C_GOOD" "$C_GOOD"
  expect_status 1 "policy stage: a default branch name with shell characters is refused"
  expect_log "is not a plain branch name" "policy stage: a default branch name with shell characters is refused (reason)"
  policy_stage "$POLICY_WS" "$rt" "0123456" "$C_GOOD"
  expect_status 1 "policy stage: an abbreviated revision is refused"
  expect_log "is not a full commit identifier" "policy stage: an abbreviated revision is refused (reason)"
  mkdir -p "$POLICY_ROOT/elsewhere"
  rm -rf "$rt/rk-command-policy"
  ln -s "$POLICY_ROOT/elsewhere" "$rt/rk-command-policy"
  policy_stage "$POLICY_WS" "$rt" "$C_GOOD" "$C_GOOD"
  expect_status 0 "policy stage: a symlink at the staging path is replaced"
  if [ ! -L "$rt/rk-command-policy" ] && [ -d "$POLICY_ROOT/elsewhere" ] && [ -z "$(ls -A "$POLICY_ROOT/elsewhere")" ]; then ok "policy stage: the symlink target is untouched"; else bad "policy stage: the symlink target changed"; fi

  local compose_rt="$POLICY_ROOT/compose-rt" off_args on_args off_guide on_guide suffix guide_literal flow
  mkdir -p "$compose_rt/rk-shared" "$POLICY_ROOT/compose-ws"
  cp -R "$REPO_ROOT/templates/claude-workflow/prompts" "$compose_rt/rk-shared/prompts"
  git -C "$POLICY_ROOT/compose-ws" init -q
  policy_stage "$POLICY_WS" "$rt" "$C_GOOD" "$C_GOOD"
  settings=$(out_of settings_file)
  suffix=$(policy_suffix)
  guide_literal='--model claude-opus-5-5 --effort high --permission-mode default --allowedTools "Bash(git status*),Bash(git log*),Bash(git diff*),Bash(git show*),Bash(git add*),Bash(git commit*),Bash(git push origin HEAD),Edit,Read,Grep,Glob,Write"'
  for shape in implement: fix-pr: fix-pr-review: review: implement:sync-docs implement:create-release implement:sync-release; do
    mode="${shape%%:*}"
    flow="${shape#*:}"
    policy_compose "$POLICY_ROOT/off.out" "$mode" "$flow" false ""
    expect_status 0 "policy compose: $shape with the opt-in off runs"
    off_args=$(heredoc_output "$POLICY_ROOT/off.out" claude_args)
    off_guide=$(heredoc_output "$POLICY_ROOT/off.out" guide_claude_args)
    case "$off_args" in *--add-dir*) bad "policy compose: $shape with the opt-in off holds --add-dir" ;; *) ok "policy compose: $shape with the opt-in off holds no --add-dir" ;; esac
    case "$mode:$off_args" in
      review:*--settings*) ok "policy compose: review with the opt-in off keeps its own settings file" ;;
      review:*) bad "policy compose: review lost its settings file" ;;
      *:*--settings*) bad "policy compose: $shape with the opt-in off holds --settings" ;;
      *) ok "policy compose: $shape with the opt-in off holds no --settings" ;;
    esac
    if [ "$off_guide" = "$guide_literal" ]; then ok "policy compose: $shape with the opt-in off keeps the guide revision arguments"; else bad "policy compose: $shape guide revision arguments differ: $off_guide"; fi
    policy_compose "$POLICY_ROOT/on.out" "$mode" "$flow" true "$settings"
    expect_status 0 "policy compose: $shape with the opt-in on runs"
    on_args=$(heredoc_output "$POLICY_ROOT/on.out" claude_args)
    on_guide=$(heredoc_output "$POLICY_ROOT/on.out" guide_claude_args)
    if [ "$mode" = review ]; then
      if [ "$on_args" = "$off_args" ]; then ok "policy compose: review arguments are byte-identical with the opt-in on"; else bad "policy compose: review arguments change with the opt-in on"; fi
    else
      if [ "$on_args" = "$off_args$suffix" ]; then ok "policy compose: $shape with the opt-in on adds exactly the policy flags at the end"; else bad "policy compose: $shape with the opt-in on does not equal the off arguments plus the policy flags"; fi
      if [ "$on_guide" = "$guide_literal$suffix" ]; then ok "policy compose: $shape guide revision arguments add exactly the policy flags"; else bad "policy compose: $shape guide revision arguments with the opt-in on are wrong"; fi
    fi
  done
  policy_compose "$POLICY_ROOT/on.out" implement "" true ""
  expect_status 1 "policy compose: the opt-in with no staged settings file stops the run"
  policy_compose "$POLICY_ROOT/on.out" implement "" true "$POLICY_ROOT/bad\"path/settings.json"
  expect_status 1 "policy compose: a settings path with a double quote stops the run"

  local args_on="--model m$suffix" home_settings="$POLICY_ROOT/home/.claude/settings.json" exec_file="$POLICY_ROOT/execution.json"
  local bodies=() n
  for n in "before Claude runs" "after Claude runs" "before the CLAUDE.md revision" "after the CLAUDE.md revision"; do
    bodies+=("$(step_script "Check the staged command policy $n")")
  done
  if cmp -s "${bodies[0]}" "${bodies[1]}" && cmp -s "${bodies[0]}" "${bodies[2]}" && cmp -s "${bodies[0]}" "${bodies[3]}"; then ok "policy check: the four check steps share one script body"; else bad "policy check: the four check step bodies differ"; fi

  policy_check before-main "$args_on"
  expect_status 0 "policy check: an unchanged policy passes before the launch"
  expect_output "$POLICY_ROOT/check.out" call_lines 0 "policy check: the before phase records the call record line count"
  printf '[{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"git status"}}]}},{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t1","is_error":false,"content":"ok"}]}}]\n' > "$exec_file"
  policy_check after-main "$args_on" 0 "$exec_file"
  expect_status 1 "policy check: an executed Bash call with no call record line fails after the launch"
  expect_log "the policy hook did not run" "policy check: the failure names the hook that did not run"
  chmod u+w "$(out_of call_record)"
  printf '1 1\n' >> "$(out_of call_record)"
  policy_check after-main "$args_on" 0 "$exec_file"
  expect_status 0 "policy check: an executed Bash call with a call record line passes after the launch"
  policy_check after-main "$args_on" 0 "$POLICY_ROOT/missing-execution.json"
  expect_status 0 "policy check: a missing execution file skips the hook-ran check"
  expect_log "the execution file is missing" "policy check: the skip is named"
  policy_check after-main "$args_on" ""
  expect_status 1 "policy check: a missing line count before the launch fails"
  expect_log "line count from before the launch is missing" "policy check: a missing line count before the launch fails (reason)"
  policy_check before-main "--model m"
  expect_status 1 "policy check: launch arguments without the policy flags fail before the launch"
  expect_log "do not end with the policy settings flags" "policy check: launch arguments without the policy flags fail before the launch (reason)"
  policy_check before-main "--model m$suffix --settings other.json"
  expect_status 1 "policy check: launch arguments where the policy flags are not last fail before the launch"

  mkdir -p "$POLICY_ROOT/home/.claude"
  printf '{"enableAllProjectMcpServers": true, "enabledPlugins": {"x@y": true}}\n' > "$home_settings"
  policy_check after-main "$args_on" 0
  expect_status 0 "policy check: user settings changed only in the excluded keys pass"
  printf '{"hooks": {"PreToolUse": []}}\n' > "$home_settings"
  policy_check after-main "$args_on" 0
  expect_status 1 "policy check: user settings with a new hooks key fail"
  expect_log "changed top-level keys: hooks" "policy check: the failure names the changed key"
  printf '{"disableAllHooks": true}\n' > "$home_settings"
  policy_stage "$POLICY_WS" "$rt" "$C_GOOD" "$C_GOOD"
  policy_check before-main "--model m$(policy_suffix)"
  expect_status 1 "policy check: user settings with disableAllHooks true fail before the launch"
  expect_log "sets disableAllHooks to true" "policy check: user settings with disableAllHooks true fail before the launch (reason)"
  rm -f "$home_settings"
  policy_stage "$POLICY_WS" "$rt" "$C_GOOD" "$C_GOOD"
  args_on="--model m$(policy_suffix)"
  mkdir -p "$POLICY_ROOT/managed-a" "$POLICY_ROOT/managed-b/managed-settings.d"
  printf '{"allowManagedHooksOnly": true}\n' > "$POLICY_ROOT/managed-a/managed-settings.json"
  MANAGED_IN="$POLICY_ROOT/managed-a" policy_check before-main "$args_on"
  expect_status 1 "policy check: a managed allowManagedHooksOnly true fails before the launch"
  expect_log "sets allowManagedHooksOnly to true" "policy check: a managed allowManagedHooksOnly true fails before the launch (reason)"
  printf '{"disableAllHooks": true}\n' > "$POLICY_ROOT/managed-b/managed-settings.d/20-hooks.json"
  MANAGED_IN="$POLICY_ROOT/managed-b" policy_check before-main "$args_on"
  expect_status 1 "policy check: a managed drop-in with disableAllHooks true fails before the launch"
  expect_log "managed-settings.d/20-hooks.json sets disableAllHooks to true" "policy check: a managed drop-in with disableAllHooks true fails before the launch (reason)"
  printf '{"disableAllHooks": false}\n' > "$POLICY_ROOT/managed-b/managed-settings.d/20-hooks.json"
  MANAGED_IN="$POLICY_ROOT/managed-b" policy_check before-main "$args_on"
  expect_status 0 "policy check: a managed drop-in with disableAllHooks false passes"

  policy_mutate() {
    policy_stage "$POLICY_WS" "$rt" "$C_GOOD" "$C_GOOD"
    args_on="--model m$(policy_suffix)"
    chmod 700 "$rt/rk-command-policy"
    "$@"
    policy_check before-main "$args_on"
  }
  change_checker() { chmod 600 "$(out_of checker)"; printf '\n' >> "$(out_of checker)"; chmod 400 "$(out_of checker)"; chmod 500 "$rt/rk-command-policy"; }
  change_settings() { chmod 600 "$(out_of settings_file)"; printf ' ' >> "$(out_of settings_file)"; chmod 400 "$(out_of settings_file)"; chmod 500 "$rt/rk-command-policy"; }
  delete_checker() { rm -f "$(out_of checker)"; chmod 500 "$rt/rk-command-policy"; }
  link_checker() { cp "$(out_of checker)" "$POLICY_ROOT/copy.py"; rm -f "$(out_of checker)"; ln -s "$POLICY_ROOT/copy.py" "$(out_of checker)"; chmod 500 "$rt/rk-command-policy"; }
  extra_file() { : > "$rt/rk-command-policy/extra"; chmod 500 "$rt/rk-command-policy"; }
  open_dir() { :; }
  policy_mutate change_checker
  expect_status 1 "policy check: a changed checker fails"
  expect_log "changed since the policy was staged" "policy check: a changed checker fails (reason)"
  policy_mutate change_settings
  expect_status 1 "policy check: a changed settings file fails"
  expect_log "changed since the policy was staged" "policy check: a changed settings file fails (reason)"
  policy_mutate delete_checker
  expect_status 1 "policy check: a deleted checker fails"
  expect_log "unexpected set of entries" "policy check: a deleted checker fails (reason)"
  policy_mutate link_checker
  expect_status 1 "policy check: a symlink in place of the checker fails"
  expect_log "a symlink, or not a regular file" "policy check: a symlink in place of the checker fails (reason)"
  policy_mutate extra_file
  expect_status 1 "policy check: an extra file in the staged directory fails"
  expect_log "unexpected set of entries" "policy check: an extra file in the staged directory fails (reason)"
  policy_mutate open_dir
  expect_status 1 "policy check: a staged directory that is writable again fails"
  expect_log "does not have mode 0500" "policy check: a staged directory that is writable again fails (reason)"

  mkdir -p "$POLICY_ROOT/interp"
  ln -sf "$POLICY_PYTHON" "$POLICY_ROOT/interp/python3"
  INTERPRETERS_IN="$POLICY_ROOT/interp/python3" policy_stage "$POLICY_WS" "$rt" "$C_GOOD" "$C_GOOD"
  expect_status 0 "policy stage: an interpreter symlink outside the workspace is staged"
  args_on="--model m$(policy_suffix)"
  policy_check before-main "$args_on"
  expect_status 0 "policy check: the interpreter link passes before it moves"
  ln -sf "$(command -v git)" "$POLICY_ROOT/interp/python3"
  policy_check before-main "$args_on"
  expect_status 1 "policy check: a moved interpreter link fails"
  expect_log "now resolves to" "policy check: a moved interpreter link fails (reason)"

  local cleanup target="$POLICY_ROOT/cleanup-target"
  cleanup=$(step_script "Remove the staged command policy")
  policy_stage "$POLICY_WS" "$rt" "$C_GOOD" "$C_GOOD"
  chmod 700 "$rt/rk-command-policy"
  mkdir -p "$rt/rk-command-policy/locked/inner"
  : > "$rt/rk-command-policy/locked/inner/file"
  chmod 000 "$rt/rk-command-policy/locked"
  chmod 500 "$rt/rk-command-policy"
  mkdir -p "$POLICY_WS/.rk-command-policy"
  run_script "$cleanup" -i "PATH=$PATH" "POLICY_DIR=$rt/rk-command-policy" "POLICY_WORKSPACE=$POLICY_WS"
  expect_status 0 "policy cleanup: a read-only staged tree with a mode-0000 directory is removed"
  if [ ! -e "$rt/rk-command-policy" ] && [ ! -e "$POLICY_WS/.rk-command-policy" ]; then ok "policy cleanup: the staged tree and a leftover checkout are gone"; else bad "policy cleanup: an entry stays"; fi
  run_script "$cleanup" -i "PATH=$PATH" "POLICY_DIR=$rt/rk-command-policy" "POLICY_WORKSPACE=$POLICY_WS"
  expect_status 0 "policy cleanup: an absent staged tree passes"
  mkdir -p "$target"
  printf 'keep\n' > "$target/file"
  ln -s "$target" "$rt/rk-command-policy"
  run_script "$cleanup" -i "PATH=$PATH" "POLICY_DIR=$rt/rk-command-policy" "POLICY_WORKSPACE=$POLICY_WS"
  expect_status 1 "policy cleanup: a symlink at the staged path is refused"
  if [ "$(cat "$target/file")" = keep ]; then ok "policy cleanup: the symlink target is untouched"; else bad "policy cleanup: the symlink target changed"; fi
  rm -f "$rt/rk-command-policy"
  run_script "$cleanup" -i "PATH=$PATH" "POLICY_DIR=$rt/other-name" "POLICY_WORKSPACE=$POLICY_WS"
  expect_status 1 "policy cleanup: a path with another name is refused"
}

for tool in bun git jq; do
  command -v "$tool" >/dev/null 2>&1 || { echo "missing $tool" >&2; exit 2; }
done

SUITES=("$@")
[ "${#SUITES[@]}" -gt 0 ] || SUITES=(contract guard settings cleanup agent_home stubs policy)
for suite in "${SUITES[@]}"; do
  case "$suite" in
    contract) test_contract ;;
    guard) test_guard ;;
    settings) test_settings ;;
    cleanup) test_cleanup ;;
    agent_home) test_agent_home ;;
    stubs) test_stubs ;;
    policy) test_policy ;;
    *) echo "unknown suite: $suite" >&2; exit 2 ;;
  esac
done

echo "fixtures: $PASS passed, $FAIL failed"
[ "$FAIL" = 0 ]
