---
name: fable-new-issue-loop
description: Use when the user asks to have a Fable 5.1 subagent draft and file a GitHub issue, then autonomously drive it all the way to a reviewed PR in one shot — "fable-new-issue-loop", "fable create the issue and run it to completion". Runs fable-new-issue to create a fully-specified issue (drafted by a Fable 5.1 subagent), then hands the new issue number to validate-issue-loop (validate → update → work-on-issue-loop) — stopping instead when a duplicate is found or the discussion hasn't converged on one issue.
---

# fable-new-issue-loop

Chain fable-new-issue → validate-issue-loop into one autonomous run: a Fable 5.1 subagent drafts the issue, the main agent files it, and the loop drives it to a reviewed PR without a human in between.

**This skill is `new-issue-loop` with a different front of the chain.** Follow the `new-issue-loop` skill for the full procedure: the complete-issue rule, the input contract, the stop gate, the handoff to validate-issue-loop (explicit issue reference, `owner/repo#N` when filed cross-repo), the report format, and the Red Flags. Apply only the deltas below.

## Deltas from new-issue-loop

- **Step 1, front of the chain.** Invoke the `fable-new-issue` skill (Skill tool, `skill: fable-new-issue`) in place of `new-issue`. Let it run its full process (Fable 5.1 subagent draft, duplicate gate, spot-check, filing) and capture the created issue number from its report.
- **Step 2, stop gate.** new-issue-loop's stop gate applies with one extra row for the Fable draft; the effective table:

| Condition | Action |
|---|---|
| fable-new-issue found an existing open issue/PR already covering it (no issue filed) | **STOP.** Report the duplicate and the offer to update/comment instead — merging scopes is a human call. |
| The conversation held several distinct candidates | If one clearly converged, file it and **continue the chain with it**; the unfiled candidates go in the final report. If none clearly converged, **STOP** — report the candidates and ask which to file. Never bundle, never auto-file the extras. |
| fable-new-issue split the work and named unfiled follow-ups | Continue with the **core issue only**; relay the unfiled follow-ups in the final report. |
| The draft was structurally wrong and fable-new-issue paused for a human decision | **STOP.** Relay what is off. Do not file or re-dispatch on your own. |
- **Step 3, why validation still runs.** Validating an issue this chain just filed stays useful: validate-issue re-traces the claims against the code independently and catches anything the Fable draft or the spot-check got wrong.
- **Step 4, report.** Mark the issue line as drafted by Fable 5.1. **Cap the whole report at 55 words, plain simple English in ASD-STE100** — apply the Response Style rules in CLAUDE.md/AGENTS.md.
- **One extra Red Flag.** Tempted to skip the Fable subagent and draft or file the issue yourself to go faster: never. The draft coming from Fable 5.1 is the point of this skill.
