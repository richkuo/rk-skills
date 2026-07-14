---
name: validate-fableplan-loop
description: Use when the user asks to validate a GitHub issue (without Fable), conditionally plan it with fableplan, then autonomously drive it to a reviewed PR in one shot — "validate-fableplan-loop", "validate, plan, and work on #N", "validate and fableplan and fully automate #N". Runs validate-issue on your session model (not a Fable subagent), auto-applies its update-issue edits when the verdict calls for it, has fableplan produce and post a Fable 5 implementation plan (skipped when Capability < 2 / score < 50 with no safety flags), then hands off to work-on-issue-loop — stopping instead when validation flags the issue as too large, architecturally infeasible, or already addressed by an existing PR. The non-Fable-validation counterpart to fable-validate-loop.
---

# validate-fableplan-loop

Chain validate-issue → (conditional) update issue → (conditional) fableplan → work-on-issue-loop into one autonomous run: your session model validates the issue against the code, the main agent fixes the issue description if needed, Fable 5 plans the implementation for non-trivial issues (plan posted to the issue), and work-on-issue-loop implements the plan and drives the PR through review to convergence.

This is **validate-issue-loop with a Fable 5 planning phase inserted before implementation** — identical to fable-validate-loop except validation runs through the plain `validate-issue` (your session model) instead of a Fable 5 subagent. Only the *planning* is delegated to Fable 5, and only when the issue is complex enough to warrant it. Reach for this over fable-validate-loop when you want cheaper, session-model validation but still want a Fable-vetted plan for the harder issues.

**Do not skip or reorder the chain.** Validation gates planning (a plan built on refuted claims is wrong), and the plan gates implementation (that's the point of routing through fableplan). The only sanctioned skip is the step-4 Capability gate (Capability < 2 / score < 50 bypasses fableplan). Every other step of each skill still runs; only the "wait for the user's reply" moments are replaced by the decision rules below.

## Input

Same defaults as validate-issue: issue URL, `#<N>` / `<N>` / `owner/repo#N`, or nothing (defaults to the latest open issue in the current repo).

## Steps

### 1. Run validate-issue

Invoke the `validate-issue` skill for the target issue (Skill tool, `skill: validate-issue`). Let it run its full process — steps 0 through 7 — and produce its verdict block:

```
**#<N>: Update issue description? <Yes|No>**  ·  Complexity: <score>/100 — <driver>  ·  Scope: <OK | too large — split/umbrella/narrow>
```

Treat the verdict block as structured output to parse yourself, not the interactive `→ Reply "work on issue"` prompt to wait on. Don't ask the user to confirm; decide from the table in step 2. Record the resolved issue number — every later step targets exactly this issue.

### 2. Scope gate — stop if the issue is unsafe to auto-implement

Check the verdict's **Scope** field, **Architecture** section, and **Concerns** (for an already-addressing PR from validate-issue's step 1 linked-PR check) before doing anything else:

| Condition | Action |
|---|---|
| `Scope: too large` (validate-issue step 6.5 flagged split / umbrella / narrow) | **STOP.** Report the disposition and proposed parts; do not proceed to planning or work-on-issue-loop. Implementing a multi-part issue as one PR reproduces the scope problem in the diff — that needs a human call on how to split it. |
| Architecture marked ❌ **Infeasible** | **STOP.** Report the infeasibility and the "Optimal direction" note; planning and implementing a design the validation itself rejected would ship the wrong fix. |
| A **merged** PR already implements the fix (verdict recommends closing/repurposing the issue) | **STOP.** Report the PR and the close/repurpose recommendation — there's nothing left to implement. |
| An **open** PR is already addressing the issue (named under Concerns) | **STOP.** Report the overlapping PR; whether to supersede, join, or wait on in-flight work is a human call — auto-implementing duplicates it. |

Otherwise (Scope: OK; architecture ✅/⚠️ or not applicable; no PR already addressing it), continue.

### 3. Apply the update-issue edits, if called for

If the verdict says **Update issue description? Yes**, apply validate-issue's step 8 now — the suggested title/body edits plus the stacked `Updated with LLM: …` attribution line (harness suffix `validate-fableplan-loop`) — from the current checkout (no worktree for issue edits, per validate-issue step 0).

If **No**, skip straight to step 4.

**Order matters:** the edits land before fableplan runs, so the Fable 5 planner fetches and plans against the corrected issue, not the flawed original.

### 4. Run fableplan — planning phase only (skip when Capability < 2)

**Capability gate:** if the verdict's validated complexity score is **below 50** (Capability < 2 under the `validate-issue` band encoding), skip fableplan and go straight to step 5 — work-on-issue-loop plans adequately for low-capability-band changes on its own. **Safety carve-out (overrides the gate):** if the validation flags money, data integrity, security, or an auto-protective mechanism anywhere in its findings, run fableplan regardless of score.

Otherwise, invoke the `fableplan` skill for the same issue number (Skill tool, `skill: fableplan`), and **scope it to its planning phase — steps 1 through 5 only**: fetch the issue, dispatch the Fable 5 Plan subagent, sanity-check the plan against the code, post the vetted plan as an issue comment, and relay it. **Do NOT execute fableplan's steps 6–7 (worktree + build)** — implementation belongs to work-on-issue-loop in step 5, which owns the implement → PR → review chain; building here would duplicate it outside that chain.

Give the planning subagent the validation findings (the verdict block and validate-issue's report) alongside the issue — the plan must respect what validation established (verified/refuted claims, the Optimal-direction note when architecture was ⚠️, and any concerns it raised).

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
| Tempted to wait for a literal user reply to validate-issue's or fableplan's prompt | Parse the output yourself and proceed per the step rules |
| Verdict says Update issue description? Yes | Apply the edits **before** fableplan runs, so the plan targets the corrected issue |
| fableplan about to enter its build steps (6–7) | Don't — stop it at step 5; work-on-issue-loop owns implementation |
| fableplan's sanity-check finds the plan structurally wrong | Stop and report — don't hand a broken plan to work-on-issue-loop, and don't silently re-plan |
| Issue scored below 50 (Capability < 2) with no safety flags | Skip fableplan and hand the issue straight to work-on-issue-loop — note the skip in the report |
