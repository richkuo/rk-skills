---
name: fable-dispatch
description: Required dispatch procedure for running a subagent on Fable 5.1: positive harness detection, the Claude Code CLI shim for other harnesses, the fallback ladder, the result-parsing contract, the attribution rule, and the caller dispatch-hygiene rules (read-only prompt, snapshot/diff, retry). Load BEFORE dispatching any `model: fable` subagent.
---

# Fable dispatch

How every fable skill reaches Fable 5.1 on the current harness. The calling skill owns the prompt, the subagent type, and what happens with the result. This skill owns the path to Fable 5.1. A downgrade to another model is the ladder's last step, and it is always reported.

## 1. Detect the harness

Run one Bash check before dispatching:

```sh
[ -n "$CLAUDECODE" ] && echo claude-code || echo other
```

Claude Code sets `CLAUDECODE=1`. Every other result means "not Claude Code". Do not probe for Cursor or Codex variables (their names are unverified), and never infer the harness from an Agent-call error: a harness that maps `fable` to another model raises no error. That silent substitution is the defect this ladder closes.

## 2. The fallback ladder

1. **Claude Code** (`$CLAUDECODE` set): the Agent tool with `model: fable`, as the calling skill's dispatch step describes.
2. **Other harness, and `command -v claude` succeeds**: the CLI shim (section 3). The work still runs on Fable 5.1 at the intended effort.
3. **Neither path, or a shim call that failed after the section 7 retry**: the most capable model available, with the downgrade reported. In order: (a) the harness's own subagent facility with its most capable model, keeping the calling skill's isolation pattern; (b) a completed shim result that another model served, adopted per section 5; (c) no subagent facility at all: do the work inline in the main context and make no writes during it, so the calling skill's read-only promise holds. The report names both what failed and which model ran instead.

## 3. The CLI shim

Write the prompt to a file, then feed that file to stdin:

```sh
claude -p --model fable --effort <tier> \
  --output-format json --permission-mode plan \
  --allowedTools <read-only command list> \
  < <prompt-file>
```

- **Never interpolate the prompt into the command line.** A prompt containing `"`, `` ` ``, or `$` breaks the quoting or executes (the class `tests/prompt-shell-safety.test.js` guards). Stdin from a file passes the prompt as data.
- `--permission-mode plan` keeps the subagent read-only. `--dangerously-skip-permissions` must never appear in the shim.
- **`--allowedTools` names every read-only command the calling skill's procedure runs.** Example: `fable-validate` runs `gh issue view --comments` and `gh pr list`, so its list is `"Bash(gh issue view *)" "Bash(gh pr list *)"`. Add `git log`/`git diff` forms when the procedure reads history, and `-R owner/repo` forms when it reads another repo. An empty list is valid for a subagent that only reads files. Plan mode auto-approves built-in reads. A headless run has no user to answer any other prompt, so a missing entry lands in `.permission_denials` and the result is incomplete. The list carries read-only commands only: never a bare `Bash`, never an edit, comment, or push command. Plan mode does not block an allow-listed Bash write (verified live), so the read-only list is the shim's only guard against writes.
- `--effort` carries the tier directly. The Fable ceiling holds: any stamped tier above `high` becomes `high`, and the calling skill's report says so.
- **Timeout.** A Fable 5.1 run at `high` takes minutes and exceeds a host's default Bash timeout, which kills the call mid-run. Set the host's maximum timeout on the call, or start the CLI in the background with output redirected to a file and poll for exit.

## 4. Parse the result

`--output-format json` prints one JSON object. Read four keys:

- `.result`: the subagent's output (the plan, verdict, or draft).
- `.is_error`: `true` means the call failed.
- `.modelUsage`: its keys name the model(s) that served the call. Never assume the requested model ran. Observed live: a `--model` alias the CLI accepts can be served by a different model, and `.modelUsage` is the only honest record.
- `.permission_denials`: a non-empty list means a command was blocked. For a read-only command the procedure needs, add its form to `--allowedTools` and re-run once. A denied write means the prompt's read-only rule failed, so report it.

## 5. Shim failure and substitution

A shim call fails when the CLI exits non-zero or `.is_error` is `true`. After the section 7 retry, fall to ladder step 3 and report both the failure and the downgrade.

Substitution is its own case: exit zero and `.is_error` false, but `.modelUsage` names a model other than Fable. The output is a finished work product from that model. Adopt it as the ladder step-3 result and report both the failure (the substitution) and the downgrade. A re-run lands on the same substitute at extra cost. Never present an adopted result as Fable's.

## 6. Attribution

The footer and the report name the model `.modelUsage` reports. On the Agent path that is Fable 5.1, unless ladder step 3 substituted another model, and then that model's name. The effort is the tier actually passed and accepted. The harness field names the harness running the session: `Claude Code` only when `$CLAUDECODE` is set, otherwise that harness's name (`Cursor`, `Codex`), on the shim path too. A footer that names a model, tier, or harness that did not serve the call is a false attribution.

## 7. Dispatch hygiene, every caller

Callers cite this section at their dispatch step and add only their own deltas.

- **State read-only in the prompt.** A `Plan` subagent lacks Edit and Write but keeps Bash, so the prompt says explicitly: no file edits and no commits, including through Bash.
- **Snapshot before, diff after.** Run `git status --porcelain` before dispatching (the tree may already be dirty) and again when the result arrives. Any new change means the subagent wrote: tell the user and ask whether to revert before continuing.
- **Retry once, then report.** On a null result or an error (user skip, terminal API failure, a shim failure per section 5), retry once. A second failure on the Agent path stops with a report to the user. A second failure on the shim path falls to ladder step 3 with the report section 5 requires. Never do the delegated work yourself in the subagent's place; inline work is ladder step 3(c) only, when no subagent facility exists.
