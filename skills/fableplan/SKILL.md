---
name: fableplan
description: Use when the user wants a task planned by a Fable 5 planning subagent before building it. Spins up a Plan subagent running on Fable 5 to produce an implementation plan, relays the plan back to the main agent, and — if a GitHub issue is referenced — posts the plan as a comment on that issue and asks the user whether to continue building now before proceeding. Trigger on "/fableplan", "fableplan this", or "plan this with fable".
---

# fableplan

Delegate planning to a **Fable 5** Plan subagent, then build from its plan in the main agent. The main agent does the building — the subagent only plans.

## Input

The user provides a task description, and optionally a GitHub issue:
- A task in prose ("fableplan adding X to Y").
- A GitHub issue reference — full URL, `#<N>`, bare `<N>`, or `owner/repo#N`. When present, the plan is also posted as an issue comment.
- If neither is obvious, ask the user what to plan before dispatching.

## Steps

### 1. Resolve the GitHub issue (only if one is referenced)

If the user named an issue, fetch it so the subagent plans against the real requirements, not a paraphrase:

```
gh issue view <N> --json number,title,body,url
```

For the `owner/repo#N` form (or a full URL to another repo), add `-R owner/repo` — a bare `gh issue view <N>` only resolves against the current repo.

If the command fails (wrong number, no auth, no repo), stop and tell the user — never proceed by planning against your paraphrase of an issue you couldn't fetch.

Record the issue number and URL — you'll need them in step 4. If no issue is referenced, skip this and step 4's posting.

Also record the **Plan effort** if the fetched body has an `## Execution` block carrying a `- **Plan effort:**` line — step 2 dispatches at that tier. The line sets effort only; this skill always plans on Fable 5 regardless of the block's `Build model:`. When the line is absent, or no issue was referenced, step 2 dispatches at `high` — the repo attribution default — rather than leaving the subagent on the session's own tier, so the footer names an effort that actually ran.

### 2. Dispatch the Fable 5 Plan subagent

Do not re-plan the task yourself first — the subagent owns the plan. **Load the `fable-dispatch` skill before dispatching**: it owns the dispatch path and the dispatch-hygiene rules in its section 7 (read-only prompt, snapshot/diff, retry once then report). Dispatch per its ladder; on the Agent-tool path, call the Agent tool with:

- `subagent_type`: `Plan`
- `model`: `fable` (this is the whole point of the skill — the plan must come from Fable 5)
- `run_in_background`: `false` — every later step depends on the plan, so wait for it synchronously instead of doing other work first
- `effort`: the issue's stamped **Plan effort** from step 1 when there is one, otherwise `high`. Pass it explicitly even in the unstamped case rather than omitting it — an omitted parameter leaves the subagent on the session's own tier, which the footer cannot name honestly and which may be *below* `high`; passing it makes the footer's value the one that actually ran. **Not every harness's Agent tool accepts `effort`.** Before passing it, check the Agent tool's own parameter schema in this harness: if it exposes no `effort` property, don't construct the argument — dispatch without it and note that the tier could not be honored. If the schema check is inconclusive and the call fails input validation on the parameter, re-dispatch once without `effort` rather than treating it as the step-2 failure below; a plan at session effort beats no plan. Either way this is a degradation, not an error — never abort the step over it, and report it to the user in step 5. This degradation is Agent-tool-only: on `fable-dispatch`'s CLI-shim path, `--effort` carries the tier directly.
- `description`: `Plan <short task name>`
- `prompt`: Hand the subagent everything it needs to plan independently — the full task description, the issue title/body if one was fetched, the working directory, and any constraints the user stated. Tell it explicitly:
  - Produce a concrete, ordered implementation plan (files to create/modify, the approach, build sequence, risks/edge cases, and how to verify).
  - Plan the absolute-best solution the task calls for, evaluated as if cost, effort, time, token spend, and code volume were unlimited — they are not factors and must never narrow the option space. The only constraints that override "best" are correctness and safety.
  - Return the plan as its final message in clean Markdown suitable to (a) act on directly and (b) post verbatim as a GitHub issue comment.
  - It is planning only — state the read-only rule explicitly in the prompt per `fable-dispatch` section 7.

The Plan subagent's final message is returned to you as the tool result; it is not shown to the user.

When the result arrives:
- Save the plan verbatim to a scratchpad file immediately, so it survives context summarization during a long build and step 4 can post it exactly as produced.
- **Record the model and effort the subagent actually ran at** — the model is `Fable 5` unless the `fable-dispatch` fallback ladder substituted another, and the effort is whatever tier was actually passed and accepted: the stamped **Plan effort**, or `high` when nothing was stamped. Only when the harness accepted no `effort` at all does the recorded value become a convention rather than an observation — then record the repo attribution default `high` and **do not try to name the session's own tier**, which an agent cannot observe; guessing it would put an invented value in the very slot this footer exists to keep honest. Also record *whether* the tier was honored — step 5 tells the user when a stamped one was not. Step 4's footer names these recorded values, so resolve them now rather than assuming the stamped tier took effect.

### 3. Sanity-check the plan against the code

