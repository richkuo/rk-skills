---
name: fable-validate-fableplan
description: Use when the user asks to validate a GitHub issue with Fable 5 and always plan it with Fable 5, stopping once the plan is posted — "fable-validate-fableplan", "fable validate and fable plan #N", "validate and plan #N with fable, don't build it". Runs fable-validate, auto-applies its update-issue edits when the verdict calls for it, then has fableplan produce and post a Fable 5 implementation plan for EVERY issue (no score gate), and stops at the posted plan — no worktree, no build, no PR, no review loop. Stops earlier when validation flags the issue as too large, architecturally infeasible, or already addressed by an existing PR. The no-implementation counterpart to fable-validate-fableplan-loop.
---

# fable-validate-fableplan

Chain fable-validate → (conditional) update issue → fableplan into one autonomous run, and stop there: Fable 5 validates the issue, the main agent fixes the issue description if needed, and Fable 5 plans the implementation. The vetted plan is posted to the issue as a comment. **Nothing is built.**

This is **fable-validate-fableplan-loop with the implementation stage removed** — the head of that chain is identical (same validation, same scope gate, same issue edits, same unconditional Fable plan), but the handoff to `work-on-issue-loop` is dropped. Reach for this when you want the issue fact-checked, corrected, and planned so a human (or a later run) can decide what to do with the plan. When the plan should be built and driven through review in the same run, use `fable-validate-fableplan-loop` instead.

**Do not skip or reorder the chain.** Validation gates planning — a plan built on refuted claims is wrong. There is **no sanctioned skip**: every step runs; only the "wait for the user's reply" moments are replaced by the decision rules below.

**No score gate.** fableplan **always runs** for every issue that passes the scope gate, whatever the validated complexity score. There is no "skip when the score is below 61" rule in this skill — producing the plan is the product, so gating it away would leave the run with no output. This matches `fable-validate-fableplan-loop`; it is the deliberate difference from `fable-validate-loop` / `validate-fableplan-loop`.

## Input

Same defaults as fable-validate: issue URL, `#<N>` / `<N>` / `owner/repo#N`, or nothing (defaults to the latest open issue in the current repo).

## Steps

### 1. Run fable-validate

Invoke the `fable-validate` skill for the target issue (Skill tool, `skill: fable-validate`). Let it run fully — Fable 5 subagent validation, spot-check, verdict — producing the standard verdict block:

```
**#<N>: Update issue description? <Yes|No>**  ·  Complexity: <score>/100 — Capability <k> (<driver>); Volume <v> · fableplan: <yes|no>  ·  Scope: <OK | too large — split/umbrella/narrow>
```

Treat the verdict as structured output to parse yourself, not a prompt to wait on. Record the resolved issue number — every later step targets exactly this issue. Keep the verdict block and the validation report in the scratchpad; step 4 passes them to the planner.

### 2. Scope gate — stop if the issue is not worth planning

Check the verdict's **Scope** field, **Architecture** section, and **Concerns** (for an already-addressing PR) before doing anything else:

| Condition | Action |
|---|---|
| `Scope: too large` (split / umbrella / narrow flagged) | **STOP.** Report the disposition and proposed parts. One plan for a multi-part issue reproduces the scope problem in the plan — splitting is a human call. |
| Architecture marked ❌ **Infeasible** | **STOP.** Report the infeasibility and the "Optimal direction" note; planning a design the validation rejected would post the wrong plan. |
| A **merged** PR already implements the fix | **STOP.** Report the PR and the close/repurpose recommendation — nothing left to plan. |
| An **open** PR is already addressing the issue | **STOP.** Report the overlapping PR; supersede/join/wait is a human call. |

Otherwise (Scope: OK; architecture ✅/⚠️ or not applicable; no PR already addressing it), continue.

### 3. Apply the update-issue edits, if called for

If the verdict says **Update issue description? Yes**, apply the suggested title/body edits now per fable-validate step 5 / validate-issue step 8 — claim-verification gate, final consistency pass, and the stacked attribution line (`Validated with LLM: Fable 5 | high | Harness: Claude Code | fable-validate-fableplan`) — from the current checkout (no worktree for issue edits).

If **No**, skip straight to step 4.

**Order matters:** the edits land before fableplan runs, so the Fable 5 planner fetches and plans against the corrected issue, not the flawed original.

### 4. Run fableplan — planning phase only, always

Invoke the `fableplan` skill for the same issue number (Skill tool, `skill: fableplan`), and **scope it to its planning phase — steps 1 through 5 only**: fetch the issue, dispatch the Fable 5 Plan subagent, sanity-check the plan against the code, post the vetted plan as an issue comment, and relay it. Instruct fableplan to use the harness suffix `fable-validate-fableplan` (not `fableplan`) in the posted comment's attribution footer, so the comment records the actual entry point.

**Do NOT execute fableplan's steps 7–8 (worktree + build), and do not answer its "build now?" prompt with anything but stop.** This skill ends at the posted plan. Building here would take the run past its scope without the user asking.

Give the planning subagent the validation verdict and report (the scratchpad copies from step 1) alongside the issue — the plan must respect what validation established (verified/refuted claims, the Optimal-direction note when architecture was ⚠️, 5b concerns).

If fableplan's sanity-check finds the plan structurally wrong, or fableplan fails after its internal retry, **stop and report** — don't post a broken plan, and don't fall back to planning yourself.

### 5. Report

Report, in order: scope gate passed, issue updated or not, plan posted (comment URL), and one line on what the plan proposes. Then name the follow-on options in one line — `work-on-issue` to build the plan and stop at the PR, `work-on-issue-loop` to build it and drive review to convergence, or `fable-validate-fableplan-loop` for the same chain end-to-end next time. **Do not start any of them.**

**Cap the whole report at 55 words, plain simple English in ASD-STE100** — active voice, no jargon, no litotes or litotes-adjacent hedging, written for a reader with no context on this codebase.

## Red Flags — STOP

| Situation | Action |
|---|---|
| Tempted to implement the plan, open a worktree, or open a PR | Out of scope — this skill ends at the posted plan; name `work-on-issue` / `work-on-issue-loop` / `fable-validate-fableplan-loop` as the follow-on instead of starting one |
| Tempted to skip validation and go straight to planning | Never reorder — validate-then-plan is the point of this skill, and there is no sanctioned skip |
| Tempted to skip fableplan because the issue scored below 61 | Don't — there is no score gate here; fableplan always runs, and the plan is this skill's only output |
| `Scope: too large`, Architecture ❌ Infeasible, or a PR already addressing the issue | Stop and report per step 2 — planning is wasted or wrong in those cases |
| Tempted to wait for a literal user reply to fable-validate's or fableplan's prompt | Parse the output yourself and proceed per the step rules |
| Verdict says Update issue description? Yes | Apply the edits **before** fableplan runs, so the plan targets the corrected issue |
| fableplan about to enter its build steps (7–8) | Don't — stop it at step 5; nothing in this skill builds |
| fableplan's sanity-check finds the plan structurally wrong | Stop and report — don't post a broken plan, and don't silently re-plan |
