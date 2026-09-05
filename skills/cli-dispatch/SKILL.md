---
name: cli-dispatch
description: Required dispatch procedure for running a build or fix pass on an external coding CLI — the Codex CLI (`codex exec`) or the Cursor CLI (`agent -p`) — when an issue's Execution block stamps that harness as the Build model. Preflight, the two shims, the prompt-as-data rule, the background-and-poll rule, result parsing, the substitution check, attribution, and the failure table. Load BEFORE dispatching any Codex CLI or Cursor CLI build.
---

# CLI dispatch

How a build reaches the Codex CLI or the Cursor CLI when an issue stamps `Build model: <Name> (Codex CLI)` or `<Name> (Cursor CLI)`. The caller owns the task prompt and the result; this skill owns the path to the CLI. A run on a model other than the stamped one is a substitution: always reported, never presented as the stamped build. This procedure never falls back to a Claude build: the stamp is a user override, and a silent fallback is the defect this skill closes.

## 1. Preflight

Check only the CLI the stamp names, before writing any file: `command -v codex && codex login status` or `command -v agent && agent status`. A missing binary or a signed-out status blocks that issue (name the binary or the login); the caller runs the rest of the milestone.

## 2. Model id and effort

- `Luna (Codex CLI)` resolves to `gpt-5.6-luna`; `Grok (Cursor CLI)` resolves to `cursor-grok-4.6-<effort>`. An explicit id in the parenthetical (`Luna (Codex CLI, gpt-5.6-luna)`) is used verbatim. Any other name with no explicit id is a blocker; never guess an id.
- Codex tiers `low`, `medium`, `high`, `xhigh`, `max` pass as `-c model_reasoning_effort=<tier>`. Cursor encodes the tier in the id suffix; the caller normalizes `max` to `xhigh` with a log line.
- `agent --list-models` prints the ids Cursor accepts (`agent` and `cursor-agent` are one binary); run it when an explicit id looks unfamiliar. On 2026-09-02 (cursor-agent 2026.09.02) it listed `cursor-grok-4.6-{low,medium,high,xhigh}`, so the `Grok` default resolves at every tier; a `-fast` variant is an explicit id.
- **A model id is shell data.** Accept only ids matching `^[A-Za-z0-9][A-Za-z0-9._:-]*$`, block the issue otherwise, and single-quote the id in the shim.

## 3. The prompt file

Write the prompt to a file outside the repository tree (the session scratchpad, else `mktemp -d`). Append one line telling the CLI agent to read the `work-on-issue` skill (or `fix-pr-review` for a fix pass) at the first existing path of `~/.codex/skills/<skill>/SKILL.md`, `~/.cursor/skills/<skill>/SKILL.md`, `~/.claude/skills/<skill>/SKILL.md`; resolve and write the absolute path yourself. Append the section 7 attribution rules.

A **build** file carries the task prompt verbatim plus one line: the driver handles every review trigger and cycle, so the CLI agent stops once the PR is open and verified. A **fix pass** file names the PR and the review comment, carries the caller's constraints verbatim, and states that the CLI agent must not trigger, post, or wait for any re-review and stops after pushing the fixes and posting the disposition comment.

**Never interpolate the prompt into the command line**: `"`, `` ` ``, or `$` in it breaks the quoting or executes. The Codex shim reads the file from stdin. The Cursor CLI takes the prompt as a positional argument and reads no stdin, so the shim passes `"$(cat "$PROMPT")"` as one argument, expanded once and never re-parsed.

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

- `-s workspace-write` keeps Codex writes inside the repository; `sandbox_workspace_write.network_access=true` lets `git push` and `gh` reach the network. A 2026-09-02 smoke run (codex-cli 0.152.1, `gpt-5.6-luna`, this flag set, a throwaway repository) ran `git commit`, `git worktree add`, `curl -sI https://github.com`, and `gh auth status` with exit 0 each. `--json` streams the event log and `-o` writes the final message (verified against `codex exec --help`, codex-cli 0.152.1).
- **The Cursor shim has no write boundary.** `--force` runs any shell command without a per-command prompt and `--trust` accepts the workspace (verified against `agent --help`, 2026.08.31 build); a headless run stalls without them. `--workspace` sets the working directory and limits nothing. `--sandbox enabled` exists, but a 2026-09-02 smoke run (cursor-agent 2026.09.02) with it still wrote under `/tmp`, so it is no boundary. A Cursor build runs with the driver's full shell rights; the section 8 `git status` diff is its only guard.
- `--dangerously-bypass-approvals-and-sandbox`, `--yolo`, and any flag this section does not name never appear in a shim.
- **Timeout.** A full build exceeds the host's foreground Bash timeout. Start the shim in the background with output redirected to the files above and poll for exit; never run it in the foreground.

