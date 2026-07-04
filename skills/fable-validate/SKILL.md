---
name: fable-validate
description: Use when the user wants a GitHub issue validated by a Fable 5 subagent. Spins up a read-only subagent running on Fable 5 that executes the validate-issue procedure (claim tracing, architecture/consistency checks, complexity score), then relays the verdict back to the main agent, which presents it and takes any follow-on action (update issue, work on issue). Trigger on "/fable-validate", "fable validate <issue>", or "validate this with fable".
---

# fable-validate

Delegate issue validation to a **Fable 5** subagent, then act on its verdict in the main agent. The subagent only validates — it never edits files or the issue; the main agent handles all follow-on actions.

## Input

Same as `validate-issue`:
- Full URL: `https://github.com/<owner>/<repo>/issues/<N>`
- Short form: `#<N>` or bare `<N>` (current repo)
- `owner/repo#N`
- **Nothing** — default to the latest open issue in the current repo.

## Steps

### 1. Resolve the validation procedure and the issue

Locate the `validate-issue` SKILL.md the subagent must follow — prefer the project-local copy over the global one, since a repo may customize the procedure:

1. `<repo>/.claude/skills/validate-issue/SKILL.md` (if it exists)
2. `~/.claude/skills/validate-issue/SKILL.md`

Record the absolute path. If neither exists, stop and tell the user.

If the user referenced an issue, note the number/repo but do NOT fetch or pre-validate it yourself — the subagent owns steps 0–7 of the procedure, including fetching. If no issue was referenced, the subagent resolves the latest open issue itself per the procedure.

### 2. Dispatch the Fable 5 validation subagent

Do not validate the issue yourself first — the subagent owns the validation. Snapshot `git status --porcelain` before dispatching (the tree may already be dirty), then call the Agent tool with:

- `subagent_type`: `Plan` (read-only: no Edit/Write, keeps validation side-effect-free)
- `model`: `fable` (the whole point — the validation must come from Fable 5)
- `run_in_background`: `false` — everything downstream depends on the verdict
- `description`: `Validate issue #<N>` (or `Validate latest issue`)
- `prompt`: hand it everything needed to validate independently:
  - The issue reference exactly as the user gave it (or "no issue referenced — resolve the latest open issue per the procedure"), plus the working directory.
  - Instruct it to **read the SKILL.md at the recorded path and execute its steps 0 through 7 exactly** — baseline resolution, fetch with `--comments` + PR timeline check, claim extraction, depth-rule verification with `file:line` citations, 5a/5c/5b proposal checks, complexity score, scope disposition, and the step-7 verdict format.
  - It must STOP at step 7: no step 7.5/8 actions, no `gh issue edit`, no comments posted, no file edits — including via Bash (it lacks Edit/Write but still has Bash, so state this explicitly).
  - Return the complete step-7 verdict verbatim as its final message, plus one line stating which baseline (branch/commit) claims were traced against.

The subagent's final message comes back as the tool result; it is not shown to the user.

If the call returns null or errors (user skip, terminal API failure), retry once; if it fails again, report the failure to the user instead of validating yourself.

When the result arrives:
- Run `git status --porcelain` and diff against the pre-dispatch snapshot to confirm the subagent made no file changes. If it did, tell the user and ask whether to revert before continuing.
- Save the verdict verbatim to a scratchpad file immediately, so it survives context summarization and later steps can quote it exactly.

### 3. Spot-check the verdict

Before presenting it, spot-check the verdict's load-bearing findings against the code: the `file:line` citations for any ❌/⚠️ claims resolve to real code saying what the verdict says, and the verdict doesn't contradict repo conventions (CLAUDE.md). Evidence outranks verdicts — a subagent citation that contradicts its own mark means the mark is wrong. Fix small inaccuracies yourself and note them (update the scratchpad copy); if the verdict is structurally wrong (e.g. traced a stale baseline, missed the central claim), do NOT silently re-dispatch — tell the user what's off and let them decide whether to re-run with Fable 5 or proceed.

### 4. Relay the verdict to the user

Present the vetted verdict in the validate-issue step-7 format, noting it was produced by Fable 5 and which baseline it traced. Nothing is posted to GitHub at this stage — validation alone never writes to the issue.

### 5. Follow-on actions (main agent)

Handle the user's reply per the validate-issue procedure — these are main-agent actions, never re-delegated:

- **"update issue"** → apply the suggested title/body edits per validate-issue step 8, including its claim-verification gate and final consistency pass. Footer: since the findings came from the Fable 5 subagent, use `Validated with LLM: Fable 5 | high | Harness: Claude Code | fable-validate` (stack under any existing footer lines per step 8; a repo CLAUDE.md footer format overrides).
- **"work on issue"** → hand off to the `work-on-issue` skill per validate-issue step 7.5, surfacing any step-6.5 scope disposition first.
- **"split issue" / "decompose"** → file the proposed parts per validate-issue step 6.5, each fully specified.

## Notes

- The validation subagent runs on Fable 5 regardless of the main agent's model — `model: fable` on the Agent call forces it.
- One subagent, one verdict: don't fan out or re-run for a second opinion unless the user asks.
- If the user's reference turns out not to be fetchable (wrong number, no auth), the subagent will report that per the procedure — relay it; never validate against a paraphrase.
