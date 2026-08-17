---
name: fableplan-work-on-issue
description: Use when the user wants a GitHub issue planned by Fable 5 and then implemented in one shot, without validation or a review loop — "fableplan-work-on-issue", "fableplan and work on #N", "plan #N with fable then implement it". Runs the fableplan planning phase (Fable 5 produces and posts an implementation plan to the issue), then hands off to work-on-issue, which implements the plan in an isolated worktree and opens a PR that closes the issue. Stops at the open PR — it does not request review or loop. The trimmed counterpart to validate-fableplan-loop (no validate-issue step, no @claude review cycle).
---

# fableplan-work-on-issue

Chain fableplan → work-on-issue into one autonomous run: Fable 5 plans the implementation for a GitHub issue (plan posted to the issue), then work-on-issue implements that plan in an isolated worktree and opens a PR that closes the issue.

This is **fableplan-loop with the review loop removed** — the handoff is to `work-on-issue` (single-shot, ends at the open PR) rather than `work-on-issue-loop` (which triggers `@claude` and cycles through review). Like fableplan-loop, it has no `validate-issue` step and no score gate: with no validation to produce a score, fableplan always runs. Reach for this when you already trust the issue and just want a Fable-vetted plan built and shipped as a PR, without paying for validation or driving review to convergence.

## Input

Same as fableplan-loop: a GitHub issue is **required**; with nothing supplied, default to the latest open issue in the current repo. If no issue can be resolved, stop and ask — do not plan or implement against a paraphrase.

## Steps

Follow **fableplan-loop steps 0 through 3** with these changes:

- **Step 0 (pre-plan gate)** applies unchanged.
- **Step 1 (fableplan):** instruct fableplan to use the harness suffix `fableplan-work-on-issue` in the posted comment's attribution footer.
- **Step 2 (handoff):** invoke the `work-on-issue` skill instead of `work-on-issue-loop` (Skill tool, `skill: work-on-issue`). The explicit issue-number pass-through and the plan pointers (scratchpad file and posted issue comment) apply unchanged, and deviations follow `work-on-issue` step 2's plan-deviation policy — each named in the PR body. work-on-issue runs its full process: it implements in a fresh worktree, verifies, commits, pushes, and opens a PR that closes the issue. It ends at the open PR — **requesting review is out of scope for this skill.** If the user wants the PR driven through review to convergence, that's `fableplan-loop` (this chain plus the review loop), `validate-fableplan-loop`, or a separate `fix-pr-review-loop` run; say so rather than triggering review here.
- **Step 3 (report):** relay work-on-issue's final summary (the worktree/branch, what was implemented, the verification result, the commit SHA, the PR URL, and that it closes the issue), prefixed with one line covering the head of the chain: plan posted (comment URL). If work-on-issue stopped at one of its own gates instead of opening a PR, report why it stopped — never imply a PR exists when it doesn't. **Cap the whole report at 55 words, plain simple English in ASD-STE100** — apply the Response Style rules in CLAUDE.md/AGENTS.md.

## Red Flags — STOP

fableplan-loop's Red Flags table applies, reading "work-on-issue" for "work-on-issue-loop", with one change: its review row inverts.

| Situation | Action |
|---|---|
| Tempted to trigger `@claude` review or loop on the PR after it opens | Out of scope — this skill ends at the open PR; point the user at fableplan-loop or fix-pr-review-loop if they want review driven to convergence |
