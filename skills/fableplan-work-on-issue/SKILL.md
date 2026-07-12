---
name: fableplan-work-on-issue
description: Use when the user wants a GitHub issue planned by Fable 5 and then implemented in one shot, without validation or a review loop — "fableplan-work-on-issue", "fableplan and work on #N", "plan #N with fable then implement it". Runs the fableplan planning phase (Fable 5 produces and posts an implementation plan to the issue), then hands off to work-on-issue, which implements the plan in an isolated worktree and opens a PR that closes the issue. Stops at the open PR — it does not request review or loop. The trimmed counterpart to validate-issue-fableplan-loop (no validate-issue step, no @claude review cycle).
---

# fableplan-work-on-issue

Chain fableplan → work-on-issue into one autonomous run: Fable 5 plans the implementation for a GitHub issue (plan posted to the issue), then work-on-issue implements that plan in an isolated worktree and opens a PR that closes the issue.

This is **validate-issue-fableplan-loop with the validation and review-loop stages removed** — no `validate-issue` before planning, and the handoff is to `work-on-issue` (single-shot, ends at the open PR) rather than `work-on-issue-loop` (which triggers `@claude` and cycles through review). Reach for this when you already trust the issue and just want a Fable-vetted plan built and shipped as a PR, without paying for validation or driving review to convergence.

**Do not skip or reorder the chain.** The plan gates implementation — that's the point of routing through fableplan. There is no complexity gate here: unlike validate-issue-fableplan-loop, this skill has no validation step to produce a score, so fableplan always runs. Every step of each skill still runs; only the "wait for the user's reply" moments are replaced by the handoff below.

## Input

A GitHub issue is **required** (work-on-issue targets an issue): a full URL, `#<N>`, bare `<N>`, or `owner/repo#N`. With nothing supplied, default to the latest open issue in the current repo. If no issue can be resolved, stop and ask — do not plan or implement against a paraphrase.

## Steps

### 0. Pre-plan gate — check the issue is still worth planning

Before dispatching any planning, run the cheap checks work-on-issue would otherwise only hit in step 2 — after a Fable plan had already been produced and posted:

- `gh issue view <N> --json state,title,url` — is the issue still open?
- Check for PRs already addressing it (linked PRs on the issue, or an open PR whose branch/body references `#<N>`).

If the issue is closed, or a merged/open PR already addresses it, **do not plan — alert the user and ask what to do next** (e.g. plan anyway, target the existing PR, or stop). Only proceed on their say-so.

### 1. Run fableplan — planning phase only

Invoke the `fableplan` skill for the target issue (Skill tool, `skill: fableplan`), and **scope it to its planning phase — steps 1 through 5 only**: fetch the issue, dispatch the Fable 5 Plan subagent, sanity-check the plan against the code, post the vetted plan as an issue comment, and relay it. Instruct fableplan to use the harness suffix `fableplan-work-on-issue` (not `fableplan`) in the posted comment's attribution footer, so the comment records the actual entry point. **Do NOT execute fableplan's steps 6–7 (worktree + build)** — implementation belongs to work-on-issue in step 2, which owns the implement → PR chain; building here would duplicate it outside that chain and in the wrong worktree location.

Keep the vetted plan's scratchpad file — step 2 passes it through. If fableplan's sanity-check finds the plan structurally wrong, or fableplan fails after its internal retry, **stop and report** — don't hand a broken plan to work-on-issue, and don't fall back to planning yourself or implementing unplanned.

### 2. Hand off to work-on-issue

Invoke the `work-on-issue` skill for the same issue number (Skill tool, `skill: work-on-issue`). Pass the issue number through explicitly — don't let it re-resolve "latest issue" — and instruct it that the implementation must follow the Fable 5 plan: point it at the plan's scratchpad file and the posted issue comment (`## Implementation plan (Fable 5)`), and tell it deviations from the plan are allowed only when the code contradicts the plan, and must be named in the PR body.

work-on-issue runs its full process: it implements in a fresh worktree, verifies, commits, pushes, and opens a PR that closes the issue. It ends at the open PR — **requesting review is out of scope for this skill.** If the user wants the PR driven through review to convergence, that's `fableplan-work-on-issue-loop` (this chain plus the review loop), `validate-issue-fableplan-loop`, or a separate `fix-pr-review-loop` run; say so rather than triggering review here.

### 3. Report

Relay work-on-issue's final summary (the worktree/branch, what was implemented, the verification result, the commit SHA, the PR URL, and that it closes the issue), prefixed with one line covering the head of the chain: plan posted (comment URL). If work-on-issue stopped at one of its own gates instead of opening a PR, report why it stopped — never imply a PR exists when it doesn't.

**Cap the whole report at 55 words, ELI18** — plain language, no jargon, as if explaining the outcome to a smart 18-year-old with no context on this codebase.

## Red Flags — STOP

| Situation | Action |
|---|---|
| Tempted to skip planning and jump straight to implementation | Never reorder — plan-then-build is the point of this skill; there is no complexity gate, fableplan always runs |
| Tempted to run validate-issue first | Not part of this skill — that's validate-issue-fableplan-loop; this trimmed variant deliberately skips validation |
| fableplan about to enter its build steps (6–7) | Don't — stop it at step 5; work-on-issue owns implementation |
| fableplan's sanity-check finds the plan structurally wrong | Stop and report — don't hand a broken plan to work-on-issue, and don't silently re-plan |
| Tempted to trigger `@claude` review or loop on the PR after it opens | Out of scope — this skill ends at the open PR; point the user at fableplan-work-on-issue-loop or fix-pr-review-loop if they want review driven to convergence |
| No issue could be resolved | Stop and ask — work-on-issue needs a concrete issue to target and close |
| Issue is closed, or a PR already addresses it (step 0) | Don't plan — alert the user and ask what to do next; only proceed on their say-so |