## 5. Parse the result

Sections 5 and 6 run after every run, pass or fail: a zero exit never skips the result read, the substitution comparison, or the `model unverified` record, because a swapped model on a successful build is the case they catch.

- Codex: `$RESULT` holds the final message; `$EVENTS` holds one JSON event per line. Cursor: `$RESULT` holds one JSON object with the final text. When either names the model that served the run, that value is the record.
- On the 2026-09-02 smoke runs neither output named a model (codex-cli 0.152.1 events carry `thread`, `turn`, `item`; cursor-agent 2026.09.02 returns `result`, `session_id`, `request_id`, `usage`), so `model unverified` is the usual record until a CLI version adds the field.
- A non-zero exit is a failure. Before any retry, check for work the failed run already landed: for a build, a `<prefix>/issue-<N>-*` remote branch or an open PR closing the issue; for a fix pass, a head commit newer than the pre-run head or a new disposition comment. Landed work is a completed pass: verify it (section 8) and never re-run, because a second run repeats the issue edit, the PR, or the comment. When nothing landed, retry once with the same inputs; a second failure blocks and quotes the last lines of `$STDERR`.

## 6. Substitution check

Compare the model the output names with the requested id. A different model is a substituted work product: adopt it only with the substitution named in the summary, the flags, and the footer, and never present it as the stamped model's build. An output naming no model is recorded as `model unverified` beside the requested id.

## 7. Attribution

- Branch prefix: `codex/` or `cursor/` (CLAUDE.md Git Workflow).
- PR title bracket: `[C<score>, <Name>, <tier>]`, e.g. `[C33, Luna, max]`, with `, fableplan` appended when the caller says a Fable 5.1 plan drove the build (CLAUDE.md PR title convention); a failed plan stage earns no marker.
- Footer: `Created with LLM: <Name> | <tier> | Harness: Codex` or `Harness: Cursor`; `Updated` on a fix pass. `<Name>` is the stamped display name unless section 6 found a substitution, then the model the output named.

## 8. Dispatch hygiene, every caller

- Snapshot `git status --porcelain --untracked-files=all` in the main checkout before dispatching and diff it after, ignoring every path under `.claude/worktrees/` (concurrent tracks create worktrees there). Report any other change outside the issue's worktree, including a non-worktree write under `.claude/`.
- Verify the PR with `gh` as a Claude builder would: number, head ref, head commit. A zero exit with no PR is a blocker.
- Review cycles: the driver owns every read or write of GitHub review state (the standing review, the stop decision, the cycle-1 trigger and every re-trigger the caller's routing selects, the Actions run, the verdict) and forwards each fix pass to the same shim with the section 3 fix-pass file. The CLI agent runs `fix-pr-review` through its disposition comment and never posts a trigger; when the caller forbids re-triggering (subagent review mode), the driver posts nothing. After a fix pass the driver checks `gh pr view <num> --json headRefName,headRefOid`; a zero exit with neither a new head commit nor a disposition comment is a blocker.

## Failure modes

| Situation | Do this |
|---|---|
| CLI binary absent | Block the issue, binary named; the caller runs the rest |
| `codex login status` or `agent status` signed out | Block the issue, login named |
| Shim exits non-zero | Check for landed work (section 5); else retry once, then block with the last stderr lines |
| Output names another model | Report the substitution in summary, flags, footer; never present as the stamped build |
| Zero exit, no PR | Block; never open a PR for the CLI agent |
| Writes outside the issue's worktree | Report in flags; leave for the user |
