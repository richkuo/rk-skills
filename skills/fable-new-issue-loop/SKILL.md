---
name: fable-new-issue-loop
description: Use when the user asks to have a Fable 5 subagent draft and file a GitHub issue, then autonomously drive it all the way to a reviewed PR in one shot — "fable-new-issue-loop", "fable create the issue and run it to completion". Runs fable-new-issue to create a fully-specified issue (drafted by a Fable 5 subagent), then hands the new issue number to validate-issue-loop (validate → update → work-on-issue-loop) — stopping instead when a duplicate is found or the discussion hasn't converged on one issue.
---

# fable-new-issue-loop

> **Harness:** Claude Code only. This skill dispatches a subagent pinned to the **Fable 5** model, which Codex and Cursor do not offer. On those harnesses, run the non-Fable counterpart instead: `new-issue`, `validate-issue`, `work-on-issue`, and their `-loop` variants cover the same pipeline without a Fable stage.

Chain fable-new-issue → validate-issue-loop into one autonomous run: a Fable 5 subagent drafts the issue, the main agent files it, and the loop drives it to a reviewed PR without a human in between. Identical to new-issue-loop except the front of the chain is fable-new-issue.

**Do not skip filing a complete issue.** The downstream loop validates and implements *the issue text* — a thin or unverified draft propagates straight into the PR. Every step of fable-new-issue still runs (subagent drafting, duplicate gate, spot-check, filing); only the "offer next steps and wait" step is replaced by the handoff.

## Input

Same as fable-new-issue: an optional description of what the issue should cover; with no input, derive it from the current conversation. Optionally `owner/repo` when the issue belongs elsewhere.

## Steps

### 1. Run fable-new-issue

Invoke the `fable-new-issue` skill (Skill tool, `skill: fable-new-issue`) with the user's description (or conversation-derived scope). Let it run its full process — Fable 5 subagent draft, duplicate gate, spot-check, filing. Capture the created issue number from its report.

### 2. Stop gate — cases the loop can't safely continue

| Condition | Action |
|---|---|
| The subagent found an existing open issue/PR already covering it (no issue filed) | **STOP.** Report the duplicate and the offer to update/comment instead — whether to merge scopes is a human call. |
| The conversation held several distinct candidates | If one clearly converged, file it and **continue the chain with it**; the unfiled candidates go in the final report. If none clearly converged, **STOP** — report the candidates and ask which to file. Never bundle, never auto-file the extras. |
| The draft was structurally wrong and fable-new-issue paused for a human decision | **STOP.** Relay what's off — don't file or re-dispatch on your own. |
| The scope check named unfiled follow-ups | Continue with the **core issue only**; relay the unfiled follow-ups in the final report. |

Otherwise (one issue filed cleanly), continue.

### 3. Hand off to validate-issue-loop

Invoke the `validate-issue-loop` skill (Skill tool, `skill: validate-issue-loop`) with the issue from step 1 passed explicitly — don't let it default to "latest open issue" and risk racing another just-filed issue. If filed to a repo other than the current checkout, pass the full `owner/repo#N` reference, not the bare number. Its own scope gate (too large / infeasible / already-addressed) still applies and may stop the run; that's the designed behavior, not a failure.

Validating an issue this chain just filed is not redundant: validate-issue re-traces the claims against the code independently, catching anything the Fable draft or the spot-check got wrong.

### 4. Report

Relay validate-issue-loop's final summary (PR URL, review cycles, verdict), prefixed with one line covering the front of the chain: issue number/URL filed (drafted by Fable 5), complexity score, and any unfiled follow-ups from step 2.

**Cap the whole report at 55 words, plain simple English in ASD-STE100** — apply the Response Style rules in CLAUDE.md/AGENTS.md, written for a reader with no context on this codebase.

## Red Flags — STOP

| Situation | Action |
|---|---|
| Tempted to skip the Fable subagent and draft/file the issue yourself to go faster | Never — the draft coming from Fable 5 is the point of this skill |
| fable-new-issue stopped on a duplicate or a structurally-wrong draft | Stop and report per step 2 — don't file anyway |
| Tempted to hand off without an explicit issue reference | Always pass the issue from step 1 — `owner/repo#N` if filed cross-repo — "latest issue" can race |
| validate-issue-loop's scope gate stops the run | Report its disposition faithfully — don't override and implement anyway |