Before posting or presenting it, verify the plan's load-bearing claims against the actual codebase: the files it says to modify exist, the functions/symbols it references are real, and it doesn't contradict repo conventions (CLAUDE.md). Fix small inaccuracies yourself and note them; if the plan is structurally wrong (built on a file or mechanism that doesn't exist), do NOT automatically re-dispatch the Plan subagent — stop and tell the user what's failing, and let them decide whether to re-plan with Fable 5, adjust the task, or proceed anyway. If you fixed small inaccuracies, update the scratchpad file from step 2 so it reflects the corrected plan before step 4 posts it.

### 4. Post the plan to the GitHub issue (only if one was resolved in step 1)

Now that the plan has passed the sanity-check, save it to the issue as a comment before building, so the vetted plan is preserved on the issue regardless of how the build goes. This comment is not updated after the build.

```
gh issue comment <N> --body-file <tmpfile>
```

Add `-R owner/repo` when the issue lives in another repo (as in step 1). Use the scratchpad file from step 2 (with any step-3 corrections) as the body-file base — it avoids shell-escaping problems with Markdown. Prefix the comment so its origin is clear with a heading line `## Implementation plan (Fable 5)` above the plan body, and end the body with the standard metadata footer:

```
---
Created with LLM: <model that actually ran> | <effort that actually ran> | Harness: <harness> | fableplan
```

Fill the model and effort fields from the values recorded at the end of step 2 — **never a constant**. `<harness>` names the harness actually running the session (`Claude Code`, `Cursor`, `Codex`, …), per `fable-dispatch` section 6. Normally that is `Fable 5 | <the issue's stamped Plan effort>`; it falls back to the repo attribution default `high` when no `Plan effort` was stamped or the harness could not honor one, and to the substituted model name when the `fable-dispatch` fallback ladder fired. Never invent a tier the run cannot account for: `high` here is a documented default, not a guess at the session's own effort. A footer claiming a tier the run did not use is a false attribution, the same defect the milestone-pipeline plan footer fixes. (A stamped `xhigh` Plan effort is itself illegal — the planner is always Fable 5, and Fable never runs at xhigh; honor it as `high` and note the clamp.)

After posting, give the user the comment URL `gh` returns. Follow the repo's CLAUDE.md conventions for comment formatting if any apply (e.g. avoid `#N` auto-links in list items). If no issue is referenced, skip this step.

### 5. Relay the plan to the user

Present the vetted plan to the user (the main agent).

**If step 2 recorded that the harness could not honor an effort tier and the issue had stamped one, say so here in one line** — name the stamped tier and state that the plan ran at the session's own effort instead. The person who stamped `Plan effort: xhigh` is the one who needs to hear it was dropped; an internal record that only feeds the footer is not a notice. Two cases stay silent: when the tier *was* honored (no notice — it worked), and when no `Plan effort` was stamped or no issue was referenced (nothing was promised, so make no claim about a stamped tier in either direction — the footer's `high` stands as the documented default).

### 6. Ask whether to continue building (only if an issue was referenced)

The plan is now safely posted to the issue regardless of what happens next — don't assume the user wants an immediate build. Ask (e.g. via `AskUserQuestion`) whether to continue building this now or stop here. If they stop, end the skill; they can resume later with `work-on-issue` on the same issue. If no issue was referenced in step 1, there's nothing posted to fall back to, so skip the question and proceed straight to building.

### 7. Set up an isolated git worktree

Before making any code changes, move the build into its own git worktree so it never touches the user's current workspace. If the directory isn't a git repository, tell the user and ask how to proceed rather than building in place. Create the worktree and branch per `work-on-issue` step 1 ("Create the isolated worktree on a verified base"): it owns the fetch-first rule, the base verification, the reset rule for a brand-new worktree, and the `-C` anchoring. Deltas for this skill: the name is `<agent-prefix>/fableplan/<short-task-name>` (e.g. `cc/fableplan/<short-task-name>`), and there is no `baseRefs` input — the base is always the fetched `origin/<default-branch>`.

Do all of step 8's building inside that worktree. When the build is done, follow the repo's usual conventions for merging or opening a PR from the branch, and remove the worktree once it's no longer needed (`git worktree remove <path>`).

### 8. Build

In the worktree from step 7, the main agent builds the task per the plan. Confirm with the user first only if the plan reveals ambiguity or a decision the user must make; otherwise proceed.

## Planning-phase-only invocation

Wrapper skills (the validate chains, `fableplan-loop`, `fableplan-work-on-issue`) invoke this skill for planning only. In that mode:

- Run **steps 1 through 5 only**: fetch the issue, dispatch the Fable 5 Plan subagent, sanity-check the plan against the code, post the vetted plan as an issue comment, and relay it.
- **Do NOT execute steps 7–8** (worktree + build), and do not act on step 6's build question. The caller owns implementation; a build here would duplicate the caller's implement chain in the wrong worktree location.
- When the caller supplies a harness suffix, use it in place of `fableplan` in step 4's posted-comment attribution footer, so the comment records the actual entry point.
- Keep the vetted plan's scratchpad file; the caller passes it to its implementation or report stage.
- If the step-3 sanity-check finds the plan structurally wrong, or the dispatch fails after the `fable-dispatch` section 7 retry, stop and report to the caller. Never post a broken plan, and never plan the task yourself in fableplan's place.

## Notes

- The Plan subagent runs on Fable 5 regardless of the main agent's model — `model: fable` on the Agent call forces it.
- If the user did not reference an issue, never invent one or post anywhere — just plan and build.
