---
name: fable-validate-fableplan
description: Use when the user asks to validate a GitHub issue with Fable 5.1 and always plan it with Fable 5.1, stopping once the plan is posted — "fable-validate-fableplan", "fable validate and fable plan #N", "validate and plan #N with fable, don't build it". Runs fable-validate, auto-applies its update-issue edits when the verdict calls for it, then has fableplan produce and post a Fable 5.1 implementation plan for EVERY issue (no score gate), and stops at the posted plan — no worktree, no build, no PR, no review loop. Stops earlier when validation flags the issue as too large, architecturally infeasible, or already addressed by an existing PR. The no-implementation counterpart to fable-validate-fableplan-loop.
---

# fable-validate-fableplan

Chain fable-validate → (conditional) update issue → fableplan into one autonomous run, and stop there: Fable 5.1 validates the issue, the main agent fixes the issue description if needed, and Fable 5.1 plans the implementation. The vetted plan is posted to the issue as a comment. **Nothing is built.**

This is **fable-validate-fableplan-loop with the implementation stage removed** — the head of that chain is identical (same validation, same scope gate, same issue edits, same unconditional Fable plan), but the handoff to `work-on-issue-loop` is dropped. Reach for this when you want the issue fact-checked, corrected, and planned so a human (or a later run) can decide what to do with the plan. When the plan should be built and driven through review in the same run, use `fable-validate-fableplan-loop` instead.

**Do not skip or reorder the chain.** Validation gates planning; a plan built on refuted claims is wrong. There is no sanctioned skip: every step runs, and only the "wait for the user's reply" moments are replaced by the decision rules in the cited steps.

## Input

Same defaults as fable-validate: issue URL, `#<N>` / `<N>` / `owner/repo#N`, or nothing (defaults to the latest open issue in the current repo).

## Steps

Follow **fable-validate-loop steps 1 through 4** with the changes below, then run this skill's step 5 in place of fable-validate-loop's steps 5 and 6:

**Step 1 (fable-validate):** also keep the verdict block and the validation report in the scratchpad; step 4 passes them to the planner. It produces the standard verdict block:

```
**#<N>: Update issue description? <Yes|No>**  ·  Complexity: <score>/100 — Capability <k> (<driver>); Volume <v> · fableplan: <yes|no>  ·  Scope: <OK | too large — split/umbrella/narrow>
```

**Step 2 (scope gate):** the same four STOP conditions apply; the cost here is a wasted or wrong plan rather than a wrong PR:

| Condition | Action |
|---|---|
| `Scope: too large` (split / umbrella / narrow flagged) | **STOP.** Report the disposition and proposed parts — splitting is a human call. |
| Architecture marked ❌ **Infeasible** | **STOP.** Report the infeasibility and the "Optimal direction" note. |
| A **merged** PR already implements the fix | **STOP.** Report the PR and the close/repurpose recommendation. |
| An **open** PR is already addressing the issue | **STOP.** Report the overlapping PR; supersede/join/wait is a human call. |

**Step 3 (update-issue edits):** apply them per fable-validate step 5 / validate-issue step 11; the stacked `Validated with LLM: …` attribution line uses the harness suffix `fable-validate-fableplan`.

**Step 4 (fableplan):** there is **no score gate** — fable-validate-loop's score gate, safety carve-out, and top-band note do not apply; fableplan runs for every issue that passed the scope gate, whatever the validated score. Producing the plan is this skill's product, so gating it away would leave the run with no output; this matches fable-validate-fableplan-loop and is the deliberate difference from fable-validate-loop and validate-fableplan-loop. Hand the planner the verdict block and validation report from step 1 — the plan must respect what validation established (verified/refuted claims, the Optimal-direction note when architecture was ⚠️, 5c concerns). Instruct fableplan to use the harness suffix `fable-validate-fableplan` in the posted comment's attribution footer, so the comment records the actual entry point. This skill ends at the posted plan: do not answer fableplan's step-6 "build now?" question with anything but stop, and there is no scratchpad pass-through to an implementation stage.

### 5. Report

Report, in order: scope gate passed, issue updated or not, plan posted (comment URL), and one line on what the plan proposes. Then name the follow-on options in one line — `work-on-issue` to build the plan and stop at the PR, `work-on-issue-loop` to build it and drive review to convergence, or `fable-validate-fableplan-loop` for the same chain end-to-end next time. **Do not start any of them.**

**Cap the whole report at 55 words, plain simple English in ASD-STE100** — apply the Response Style rules in CLAUDE.md/AGENTS.md, written for a reader with no context on this codebase.

## Red Flags — STOP

fable-validate-loop's Red Flags rows for the scope gate, waiting on prompts, the update-before-plan order, fableplan's build steps (7–8), and a structurally wrong plan apply, with two substitutions — this chain never invokes `work-on-issue-loop`, so neither row may name it as the owner of what happens next. In the build-steps row, read "stop it at step 5; this skill ends at the posted plan and owns no implementation" for "stop it at step 5; work-on-issue-loop owns implementation". In the structurally-wrong-plan row, read "post a broken plan" for "hand a broken plan to work-on-issue-loop". In addition:

| Situation | Action |
|---|---|
| Tempted to implement the plan, open a worktree, or open a PR | Out of scope — this skill ends at the posted plan; name `work-on-issue` / `work-on-issue-loop` / `fable-validate-fableplan-loop` as the follow-on instead of starting one |
| Tempted to skip validation and go straight to planning | Never reorder — validate-then-plan is the point of this skill, and there is no sanctioned skip |
