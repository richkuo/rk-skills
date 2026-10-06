---
name: fableplan-work-on-issue
description: >-
  Use when the user wants a GitHub issue planned by Fable 5.1 and then implemented in one shot, without validation or a review loop — "fableplan-work-on-issue", "fableplan and work on #N", "plan #N with fable then implement it". Runs the fableplan planning phase (Fable 5.1 produces and posts an implementation plan to the issue), then hands off to work-on-issue, which implements the plan in an isolated worktree and opens a PR that closes the issue. Stops at the open PR — it does not request review or loop. The trimmed counterpart to validate-fableplan-loop (no validate-issue step, no @claude review cycle).
---

# fableplan-work-on-issue

Chain fableplan → work-on-issue into one autonomous run: Fable 5.1 plans the implementation for a GitHub issue (plan posted to the issue), then work-on-issue implements that plan in an isolated worktree and opens a PR that closes the issue.

It is **fableplan-loop with the review loop removed**: the handoff goes to `work-on-issue`, which ends at the open PR. It has no `validate-issue` step and no score gate: fableplan always runs.

## Input

Same as fableplan-loop's Input section, including the required issue, the `owner/repo#N` record, and the optional `targetBranch`.

## Steps

Follow **fableplan-loop steps 0 through 3** with these changes:

- **Step 1 (fableplan):** instruct fableplan to use the harness suffix `fableplan-work-on-issue` in the posted comment's attribution footer.
- **Step 2 (handoff):** invoke the `work-on-issue` skill instead of `work-on-issue-loop` (Skill tool, `skill: work-on-issue`). The explicit `owner/repo#N` pass-through and the plan pointers (scratchpad file and posted issue comment) apply unchanged, and deviations follow `work-on-issue` step 2's plan-deviation policy, each named in the PR body. work-on-issue runs its full process and ends at the open PR. **Requesting review is out of scope for this skill.** If the user wants the PR driven through review to convergence, point them at `fableplan-loop`, `validate-fableplan-loop`, or a separate `fix-pr-review-loop` run; do not trigger review here.
- **Step 3 (report):** in place of fableplan-loop's terminal-state list, relay work-on-issue's final summary (the worktree/branch, what was implemented, the verification result, the commit SHA, the PR URL, and that it closes the issue), prefixed with one line covering the head of the chain: plan posted (comment URL). If work-on-issue stopped at one of its own gates instead of opening a PR, report why it stopped; never imply a PR exists when it does not. **Write the report per the Response Style rules in CLAUDE.md/AGENTS.md (55-word cap, ASD-STE100).**

## Red Flags — STOP

fableplan-loop's Red Flags table applies, reading "work-on-issue" for "work-on-issue-loop", with one change: its review row inverts.

| Situation | Action |
|---|---|
| Tempted to trigger `@claude` review or loop on the PR after it opens | Do not; this skill ends at the open PR. Point the user at fableplan-loop or fix-pr-review-loop if they want review driven to convergence |
