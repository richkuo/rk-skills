---
name: cli-dispatch
description: Required dispatch procedure for running a build or fix pass on an external coding CLI — the Codex CLI (`codex exec`) or the Cursor CLI (`agent -p`) — when an issue's Execution block stamps that harness as the Build model. Preflight, the two shims, the prompt-as-data rule, the background-and-poll rule, result parsing, the substitution check, attribution, and the failure table. Load BEFORE dispatching any Codex CLI or Cursor CLI build.
---

# CLI dispatch

How a build reaches the Codex CLI or the Cursor CLI when an issue stamps `Build model: <Name> (Codex CLI)` or `<Name> (Cursor CLI)`. The calling skill or workflow owns the task prompt and what happens with the result. This skill owns the path to the external CLI. A run on any other model than the stamped one is a substitution, and a substitution is always reported and never presented as the stamped build. This procedure never falls back to a Claude build: the stamp is a user override, and a silent fallback is the defect this skill closes.

## 1. Preflight

Run before writing any file:

```sh
command -v codex && codex login status
command -v agent && agent status
```

Check only the CLI the stamp names. A missing binary or a signed-out status is a blocker for that issue: return it with the binary or the login named, and let the caller run the rest of the milestone.

## 2. Resolve the model id and the effort

- `Build model: Luna (Codex CLI)` resolves to `gpt-5.6-luna`. `Build model: Grok (Cursor CLI)` resolves to `cursor-grok-4.6-<effort>`. An explicit id inside the parenthetical, `Luna (Codex CLI, gpt-5.6-luna)` or `Grok (Cursor CLI, cursor-grok-4.6-high)`, is used verbatim. Any other name with no explicit id is a blocker; never guess an id.
- Codex effort tiers are `low`, `medium`, `high`, `xhigh`, and `max`, passed as `-c model_reasoning_effort=<tier>`. Cursor encodes the tier in the model id suffix, and `max` becomes `xhigh` with a log line. `max` on a Claude model is normalized by the caller to xhigh on every Claude model.
- `agent --list-models` prints the ids Cursor accepts; run it when an explicit Cursor id looks unfamiliar (`agent` and `cursor-agent` are the same binary, and the preflight checks `agent`). On 2026-09-02 (cursor-agent 2026.09.02) that list carried `cursor-grok-4.6-low`, `cursor-grok-4.6-medium`, `cursor-grok-4.6-high`, and `cursor-grok-4.6-xhigh`, so the `Grok` default resolves to a listed id at every tier; a `-fast` variant is an explicit id.
- **A model id is shell data.** It comes from the issue body and lands in the shim command, so the caller accepts only ids that match `^[A-Za-z0-9][A-Za-z0-9._:-]*$` and blocks the issue otherwise, and the shim single-quotes the id. Whitespace, `;`, `$(`, and backticks never reach a command position.

## 3. The prompt file

Write the task prompt to a file outside the repository tree (the session scratchpad, else a `mktemp -d` directory). Append one line that tells the CLI agent to read the `work-on-issue` skill file directly (or `fix-pr-review` for a fix pass) at the first path that exists: `~/.codex/skills/<skill>/SKILL.md`, `~/.cursor/skills/<skill>/SKILL.md`, then `~/.claude/skills/<skill>/SKILL.md`. Resolve that path yourself and write the absolute path into the file. Append the attribution rules from section 7.

The two stages get different files. A **build** file carries the task prompt verbatim plus one line saying that the driver handles every review trigger and review cycle, so the CLI agent stops once the pull request is open and verified. A **fix pass** file names the PR and the review comment to address, carries the caller's constraints and overrides verbatim, and states that the CLI agent must not trigger, post, or wait for any re-review and stops after pushing the fixes and posting the disposition comment. The driver posts every trigger (section 8).

**Never interpolate the prompt into the command line.** A prompt that contains `"`, `` ` ``, or `$` breaks the quoting or executes. The Codex shim reads the file from stdin. The Cursor CLI takes the prompt as a positional argument and reads nothing from stdin, so the shim passes `"$(cat "$PROMPT")"` as one argument: the shell expands it once and never re-parses the content.

## 4. The two shims

Run from the repository root with `REPO`, `PROMPT`, `RESULT`, `EVENTS`, and `STDERR` set to absolute paths.

```sh
codex exec -C "$REPO" -m '<model-id>' -c model_reasoning_effort=<tier> \
  -s workspace-write -c sandbox_workspace_write.network_access=true \
  --json -o "$RESULT" < "$PROMPT" > "$EVENTS" 2> "$STDERR"
```

```sh
agent -p --output-format json --model '<model-id>' --force --trust \
  --workspace "$REPO" "$(cat "$PROMPT")" > "$RESULT" 2> "$STDERR"
