---
name: execution-plan-review
description: Use when the user wants to review or revise the model/effort/fableplan assignments on a milestone's GitHub issues — "review the execution plan", "/execution-plan-review", "show me the model assignments", or piecemeal revisions like "11 should be medium". Renders the assignment table from the issues' Execution blocks, takes revisions, and writes them back. Stage 4 of the new-app-pipeline.
---

# execution-plan-review

Present the per-issue execution assignments (build model, effort, fableplan) as one table, absorb the user's revisions, and keep the GitHub issues — the single source of truth cold agents read — in sync.

## Steps

### 1. Render the table from the issues, not from memory

Fetch every issue in the milestone (`gh issue list --milestone ... --json number,title,body`) and parse the `## Execution` blocks. The table:

| Issue | C | Build model | Effort | Validate effort | fableplan first? |
|---|---|---|---|---|---|

(Validate effort defaults to high when an issue's block omits the line — show the effective value.)

Follow with 2–3 sentences on the pattern (which issues run on the top model and why, where fableplan bridges, what the review trigger is) — enough for the user to sanity-check the logic, not a lecture.

### 2. Take revisions

- The user revises in shorthand ("11 should be medium", "for 12, use fable"). Resolve ambiguous references (row position vs issue number) against the table just shown; when genuinely ambiguous, confirm in half a sentence.
- **Push back once when a revision conflicts with the heuristics** — e.g. adding a fableplan step to an issue too small to benefit, or dropping the top model from a money path. One recommendation with the reason, then the user decides. Money/security/irreversible-deletion issues dropping below the top model deserve an explicit warning.
- Batch multiple revisions; don't round-trip to GitHub per message.

### 3. Write back

For each changed issue: `gh issue edit` preserving the entire body, updating only the Execution block lines; footer verb flips to `Updated`. Strip `\r` from `gh`-fetched bodies before editing (the API returns CRLF).

### 4. Confirm

Re-render the final table once after all revisions land. This table is what the milestone workflow will execute — say so.

## Failure modes

| Situation | Do this |
|---|---|
| An issue lacks an Execution block | Add one using the prd-to-issues heuristics, flag it in the table |
| User revision references a row that doesn't exist | Show the table again, ask which issue they meant |
| Revision would put effort at `low` | Set `medium` and say why (effort floor) |
| Revision would put an Opus 4.8 build at `medium` | Set `high`, or switch the build to Fable 5 if medium was the point — Opus runs at high/xhigh only |
| Revision would put validate effort at `xhigh` | Set `high` and say why — validate effort is only ever medium or high |
| Edits collide with someone else's concurrent issue edits | Re-fetch, re-apply only your delta |
