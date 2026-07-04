---
name: validate-issue-loop
description: Use when the user asks to validate a GitHub issue and then autonomously drive it to a reviewed PR in one shot — "validate and work on this issue", "validate-issue-loop", "fully automate issue #N". Runs validate-issue, auto-applies its update-issue edits when the verdict calls for it, then hands off to work-on-issue-loop — stopping instead when validation flags the issue as too large, architecturally infeasible, or already addressed by an existing PR.
---

# validate-issue-loop

Chain validate-issue → (conditional) update issue → work-on-issue-loop into one autonomous run, so an issue goes from "reported" to "PR through N rounds of review" without a human in the loop between steps. This is validate-issue's normal interactive handoff (`→ Reply "work on issue"`) made unattended: the loop reads its own verdict and decides what to do next, instead of waiting for the user to type a reply.

**Do not skip validation.** Auto-implementing an issue whose factual claims or proposal you haven't traced against the code just reproduces the issue's own mistakes in a PR. Every step of validate-issue still runs; only the "wait for the user's reply" step is replaced by a decision table.

## Input

Same defaults as validate-issue: issue URL, `#<N>` / `<N>` / `owner/repo#N`, or nothing (defaults to the latest open issue in the current repo).

## Steps

### 1. Run validate-issue

Invoke the `validate-issue` skill for the target issue (Skill tool, `skill: validate-issue`). Let it run its full process — steps 0 through 7 — and produce its verdict block:

```
**#<N>: Update issue description? <Yes|No>**  ·  Complexity: <score>/100 — <driver>  ·  Scope: <OK | too large — split/umbrella/narrow>
```

Its final `→ Reply "work on issue"...` line is written for interactive use — in this loop, treat the verdict block as structured output to parse yourself, not a prompt to wait on. Don't ask the user to confirm; decide from the table in step 2.

### 2. Scope gate — stop if the issue is unsafe to auto-implement

Check the verdict's **Scope** field, **Architecture** section, and **Concerns** (for an already-addressing PR from validate-issue's step 1 linked-PR check) before doing anything else:

| Condition | Action |
|---|---|
| `Scope: too large` (validate-issue step 6.5 flagged split / umbrella / narrow) | **STOP.** Report the disposition and proposed parts; do not proceed to work-on-issue-loop. Implementing a multi-part issue as one PR reproduces the scope problem in the diff — that needs a human call on how to split it. |
| Architecture marked ❌ **Infeasible** | **STOP.** Report the infeasibility and the "Optimal direction" note; auto-implementing a design the validation itself rejected would ship the wrong fix. |
| A **merged** PR already implements the fix (verdict recommends closing/repurposing the issue) | **STOP.** Report the PR and the close/repurpose recommendation — there's nothing left to implement. |
| An **open** PR is already addressing the issue (named under Concerns) | **STOP.** Report the overlapping PR; whether to supersede, join, or wait on in-flight work is a human call — auto-implementing duplicates it. |

Otherwise (Scope: OK; architecture ✅/⚠️ or not applicable; no PR already addressing it), continue.

### 3. Apply the update-issue edits, if called for

If the verdict says **Update issue description? Yes**, apply validate-issue's step 8 now — the suggested title/body edits plus the stacked `Updated with LLM: …` attribution line — from the current checkout (no worktree for issue edits, per validate-issue step 0).

If **No**, skip straight to step 4.

### 4. Hand off to work-on-issue-loop

Invoke the `work-on-issue-loop` skill for the same issue number (Skill tool, `skill: work-on-issue-loop`). Pass the issue number through explicitly — don't let it re-resolve "latest issue" and risk picking a different one.

### 5. Report

Relay work-on-issue-loop's final summary to the user (PR URL, review cycles run, final verdict). Prefix it with a one-line note of what happened in steps 2–3 (issue updated or not; scope check passed) so the user sees the whole chain, not just the tail.

**Cap the whole report (prefix + relayed summary) at 55 words, ELI18** — plain language, no jargon, as if explaining the outcome to a smart 18-year-old with no context on this codebase or its internals.

## Red Flags — STOP

| Situation | Action |
|---|---|
| Tempted to skip validation and go straight to work-on-issue-loop | Never reorder — validate-first is the point of this skill |
| `Scope: too large`, Architecture ❌ Infeasible, or a PR already addressing the issue | Stop and report per step 2 — the cases the loop can't safely auto-resolve |
| Tempted to wait for a literal user reply to validate-issue's prompt | Parse the verdict yourself and proceed per step 2 |
| Verdict says Update issue description? Yes | Apply the edits before handing off; don't defer |
