#!/usr/bin/env bash
set -uo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
REPO_ROOT=$(cd "$HERE/../.." && pwd -P)
WORKFLOW="$REPO_ROOT/.github/workflows/claude-run.yml"
EXTRACT="$HERE/extract-step.mjs"
SCRIPTS="$REPO_ROOT/templates/claude-workflow/scripts"
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

shared_script() {
  local out="$SCRATCH/step-$RANDOM-$RANDOM.sh"
  cp "$SCRIPTS/$1" "$out" || { echo "cannot copy script: $1" >&2; exit 2; }
  printf '%s' "$out"
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
    "RUNNER_ENVIRONMENT=${RUNNER_ENVIRONMENT_IN:-github-hosted}" \
    "RUNNER_TEMP=${RUNNER_TEMP_IN:-}" \
    "TMPDIR=${TMPDIR_IN:-}" \
    "CLAUDE_CODE_TMPDIR=${CC_TMPDIR_IN:-}"
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
  local root="$SCRATCH/layouts" home ws out real_root top
  home="$root/home-a"
  ws="$home/actions-runner/_work/repo/repo"
  mkdir -p "$ws" "$home/actions-runner/_work/_temp"
  real_root=$(cd -P "$root" && pwd -P)
  out="$SCRATCH/l1.out"
  RUNNER_TEMP_IN="$home/actions-runner/_work/_temp" RUNNER_ENVIRONMENT_IN=self-hosted run_contract "$home" "$ws" "$out"
  expect_status 0 "contract linux: home-based layout runs"
  expect_output "$out" scrub 1 "contract linux: home-based layout keeps the scrub on"
  expect_output "$out" needs_temp_home true "contract linux: home-based actions-runner layout selects a temporary home"
  expect_output "$out" stub_scan "$([ "$(id -u)" = 0 ] && echo true || echo false)" "contract linux: stub scan follows the user ID"
  expect_output "$out" home_parent_deny true "contract linux: a self-hosted Linux review protects the temporary home parent"
  expect_output "$out" work_dir "$real_root/home-a/actions-runner/_work" "contract linux: records the resolved work directory"
  expect_output "$out" work_parent "$real_root/home-a/actions-runner" "contract linux: records the parent of the work directory"

  RUNNER_TEMP_IN="$home/actions-runner/_work/_temp" run_contract "$home" "$ws" "$SCRATCH/hosted.out"
  expect_output "$SCRATCH/hosted.out" work_dir "" "contract linux: a hosted runner records no work directory"
  expect_output "$SCRATCH/hosted.out" work_parent "" "contract linux: a hosted runner records no work directory parent"

  ws="$home/runners/r1/_work/repo/repo"
  mkdir -p "$ws" "$home/runners/r1/_work/_temp"
  RUNNER_TEMP_IN="$home/runners/r1/_work/_temp" RUNNER_ENVIRONMENT_IN=self-hosted run_contract "$home" "$ws" "$out"
  expect_output "$out" needs_temp_home true "contract linux: home-based runners layout selects a temporary home"

  ln -s "$home/actions-runner" "$root/runner-alias"
  RUNNER_TEMP_IN="$root/runner-alias/_work/_temp" RUNNER_ENVIRONMENT_IN=self-hosted run_contract "$home" "$root/runner-alias/_work/repo/repo" "$out"
  expect_output "$out" needs_temp_home true "contract linux: a symlinked path into the home-based layout selects a temporary home"
  expect_output "$out" work_dir "$real_root/home-a/actions-runner/_work" "contract linux: a symlinked runner path records the resolved work directory"

  mkdir -p "$root/real-runner/_work/repo/repo" "$root/real-runner/_work/_temp" "$root/home-b"
  ln -s "$root/real-runner" "$root/home-b/actions-runner"
  RUNNER_TEMP_IN="$root/real-runner/_work/_temp" RUNNER_ENVIRONMENT_IN=self-hosted run_contract "$root/home-b" "$root/real-runner/_work/repo/repo" "$out"
  expect_output "$out" needs_temp_home true "contract linux: a workspace under the target of a symlinked home actions-runner path selects a temporary home"

  ws="$root/plain/_work/repo/repo"
  mkdir -p "$ws" "$root/plain/_work/_temp"
  RUNNER_TEMP_IN="$root/plain/_work/_temp" RUNNER_ENVIRONMENT_IN=self-hosted run_contract "$home" "$ws" "$out"
  expect_output "$out" needs_temp_home false "contract linux: a layout outside the home uses the real home"
  expect_output "$out" scrub 1 "contract linux: a layout outside the home keeps the scrub on"
  expect_output "$out" home_parent_deny true "contract linux: a layout outside the home still protects the temporary home parent"
  expect_output "$out" work_parent "$real_root/plain" "contract linux: a layout outside the home records the parent of the work directory"

  mkdir -p "$root/linked-work/real-work/_temp" "$root/linked-work/real-work/repo/repo" "$root/linked-work/runner"
  ln -s "$root/linked-work/real-work" "$root/linked-work/runner/_work"
  RUNNER_TEMP_IN="$root/linked-work/runner/_work/_temp" RUNNER_ENVIRONMENT_IN=self-hosted run_contract "$home" "$root/linked-work/runner/_work/repo/repo" "$out"
  expect_status 0 "contract linux: a symlinked work directory runs"
  expect_output "$out" work_dir "$real_root/linked-work/real-work" "contract linux: a symlinked work directory records its target"
  expect_output "$out" work_parent "$real_root/linked-work" "contract linux: a symlinked work directory records the parent of its target"

  SCRUB_SELF_HOSTED=true RUNNER_TEMP_IN="$home/actions-runner/_work/_temp" RUNNER_ENVIRONMENT_IN=self-hosted run_contract "$home" "$home/actions-runner/_work/repo/repo" "$SCRATCH/l1b.out"
  RUNNER_TEMP_IN="$home/actions-runner/_work/_temp" RUNNER_ENVIRONMENT_IN=self-hosted run_contract "$home" "$home/actions-runner/_work/repo/repo" "$SCRATCH/l1a.out"
  if cmp -s "$SCRATCH/l1a.out" "$SCRATCH/l1b.out"; then ok "contract linux: review_subprocess_scrub_self_hosted changes no layout output"; else bad "contract linux: review_subprocess_scrub_self_hosted changes the layout outputs"; fi

  ws="$root/plain/_work/repo/repo"
  contract_refusal() {
    local label="$1" text="$2"
    expect_status 1 "contract linux: $label is refused"
    expect_log "Review refused: " "contract linux: $label gives a refusal"
    expect_log "$text" "contract linux: the refusal for $label names the cause"
    if grep -qE '^(work_dir|work_parent)=' "$SCRATCH/refused.out"; then bad "contract linux: the refusal for $label wrote a work directory output"; fi
  }
  RUNNER_TEMP_IN="" RUNNER_ENVIRONMENT_IN=self-hosted run_contract "$home" "$ws" "$SCRATCH/refused.out"
  contract_refusal "an empty RUNNER_TEMP" "RUNNER_TEMP is empty"
  RUNNER_TEMP_IN="$root/plain/_work/missing/_temp" RUNNER_ENVIRONMENT_IN=self-hosted run_contract "$home" "$ws" "$SCRATCH/refused.out"
  contract_refusal "an unresolvable RUNNER_TEMP" "cannot be resolved"
  mkdir -p "$root/plain/_work/tmp"
  RUNNER_TEMP_IN="$root/plain/_work/tmp" RUNNER_ENVIRONMENT_IN=self-hosted run_contract "$home" "$ws" "$SCRATCH/refused.out"
  contract_refusal "a RUNNER_TEMP with a last component other than _temp" "does not end in _temp"
  mkdir -p "$root/plain/_work/_temp-target"
  rm -rf "$root/plain/_work/_temp"
  ln -s "$root/plain/_work/_temp-target" "$root/plain/_work/_temp"
  RUNNER_TEMP_IN="$root/plain/_work/_temp" RUNNER_ENVIRONMENT_IN=self-hosted run_contract "$home" "$ws" "$SCRATCH/refused.out"
  contract_refusal "a RUNNER_TEMP that resolves to another directory" "which is not the _temp directory of the work directory"
  rm -f "$root/plain/_work/_temp"
  mkdir -p "$root/plain/_work/_temp" "$root/elsewhere/repo"
  RUNNER_TEMP_IN="$root/plain/_work/_temp" RUNNER_ENVIRONMENT_IN=self-hosted run_contract "$home" "$root/elsewhere/repo" "$SCRATCH/refused.out"
  contract_refusal "a workspace outside the work directory" "outside the work directory"
  RUNNER_TEMP_IN="/_temp" RUNNER_ENVIRONMENT_IN=self-hosted run_contract "$home" "$ws" "$SCRATCH/refused.out"
  contract_refusal "a work directory parent of /" "which is / or a directory directly under /"
  top=$(mktemp -d /tmp/rk-fixture-top.XXXXXXXX)
  mkdir -p "$top/_temp" "$top/repo/repo"
  RUNNER_TEMP_IN="$top/_temp" RUNNER_ENVIRONMENT_IN=self-hosted run_contract "$home" "$top/repo/repo" "$SCRATCH/refused.out"
  contract_refusal "a work directory parent directly under /" "which is / or a directory directly under /"
  rm -rf "$top"
  RUNNER_TEMP_IN="$root/plain/_work/_temp" RUNNER_ENVIRONMENT_IN=self-hosted run_contract "$root/plain" "$ws" "$SCRATCH/refused.out"
  contract_refusal "a job home equal to the work directory parent" "is at or under"
  mkdir -p "$root/plain/home-inside"
  RUNNER_TEMP_IN="$root/plain/_work/_temp" RUNNER_ENVIRONMENT_IN=self-hosted run_contract "$root/plain/home-inside" "$ws" "$SCRATCH/refused.out"
  contract_refusal "a job home under the work directory parent" "is at or under"
  ln -s "$root/plain" "$root/home-link"
  RUNNER_TEMP_IN="$root/plain/_work/_temp" RUNNER_ENVIRONMENT_IN=self-hosted run_contract "$root/home-link" "$ws" "$SCRATCH/refused.out"
  contract_refusal "a job home that resolves to the work directory parent" "is at or under"
  mkdir -p "$root/glob[1]/_work/_temp" "$root/glob[1]/_work/repo/repo"
  RUNNER_TEMP_IN="$root/glob[1]/_work/_temp" RUNNER_ENVIRONMENT_IN=self-hosted run_contract "$home" "$root/glob[1]/_work/repo/repo" "$SCRATCH/refused.out"
  contract_refusal "a pattern character in the runner path" "holds a *, ?, or [ character"
  mkdir -p "$root/plain/_work/repo/re?po"
  RUNNER_TEMP_IN="$root/plain/_work/_temp" RUNNER_ENVIRONMENT_IN=self-hosted run_contract "$home" "$root/plain/_work/repo/re?po" "$SCRATCH/refused.out"
  contract_refusal "a pattern character in the workspace path" "holds a *, ?, or [ character"
  TMPDIR_IN="$root/plain/_work/_temp" RUNNER_TEMP_IN="$root/plain/_work/_temp" RUNNER_ENVIRONMENT_IN=self-hosted run_contract "$home" "$ws" "$SCRATCH/refused.out"
  contract_refusal "a TMPDIR under the work directory parent" "TMPDIR is"
  CC_TMPDIR_IN="$root/plain/tmp" RUNNER_TEMP_IN="$root/plain/_work/_temp" RUNNER_ENVIRONMENT_IN=self-hosted run_contract "$home" "$ws" "$SCRATCH/refused.out"
  contract_refusal "a CLAUDE_CODE_TMPDIR under the work directory parent" "CLAUDE_CODE_TMPDIR is"
  TMPDIR_IN=/tmp RUNNER_TEMP_IN="$root/plain/_work/_temp" RUNNER_ENVIRONMENT_IN=self-hosted run_contract "$home" "$ws" "$SCRATCH/l-tmp.out"
  expect_status 0 "contract linux: a TMPDIR outside the work directory parent runs"
}

