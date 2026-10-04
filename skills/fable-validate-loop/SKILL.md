---
name: fable-validate-loop
description: >-
  Use when the user asks to validate a GitHub issue with Fable 5.1 and then autonomously drive it to a reviewed PR in one shot — "fable-validate-loop", "fable validate and work on #N", "fully automate issue #N with fable". Runs fable-validate, auto-applies its update-issue edits when the verdict calls for it, has fableplan produce and post a Fable 5.1 implementation plan (skipped only when the verdict's title-floored signal reads `fableplan: no`, which means the title score and the recomputed score are both below 75, with no safety flags and no `fableplan first: Yes` stamp in the issue's Execution block), then hands off to work-on-issue-loop — stopping instead when validation flags the issue as too large, architecturally infeasible, or already addressed by an existing PR, when a step holds for a human decision, or when the issue edit does not land.
---

# fable-validate-loop

Chain fable-validate → (conditional) update issue → (conditional) fableplan → work-on-issue-loop into one unattended run. Parse each skill's output and proceed where the interactive skill would wait for the user, except at the STOP rows below.

**Do not skip or reorder the chain.** Validation gates planning, and the plan gates implementation. The only sanctioned skip is the step-4 score gate. Every other step of each skill still runs.

## Input

Same as fable-validate: issue URL, `#<N>` / `<N>` / `owner/repo#N`, or nothing (the issue named, validated, planned, or filed in this session; with none, stop and ask). Never pick an issue from a list.

Optional `targetBranch` (`{ issue, targetBranch }` or a prose "target branch <name>") passes unchanged to every validate, plan, and build step; `work-on-issue` step 1 ("Target") owns its validation.

## Steps

### 1. Run fable-validate

Invoke `fable-validate` (Skill tool) for the issue and let it run fully. It emits the standard verdict block:

```
**#<N>: Update issue description? <Yes|No>**  ·  Complexity: <score>/100 — Capability <k> (Risk <r>, Uncertainty <u> — <driver>); Volume <v> (Scope <s>, Coupling <c>, Verification <x>) · fableplan: <yes|no>  ·  Scope: <OK | too large — split/umbrella/narrow>
```

Parse it yourself. Record the resolved issue as the full reference `owner/repo#N`: the repository from the user's reference (URL or `owner/repo#N`), else `gh repo view --json nameWithOwner -q .nameWithOwner` in the current checkout. Every later step and every skill this chain invokes gets that full reference and targets exactly this issue. A bare number resolves against the current checkout, so no handoff passes one.

### 2. Scope and decision gate

First check the verdict's **Scope** field, **Architecture** section, and **Concerns** (for an already-addressing PR), and the state `fable-validate` and `fable-dispatch` ended in. Rows (a) to (c) are **Fable validation only**: a chain that validates with plain `validate-issue` does not apply them.

| Condition | Action |
|---|---|
| `Scope: too large` (split / umbrella / narrow flagged) | **STOP.** Report the disposition and proposed parts; splitting is a human call. |
| `Validation blocked` (validate-issue step 8: no completed-verdict line) | **STOP.** Report the missing input; an incomplete validation is never approval to build. |
| Architecture marked **Infeasible** | **STOP.** Report the infeasibility and the "Optimal direction" note. |
| A **merged** PR already implements the fix | **STOP.** Report the PR and the close/repurpose recommendation. |
| An **open** PR is already addressing the issue | **STOP.** Report the overlapping PR; supersede/join/wait is a human call. |
| (a) `fable-validate` step 3 found the verdict structurally wrong and held it for the user | **STOP.** Relay what is off. Do not re-dispatch or continue on the verdict. |
| (b) The dispatch failed a second time on the Agent path (`fable-dispatch` section 7) | **STOP.** Relay the failure report. Do not re-dispatch or validate the issue yourself. |
| (c) The section 7 snapshot diff shows that the subagent wrote | **STOP.** Relay the changed paths. Do not revert them or continue on that tree; the user decides. |

Otherwise continue.

### 3. Apply the update-issue edits, if called for

On **Update issue description? Yes**, apply the edits now, before fableplan, per fable-validate step 5 (validate-issue step 11 and `skills/validate-issue/issue-editing.md`), from the current checkout, against the step 1 `owner/repo#N`. The stacked attribution line is `Validated with LLM: <served model> | <accepted tier> | Harness: <harness> | fable-validate-loop`: the model and effort that fable-validate step 2 recorded, and the harness running the session per `fable-dispatch` section 6. A delta skill that reuses this step substitutes its own suffix and, when it validates on the session model, that model and tier. On **No**, go to step 4.

