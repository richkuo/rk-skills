---
name: fable-validate-fableplan-loop
description: Use when the user asks to validate a GitHub issue with Fable 5, always plan it with Fable 5, and autonomously drive it to a reviewed PR in one shot — "fable-validate-fableplan-loop", "fable validate, fable plan, and work on #N", "fully automate #N with fable validation and an unconditional fable plan". Runs fable-validate, auto-applies its update-issue edits when the verdict calls for it, has fableplan produce and post a Fable 5 implementation plan for EVERY issue (no score gate — unlike fable-validate-loop, which skips planning when the score is below 61), then hands off to work-on-issue-loop — stopping instead when validation flags the issue as too large, architecturally infeasible, or already addressed by an existing PR.
---

# fable-validate-fableplan-loop

Chain fable-validate → (conditional) update issue → fableplan → work-on-issue-loop into one autonomous run: Fable 5 validates the issue, the main agent fixes the issue description if needed, Fable 5 plans the implementation (plan posted to the issue), and work-on-issue-loop implements the plan and drives the PR through review to convergence.

This is **fable-validate-loop with the score gate removed** — the only difference is that fableplan **always runs**, regardless of the validated complexity score; there is no "skip when the score is below 61" rule. Reach for this when even simple issues should get a posted, Fable-vetted plan before implementation (e.g. the plan comment doubles as documentation, or the repo's simple-looking issues have a history of hiding traps). If skipping the plan for lower-band issues is fine, use `fable-validate-loop` instead — it's the cheaper default.

**Do not skip or reorder the chain.** Validation gates planning (a plan built on refuted claims is wrong), and the plan gates implementation (that's the point of routing through fableplan). This variant has no sanctioned skip: every step runs, and only the "wait for the user's reply" moments are replaced by the decision rules in the cited steps.

## Input

Same defaults as fable-validate: issue URL, `#<N>` / `<N>` / `owner/repo#N`, or nothing (defaults to the latest open issue in the current repo).

## Steps

Follow **fable-validate-loop steps 1 through 6** with these changes:

**Step 1 (fable-validate)** applies unchanged; it produces the standard verdict block:

```
**#<N>: Update issue description? <Yes|No>**  ·  Complexity: <score>/100 — Capability <k> (<driver>); Volume <v> · fableplan: <yes|no>  ·  Scope: <OK | too large — split/umbrella/narrow>
```

**Step 2 (scope gate)** applies unchanged — the same four STOP conditions:

| Condition | Action |
|---|---|
| `Scope: too large` (split / umbrella / narrow flagged) | **STOP.** Report the disposition and proposed parts — splitting is a human call. |
| Architecture marked ❌ **Infeasible** | **STOP.** Report the infeasibility and the "Optimal direction" note. |
| A **merged** PR already implements the fix | **STOP.** Report the PR and the close/repurpose recommendation. |
| An **open** PR is already addressing the issue | **STOP.** Report the overlapping PR; supersede/join/wait is a human call. |

**Step 3 (update-issue edits):** apply them per fable-validate step 5 / validate-issue step 11; the stacked `Validated with LLM: …` attribution line uses the harness suffix `fable-validate-fableplan-loop`.

**Step 4 (fableplan):** there is **no score gate** — fable-validate-loop's score gate, safety carve-out, and top-band note do not apply; fableplan runs for every issue that passed the step-2 scope gate, whatever the validated score. Instruct fableplan to use the harness suffix `fable-validate-fableplan-loop` in the posted comment's attribution footer, so the comment records the actual entry point. The rest of the step applies unchanged: fableplan's planning-phase-only invocation, and the validation verdict handed to the planner (verified/refuted claims, the Optimal-direction note when architecture was ⚠️, 5c concerns), with the scratchpad kept for step 5.

**Step 5 (handoff)** applies unchanged — including that deviations follow `work-on-issue` step 2's plan-deviation policy and must each be named in the PR body.

**Step 6 (report)** applies unchanged. **Cap the whole report at 55 words, plain simple English in ASD-STE100** — apply the Response Style rules in CLAUDE.md/AGENTS.md.

## Red Flags — STOP

fable-validate-loop's Red Flags table applies. Read its "only sanctioned skip is the step-4 score gate" wording as "no sanctioned skip at all": a score below 61 never skips fableplan here.
