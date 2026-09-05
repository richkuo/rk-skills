---
name: fableplan
description: Use when the user wants a task planned by a Fable 5.1 planning subagent before building it. Spins up a Plan subagent running on Fable 5.1 to produce an implementation plan, relays the plan back to the main agent, and — if a GitHub issue is referenced — posts the plan as a comment on that issue and asks the user whether to continue building now before proceeding. Trigger on "/fableplan", "fableplan this", or "plan this with fable".
---

# fableplan

A **Fable 5.1** Plan subagent writes the plan. The main agent checks it, posts it, and builds from it. The subagent never builds.

## Input

A task description, with an optional issue reference (URL, `#<N>`, bare `<N>`, or `owner/repo#N`). With an issue, the plan is also posted as a comment. Ask what to plan only when the task is unclear. With no issue, never invent one or post anywhere.

## Steps

### 1. Resolve the GitHub issue (only if one is referenced)

`gh issue view <N> --json number,title,body,url` (add `-R owner/repo` for another repository). Stop and tell the user if it fails; never plan from a paraphrase of an issue you could not fetch. Record the number and URL for step 4. Read any **Plan effort** line in the body's `## Execution` block: planning runs at that tier when present, else `high`; a stamped `xhigh` runs at `xhigh`.

### 2. Dispatch the Fable 5.1 Plan subagent

Do not plan the task yourself first. **Load the `fable-dispatch` skill before dispatching.** It owns the ladder, the CLI shim (`--effort <tier>` carries the tier there), result parsing, attribution (section 6), and the hygiene rules every caller follows (section 7). On the Agent-tool path, call the Agent tool with:

- `subagent_type`: `Plan`; `model`: `fable`; `run_in_background`: `false`; `description`: `Plan <short task name>`.
- `effort`: the step 1 tier, passed explicitly when the Agent tool's schema exposes an `effort` property. When it does not, dispatch without it; when the check is inconclusive and the call fails input validation on that parameter, re-dispatch once without it. A dispatch without `effort` is a degradation to report in step 5, never a step failure.
- `prompt`: everything needed to plan alone: the full task, the issue title and body when fetched, the working directory, and the user's constraints. Instruct it to:
  - Produce a concrete, ordered plan: files to create or modify, approach, build sequence, risks and edge cases, verification.
  - Number the implementation steps (`1.`, `2.`, ...) and end each with a **verify point**: the observable check that proves the step is done (a command, a passing test, a file state). Builders mirror these steps into their task tracker.
  - Plan the absolute-best solution; only correctness and safety override "best".
  - Return the plan as its final message in clean Markdown, fit to post verbatim as an issue comment.
  - Make no file edits and no commits, including through Bash (`fable-dispatch` section 7).

When the plan arrives: save it verbatim to a scratchpad file at once (it must survive context summarization, and step 4 posts from it); run the section 7 snapshot diff; **record the model and effort that actually ran**. The model is `Fable 5.1` unless the ladder substituted another. The effort is the step 1 tier unless the harness accepted no `effort` parameter; then record that tier as requested, note it was not honored, and do not guess the session's own tier. Steps 4 and 5 use these values.

### 3. Sanity-check the plan against the code

Verify the load-bearing claims: named files exist, named symbols are real, repository conventions (CLAUDE.md) hold. Fix small inaccuracies yourself, note them, and update the scratchpad file. If the plan is structurally wrong (built on a file or mechanism that does not exist), do not re-dispatch on your own: stop, say what fails, and let the user decide to re-plan, adjust the task, or proceed.

### 4. Post the plan to the GitHub issue (only if one was resolved in step 1)

Post before building; never update the comment afterwards. Body from the scratchpad file: the heading `## Implementation plan (Fable 5.1)`, the plan, then the footer:

```
---
Created with LLM: <model that actually ran> | <effort that actually ran> | Harness: <harness> | fableplan
```

Fill model and effort from step 2's recorded values, never a constant; `<harness>` per `fable-dispatch` section 6. Post with `gh issue comment <N> --body-file <tmpfile>` (add `-R owner/repo` as needed), follow the repository's comment conventions (no bare `#N` list numbering), and give the user the comment URL.

### 5. Relay the plan to the user

Present the checked plan. Say in one line if step 2 could not honor the requested tier; otherwise say nothing about tiers.

### 6. Ask whether to continue building (only if an issue was referenced)

Ask (for example via `AskUserQuestion`) whether to build now or stop. On stop, end the skill; the user can resume with `work-on-issue`. With no issue, nothing is posted to fall back to, so skip the question and build.

### 7. Set up an isolated git worktree

Never build in the user's current checkout; if the directory is not a git repository, tell the user and ask how to proceed. Create the worktree and branch per `work-on-issue` step 1. Deltas: the name is `<agent-prefix>/fableplan/<short-task-name>`, and with no `baseRefs` the base is the fetched `origin/<target>` (the `targetBranch` the user named, else the default branch); the PR opens against that target. Build there, open a PR per the repository's conventions, and remove the worktree when done (`git worktree remove <path>`).

### 8. Build

Build per the plan. Before writing any code, mirror the plan's numbered steps into the task tracker per `work-on-issue` step 2, which owns the mirroring rule, its fallbacks, and the disposition of an overridden step. Confirm with the user first only when the plan exposes a decision that is theirs.

## Planning-phase-only invocation

Wrapper skills (the validate chains, `fableplan-loop`, `fableplan-work-on-issue`) invoke this skill for planning only:

- Run **steps 1 through 5 only**; skip step 6's question and steps 7 and 8. The caller owns implementation.
- Use the caller's harness suffix in place of `fableplan` in step 4's footer.
- Keep the scratchpad file for the caller's implementation or report stage.
- On a structurally wrong plan, or a dispatch that fails after the `fable-dispatch` section 7 retry, stop and report to the caller. Never post a broken plan, and never plan the task yourself in fableplan's place.
