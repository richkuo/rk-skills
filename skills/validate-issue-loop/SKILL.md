---
name: validate-issue-loop
description: Use when the user asks to validate a GitHub issue and then autonomously drive it to a reviewed PR in one shot — "validate and work on this issue", "validate-issue-loop", "fully automate issue #N". Runs validate-issue, auto-applies its update-issue edits when the verdict calls for it, then hands off to work-on-issue-loop with no plan stage — stopping instead when validation flags the issue as too large, architecturally infeasible, or already addressed by an existing PR, or when the issue edit does not land.
---

# validate-issue-loop

Chain validate-issue → (conditional) update issue → work-on-issue-loop into one autonomous run, so an issue goes from "reported" to "PR through N rounds of review" without a human in the loop between steps. This is validate-issue's normal interactive handoff (its `→` next-step line) made unattended: the loop reads its own verdict and decides what to do next, where the interactive skill would wait for the user to type a reply.

**Do not skip validation.** Auto-implementing an issue whose factual claims or proposal you haven't traced against the code just reproduces the issue's own mistakes in a PR. Every step of validate-issue still runs; only the "wait for the user's reply" step is replaced by the decision rules below.

## Input

Same as fable-validate-loop, including the optional `targetBranch`.

## Steps

Follow **fable-validate-loop steps 1 through 3**, which own the verdict block, the `owner/repo#N` record, the stop table, and the edit step with its landing check, with these changes:

**Step 1 (validation):** invoke the plain `validate-issue` skill (Skill tool, `skill: validate-issue`) in place of `fable-validate`. Let it run its full process, steps 0 through 8, and parse the verdict block that fable-validate-loop step 1 quotes. Its final `→` next-step line is written for interactive use, so treat the verdict as structured output and decide from the step 2 table. Record the resolved issue as `owner/repo#N` per fable-validate-loop step 1.

**Step 2 (scope gate):** fable-validate-loop step 2's STOP table applies, sourced from the plain validation (the already-addressing PR comes from validate-issue's step 1 linked-PR check; `too large` from validate-issue step 7). Rows (a) to (c) are **Fable validation only** and do not apply here.

**Step 3 (update-issue edits):** apply validate-issue's step 11 (this chain has no fable-validate step), from the current checkout, with fable-validate-loop step 3's read-back and STOP row unchanged. The stacked attribution line is `Validated with LLM: <session model> | <session tier> | Harness: <harness> | validate-issue-loop`, naming the session model and tier that ran the validation.

Then run this skill's steps 4 and 5 in place of fable-validate-loop's steps 4 to 6.

### 4. Hand off to work-on-issue-loop

This chain never plans, by design. Read the plan signal once: a plan is due when fable-validate-loop step 4's gate would run fableplan, that is, when the verdict signal is `fableplan: yes`, the validation flags a safety concern, or the issue's `## Execution` block (read after step 3) stamps `fableplan first: Yes`. When a plan is due, build with no plan and record it for step 5.

Invoke the `work-on-issue-loop` skill (Skill tool, `skill: work-on-issue-loop`) with the step 1 `owner/repo#N` passed explicitly, so it cannot resolve a different issue from session context or the current checkout.

### 5. Report

Relay work-on-issue-loop's final summary to the user (PR URL, review cycles run, final verdict). Prefix it with a one-line note of what happened in steps 2 and 3 (issue updated or not; scope check passed), so the user sees the whole chain. When step 4 recorded a due plan, say that a plan was due and that `validate-fableplan-loop` is the chain that plans. On a STOP row, report the row and its evidence in place of the summary.

**Cap the whole report (prefix + relayed summary) at 55 words, plain simple English in ASD-STE100** — apply the Response Style rules in CLAUDE.md/AGENTS.md, written for a reader with no context on this codebase or its internals.

## Red Flags — STOP

fable-validate-loop's Red Flags table applies, reading "validate-issue" wherever it says "fable-validate" and "the step 4 handoff" wherever it says "fableplan runs". Three owner rows do not apply: the row for step 2 rows (a) to (c), the `fableplan about to enter its build steps` row, and the `fableplan's sanity-check` row. The owner's first row reads, for this chain, as the row below. In addition:

| Situation | Action |
|---|---|
| Tempted to skip validation and jump to implementation | Never skip validation; this chain has no plan stage and no sanctioned skip |
| Tempted to run fableplan because the signal reads `yes` | This chain never plans; build without a plan and name `validate-fableplan-loop` in the report |
