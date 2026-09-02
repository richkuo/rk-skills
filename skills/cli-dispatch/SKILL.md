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
- Codex effort tiers are `low`, `medium`, `high`, `xhigh`, and `max`, passed as `-c model_reasoning_effort=<tier>`. Cursor encodes the tier in the model id suffix, and `max` becomes `xhigh` with a log line. `max` on a Claude model is normalized by the caller (xhigh on Opus or Sonnet, high on Fable).
- `cursor-agent --list-models` prints the ids Cursor accepts; run it when an explicit Cursor id looks unfamiliar.

## 3. The prompt file

Write the task prompt to a file outside the repository tree (the session scratchpad, else a `mktemp -d` directory). Append one line that tells the CLI agent to read the `work-on-issue` skill file directly (or `fix-pr-review` for a fix pass) at the first path that exists: `~/.codex/skills/<skill>/SKILL.md`, `~/.cursor/skills/<skill>/SKILL.md`, then `~/.claude/skills/<skill>/SKILL.md`. Resolve that path yourself and write the absolute path into the file. Append the attribution rules from section 7.

**Never interpolate the prompt into the command line.** A prompt that contains `"`, `` ` ``, or `$` breaks the quoting or executes. The Codex shim reads the file from stdin. The Cursor CLI takes the prompt as a positional argument and reads nothing from stdin, so the shim passes `"$(cat "$PROMPT")"` as one argument: the shell expands it once and never re-parses the content.

## 4. The two shims

Run from the repository root with `REPO`, `PROMPT`, `RESULT`, `EVENTS`, and `STDERR` set to absolute paths.

```sh
codex exec -C "$REPO" -m <model-id> -c model_reasoning_effort=<tier> \
  -s workspace-write -c sandbox_workspace_write.network_access=true \
  --json -o "$RESULT" < "$PROMPT" > "$EVENTS" 2> "$STDERR"
```

```sh
agent -p --output-format json --model <model-id> --force --trust \
  --workspace "$REPO" "$(cat "$PROMPT")" > "$RESULT" 2> "$STDERR"
```

- `-s workspace-write` keeps Codex writes inside the repository. `sandbox_workspace_write.network_access=true` is the documented config key that lets `git push` and `gh` reach the network from that sandbox; it was read from the Codex config reference and has not been exercised by running a build on this machine. `--json` streams the event log and `-o` writes the final message; both flags are verified against `codex exec --help` (codex-cli 0.152.1).
- `--force` lets the Cursor CLI run shell commands without a per-command prompt, and `--trust` accepts the workspace; both flags are verified against `agent --help` (2026.08.31 build). A headless run has no user to answer a prompt, so a build without them stalls.
- `--dangerously-bypass-approvals-and-sandbox`, `--yolo`, and any flag this section does not name never appear in a shim.
- **Timeout.** A full build runs for many minutes and exceeds the host's foreground Bash timeout. Start the shim in the background with output redirected to the files above and poll for the process to exit; never run it in the foreground.

## 5. Parse the result

- Codex: `$RESULT` holds the agent's final message. `$EVENTS` holds one JSON event per line; when an event names the model that served the turn, that value is the record of what ran.
- Cursor: `$RESULT` holds one JSON object with the final text; when it names the model that served the call, that value is the record.
- A non-zero exit is a failure. Retry the shim once with the same inputs; a second failure is a blocker that quotes the last lines of `$STDERR`.

## 6. Substitution check

Compare the model the output names with the requested id. A different model means the CLI substituted, and the result is a substituted work product: adopt it only with the substitution named in the summary, the flags, and the footer, and never present it as the stamped model's build. An output that names no model is recorded as `model unverified` beside the requested id.

## 7. Attribution

- Branch prefix: `codex/` for the Codex CLI, `cursor/` for the Cursor CLI (CLAUDE.md Git Workflow).
- PR title bracket: `[C<score>, <Name>, <tier>]`, e.g. `[C33, Luna, max]`.
- Footer: `Created with LLM: <Name> | <tier> | Harness: Codex` or `Harness: Cursor`; `Updated` on a fix pass. The name is the stamped display name (`Luna`, `Grok`) unless section 6 found a substitution, and then it is the model the output named.

## 8. Dispatch hygiene, every caller

- Snapshot `git status --porcelain` in the main checkout before dispatching and diff it after the run; report any change outside the issue's worktree.
- Verify the pull request with `gh` after the run exactly as a Claude builder would: the PR number, the head ref, and the head commit. A successful exit with no PR is a blocker.
- Review cycles: the driver reads GitHub state itself (posts the trigger, watches the Actions run, reads the verdict) and forwards every fix pass to the same shim with a fix prompt naming the PR and the findings.

## Failure modes

| Situation | Do this |
|---|---|
| The CLI binary is absent | Block that issue with the binary named; the caller runs the rest of the milestone |
| `codex login status` or `agent status` reports signed out | Block that issue with the login named |
| The shim exits non-zero | Retry once with the same inputs, then block with the last lines of stderr |
| The output names a model other than the requested id | Report the substitution in the summary, flags, and footer; never present it as the stamped build |
| The run exits zero and no PR exists | Block; never open a PR on the CLI agent's behalf |
| Writes appear outside the issue's worktree | Report them in flags and leave them for the user to review |
