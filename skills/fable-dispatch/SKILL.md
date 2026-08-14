---
name: fable-dispatch
description: Required dispatch procedure for running a subagent on Fable 5 — positive harness detection, the Claude Code CLI shim for other harnesses, the fallback ladder, the result-parsing contract, and the attribution rule. Load BEFORE dispatching any `model: fable` subagent.
---

# Fable dispatch

How every fable skill reaches Fable 5 on the current harness. The calling skill owns the prompt, the subagent type, and what happens with the result; this skill owns *how* the dispatch reaches Fable 5. Downgrading to another model is the ladder's last resort, never the first response to an unavailable model id.

## 1. Detect the harness — positively, before dispatching

Run one Bash check:

```sh
[ -n "$CLAUDECODE" ] && echo claude-code || echo other
```

Claude Code sets `CLAUDECODE=1` in its sessions. Treat every other result as "not Claude Code". Do not probe for Cursor or Codex marker variables — those names are unverified — and do not infer the harness from an Agent-call error: a harness that accepts an unknown model id, or maps `fable` to another model, produces no error to catch. That silent substitution is the defect this ladder closes.

## 2. The fallback ladder

1. **Claude Code** (`$CLAUDECODE` is set) → dispatch with the Agent tool and `model: fable`, exactly as the calling skill's dispatch step describes.
2. **Not Claude Code, and `command -v claude` succeeds** → the CLI shim below. The work still runs on Fable 5 at the intended effort.
3. **Neither path is available, or a shim call failed** (see the failure rule below) → fall back to the most capable model available and proceed — the calling skill's isolation pattern is what matters — and report the downgrade. Reaching this step silently is the same defect the ladder exists to fix: the report to the user names both what failed and which model ran instead.

## 3. The CLI shim

Write the subagent prompt to a file first, then dispatch by feeding that file to stdin:

```sh
claude -p --model fable --effort <tier> \
  --output-format json --permission-mode plan \
  < <prompt-file>
```

- **Never interpolate the prompt into the command line.** A prompt containing `"`, `` ` ``, or `$` breaks the quoting or executes (the failure class `tests/prompt-shell-safety.test.js` guards against). The stdin-from-a-file form passes the prompt as data; a properly quoted argument is the only alternative.
- `--permission-mode plan` keeps the subagent read-only, matching what the fable skills promise. `--dangerously-skip-permissions` must never appear in the shim, under any circumstances — a read-only permission mode is required.
- `--effort` carries the intended tier (`low|medium|high|xhigh|max`) directly, so the Agent-tool "harness may not accept `effort`" degradation does not apply on this path. The Fable ceiling still holds: a stamped `xhigh` becomes `high`, and the calling skill's report says so.
- **Timeout.** A Fable 5 run at `high` takes minutes and exceeds a host harness's default Bash timeout, which kills the call mid-run — the default timeout is not sufficient. Either set the host's maximum Bash timeout on the shim call, or run it background-and-poll: start the CLI with its output redirected to a file, then poll for process exit and read the file.

## 4. Parse the result

`--output-format json` prints one JSON object. Read three keys:

- `.result` — the subagent's output (the plan, verdict, or draft the calling skill wants).
- `.is_error` — `true` means the call failed.
- `.modelUsage` — an object whose keys name the model(s) that actually served the call. Read it; never assume the requested model ran. (Observed live: a `--model` alias the CLI accepts can still be served by a different model — `.modelUsage` is the only honest record.)

## 5. Shim failure

A shim call counts as failed when any of these holds:

- the CLI exits non-zero;
- `.is_error` is `true`;
- `.modelUsage` names a model other than Fable serving the call.

On failure, fall to ladder step 3 and report both the failure and the downgrade — never only the downgrade, and never neither.

## 6. Attribution

The footer and the report name the model `.modelUsage` reports (on the Agent path: Fable 5, unless ladder step 3 substituted another model — then that model's name, never "Fable 5"). The effort named is the tier that was actually passed and accepted. A footer claiming a model or tier that did not serve the call is a false attribution.
