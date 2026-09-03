---
name: validate-fableplan-loop
description: Use when the user asks to validate a GitHub issue (without Fable), conditionally plan it with fableplan, then autonomously drive it to a reviewed PR in one shot — "validate-fableplan-loop", "validate, plan, and work on #N", "validate and fableplan and fully automate #N". Runs validate-issue on your session model (not a Fable subagent), auto-applies its update-issue edits when the verdict calls for it, has fableplan produce and post a Fable 5.1 implementation plan (skipped when the validated score is below 71 with no safety flags), then hands off to work-on-issue-loop — stopping instead when validation flags the issue as too large, architecturally infeasible, or already addressed by an existing PR. The non-Fable-validation counterpart to fable-validate-loop.
---

# validate-fableplan-loop

Chain validate-issue → (conditional) update issue → (conditional) fableplan → work-on-issue-loop into one autonomous run: your session model validates the issue against the code, the main agent fixes the issue description if needed, Fable 5.1 plans the implementation for non-trivial issues (plan posted to the issue), and work-on-issue-loop implements the plan and drives the PR through review to convergence.

This is **fable-validate-loop with validation run through the plain `validate-issue` skill** on your session model instead of a Fable 5.1 subagent. Only the *planning* is delegated to Fable 5.1, and only when the issue is complex enough to warrant it. Reach for this over fable-validate-loop when you want cheaper, session-model validation but still want a Fable-vetted plan for the harder issues.

**Do not skip or reorder the chain.** Validation gates planning (a plan built on refuted claims is wrong), and the plan gates implementation (that's the point of routing through fableplan). The only sanctioned skip is the step-4 score gate (a score below 71 bypasses fableplan). Every other step of each skill still runs; only the "wait for the user's reply" moments are replaced by the decision rules in the cited steps.

## Input

Same defaults as validate-issue: issue URL, `#<N>` / `<N>` / `owner/repo#N`, or nothing (defaults to the latest open issue in the current repo).

Optional `targetBranch` (orchestration form `{ issue, targetBranch }` or a prose "target branch <name>"): passed unchanged to every validate, plan, and build step in the chain, so the baseline and the PR base are that branch instead of the repo default. `work-on-issue` step 1 ("Target") owns its validation.

## Steps

Follow **fable-validate-loop steps 1 through 6** with these changes:

**Step 1 (validation):** invoke the plain `validate-issue` skill (Skill tool, `skill: validate-issue`) instead of `fable-validate`. Let it run its full process — steps 0 through 8 — and produce the standard verdict block:

```
**#<N>: Update issue description? <Yes|No>**  ·  Complexity: <score>/100 — Capability <k> (Risk <r>, Uncertainty <u> — <driver>); Volume <v> (Scope <s>, Coupling <c>, Verification <x>) · fableplan: <yes|no>  ·  Scope: <OK | too large — split/umbrella/narrow>
```

Treat the verdict as structured output to parse yourself, and don't ask the user to confirm. Record the resolved issue number; every later step targets exactly this issue.

**Step 2 (scope gate):** the same four STOP conditions apply, sourced from the plain validation (the already-addressing PR comes from validate-issue's step 1 linked-PR check; `too large` from validate-issue step 7):

| Condition | Action |
|---|---|
| `Scope: too large` (split / umbrella / narrow flagged) | **STOP.** Report the disposition and proposed parts — splitting is a human call. |
| Architecture marked ❌ **Infeasible** | **STOP.** Report the infeasibility and the "Optimal direction" note. |
| A **merged** PR already implements the fix | **STOP.** Report the PR and the close/repurpose recommendation. |
| An **open** PR is already addressing the issue | **STOP.** Report the overlapping PR; supersede/join/wait is a human call. |

**Step 3 (update-issue edits):** apply validate-issue's step 11 (this chain has no fable-validate step), from the current checkout (no worktree for issue edits, per validate-issue step 0). The stacked `Validated with LLM: …` attribution line uses the harness suffix `validate-fableplan-loop` and names the session model that ran the validation; the `Fable 5.1` model string in fable-validate-loop's step 3 does not apply here.

**Step 4 (fableplan):** **Score gate:** a validated complexity score **below 71** skips fableplan — go straight to step 5. **Safety carve-out (overrides the gate):** if the validation flags money, data integrity, security, or an auto-protective mechanism anywhere in its findings, run fableplan regardless of score. The top-band note applies unchanged. When fableplan runs, give the planning subagent the validation findings (the verdict block and validate-issue's report) alongside the issue, and instruct fableplan to use the harness suffix `validate-fableplan-loop` in the posted comment's attribution footer.

**Step 5 (handoff)** applies unchanged — including that deviations follow `work-on-issue` step 2's plan-deviation policy and must each be named in the PR body.

**Step 6 (report)** applies unchanged. **Cap the whole report at 55 words, plain simple English in ASD-STE100** — apply the Response Style rules in CLAUDE.md/AGENTS.md.

## Red Flags — STOP

fable-validate-loop's Red Flags table applies, reading "validate-issue" wherever it says "fable-validate".