Continue only when the editing procedure's "Verify the saved issue" read-back shows the corrected title, the first complexity line, and the appended footer line.

| Condition | Action |
|---|---|
| The `gh issue edit` call failed, the editing procedure stopped with a prepared correction (newer edits kept arriving), or the read-back does not show the corrected title, complexity line, and footer | **STOP.** Report the prepared correction and what the read-back showed. Do not plan or build; a restamped score routes nothing until the edit lands. |

### 4. Run fableplan, planning phase only

**Score gate:** skip fableplan and go straight to step 5 only when the verdict signal is `fableplan: no` (validate-issue step 8 emits it only when the title score and the recomputed score are both **below 75**) and neither override below applies. Never read the raw `Complexity:` value for this gate; the title score is the floor. **Safety carve-out:** if the validation flags money, data integrity, security, or an auto-protective mechanism anywhere in its findings, run fableplan regardless of score. **Stamped plan flag:** if the issue's `## Execution` block, read as the issue stands after step 3 (`gh issue view <N> -R <owner>/<repo> --json body`), stamps `fableplan first: Yes`, run fableplan regardless of score, as the milestone pipeline does. For an unconditional plan use `fable-validate-fableplan-loop`.

**Top-band note:** the signal is `yes` for every score of 75 or higher, so band-4 issues always plan here. Implementation runs on the session model, so in this chain Fable 5.1 involvement ends with the validation and the posted plan.

Otherwise invoke `fableplan` (Skill tool) for the step 1 `owner/repo#N` under its "Planning-phase-only invocation" section, with harness suffix `fable-validate-loop` in the posted footer (a delta skill that reuses this step substitutes its own name). Give the planner the validation verdict alongside the issue; the plan must respect the verified/refuted claims, the Optimal-direction note when architecture was Underspecified, and the 5c concerns. Keep the plan's scratchpad file for step 5. On a structurally wrong plan, a fableplan dispatch failure after its internal retry, or a snapshot diff that shows the planning subagent wrote, stop and report per that section; never implement unplanned.

### 5. Hand off to work-on-issue-loop

Invoke `work-on-issue-loop` (Skill tool) with the step 1 `owner/repo#N` passed explicitly. Point it at the plan's scratchpad file and the posted `## Implementation plan (<model>)` comment, and tell it deviations follow `work-on-issue` step 2's plan-deviation policy and must each be named in the PR body. Do not narrow that policy here. If the score gate skipped step 4, hand off the issue alone and note the skip.

### 6. Report

Relay work-on-issue-loop's final summary (PR URL, review cycles, final verdict), prefixed with one line for the head of the chain: scope gate passed, issue updated or not, plan posted (comment URL) or skipped by the score gate. On a STOP row, report the row and its evidence in place of the summary. **Cap the whole report at 55 words and 5 sentences, plain simple English in ASD-STE100**, per the Response Style rules in CLAUDE.md/AGENTS.md.

## Red Flags — STOP

| Situation | Action |
|---|---|
| Tempted to skip validation or planning and jump to implementation | Never reorder; the only sanctioned skip is the step-4 score gate |
| `Scope: too large`, Architecture Infeasible, or a PR already addressing the issue | Stop and report per step 2 |
| fable-validate held the verdict for the user, a dispatch failed twice, or a snapshot diff shows a write | Stop and report per step 2 rows (a) to (c) |
| Tempted to wait for a literal user reply to the verdict's `→` next-step line | Parse the verdict yourself and proceed per the step rules. This row covers only that next-step prompt; every STOP row in steps 2 to 4 and in fableplan's planning-phase-only section outranks it |
| Handing off a bare issue number | Pass the step 1 `owner/repo#N` to every invoked skill |
| Verdict says Update issue description? Yes | Apply the edits **before** fableplan runs, and continue only when the read-back confirms them (step 3) |
| fableplan's sanity-check finds the plan structurally wrong, its dispatch fails after the retry, or its snapshot diff shows a write | Stop and report per fableplan's planning-phase-only section; never hand a broken plan to work-on-issue-loop, and never re-plan yourself |
