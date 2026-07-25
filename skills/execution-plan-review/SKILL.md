---
name: execution-plan-review
description: Use when the user wants to review or revise the ordering/model/effort/fableplan/plan-effort assignments on a milestone's GitHub issues — "review the execution plan", "/execution-plan-review", "show me the model assignments", or piecemeal revisions like "11 should be medium" or "plan 17 at xhigh". Renders the assignment table from the issues' Execution blocks, validates revisions, and writes them back. Stage 4 of the new-app-pipeline.
---

# execution-plan-review

Present the per-issue ordering and execution assignments as one table, absorb the user's revisions, and keep the GitHub issues — the single source of truth cold agents read — in sync.

## Steps

### 1. Render the table from the issues, not from memory

Fetch every issue in the milestone (`gh issue list --milestone ... --json number,title,body`) and parse the `## Execution` blocks. The table:

| Issue | C | Depends on | Runs after | Build model | Effort | Validate effort | fableplan first? | Plan effort |
|---|---|---|---|---|---|---|---|---|

(Validate effort and Plan effort both default to high when an issue's block omits the line — show the effective value. Show Plan effort as `—` on issues where fableplan first is No, since no plan stage runs. Display an absent ordering field as `missing`, not `none`, so legacy prose inference is not silently discarded.)

Follow with 2–3 sentences on the pattern (which Capability bands dominate, where fableplan bridges Capability 2, what the review trigger is) — enough for the user to sanity-check against the `prd-to-issues` / `validate-issue` band table, not a lecture.

### 2. Take revisions

- The user revises in shorthand ("11 should be medium", "12 depends on 8 and 9", "13 runs after 12", "clear 14's dependencies", "plan 17 at xhigh"). Resolve ambiguous references (row position vs issue number) against the table just shown; when genuinely ambiguous, confirm in half a sentence. A bare effort revision ("11 should be medium") means the **build** effort — confirm in half a sentence when the issue also has a plan stage.
- **Push back once when a revision conflicts with the score band** (canonical table in `validate-issue` step 6 / `prd-to-issues`) — e.g. fableplan on Capability 0–1, or dropping below Fable/Opus on a money/security/irreversible-deletion issue (high Risk → Capability 2–3). One recommendation with the reason, then the user decides. Money/security/irreversible-deletion issues dropping below the top model deserve an explicit warning.
- Batch multiple revisions; don't round-trip to GitHub per message.
- **A Plan effort revision on a `fableplan first: No` issue is inert** — no plan stage runs, so the value is never read. Say so once and either drop the revision or ask whether they meant to turn fableplan on; never write a value that silently does nothing. Conversely, when a revision flips fableplan to `Yes`, the issue inherits the default high unless they also name a Plan effort.
- Preserve the edge kind exactly: a `Depends on` revision remains a hard prerequisite, while a `Runs after` revision remains ordering-only. Never move an issue between the fields merely to simplify the graph.
- Before writing, verify every referenced issue exists, reject self-references, deduplicate each list, and reject a predecessor present in both fields. Recursively fetch referenced issues outside the milestone until the explicit ordering graph closes so every reachable typed edge participates in validation.
- **Reject the whole revision batch before write-back** if the combined graph contains a cycle; the graph is the union of every `Depends on` and `Runs after` edge, including unchanged and externally referenced issues.

### 3. Write back

Load `github-issue-format` before editing. For each changed issue: `gh issue edit` preserving the entire body, updating only the intended Execution block lines; footer verb flips to `Updated`. Strip `\r` from `gh`-fetched bodies before editing (the API returns CRLF). Re-run the graph validation after any concurrent-edit re-fetch and before retrying a write.

### 4. Confirm

Re-render the final table once after all revisions land. This table is what the milestone workflow will execute — say so.

To check the milestone as a whole before it runs — graph closure, execution waves, run size, a go / no-go verdict — that is `milestoneplan`. It audits read-only and routes any fixes back here.

## Failure modes

| Situation | Do this |
|---|---|
| An issue lacks an Execution block | Add one by deriving model/effort/fableplan/plan effort from the `[C..]` band per `prd-to-issues`, flag it in the table |
| An issue lacks one or both ordering fields | Backfill from the approved prd-to-issues graph when available; otherwise infer from Approach/Problem, mark the value as inferred in the table, and confirm it before write-back |
| User revision references a row that doesn't exist | Show the table again, ask which issue they meant |
| A revision creates a cycle across either edge kind | Reject the batch without editing any issue and show the cycle path |
| Revision would put a non-Fable build's effort at `low` or `medium` | Set `high`, or switch the build to Fable 5 if that tier was the point — Opus/Sonnet run at high/xhigh only |
| Revision would put a Fable build's effort at `low` | Allowed — Fable-only discretionary tier below the formula floor, no pushback needed |
| Revision would put validate effort at `xhigh` | Set `high` and say why — validate effort is only ever medium or high |
| Revision names a plan model, not just an effort | Only the effort is stampable — the fableplan stage is Fable 5 by definition. Keep Fable 5, apply the effort if one was named, and say so |
| Revision would put plan effort at `low` or `medium` | Allowed — the planner is always Fable, so every tier is legal; no pushback needed |
| Edits collide with someone else's concurrent issue edits | Re-fetch, re-apply only your delta |
