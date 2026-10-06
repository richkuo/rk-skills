---
name: fable-validate-fableplan
description: >-
  Use when the user asks to validate a GitHub issue with Fable 5.1 and always plan it with Fable 5.1, stopping once the plan is posted — "fable-validate-fableplan", "fable validate and fable plan #N", "validate and plan #N with fable, don't build it". Runs fable-validate, auto-applies its update-issue edits when the verdict calls for it, then has fableplan produce and post a Fable 5.1 implementation plan for EVERY issue (no score gate), and stops at the posted plan — no worktree, no build, no PR, no review loop. Stops earlier when validation flags the issue as too large, architecturally infeasible, or already addressed by an existing PR, or recommended for closure as completed or invalid. The no-implementation counterpart to fable-validate-fableplan-loop.
---

# fable-validate-fableplan

Chain fable-validate → (conditional) update issue → fableplan into one autonomous run, and stop there. The vetted plan is posted to the issue as a comment. **Nothing is built.**

This is **fable-validate-fableplan-loop with the handoff to `work-on-issue-loop` dropped**. When the plan should be built and driven through review in the same run, use `fable-validate-fableplan-loop`.

**Do not skip or reorder the chain.** Validation gates planning. There is no sanctioned skip: every step runs, and only the "wait for the user's reply" moments are replaced by the decision rules in the cited steps.

## Input

Same as fable-validate-loop, including the optional `targetBranch`.

## Steps

Follow **fable-validate-loop steps 1 through 4** with the changes below, then run this skill's step 5 in place of fable-validate-loop's steps 5 and 6:

**Step 1 (fable-validate):** also keep the verdict block and the validation report in the scratchpad; step 4 passes them to the planner.

**Step 2 (scope gate):** fable-validate-loop step 2's STOP table applies unchanged. An incomplete validation is never approval to plan.

**Step 3 (update-issue edits):** apply them per fable-validate step 5 / validate-issue step 11; the stacked `Validated with LLM: …` attribution line uses the harness suffix `fable-validate-fableplan`.

**Step 4 (fableplan):** there is **no score gate** — fable-validate-loop's score gate, safety carve-out, and top-band note do not apply; fableplan runs for every issue that passed the scope gate, whatever the validated score. Hand the planner the verdict block and validation report from step 1; the plan must respect what validation established (verified/refuted claims, the Optimal-direction note when architecture was Underspecified, 5c concerns). Instruct fableplan to use the harness suffix `fable-validate-fableplan` in the posted comment's attribution footer. fableplan stops at the posted plan, and so does this skill.

### 5. Report

Report, in order: scope gate passed, issue updated or not, plan posted (comment URL), and one line on what the plan proposes. Then name the follow-on options in one line — `work-on-issue` to build the plan and stop at the PR, `work-on-issue-loop` to build it and drive review to convergence, or `fable-validate-fableplan-loop` for the same chain end-to-end next time. **Do not start any of them.**

**Cap the whole report at 55 words and 5 sentences, plain simple English in ASD-STE100** — apply the Response Style rules in CLAUDE.md/AGENTS.md, written for a reader with no context on this codebase.

## Red Flags — STOP

fable-validate-loop's Red Flags rows for the scope gate, the step 2 human-decision rows (a) to (c), waiting on prompts, the bare issue number, the update-before-plan order, and a structurally wrong plan apply, with one substitution: in the structurally-wrong-plan row, read "post a broken plan" for "hand a broken plan to work-on-issue-loop". In addition:

| Situation | Action |
|---|---|
| Tempted to implement the plan, open a worktree, or open a PR | Stop at the posted plan; name `work-on-issue` / `work-on-issue-loop` / `fable-validate-fableplan-loop` as the follow-on instead of starting one |
| Tempted to skip validation and go straight to planning | Never reorder; there is no sanctioned skip |
