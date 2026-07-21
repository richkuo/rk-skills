---
name: fable-validate-loop
description: Use when the user asks to validate a GitHub issue with Fable 5 and then autonomously drive it to a reviewed PR in one shot — "fable-validate-loop", "fable validate and work on #N", "fully automate issue #N with fable". Runs fable-validate, auto-applies its update-issue edits when the verdict calls for it, has fableplan produce and post a Fable 5 implementation plan (skipped when Capability < 2 / score < 50 with no safety flags), then hands off to work-on-issue-loop — stopping instead when validation flags the issue as too large, architecturally infeasible, or already addressed by an existing PR.
---

# fable-validate-loop

Chain fable-validate → (conditional) update issue → fableplan → work-on-issue-loop into one autonomous run: Fable 5 validates the issue, the main agent fixes the issue description if needed, Fable 5 plans the implementation (plan posted to the issue), and work-on-issue-loop implements the plan and drives the PR through review to convergence. This is fable-validate's interactive handoff made unattended — the loop reads its own verdicts and proceeds, instead of waiting for the user to reply.

**Do not skip or reorder the chain.** Validation gates planning (a plan built on refuted claims is wrong), and the plan gates implementation (that's the point of routing through fableplan). The only sanctioned skip is the step-4 Capability gate (Capability < 2 / score < 50 bypasses fableplan). Every other step of each skill still runs; only the "wait for the user's reply" moments are replaced by the decision rules below.

## Input

Same defaults as fable-validate: issue URL, `#<N>` / `<N>` / `owner/repo#N`, or nothing (defaults to the latest open issue in the current repo).

## Steps

### 1. Run fable-validate

Invoke the `fable-validate` skill for the target issue (Skill tool, `skill: fable-validate`). Let it run fully — Fable 5 subagent validation, spot-check, verdict — producing the standard verdict block:

```
**#<N>: Update issue description? <Yes|No>**  ·  Complexity: <score>/100 — Capability <k> (<driver>); Volume <v>  ·  Scope: <OK | too large — split/umbrella/narrow>
```

Treat the verdict as structured output to parse yourself, not a prompt to wait on. Record the resolved issue number — every later step targets exactly this issue.

### 2. Scope gate — stop if the issue is unsafe to auto-implement

Check the verdict's **Scope** field, **Architecture** section, and **Concerns** (for an already-addressing PR) before doing anything else:

| Condition | Action |
|---|---|
| `Scope: too large` (split / umbrella / narrow flagged) | **STOP.** Report the disposition and proposed parts. Implementing a multi-part issue as one PR reproduces the scope problem in the diff — splitting is a human call. |
| Architecture marked ❌ **Infeasible** | **STOP.** Report the infeasibility and the "Optimal direction" note; planning and implementing a design the validation rejected would ship the wrong fix. |
| A **merged** PR already implements the fix | **STOP.** Report the PR and the close/repurpose recommendation — nothing left to implement. |
| An **open** PR is already addressing the issue | **STOP.** Report the overlapping PR; supersede/join/wait is a human call. |

Otherwise (Scope: OK; architecture ✅/⚠️ or not applicable; no PR already addressing it), continue.

### 3. Apply the update-issue edits, if called for

If the verdict says **Update issue description? Yes**, apply the suggested title/body edits now per fable-validate step 5 / validate-issue step 8 — claim-verification gate, final consistency pass, and the stacked attribution line (`Validated with LLM: Fable 5 | high | Harness: Claude Code | fable-validate-loop`) — from the current checkout (no worktree for issue edits).

If **No**, skip straight to step 4.

**Order matters:** the edits land before fableplan runs, so the Fable 5 planner fetches and plans against the corrected issue, not the flawed original.

### 4. Run fableplan — planning phase only (skip when Capability < 2)

**Capability gate:** if the verdict's validated complexity score is **below 50** (Capability < 2 under the `validate-issue` band encoding), skip fableplan and go straight to step 5 — work-on-issue-loop plans adequately for low-capability-band changes on its own. **Safety carve-out (overrides the gate):** if the validation flags money, data integrity, security, or an auto-protective mechanism anywhere in its findings, run fableplan regardless of score. (If the user wants a plan unconditionally, that's `fable-validate-fableplan-loop` — this same chain with the gate removed.)

Otherwise, invoke the `fableplan` skill for the same issue number (Skill tool, `skill: fableplan`), and **scope it to its planning phase — steps 1 through 5 only**: fetch the issue, dispatch the Fable 5 Plan subagent, sanity-check the plan against the code, post the vetted plan as an issue comment, and relay it. **Do NOT execute fableplan's steps 7–8 (worktree + build)** — implementation belongs to work-on-issue-loop in step 5, which owns the implement → PR → review chain; building here would duplicate it outside that chain.

Give the planning subagent the validation verdict (the scratchpad copy from step 1) alongside the issue — the plan must respect what validation established (verified/refuted claims, the Optimal-direction note when architecture was ⚠️, 5b concerns).

Keep the vetted plan's scratchpad file — step 5 passes it through. If fableplan fails after its internal retry, stop and report; don't fall back to planning yourself or implementing unplanned.

### 5. Hand off to work-on-issue-loop

Invoke the `work-on-issue-loop` skill for the same issue number (Skill tool, `skill: work-on-issue-loop`). Pass the issue number through explicitly — don't let it re-resolve "latest issue" — and instruct it that the implementation must follow the Fable 5 plan: point it at the plan's scratchpad file and the posted issue comment (`## Implementation plan (Fable 5)`), and tell it deviations from the plan are allowed only when the code contradicts the plan, and must be named in the PR body. (If step 4 was skipped by the Capability gate, there is no plan — hand off the issue alone and note the skip.)

It runs its full loop: work-on-issue implements in a worktree and opens the PR, the loop triggers `@claude` review, and fix-pr-review cycles until convergence.

### 6. Report

Relay work-on-issue-loop's final summary (PR URL, review cycles, final verdict), prefixed with one line covering the head of the chain: scope gate passed, issue updated or not, plan posted (comment URL) or skipped by the Capability gate. 

**Cap the whole report at 55 words, ELI18** — plain language, no jargon, as if explaining the outcome to a smart 18-year-old with no context on this codebase.

## Red Flags — STOP

| Situation | Action |
|---|---|
| Tempted to skip validation or planning and jump to implementation | Never reorder — validate-then-plan-then-build is the point of this skill; the only sanctioned skip is the step-4 Capability gate (score < 50 / Capability < 2, no safety flags) |
| `Scope: too large`, Architecture ❌ Infeasible, or a PR already addressing the issue | Stop and report per step 2 — the cases the loop can't safely auto-resolve |
| Tempted to wait for a literal user reply to fable-validate's or fableplan's prompt | Parse the output yourself and proceed per the step rules |
| Verdict says Update issue description? Yes | Apply the edits **before** fableplan runs, so the plan targets the corrected issue |
| fableplan about to enter its build steps (7–8) | Don't — stop it at step 5; work-on-issue-loop owns implementation |
| fableplan's sanity-check finds the plan structurally wrong | Stop and report — don't hand a broken plan to work-on-issue-loop, and don't silently re-plan |