make_guard() {
  local dir="$1" script
  script="$SCRIPTS/review_write_guard.sh"
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
  local rt="${RUNNER_TEMP_IN:-$dir/runner/_work/_temp}" work work_parent
  work=$(cd -P "$(dirname "$rt")" 2>/dev/null && pwd -P) || work=$(dirname "$rt")
  work="${WORK_DIR_IN-$work}"
  work_parent=$(dirname "$work")
  work_parent="${WORK_PARENT_IN-$work_parent}"
  script="$SCRIPTS/review_write_settings.sh"
  rm -f "$dir/settings.json"
  run_script "$script" -i "PATH=${PATH_IN:-$PATH}" "GITHUB_WORKSPACE=$dir/runner/_work/repo/repo" "RUNNER_TEMP=$rt" "RUNNER_TOOL_CACHE=${RUNNER_TOOL_CACHE_IN:-}" "SETTINGS_FILE=$dir/settings.json" "GUARD_FILE=$dir/guard.sh" "GUARD_OID=0123" "REAL_HOME=$dir/real-home" "AGENT_HOME=${AGENT_HOME_IN:-${temp_home:-$dir/real-home}}" "TEMP_AGENT_HOME=$temp_home" "HOME_PARENT=$parent" "HOME_PARENT_DENY=$parent_deny" "WORK_DIR=$work" "WORK_PARENT=$work_parent" "GITHUB_OUTPUT=$dir/settings.out"
}

