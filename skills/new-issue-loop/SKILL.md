---
name: new-issue-loop
description: Use when the user asks to file a GitHub issue and then autonomously drive it all the way to a reviewed PR in one shot — "new-issue-loop", "create the issue and run it to completion", "file this and fully automate it". Runs new-issue to create a fully-specified issue, then hands the new issue's `owner/repo#N` reference to validate-issue-loop (validate → update → work-on-issue-loop) — stopping instead when new-issue finds a duplicate or the discussion hasn't converged on one issue.
---

# new-issue-loop

Chain new-issue → validate-issue-loop into one autonomous run, so a bug/idea/discussion goes from "described" to "filed issue with a PR through N rounds of review" without a human in the loop between steps. This is new-issue's normal interactive handoff (`Offer "validate issue" / "work on issue"`) made unattended: the loop takes the issue it just filed and feeds it straight into the validate-and-implement pipeline.

**Do not skip filing a complete issue.** The downstream loop validates and implements *the issue text* — a thin or unverified body propagates straight into the PR. Every step of new-issue still runs (grounding, approach design, complexity score); only the "offer next steps and wait" step is replaced by the handoff.

## Input

Same as new-issue: an optional description of what the issue should cover; with no input, derive it from the current conversation. Optionally `owner/repo` when the issue belongs elsewhere.

## Steps

### 1. Run new-issue

Invoke the `new-issue` skill (Skill tool, `skill: new-issue`) with the user's description (or conversation-derived scope). Let it run its full process — duplicate check, code grounding, approach, complexity score, filing. Capture the created issue from its report as the full reference `owner/repo#N`: the repository new-issue filed to (its `-R owner/repo`, else the current checkout per `gh repo view --json nameWithOwner -q .nameWithOwner`) and the new number.

### 2. Stop gate — cases the loop can't safely continue

| Condition | Action |
|---|---|
| new-issue found an existing open issue/PR already covering it (no issue filed) | **STOP.** Report the duplicate and new-issue's offer to update/comment instead — whether to merge scopes is a human call. |
| The conversation held several distinct candidates | If one clearly converged, file it and **continue the chain with it**; the unfiled candidates go in the final report. If none clearly converged, **STOP** — report the candidates and ask which to file. Never bundle, never auto-file the extras. |
| new-issue split the work and named unfiled follow-ups | Continue with the **core issue only**; relay the unfiled follow-ups in the final report. |

Otherwise (one issue filed cleanly), continue.

### 3. Hand off to validate-issue-loop

Invoke the `validate-issue-loop` skill (Skill tool, `skill: validate-issue-loop`) with the step 1 `owner/repo#N` passed explicitly, always, whichever repository new-issue filed to. A bare number resolves against the current checkout, and validate-issue-loop carries the full reference to every later stage. Its own scope gate (too large / infeasible / already-addressed) and its edit-landing stop still apply and may stop the run. That stop is designed behavior, and the report relays it as a stop.

`validate-issue-loop` owns the `fableplan: yes` signal that new-issue reports: that chain never plans, and its report says when a plan was due. This skill adds no plan gate of its own.

Validating an issue this same session just wrote is not redundant: validate-issue re-traces the claims against the code independently, catching anything the filing pass got wrong.

### 4. Report

Relay validate-issue-loop's final summary (PR URL, review cycles, verdict), prefixed with one line covering the front of the chain: issue number/URL filed, complexity score, and any unfiled follow-ups from step 2.

**Write the whole report in ASD-STE100** per the Response Style rules in CLAUDE.md/AGENTS.md, for a reader with no context on this codebase: lead with the outcome, and keep every item the relayed terminal-state row requires.

## Red Flags — STOP

| Situation | Action |
|---|---|
| Tempted to skip new-issue's grounding/duplicate check to get to implementation faster | Never — a fabricated or duplicate issue poisons the whole chain |
| new-issue stopped on a duplicate | Stop and report per step 2 — don't file anyway |
| Tempted to hand off without an explicit issue reference | Always pass the step 1 `owner/repo#N`, so session context and the current checkout cannot pick a different issue |
| validate-issue-loop's scope gate stops the run | Report its disposition faithfully — don't override and implement anyway |
