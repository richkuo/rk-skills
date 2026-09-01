---
name: fable-dispatch
description: Required dispatch procedure for running a subagent on Fable 5.1 — positive harness detection, the Claude Code CLI shim for other harnesses, the fallback ladder, the result-parsing contract, the attribution rule, and the caller dispatch-hygiene rules (read-only prompt, snapshot/diff, retry). Load BEFORE dispatching any `model: fable` subagent.
---

# Fable dispatch

How every fable skill reaches Fable 5.1 on the current harness. The calling skill owns the prompt, the subagent type, and what happens with the result; this skill owns *how* the dispatch reaches Fable 5.1. Downgrading to another model is the ladder's last resort, never the first response to an unavailable model id.

## 1. Detect the harness — positively, before dispatching

Run one Bash check:

```sh
[ -n "$CLAUDECODE" ] && echo claude-code || echo other
```

Claude Code sets `CLAUDECODE=1` in its sessions. Treat every other result as "not Claude Code". Do not probe for Cursor or Codex marker variables — those names are unverified — and do not infer the harness from an Agent-call error: a harness that accepts an unknown model id, or maps `fable` to another model, produces no error to catch. That silent substitution is the defect this ladder closes.

## 2. The fallback ladder

1. **Claude Code** (`$CLAUDECODE` is set) → dispatch with the Agent tool and `model: fable`, exactly as the calling skill's dispatch step describes.
2. **Not Claude Code, and `command -v claude` succeeds** → the CLI shim below. The work still runs on Fable 5.1 at the intended effort.
3. **Neither path is available, or a shim call failed** (see the failure rule below) → fall back to the most capable model available and proceed, then report the downgrade. The mechanism, in order: (a) the harness's own subagent facility with the most capable model it offers, keeping the calling skill's isolation pattern; (b) a completed shim result that another model served — adopt it per the substitution rule in section 5 instead of re-running; (c) no subagent facility at all — do the work inline in the main context and make no writes during it, so the calling skill's read-only promise holds. Reaching this step silently is the same defect the ladder exists to fix: the report to the user names both what failed and which model ran instead.

## 3. The CLI shim

Write the subagent prompt to a file first, then dispatch by feeding that file to stdin:

```sh
claude -p --model fable --effort <tier> \
  --output-format json --permission-mode plan \
  --allowedTools <read-only command list> \
  < <prompt-file>
```

- **Never interpolate the prompt into the command line.** A prompt containing `"`, `` ` ``, or `$` breaks the quoting or executes (the failure class `tests/prompt-shell-safety.test.js` guards against). The stdin-from-a-file form passes the prompt as data; a properly quoted argument is the only alternative.
- `--permission-mode plan` keeps the subagent read-only, matching what the fable skills promise. `--dangerously-skip-permissions` must never appear in the shim, under any circumstances — a read-only permission mode is required.
- **Derive the `--allowedTools` list from the calling skill's procedure**: every read-only command the subagent's steps run, named explicitly — e.g. `fable-validate`'s subagent runs `gh issue view --comments` and `gh pr list`, so its list is `"Bash(gh issue view *)" "Bash(gh pr list *)"`; add `git log`/`git diff` forms when the procedure reads history, and `-R owner/repo` forms when it reads another repo. An empty list is valid for a subagent that only reads files. Plan mode auto-approves built-in reads, and a permission classifier can approve other read-only commands (observed live once), but classifier approval is heuristic and a headless run has no user to answer a prompt — the explicit list is what makes the procedure's reads deterministic. The list carries read-only commands only: never a bare `Bash`, never an edit, comment, or push command. **Plan mode does not block an allow-listed Bash write** (verified live: an allow-listed `touch` ran in plan mode and created its file) — the read-only-only constraint on the list is the shim's only guarantee against writes.
- `--effort` carries the intended tier (`low|medium|high|xhigh|max`) directly, so the Agent-tool "harness may not accept `effort`" degradation does not apply on this path. The Fable ceiling still holds: any stamped tier above `high` — `xhigh`, `max`, or a future higher tier — becomes `high`, and the calling skill's report says so.
- **Timeout.** A Fable 5.1 run at `high` takes minutes and exceeds a host harness's default Bash timeout, which kills the call mid-run — the default timeout is not sufficient. Either set the host's maximum Bash timeout on the shim call, or run it background-and-poll: start the CLI with its output redirected to a file, then poll for process exit and read the file.

## 4. Parse the result

`--output-format json` prints one JSON object. Read three keys:

- `.result` — the subagent's output (the plan, verdict, or draft the calling skill wants).
- `.is_error` — `true` means the call failed.
- `.modelUsage` — an object whose keys name the model(s) that actually served the call. Read it; never assume the requested model ran. (Observed live: a `--model` alias the CLI accepts can still be served by a different model — `.modelUsage` is the only honest record.)

## 5. Shim failure

A shim call counts as failed when the CLI exits non-zero or `.is_error` is `true`. On failure, fall to ladder step 3 and report both the failure and the downgrade — never only the downgrade, and never neither.

**Substitution is its own case.** When the call completes (exit zero, `.is_error` false) but `.modelUsage` names a model other than Fable serving the call, the output is a finished work product from that model. Adopt it as the ladder step-3 result and report both the failure (the substitution) and the downgrade — a re-run would land on the same substitute at extra cost. Never present an adopted result as Fable's.

## 6. Attribution

The footer and the report name the model `.modelUsage` reports (on the Agent path: Fable 5.1, unless ladder step 3 substituted another model — then that model's name, never "Fable 5.1"). The effort named is the tier that was actually passed and accepted. The harness field names the harness actually running the session — `Claude Code` only when `$CLAUDECODE` is set; on another harness, that harness's name (e.g. `Cursor`, `Codex`), on the shim path included. A footer claiming a model, tier, or harness that did not serve the call is a false attribution.

## 7. Dispatch hygiene — every caller

Three rules apply to every dispatch this skill governs. Callers cite this section at their dispatch step and add only their own deltas.

- **State read-only explicitly in the prompt.** A `Plan` subagent lacks Edit and Write, but it still has Bash, so the prompt must say explicitly that the subagent makes no file edits and no commits, including through Bash. The tool restriction alone does not close the Bash path.
- **Snapshot before, diff after.** Snapshot `git status --porcelain` before dispatching (the tree may already be dirty). When the result arrives, run it again and diff against the snapshot to confirm the subagent made no file changes. If it did, tell the user and ask whether to revert before continuing.
- **Retry once, then report.** If the call returns null or errors (user skip, terminal API failure), retry once. If it fails again, report the failure to the user. Never perform the delegated work yourself in the subagent's place.
