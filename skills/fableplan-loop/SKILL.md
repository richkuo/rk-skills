---
name: fableplan-loop
description: Use when the user wants a GitHub issue planned by Fable 5.1 and then autonomously driven to a reviewed PR in one shot, without validation — "fableplan-loop", "fableplan #N and loop until approved", "plan #N with fable then drive it to a reviewed PR". Runs the fableplan planning phase (Fable 5.1 produces and posts an implementation plan to the issue), then hands off to work-on-issue-loop, which implements the plan in an isolated worktree, opens a PR, triggers @claude review, and fix-pr-review cycles until convergence. The review-loop counterpart of fableplan-work-on-issue, and validate-fableplan-loop with the validation stage removed.
---

# fableplan-loop

Chain fableplan → work-on-issue-loop into one autonomous run: Fable 5.1 plans the implementation for a GitHub issue (plan posted to the issue), then work-on-issue-loop implements that plan in an isolated worktree, opens a PR that closes the issue, and drives the PR through `@claude` review to convergence.

This is **fableplan-work-on-issue with the review loop added back** — the handoff goes to `work-on-issue-loop` (implement → PR → trigger `@claude` → fix-pr-review cycles until LGTM) instead of `work-on-issue` (single-shot, ends at the open PR). Equivalently, it's **validate-fableplan-loop with the validation stage removed**: no `validate-issue`, no update-issue edits, and no score gate — fableplan always runs. Reach for this when you already trust the issue, want a Fable-vetted plan, and want the PR reviewed to convergence without coming back.

**Do not skip or reorder the chain.** The plan gates implementation — that's the point of routing through fableplan. There is no score gate here: unlike validate-fableplan-loop, this skill has no validation step to produce a score, so fableplan always runs. Every step of each skill still runs; only the "wait for the user's reply" moments are replaced by the handoff below.

## Input

A GitHub issue is **required** (work-on-issue-loop targets an issue): a full URL, `#<N>`, bare `<N>`, or `owner/repo#N`. With nothing supplied, use the issue validated or planned in this session; with none, stop and ask. Never pick an issue from a list, and never plan or implement against a paraphrase.

Record the resolved issue as the full reference `owner/repo#N` per fable-validate-loop step 1 (the repository from the user's reference, else `gh repo view --json nameWithOwner -q .nameWithOwner`). Every step below passes that full reference.

Optional `targetBranch` (orchestration form `{ issue, targetBranch }` or a prose "target branch <name>"): passed unchanged to every plan and build step in the chain, so the baseline and the PR base are that branch instead of the repo default. `work-on-issue` step 1 ("Target") owns its validation.

## Steps

### 0. Pre-plan gate — check the issue is still worth planning

Before dispatching any planning, run the cheap checks work-on-issue would otherwise only hit after a Fable plan had already been produced and posted:

- `gh issue view <N> -R <owner>/<repo> --json state,title,url,closedByPullRequestsReferences`: is the issue still open?
- Check for PRs already addressing it (linked PRs on the issue, or an open PR in `<owner>/<repo>` whose branch/body references `#<N>`, via `gh pr list -R <owner>/<repo>`).

If the issue is closed, or a merged/open PR already addresses it, **do not plan — alert the user and ask what to do next** (e.g. plan anyway, target the existing PR, or stop). Only proceed on their say-so.

### 1. Run fableplan — planning phase only

Invoke the `fableplan` skill for the recorded `owner/repo#N` (Skill tool, `skill: fableplan`) and follow **fableplan's "Planning-phase-only invocation" section**: run fableplan steps 1 through 5 only, and do not execute its steps 7–8. Implementation belongs to work-on-issue-loop in step 2. Instruct fableplan to use the harness suffix `fableplan-loop` in the posted comment's attribution footer.

Keep the vetted plan's scratchpad file — step 2 passes it through. On a structurally wrong plan, a fableplan dispatch failure after its internal retry, or a snapshot diff that shows the planning subagent wrote, **stop and report** per that section; don't hand a broken plan to work-on-issue-loop, and don't implement unplanned.

### 2. Hand off to work-on-issue-loop

Invoke the `work-on-issue-loop` skill for the recorded `owner/repo#N` (Skill tool, `skill: work-on-issue-loop`). Pass that full reference explicitly, so it cannot resolve a different issue from session context or the current checkout, and instruct it that the implementation must follow the posted plan: point it at the plan's scratchpad file and the posted issue comment (`## Implementation plan (<model>)`), and tell it deviations follow `work-on-issue` step 2's plan-deviation policy — the traced code, a newer comment or body edit from a `work-on-issue` step 0 trusted author, then correctness and safety — and must each be named in the PR body. Don't narrow that policy here.

It runs its full loop: work-on-issue implements in a fresh worktree and opens the PR (`Closes #<N>`), the loop triggers the first review, and fix-pr-review cycles run. `work-on-issue-loop` step 2 owns the stop rules and step 4 owns the terminal-state table; this skill states neither. Relay whatever terminal state it reports in step 3.

### 3. Report

Relay work-on-issue-loop's final summary (PR URL, number of review cycles, final verdict, which model each fix cycle ran on, any follow-on issues it filed), prefixed with one line covering the head of the chain: plan posted (comment URL). Relay every terminal state of `work-on-issue-loop` step 4 under its own name: **Done**, **Done, with leftovers**, **Diverging**, **Blocked on a test**, **Fixer stopped**, the bot-never-responded escalation, and **Nothing to drive**. Only the two **Done** states report a finished review; never imply an approved PR exists when it does not.

**Cap the whole report at 55 words, plain simple English in ASD-STE100** — apply the Response Style rules in CLAUDE.md/AGENTS.md, written for a reader with no context on this codebase.

## Red Flags — STOP

| Situation | Action |
|---|---|
| Tempted to skip planning and jump straight to implementation | Never reorder — plan-then-build is the point of this skill |
| Tempted to run validate-issue first | Not part of this skill — that's validate-fableplan-loop; this variant deliberately skips validation |
| fableplan about to enter its build steps (7–8) | Don't — stop it at step 5; work-on-issue-loop owns implementation |
| fableplan's sanity-check finds the plan structurally wrong, its dispatch fails after the retry, or its snapshot diff shows a write | Stop and report per fableplan's planning-phase-only section; don't hand a broken plan to work-on-issue-loop, and don't re-plan yourself |
| Handing off a bare issue number | Pass the recorded `owner/repo#N` to every invoked skill |
| Tempted to stop at the open PR without triggering review | The review loop is the point of this variant — that trimmed behavior is fableplan-work-on-issue; here work-on-issue-loop owns the trigger and the cycles |
| No issue given and none validated or planned this session | Stop and ask; never pick one from a list |
| Issue is closed, or a PR already addresses it (step 0) | Don't plan — alert the user and ask what to do next; only proceed on their say-so |
