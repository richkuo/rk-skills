---
name: fable-validate-fableplan-loop
description: >-
  Use when the user asks to validate a GitHub issue with Fable 5.1, always plan it with Fable 5.1, and autonomously drive it to a reviewed PR in one shot — "fable-validate-fableplan-loop", "fable validate, fable plan, and work on #N", "fully automate #N with fable validation and an unconditional fable plan". Runs fable-validate, auto-applies its update-issue edits when the verdict calls for it, has fableplan produce and post a Fable 5.1 implementation plan for EVERY issue (no score gate — unlike fable-validate-loop, which skips planning when the score is below 75), then hands off to work-on-issue-loop — stopping instead when validation flags the issue as too large, architecturally infeasible, or already addressed by an existing PR, or recommended for closure as completed or invalid.
---

# fable-validate-fableplan-loop

Chain fable-validate → (conditional) update issue → fableplan → work-on-issue-loop into one autonomous run.

This is **fable-validate-loop with the score gate removed**: fableplan **always runs**, whatever the validated complexity score, and there is no "skip when the score is below 75" rule. When skipping the plan for lower-band issues is fine, use `fable-validate-loop`.

**Do not skip or reorder the chain.** Validation gates planning, and the plan gates implementation. This variant has no sanctioned skip: every step runs, and only the "wait for the user's reply" moments are replaced by the decision rules in the cited steps.

## Input

Same as fable-validate-loop, including the optional `targetBranch`.

## Steps

Follow **fable-validate-loop steps 1 through 6** with these changes:

**Step 1 (fable-validate)** applies unchanged.

**Step 2 (scope gate)** applies unchanged, with fable-validate-loop step 2's STOP table.

**Step 3 (update-issue edits):** apply them per fable-validate step 5 / validate-issue step 11; the stacked `Validated with LLM: …` attribution line uses the harness suffix `fable-validate-fableplan-loop`.

**Step 4 (fableplan):** there is **no score gate** — fable-validate-loop's score gate, safety carve-out, and top-band note do not apply; fableplan runs for every issue that passed the step-2 scope gate, whatever the validated score. Instruct fableplan to use the harness suffix `fable-validate-fableplan-loop` in the posted comment's attribution footer. The rest of the step applies unchanged: fableplan's planning-phase-only invocation, and the validation verdict handed to the planner (verified/refuted claims, the Optimal-direction note when architecture was Underspecified, 5c concerns), with the scratchpad kept for step 5.

**Step 5 (handoff)** applies unchanged — including that deviations follow `work-on-issue` step 2's plan-deviation policy and must each be named in the PR body.

**Step 6 (report)** applies unchanged. **Cap the whole report at 55 words and 5 sentences, plain simple English in ASD-STE100** — apply the Response Style rules in CLAUDE.md/AGENTS.md.

## Red Flags — STOP

fable-validate-loop's Red Flags table applies. Read its "only sanctioned skip is the step-4 score gate" wording as "no sanctioned skip at all": a score below 75 never skips fableplan here.