```

- `-s workspace-write` keeps Codex writes inside the repository, and `sandbox_workspace_write.network_access=true` lets `git push` and `gh` reach the network from that sandbox. A smoke run on 2026-09-02 (codex-cli 0.152.1, `gpt-5.6-luna`, this exact flag set, a throwaway repository) ran `git commit`, `git worktree add`, `curl -sI https://github.com`, and `gh auth status` with exit status 0 each, so the sandbox permits the commit-and-open-PR contract. `--json` streams the event log and `-o` writes the final message; both flags are verified against `codex exec --help` (codex-cli 0.152.1).
- **The Cursor shim has no write boundary.** `--force` lets the Cursor CLI run any shell command without a per-command prompt, and `--trust` accepts the workspace; both flags are verified against `agent --help` (2026.08.31 build). A headless run has no user to answer a prompt, so a build without them stalls. `--workspace` sets the working directory and limits nothing. The `--sandbox enabled` flag exists, and on 2026-09-02 (cursor-agent 2026.09.02) a smoke run with it still wrote a file under `/tmp` outside the workspace, so it is no boundary either. A Cursor build runs with the driver's full shell rights, and the `git status` snapshot diff in section 8 is its only guard.
- `--dangerously-bypass-approvals-and-sandbox`, `--yolo`, and any flag this section does not name never appear in a shim.
- **Timeout.** A full build runs for many minutes and exceeds the host's foreground Bash timeout. Start the shim in the background with output redirected to the files above and poll for the process to exit; never run it in the foreground.

## 5. Parse the result

Sections 5 and 6 run after every run, pass or fail. A zero exit never skips the result read, the substitution comparison, or the `model unverified` record, because a swapped model on a successful build is the case they exist to catch.

- Codex: `$RESULT` holds the agent's final message. `$EVENTS` holds one JSON event per line; when an event names the model that served the turn, that value is the record of what ran.
- Cursor: `$RESULT` holds one JSON object with the final text; when it names the model that served the call, that value is the record.
- On the 2026-09-02 smoke runs neither output named a model (codex-cli 0.152.1 `--json` events carry `thread`, `turn`, and `item` records; cursor-agent 2026.09.02 returns `result`, `session_id`, `request_id`, and `usage`), so expect `model unverified` (section 6) to be the usual record until a CLI version adds the field.
- A non-zero exit is a failure. Before any retry, check for work the failed run already landed: for a build, a `<prefix>/issue-<N>-*` branch on the remote or an open PR closing the issue; for a fix pass, a head commit newer than the pre-run head or a new disposition comment. Landed work is a completed pass: verify it (section 8) and never re-run, because a second run repeats the issue-body edit, the PR, or the disposition comment. Only when nothing landed, retry the shim once with the same inputs; a second failure is a blocker that quotes the last lines of `$STDERR`.

## 6. Substitution check

Compare the model the output names with the requested id. A different model means the CLI substituted, and the result is a substituted work product: adopt it only with the substitution named in the summary, the flags, and the footer, and never present it as the stamped model's build. An output that names no model is recorded as `model unverified` beside the requested id.

## 7. Attribution

- Branch prefix: `codex/` for the Codex CLI, `cursor/` for the Cursor CLI (CLAUDE.md Git Workflow).
- PR title bracket: `[C<score>, <Name>, <tier>]`, e.g. `[C33, Luna, max]`, with `, fableplan` appended when the caller says a Fable 5.1 plan was posted for the issue and drove the build (CLAUDE.md PR title convention); a failed plan stage earns no marker.
- Footer: `Created with LLM: <Name> | <tier> | Harness: Codex` or `Harness: Cursor`; `Updated` on a fix pass. The name is the stamped display name (`Luna`, `Grok`) unless section 6 found a substitution, and then it is the model the output named.

## 8. Dispatch hygiene, every caller

- Snapshot `git status --porcelain --untracked-files=all` in the main checkout before dispatching and diff it after the run, ignoring every path under `.claude/worktrees/`: tracks run concurrently and another issue's Codex or Cursor worktree is created there, so it is not a stray write. Report any other change outside the issue's worktree, including a write under `.claude/` that is no worktree.
- Verify the pull request with `gh` after the run exactly as a Claude builder would: the PR number, the head ref, and the head commit. A successful exit with no PR is a blocker.
- Review cycles: the driver owns every step that reads or writes GitHub review state (fetching the standing review, deciding whether to stop, posting the cycle-1 trigger and every re-trigger the caller's routing selects, watching the Actions run, reading the verdict) and forwards each fix pass to the same shim with the fix-pass file section 3 describes. The CLI agent runs `fix-pr-review` through its disposition comment and never posts a trigger; when the caller forbids re-triggering (subagent review mode), the driver posts nothing. After a fix pass the driver verifies the PR head with `gh pr view <num> --json headRefName,headRefOid`, and a pass that exits zero with neither a new head commit nor a disposition comment is a blocker.

## Failure modes

| Situation | Do this |
|---|---|
| The CLI binary is absent | Block that issue with the binary named; the caller runs the rest of the milestone |
| `codex login status` or `agent status` reports signed out | Block that issue with the login named |
| The shim exits non-zero | Check for landed work first (section 5); when none, retry once with the same inputs, then block with the last lines of stderr |
| The output names a model other than the requested id | Report the substitution in the summary, flags, and footer; never present it as the stamped build |
| The run exits zero and no PR exists | Block; never open a PR on the CLI agent's behalf |
| Writes appear outside the issue's worktree | Report them in flags and leave them for the user to review |
