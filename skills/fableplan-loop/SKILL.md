---
name: fableplan-loop
description: Use when the user wants a GitHub issue planned by Fable 5 and then autonomously driven to a reviewed PR in one shot, without validation — "fableplan-loop", "fableplan #N and loop until approved", "plan #N with fable then drive it to a reviewed PR". Runs the fableplan planning phase (Fable 5 produces and posts an implementation plan to the issue), then hands off to work-on-issue-loop, which implements the plan in an isolated worktree, opens a PR, triggers @claude review, and fix-pr-review cycles until convergence. The review-loop counterpart of fableplan-work-on-issue, and validate-fableplan-loop with the validation stage removed.
---

# fableplan-loop

Chain fableplan → work-on-issue-loop into one autonomous run: Fable 5 plans the implementation for a GitHub issue (plan posted to the issue), then work-on-issue-loop implements that plan in an isolated worktree, opens a PR that closes the issue, and drives the PR through `@claude` review to convergence.

This is **fableplan-work-on-issue with the review loop added back** — the handoff goes to `work-on-issue-loop` (implement → PR → trigger `@claude` → fix-pr-review cycles until LGTM) instead of `work-on-issue` (single-shot, ends at the open PR). Equivalently, it's **validate-fableplan-loop with the validation stage removed**: no `validate-issue`, no update-issue edits, and no Capability gate — fableplan always runs. Reach for this when you already trust the issue, want a Fable-vetted plan, and want the PR reviewed to convergence without coming back.

**Do not skip or reorder the chain.** The plan gates implementation — that's the point of routing through fableplan. There is no Capability gate here: unlike validate-fableplan-loop, this skill has no validation step to produce a score, so fableplan always runs. Every step of each skill still runs; only the "wait for the user's reply" moments are replaced by the handoff below.

## Input

A GitHub issue is **required** (work-on-issue-loop targets an issue): a full URL, `#<N>`, bare `<N>`, or `owner/repo#N`. With nothing supplied, default to the latest open issue in the current repo. If no issue can be resolved, stop and ask — do not plan or implement against a paraphrase.

## Steps

### 0. Pre-plan gate — check the issue is still worth planning

Before dispatching any planning, run the cheap checks work-on-issue would otherwise only hit after a Fable plan had already been produced and posted:

- `gh issue view <N> --json state,title,url` — is the issue still open?
- Check for PRs already addressing it (linked PRs on the issue, or an open PR whose branch/body references `#<N>`).

If the issue is closed, or a merged/open PR already addresses it, **do not plan — alert the user and ask what to do next** (e.g. plan anyway, target the existing PR, or stop). Only proceed on their say-so.

### 1. Run fableplan — planning phase only

Invoke the `fableplan` skill for the target issue (Skill tool, `skill: fableplan`), and **scope it to its planning phase — steps 1 through 5 only**: fetch the issue, dispatch the Fable 5 Plan subagent, sanity-check the plan against the code, post the vetted plan as an issue comment, and relay it. Instruct fableplan to use the harness suffix `fableplan-loop` (not `fableplan`) in the posted comment's attribution footer, so the comment records the actual entry point. **Do NOT execute fableplan's steps 6–7 (worktree + build)** — implementation belongs to work-on-issue-loop in step 2, which owns the implement → PR → review chain; building here would duplicate it outside that chain and in the wrong worktree location.

Keep the vetted plan's scratchpad file — step 2 passes it through. If fableplan's sanity-check finds the plan structurally wrong, or fableplan fails after its internal retry, **stop and report** — don't hand a broken plan to work-on-issue-loop, and don't fall back to planning yourself or implementing unplanned.

### 2. Hand off to work-on-issue-loop

Invoke the `work-on-issue-loop` skill for the same issue number (Skill tool, `skill: work-on-issue-loop`). Pass the issue number through explicitly — don't let it re-resolve "latest issue" — and instruct it that the implementation must follow the Fable 5 plan: point it at the plan's scratchpad file and the posted issue comment (`## Implementation plan (Fable 5)`), and tell it deviations from the plan are allowed only when the code contradicts the plan, and must be named in the PR body.

It runs its full loop: work-on-issue implements in a fresh worktree and opens the PR (`Closes #<N>`), the loop triggers `@claude` review, and fix-pr-review cycles until convergence — a bare LGTM, or past 5 cycles the first LGTM it sees. Gate on its outcome: if work-on-issue stopped with no PR, or the review bot never responded, relay that terminal state faithfully in step 3 — never imply an approved PR exists when it doesn't.

### 3. Report

Relay work-on-issue-loop's final summary (PR URL, number of review cycles, final verdict, which model each fix cycle ran on, any follow-on issues it filed), prefixed with one line covering the head of the chain: plan posted (comment URL). If the run stopped at one of its gates instead of converging, report why it stopped.

**Cap the whole report at 55 words, ELI18** — plain language, no jargon, as if explaining the outcome to a smart 18-year-old with no context on this codebase.

## Red Flags — STOP

| Situation | Action |
|---|---|
| Tempted to skip planning and jump straight to implementation | Never reorder — plan-then-build is the point of this skill; there is no Capability gate, fableplan always runs |
| Tempted to run validate-issue first | Not part of this skill — that's validate-fableplan-loop; this variant deliberately skips validation |
| fableplan about to enter its build steps (6–7) | Don't — stop it at step 5; work-on-issue-loop owns implementation |
| fableplan's sanity-check finds the plan structurally wrong | Stop and report — don't hand a broken plan to work-on-issue-loop, and don't silently re-plan |
| Tempted to stop at the open PR without triggering review | The review loop is the point of this variant — that trimmed behavior is fableplan-work-on-issue; here work-on-issue-loop owns the trigger and the cycles |
| No issue could be resolved | Stop and ask — work-on-issue-loop needs a concrete issue to target and close |
| Issue is closed, or a PR already addresses it (step 0) | Don't plan — alert the user and ask what to do next; only proceed on their say-so |
