---
name: fable-validate-loop
description: Use when the user asks to validate a GitHub issue with Fable 5.1 and then autonomously drive it to a reviewed PR in one shot — "fable-validate-loop", "fable validate and work on #N", "fully automate issue #N with fable". Runs fable-validate, auto-applies its update-issue edits when the verdict calls for it, has fableplan produce and post a Fable 5.1 implementation plan (skipped when the verdict's title-floored signal reads `fableplan: no`, which means the title score and the recomputed score are both below 71, with no safety flags), then hands off to work-on-issue-loop — stopping instead when validation flags the issue as too large, architecturally infeasible, or already addressed by an existing PR.
---

# fable-validate-loop

Chain fable-validate → (conditional) update issue → (conditional) fableplan → work-on-issue-loop into one unattended run. The loop parses each skill's output and proceeds where the interactive skill would wait for the user.

**Do not skip or reorder the chain.** Validation gates planning, and the plan gates implementation. The only sanctioned skip is the step-4 score gate (the verdict's title-floored signal reads `fableplan: no`, so the title score and the recomputed score are both below 71, with no safety flags). Every other step of each skill still runs.

## Input

Same as fable-validate: issue URL, `#<N>` / `<N>` / `owner/repo#N`, or nothing (latest open issue in the current repo).

Optional `targetBranch` (`{ issue, targetBranch }` or a prose "target branch <name>") passes unchanged to every validate, plan, and build step; `work-on-issue` step 1 ("Target") owns its validation.

## Steps

### 1. Run fable-validate

Invoke `fable-validate` (Skill tool) for the issue and let it run fully. It emits the standard verdict block:

```
**#<N>: Update issue description? <Yes|No>**  ·  Complexity: <score>/100 — Capability <k> (Risk <r>, Uncertainty <u> — <driver>); Volume <v> (Scope <s>, Coupling <c>, Verification <x>) · fableplan: <yes|no>  ·  Scope: <OK | too large — split/umbrella/narrow>
```

Parse it yourself. Record the resolved issue number; every later step targets exactly this issue.

### 2. Scope gate

Check the verdict's **Scope** field, **Architecture** section, and **Concerns** (for an already-addressing PR) first:

| Condition | Action |
|---|---|
| `Scope: too large` (split / umbrella / narrow flagged) | **STOP.** Report the disposition and proposed parts; splitting is a human call. |
| Architecture marked ❌ **Infeasible** | **STOP.** Report the infeasibility and the "Optimal direction" note. |
| A **merged** PR already implements the fix | **STOP.** Report the PR and the close/repurpose recommendation. |
| An **open** PR is already addressing the issue | **STOP.** Report the overlapping PR; supersede/join/wait is a human call. |

Otherwise continue.

### 3. Apply the update-issue edits, if called for

On **Update issue description? Yes**, apply the edits now per fable-validate step 5 (validate-issue step 11), from the current checkout, with the stacked attribution line `Validated with LLM: Fable 5.1 | high | Harness: <harness> | fable-validate-loop` (`<harness>` per `fable-dispatch` section 6). On **No**, go to step 4. The edits land before fableplan so the planner plans against the corrected issue.

### 4. Run fableplan, planning phase only

**Score gate:** a verdict signal of `fableplan: no`, which validate-issue step 8 emits only when the title score and the recomputed score are both **below 71**, skips fableplan; go straight to step 5. Never read the raw `Complexity:` value for this gate; the title score is the floor. **Safety carve-out (overrides the gate):** if the validation flags money, data integrity, security, or an auto-protective mechanism anywhere in its findings, run fableplan regardless of score. For an unconditional plan use `fable-validate-fableplan-loop`.

**Top-band note:** the signal is `yes` for every score of 71 or higher, so band-5 issues (score 81 or higher) always plan here. Implementation runs on the session model, so the posted plan is the only guaranteed Fable 5.1 involvement for a top-band issue.

Otherwise invoke `fableplan` (Skill tool) for the same issue number under its "Planning-phase-only invocation" section: steps 1 through 5 only, never steps 7–8, harness suffix `fable-validate-loop` in the posted footer (a delta skill that reuses this step substitutes its own name). Give the planner the validation verdict alongside the issue; the plan must respect the verified/refuted claims, the Optimal-direction note when architecture was ⚠️, and the 5c concerns. Keep the plan's scratchpad file for step 5. On a structurally wrong plan or a fableplan failure after its internal retry, stop and report; never implement unplanned.

### 5. Hand off to work-on-issue-loop

Invoke `work-on-issue-loop` (Skill tool) with the issue number passed explicitly. Point it at the plan's scratchpad file and the posted `## Implementation plan (Fable 5.1)` comment, and tell it deviations follow `work-on-issue` step 2's plan-deviation policy and must each be named in the PR body. Do not narrow that policy here. If step 4 was skipped by the score gate, hand off the issue alone and note the skip.

### 6. Report

Relay work-on-issue-loop's final summary (PR URL, review cycles, final verdict), prefixed with one line for the head of the chain: scope gate passed, issue updated or not, plan posted (comment URL) or skipped by the score gate.

**Cap the whole report at 55 words, plain simple English in ASD-STE100**, per the Response Style rules in CLAUDE.md/AGENTS.md.

## Red Flags — STOP

| Situation | Action |
|---|---|
| Tempted to skip validation or planning and jump to implementation | Never reorder; the only sanctioned skip is the step-4 score gate (the verdict's title-floored signal reads `fableplan: no`, with no safety flags) |
| `Scope: too large`, Architecture ❌ Infeasible, or a PR already addressing the issue | Stop and report per step 2 |
| Tempted to wait for a literal user reply to fable-validate's or fableplan's prompt | Parse the output yourself and proceed per the step rules |
| Verdict says Update issue description? Yes | Apply the edits **before** fableplan runs |
| fableplan about to enter its build steps (7–8) | Stop it at step 5; work-on-issue-loop owns implementation |
| fableplan's sanity-check finds the plan structurally wrong | Stop and report; never hand a broken plan to work-on-issue-loop, and never re-plan yourself |
