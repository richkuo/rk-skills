---
name: fable-validate
description: Use when the user wants a GitHub issue validated by a Fable 5.1 subagent. Spins up a read-only subagent running on Fable 5.1 that executes the validate-issue procedure (claim tracing, architecture/consistency checks, complexity score), then relays the verdict back to the main agent, which presents it and takes any follow-on action (update issue, work on issue). Trigger on "/fable-validate", "fable validate <issue>", or "validate this with fable".
---

# fable-validate

Delegate issue validation to a **Fable 5.1** subagent, then act on its verdict in the main agent. The subagent only validates — it never edits files or the issue; the main agent handles all follow-on actions.

## Input

Same as `validate-issue`:
- Full URL: `https://github.com/<owner>/<repo>/issues/<N>`
- Short form: `#<N>` or bare `<N>` (current repo)
- `owner/repo#N`
- **Nothing** — the issue named, validated, planned, or filed in this session, per validate-issue's input rule; with none, stop and ask. Never pick an issue from a list.

## Steps

### 1. Resolve the validation procedure and the issue

Locate the `validate-issue` SKILL.md the subagent must follow — prefer the project-local copy over the global one, since a repo may customize the procedure:

1. `<repo>/.claude/skills/validate-issue/SKILL.md` (if it exists)
2. `~/.claude/skills/validate-issue/SKILL.md`
3. Any other install location — search by name, e.g. `ls ~/.claude/plugins/*/skills/validate-issue/SKILL.md` (plugin-marketplace installs live under a plugin directory, not `~/.claude/skills/`).

Record the absolute path. If none of these resolves, stop and tell the user.

If the user referenced an issue, note the number and repository, but do NOT read or pre-validate the issue text yourself; the subagent owns steps 0 to 8 of the procedure, including the issue read. If no issue was referenced, resolve it from this session per validate-issue's input rule before dispatch; with none, stop and ask. The subagent never picks an issue itself. Then, before dispatch, on every path, in this order: when `REPO` (per `fable-dispatch` section 3) is the checkout's `origin`, run the `fable-dispatch` section 3 caller-run fetch; then run the `fable-dispatch` section 7 snapshot; then run validate-issue step 1's timeline query yourself (`gh api --paginate "repos/<owner>/<repo>/issues/<N>/timeline"` with that step's `--jq` filter). Embed its output in the prompt inside the section 7 untrusted-data block, with one line telling the subagent to take it as step 1's timeline result and never to run `gh api`; `fable-dispatch` section 3 keeps `gh api` off every allowlist. A failed timeline query is embedded as that failure, which step 1 reports under Concerns.

### 2. Dispatch the Fable 5.1 validation subagent

Do not validate the issue yourself first — the subagent owns the validation. **Load the `fable-dispatch` skill before dispatching**: it owns the dispatch path and the dispatch-hygiene rules in its section 7 (read-only prompt, snapshot/diff, retry once then report). Dispatch per its ladder; on the Agent-tool path, call the Agent tool with:

- `subagent_type`: `Plan` (no Edit or Write; the section 7 prompt rule covers Bash and MCP tools)
- `model`: `fable` (the validation must come from Fable 5.1)
- `effort`: `high` unless the user asked for another tier, with the other Agent parameters per `fable-dispatch` section 2; everything downstream waits for the verdict
- `description`: `Validate issue #<N>`
- `prompt`: hand it everything needed to validate independently:
  - The issue reference exactly as the user gave it, or the one resolved from this session, plus the working directory.
  - Instruct it to **read the SKILL.md at the recorded path and execute its steps 0 through 8 exactly** — baseline resolution, the one-call issue read with its `updatedAt` + PR timeline check, claim extraction, depth-rule verification with `file:line` citations, 5a/5b/5c proposal checks, complexity score, scope disposition, and the step-8 verdict format. It must read every mandatory reference file those steps name.
  - It must STOP at step 8: no step 9 to 12 actions, no `gh issue create`, no `gh issue edit`, no comments posted, no file edits. State the full read-only rule of `fable-dispatch` section 7 in the prompt.
  - Return the complete step-8 verdict verbatim as its final message, plus one line stating which baseline (branch/commit) claims were traced against, and one line `Issue updatedAt: <value>` with the `updatedAt` that validate-issue step 1 recorded.

On every path, when `REPO` is the checkout's `origin`, step 1 has already run the `fable-dispatch` section 3 caller-run fetch before the snapshot. Tell the subagent it is done: it executes steps 0 through 8 exactly except that fetch, which it skips, and it never runs `git fetch`. On the shim, the `--allowedTools` list is the `fable-validate` example in `fable-dispatch` section 3, and `--add-dir` names the directories that section gives for the recorded SKILL.md path. When `REPO` is another repository, add the cross-repository clone entries and directory from that section.

The subagent's final message comes back as the tool result; it is not shown to the user.

When the result arrives, run the section 7 snapshot diff, then record the result's `Issue updatedAt` as this session's validation read time, which `work-on-issue` step 0 and validate-issue step 11 use. Also **record the model that served, the tier, and whether the tier was honored**, per `fable-dispatch` section 6: the model is `Fable 5.1` on the Agent path unless the ladder substituted another, and on the shim path the model section 5 finds dominant in `.modelUsage`; the tier is the one passed per section 2 (`--effort` on the shim). Never guess another tier. Step 5's footer and every chain footer use these recorded values. Save the verdict verbatim to a scratchpad file immediately, so it survives context summarization and later steps can quote it exactly.

### 3. Spot-check the verdict

Before presenting it, spot-check the verdict's load-bearing findings against the code: the `file:line` citations for any Refuted or Conditional claims resolve to real code saying what the verdict says, and the verdict doesn't contradict repo conventions (CLAUDE.md). Evidence outranks verdicts — a subagent citation that contradicts its own mark means the mark is wrong. Fix small inaccuracies yourself and note them (update the scratchpad copy); if the verdict is structurally wrong (e.g. traced a stale baseline, missed the central claim), do NOT silently re-dispatch — tell the user what's off and let them decide whether to re-run with Fable 5.1 or proceed.

### 4. Relay the verdict to the user

Present the vetted verdict in the validate-issue step-8 format, noting it was produced by Fable 5.1 and which baseline it traced. Nothing is posted to GitHub at this stage — validation alone never writes to the issue.

### 5. Follow-on actions (main agent)

Handle the user's reply per the validate-issue procedure — these are main-agent actions, never re-delegated:

- **"update issue"** → apply the suggested title/body edits per validate-issue step 11, including its claim-verification gate and final consistency pass. Footer: `Validated with LLM: <served model> | <accepted tier> | Harness: <harness> | fable-validate`, with the model and effort that step 2 recorded and the harness actually running per `fable-dispatch` section 6 (stack under any existing footer lines per step 11; a repo CLAUDE.md footer format overrides).
- **"work on issue"** → hand off to the `work-on-issue` skill per validate-issue step 9, surfacing any step-7 scope disposition first.
- **"split issue" / "decompose"** → apply validate-issue step 12 with the step 7 disposition from the relayed verdict.

## Notes

- The dispatch requests Fable 5.1 with `model: fable`, whatever the main agent's model. A harness can map `fable` to another model with no error, so `fable-dispatch` sections 1 and 5 detect a substitution, and the footer names the model that served.
- One subagent, one verdict: don't fan out or re-run for a second opinion unless the user asks.
- If the user's reference turns out not to be fetchable (wrong number, no auth), the subagent will report that per the procedure — relay it; never validate against a paraphrase.
