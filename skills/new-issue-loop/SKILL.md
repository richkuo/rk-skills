---
name: new-issue-loop
description: Use when the user asks to file a GitHub issue and then autonomously drive it all the way to a reviewed PR in one shot — "new-issue-loop", "create the issue and run it to completion", "file this and fully automate it". Runs new-issue to create a fully-specified issue, then hands the new issue number to validate-issue-loop (validate → update → work-on-issue-loop) — stopping instead when new-issue finds a duplicate or the discussion hasn't converged on one issue.
---

# new-issue-loop

Chain new-issue → validate-issue-loop into one autonomous run, so a bug/idea/discussion goes from "described" to "filed issue with a PR through N rounds of review" without a human in the loop between steps. This is new-issue's normal interactive handoff (`Offer "validate issue" / "work on issue"`) made unattended: the loop takes the issue it just filed and feeds it straight into the validate-and-implement pipeline.

**Do not skip filing a complete issue.** The downstream loop validates and implements *the issue text* — a thin or unverified body propagates straight into the PR. Every step of new-issue still runs (grounding, approach design, complexity score); only the "offer next steps and wait" step is replaced by the handoff.

## Input

Same as new-issue: an optional description of what the issue should cover; with no input, derive it from the current conversation. Optionally `owner/repo` when the issue belongs elsewhere.

## Steps

### 1. Run new-issue

Invoke the `new-issue` skill (Skill tool, `skill: new-issue`) with the user's description (or conversation-derived scope). Let it run its full process — duplicate check, code grounding, approach, complexity score, filing. Capture the created issue number from its report.

### 2. Stop gate — cases the loop can't safely continue

| Condition | Action |
|---|---|
| new-issue found an existing open issue/PR already covering it (no issue filed) | **STOP.** Report the duplicate and new-issue's offer to update/comment instead — whether to merge scopes is a human call. |
| The conversation held several distinct candidates | If one clearly converged, file it and **continue the chain with it**; the unfiled candidates go in the final report. If none clearly converged, **STOP** — report the candidates and ask which to file. Never bundle, never auto-file the extras. |
| new-issue split the work and named unfiled follow-ups | Continue with the **core issue only**; relay the unfiled follow-ups in the final report. |

Otherwise (one issue filed cleanly), continue.

### 3. Hand off to validate-issue-loop

Invoke the `validate-issue-loop` skill (Skill tool, `skill: validate-issue-loop`) with the issue from step 1 passed explicitly — don't let it default to "latest open issue" and risk racing another just-filed issue. If new-issue filed to a repo other than the current checkout (`-R owner/repo`), pass the full `owner/repo#N` reference, not the bare number — a bare number resolves against the current repo and would target the wrong issue. Its own scope gate (too large / infeasible / already-addressed) still applies and may stop the run; that's the designed behavior, not a failure.

Validating an issue this same session just wrote is not redundant: validate-issue re-traces the claims against the code independently, catching anything the filing pass got wrong.

### 4. Report

Relay validate-issue-loop's final summary (PR URL, review cycles, verdict), prefixed with one line covering the front of the chain: issue number/URL filed, complexity score, and any unfiled follow-ups from step 2.

**Cap the whole report at 55 words, ELI18** — plain language, no jargon, as if explaining the outcome to a smart 18-year-old with no context on this codebase.

## Red Flags — STOP

| Situation | Action |
|---|---|
| Tempted to skip new-issue's grounding/duplicate check to get to implementation faster | Never — a fabricated or duplicate issue poisons the whole chain |
| new-issue stopped on a duplicate | Stop and report per step 2 — don't file anyway |
| Tempted to hand off without an explicit issue reference | Always pass the issue from step 1 — `owner/repo#N` if filed cross-repo — "latest issue" can race |
| validate-issue-loop's scope gate stops the run | Report its disposition faithfully — don't override and implement anyway |