read_has() {
  if jq -e --arg k "$2" --arg p "$3" '.sandbox.filesystem[$k] | index($p)' "$1" >/dev/null 2>&1; then ok "$4"; else bad "$4"; fi
}

read_lacks() {
  if jq -e --arg k "$2" --arg p "$3" '(.sandbox.filesystem[$k] // []) | index($p) | not' "$1" >/dev/null 2>&1; then ok "$4"; else bad "$4"; fi
}

test_settings_boundary() {
  local dir="$1" agent="$2" parent="$3" work work_parent ws
  work=$(cd -P "$dir/runner/_work" && pwd -P)
  work_parent=$(dirname "$work")
  ws="$work/repo/repo"
  make_settings "$dir" "$agent" "$parent"
  expect_status 0 "settings boundary: a self-hosted Linux run writes the read rules"
  if jq -e --arg p "$work_parent" '.sandbox.filesystem.denyRead == [$p]' "$dir/settings.json" >/dev/null; then ok "settings boundary: denyRead names only the parent of the work directory"; else bad "settings boundary: denyRead is not [the parent of the work directory] ($(jq -c '.sandbox.filesystem.denyRead' "$dir/settings.json"))"; fi
  if jq -e --arg w "$work" '.sandbox.filesystem.allowRead == [$w]' "$dir/settings.json" >/dev/null; then ok "settings boundary: allowRead names only the work directory"; else bad "settings boundary: allowRead is not [the work directory] ($(jq -c '.sandbox.filesystem.allowRead' "$dir/settings.json"))"; fi
  for target in "$work/rk-new-entry" "$work/repo/rk-new-sibling"; do
    if jq -e --arg t "$target" --arg ws "$ws" '
        (.sandbox.filesystem.allowRead | any(. as $a | ($t + "/") | startswith($a + "/")))
        and (.sandbox.filesystem.denyRead | any(. as $d | ($t + "/") | startswith($d + "/")))
        and ((($t + "/") | startswith($ws + "/")) | not)
      ' "$dir/settings.json" >/dev/null; then ok "settings boundary: $(basename "$target") is inside the read-only work directory and outside the workspace"; else bad "settings boundary: $(basename "$target") is not inside the read-only work directory or is inside the workspace"; fi
  done
  if jq -e --arg ws "$ws" '
      (.sandbox.filesystem.allowRead | any(. as $a | ($ws + "/") | startswith($a + "/")))
      and ([.sandbox.filesystem.denyWrite[] | select(($ws + "/") | startswith(. + "/"))] | length == 0)
    ' "$dir/settings.json" >/dev/null; then ok "settings boundary: the workspace is inside the read-only work directory and under no denyWrite path"; else bad "settings boundary: the workspace is outside the re-allowed work directory or under a denyWrite path"; fi
  deny_has "$dir/settings.json" "$dir/runner/_work/_temp" "settings boundary: RUNNER_TEMP stays in denyWrite"

  mkdir -p "$dir/runner/_work/_tool"
  RUNNER_TOOL_CACHE_IN="$dir/runner/_work/_tool" make_settings "$dir" "$agent" "$parent"
  expect_status 0 "settings boundary: a tool cache inside the work directory runs"
  if jq -e --arg w "$work" '.sandbox.filesystem.allowRead == [$w]' "$dir/settings.json" >/dev/null; then ok "settings boundary: a tool cache inside the work directory adds no read rule"; else bad "settings boundary: a tool cache inside the work directory added a read rule"; fi
  deny_has "$dir/settings.json" "$dir/runner/_work/_tool" "settings boundary: a tool cache inside the work directory stays in denyWrite"

  mkdir -p "$dir/runner/tool-cache"
  RUNNER_TOOL_CACHE_IN="$dir/runner/tool-cache" make_settings "$dir" "$agent" "$parent"
  expect_status 0 "settings boundary: a tool cache inside the runner directory runs"
  read_has "$dir/settings.json" allowRead "$work_parent/tool-cache" "settings boundary: a tool cache inside the runner directory and outside the work directory is re-allowed for reads"
  rm -rf "$dir/runner/tool-cache"

  mkdir -p "$dir/outer-tool-cache"
  RUNNER_TOOL_CACHE_IN="$dir/outer-tool-cache" make_settings "$dir" "$agent" "$parent"
  expect_status 0 "settings boundary: a tool cache outside the runner directory runs"
  deny_has "$dir/settings.json" "$dir/outer-tool-cache" "settings boundary: a tool cache outside the runner directory stays in denyWrite"
  read_lacks "$dir/settings.json" allowRead "$(cd -P "$dir/outer-tool-cache" && pwd -P)" "settings boundary: a tool cache outside the runner directory gets no read rule"
  rm -rf "$dir/outer-tool-cache"

  PATH_IN="$PATH:$dir/runner/bin:$dir/runner:$dir/runner/_work/_actions/owner/action/pin/bin:relative/bin" make_settings "$dir" "$agent" "$parent"
  expect_status 0 "settings boundary: a PATH with runner directories runs"
  read_has "$dir/settings.json" allowRead "$work_parent/bin" "settings boundary: a PATH directory inside the runner directory and outside the work directory is re-allowed for reads"
  read_lacks "$dir/settings.json" allowRead "$work_parent" "settings boundary: a PATH entry equal to the runner directory does not re-allow it"
  read_lacks "$dir/settings.json" allowRead "$work/_actions/owner/action/pin/bin" "settings boundary: a PATH directory inside the work directory adds no read rule"

  WORK_DIR_IN="" make_settings "$dir" "$agent" "$parent"
  expect_status 1 "settings boundary: an empty work directory value stops the run"
  expect_log "names no work directory" "settings boundary: the refusal for an empty work directory names the cause"

  WORK_PARENT_IN="" make_settings "$dir" "$agent" "$parent"
  expect_status 1 "settings boundary: an empty work directory parent value stops the run"

  WORK_DIR_IN="$work_parent" make_settings "$dir" "$agent" "$parent"
  expect_status 1 "settings boundary: a work directory that differs from RUNNER_TEMP stops the run"
  expect_log "differs from the work directory" "settings boundary: the refusal for a different work directory names the cause"

  mkdir -p "$dir/runner/agent-inside"
  AGENT_HOME_IN="$dir/runner/agent-inside" make_settings "$dir" "$agent" "$parent"
  expect_status 1 "settings boundary: an agent home under the parent of the work directory stops the run"
  expect_log "is at or under" "settings boundary: the refusal for a home under the parent names the cause"
  rm -rf "$dir/runner/agent-inside"

  mkdir -p "$dir/runner/homes"
  make_settings "$dir" "$agent" "$dir/runner/homes"
  expect_status 1 "settings boundary: a home parent under the parent of the work directory stops the run"
  expect_log "is at or under" "settings boundary: the refusal for a home parent under the parent names the cause"
  rm -rf "$dir/runner/homes"

  make_settings "$dir" "" "$parent" false
  expect_status 0 "settings boundary: a run without home_parent_deny writes the settings"
  read_lacks "$dir/settings.json" denyRead "$work_parent" "settings boundary: a run without home_parent_deny adds no read rule"
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
  expect_log "is missing or a symlink" "settings: the refusal for a missing required target names the cause"

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

  test_settings_boundary "$dir" "$agent" "$parent"
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
  script="$SCRIPTS/review_agent_home.sh"
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

test_preflight() {
  echo "== preflight"
  if [ "$(uname -s)" != "Linux" ] || [ "$(id -u)" != 0 ] || [ -z "${RK_PROBE_USER:-}" ]; then
    echo "SKIP preflight: it needs Linux, root, and RK_PROBE_USER"
    return
  fi
  local root="$SCRATCH/preflight" script work parent ws left
  rm -rf "$root"
  mkdir -p "$root/runner/_work/_temp" "$root/runner/_work/repo/repo"
  chmod 755 "$SCRATCH" "$root"
  work=$(cd -P "$root/runner/_work" && pwd -P)
  parent=$(dirname "$work")
  ws="$work/repo/repo"
  script=$(shared_script review_sandbox_preflight.sh)
  chmod 644 "$script"

  run_script "$script" -i "PATH=$PATH" "GITHUB_WORKSPACE=$ws" "WORK_DIR=$work" "WORK_PARENT=$parent"
  expect_status 0 "preflight: root passes the boundary check"
  expect_log "work:denied sibling:denied workspace:writable" "preflight: root sees the work directory read-only and the workspace writable"
  left=$(find "$work" "$work/repo" "$ws" -maxdepth 1 -name 'rk-preflight-*' -print)
  if [ -z "$left" ]; then ok "preflight: root leaves no check file on the host"; else bad "preflight: root left $left"; fi

  chown -R "$RK_PROBE_USER" "$root/runner"
  LAST_LOG="$SCRATCH/log-$RANDOM-$RANDOM.txt"
  (cd / && runuser -u "$RK_PROBE_USER" -- env -i "PATH=$PATH" "GITHUB_WORKSPACE=$ws" "WORK_DIR=$work" "WORK_PARENT=$parent" bash --noprofile --norc -eo pipefail "$script") > "$LAST_LOG" 2>&1
  LAST_STATUS=$?
  expect_status 0 "preflight: a user other than root passes the boundary check"
  expect_log "work:denied sibling:denied workspace:writable" "preflight: a user other than root sees the work directory read-only and the workspace writable"
  left=$(find "$work" "$work/repo" "$ws" -maxdepth 1 -name 'rk-preflight-*' -print)
  if [ -z "$left" ]; then ok "preflight: a user other than root leaves no check file on the host"; else bad "preflight: a user other than root left $left"; fi
  chown -R 0 "$root/runner"

  run_script "$script" -i "PATH=$PATH" "GITHUB_WORKSPACE=$ws" "WORK_DIR=$work" "WORK_PARENT=$root/missing-parent"
  expect_status 1 "preflight: a mount plan that bubblewrap cannot run is refused"
  expect_log "bubblewrap cannot run the mount plan" "preflight: the refusal names the failed mount plan"

  run_script "$script" -i "PATH=$PATH" "GITHUB_WORKSPACE=$ws" "WORK_DIR=" "WORK_PARENT="
  expect_status 1 "preflight: an empty work directory is refused"

  if ! command -v unshare >/dev/null 2>&1; then
    bad "preflight: unshare is missing, so the masked bubblewrap case cannot run"
    return
  fi
  LAST_LOG="$SCRATCH/log-$RANDOM-$RANDOM.txt"
  unshare -m --propagation private /bin/sh -c '
    for p in /usr/bin/bwrap /usr/bin/apt-get; do
      if [ -e "$p" ]; then mount --bind /dev/null "$p" || exit 97; fi
    done
    exec env -i "PATH=$1" "GITHUB_WORKSPACE=$2" "WORK_DIR=$3" "WORK_PARENT=$4" bash --noprofile --norc -eo pipefail "$5"
  ' sh "$PATH" "$ws" "$work" "$parent" "$script" > "$LAST_LOG" 2>&1
  LAST_STATUS=$?
  expect_status 1 "preflight: masked bubblewrap and apt-get are refused"
  expect_log "bubblewrap (bwrap) is not installed and could not be installed" "preflight: the refusal for masked bubblewrap names the cause"
}

test_work_entries() {
  echo "== work entries"
  local root="$SCRATCH/entries" before after work ws out oid
  rm -rf "$root"
  mkdir -p "$root/runner/_work/_temp" "$root/runner/_work/repo/repo" "$root/runner/_work/_actions"
  work=$(cd -P "$root/runner/_work" && pwd -P)
  ws="$work/repo/repo"
  before=$(shared_script review_record_work_entries.sh)
  after=$(step_script "Check that no work directory entry appeared while Claude ran")
  out="$SCRATCH/entries.out"

  record_entries() {
    : > "$out"
    run_script "$before" -i "PATH=$PATH" "GITHUB_WORKSPACE=$ws" "WORK_DIR=$work" "ENTRIES_FILE=$work/_temp/entries.txt" "GITHUB_OUTPUT=$out"
    oid=$(grep '^oid=' "$out" | tail -n 1 | cut -d= -f2-)
  }
  check_entries() {
    run_script "$after" -i "PATH=$PATH" "GITHUB_WORKSPACE=$ws" "WORK_DIR=$work" "ENTRIES_FILE=$work/_temp/entries.txt" "ENTRIES_OID=${1-$oid}"
  }

  record_entries
  expect_status 0 "work entries: the record step runs"
  if [ -n "$oid" ] && [ "$(git hash-object "$work/_temp/entries.txt")" = "$oid" ]; then ok "work entries: the recorded hash matches the record"; else bad "work entries: the recorded hash does not match the record"; fi
  if [ "$(find "$work/_temp/entries.txt" -perm 400 -print)" = "$work/_temp/entries.txt" ]; then ok "work entries: the record is mode 400"; else bad "work entries: the record is not mode 400"; fi
  if grep -qxF "E $work/_actions" "$work/_temp/entries.txt" && grep -qxF "E $work/repo/repo" "$work/_temp/entries.txt"; then ok "work entries: the record lists the work directory and the workspace parent entries"; else bad "work entries: the record misses an entry"; fi
  if grep -qF "E $ws/" "$work/_temp/entries.txt"; then bad "work entries: the record lists entries inside the workspace"; else ok "work entries: the record does not list entries inside the workspace"; fi

  printf 'x\n' > "$ws/inside-workspace"
  check_entries
  expect_status 0 "work entries: no new entry, and a new file inside the workspace, pass"
  rm -f "$ws/inside-workspace"

  printf 'x\n' > "$work/rk-new-entry"
  check_entries
  expect_status 1 "work entries: a new work directory entry fails the job"
  expect_log "$work/rk-new-entry" "work entries: the failure names the new work directory entry"
  if [ -f "$work/rk-new-entry" ]; then ok "work entries: the check deletes nothing"; else bad "work entries: the check deleted the new entry"; fi
  rm -f "$work/rk-new-entry"

  mkdir "$work/repo/.rk-new-sibling"
  check_entries
  expect_status 1 "work entries: a new workspace sibling fails the job"
  expect_log "$work/repo/.rk-new-sibling" "work entries: the failure names the new workspace sibling"
  rmdir "$work/repo/.rk-new-sibling"

  ln -s /nonexistent "$work/rk-new-link"
  check_entries
  expect_status 1 "work entries: a new dangling symlink in the work directory fails the job"
  rm -f "$work/rk-new-link"

  rmdir "$work/_actions"
  check_entries
  expect_status 0 "work entries: a removed entry does not fail the job"
  expect_log "gone after the action" "work entries: a removed entry is named in a notice"
  mkdir "$work/_actions"

  check_entries 0000
  expect_status 1 "work entries: a record whose hash differs fails the job"
  check_entries ""
  expect_status 1 "work entries: a missing record hash fails the job"
}

stub_run() {
  local ws="$1" script
  script="$SCRIPTS/review_ancestor_stubs.sh"
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

for tool in bun git jq; do
  command -v "$tool" >/dev/null 2>&1 || { echo "missing $tool" >&2; exit 2; }
done

SUITES=("$@")
[ "${#SUITES[@]}" -gt 0 ] || SUITES=(contract guard settings cleanup agent_home stubs preflight work_entries)
for suite in "${SUITES[@]}"; do
  case "$suite" in
    contract) test_contract ;;
    guard) test_guard ;;
    settings) test_settings ;;
    cleanup) test_cleanup ;;
    agent_home) test_agent_home ;;
    stubs) test_stubs ;;
    preflight) test_preflight ;;
    work_entries) test_work_entries ;;
    *) echo "unknown suite: $suite" >&2; exit 2 ;;
  esac
done

echo "fixtures: $PASS passed, $FAIL failed"
[ "$FAIL" = 0 ]
