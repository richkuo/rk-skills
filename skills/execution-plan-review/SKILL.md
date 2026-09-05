---
name: execution-plan-review
description: Use when the user wants to review or revise the ordering/model/effort/fableplan/plan-effort assignments on a milestone's GitHub issues — "review the execution plan", "/execution-plan-review", "show me the model assignments", or piecemeal revisions like "11 should be medium" or "plan 17 at xhigh". Renders the assignment table from the issues' Execution blocks, validates revisions, and writes them back. Stage 5 of the new-app-pipeline.
---

# execution-plan-review

Present the per-issue ordering and execution assignments as one table, absorb the user's revisions, and keep the GitHub issues (the single source of truth cold agents read) in sync. `milestoneplan` is the read-only view of the same table; it routes Execution-block fixes back here.

## Steps

### 1. Render the table from the issues, not from memory

Fetch every issue in the milestone (`gh issue list --milestone ... --json number,title,body`) and parse the `## Execution` blocks:

| Issue | C | Depends on | Runs after | Build model | Effort | Validate | fableplan first? | Plan effort |
|---|---|---|---|---|---|---|---|---|

Cell rules:
- **Validate** is the effective `<model> · <effort>` the pipeline dispatches. The model derives from the `[C<score>]` band and is never stampable (a missing prefix routes as band 5); the effort is the band default unless a `Validate effort:` line stamps one. The `validate-issue` step 6 band table is the authority; do not restate it here. Show a stamp as `Fable 5.1 · medium (stamped; band high)`; show a clamp as `Opus 5 · high (stamped <tier> → high: low/medium are Fable-only)`.
- **Plan effort** defaults to `high` on `fableplan first: Yes` issues; a stamped line shows as `<tier> (stamped)`. On a `No` issue show `—` only when no line is stamped; any stamped line, `high` included, shows as `<tier> (inert — no plan stage runs)`, because the milestone pipeline logs it on every run and the source-of-truth table must not mask it.
- An absent ordering field shows as `missing`, never `none`, so legacy prose inference is not silently discarded.

Follow with 2–3 sentences on the pattern (dominant bands, which issues plan first at score ≥ 71, the review trigger) for a sanity check against the `prd-to-issues` / `validate-issue` band table.

### 2. Take revisions

- Shorthand: "11 should be medium", "12 depends on 8 and 9", "13 runs after 12", "clear 14's dependencies", "plan 17 at medium", "validate 271 at medium". Resolve row-vs-issue ambiguity against the table just shown; confirm in half a sentence when still ambiguous. A bare effort revision means the **build** effort; confirm in half a sentence when the issue also has a plan stage.
- External CLI builds ("build 275 with luna on codex at max", "277 grok on cursor high", "278 on cursor with cursor-grok-4.6-high") write `- **Build model:** <Name> (Codex CLI)` or `<Name> (Cursor CLI)`, appending `, <model-id>` inside the parenthetical when the user names an id, and write the tier to `Effort:`. `max` is a Codex CLI-only tier: a Cursor `max` is written as `xhigh`, and a Claude `max` as `xhigh` on every Claude model, Fable included; say the clamp applied. Only `Luna` on Codex and `Grok` on Cursor have a default model id; any other name needs an explicit id, so ask for one in half a sentence before writing.
- "validate <n> at <tier>" writes `- **Validate effort:** <tier>`; "plan <n> at <tier>" writes `- **Plan effort:** <tier>`. A revision that names the band default for that stage removes the line instead of stamping it, and say so. A milestone-wide revision ("every Fable validate at medium", "all plans at medium") applies to every issue whose stage runs on Fable, in one batch.
- **Push back once when a revision conflicts with the score band** (`validate-issue` step 6 / `prd-to-issues`): fableplan below score 71, or dropping below Opus on a money/security/irreversible-deletion issue. One recommendation with the reason, then the user decides.
- Batch revisions; do not round-trip to GitHub per message.
- A Plan effort revision on a `fableplan first: No` issue is inert. Say so once and drop it, or ask whether they meant to turn fableplan on. A flip to `Yes` plans at `high` unless the same batch stamps a `Plan effort:` line. A flip `Yes` → `No` on an issue carrying a `Plan effort` line strips that line during write-back; say you dropped it. Offer once to strip any inert stamp already on an issue instead of carrying it forward silently.
- Preserve the edge kind: `Depends on` stays a hard prerequisite, `Runs after` stays ordering-only. Never move an issue between the fields to simplify the graph.
- Before writing: verify every referenced issue exists, reject self-references, deduplicate each list, reject a predecessor present in both fields, and recursively fetch referenced issues outside the milestone until the explicit ordering graph closes.
- **Reject the whole batch before write-back** if the combined graph (every `Depends on` and `Runs after` edge, including unchanged and external issues) contains a cycle.

### 3. Write back

Load `github-issue-format`. For each changed issue: `gh issue edit` preserving the entire body, changing only the intended Execution block lines; footer verb flips to `Updated`. Strip `\r` from `gh`-fetched bodies (the API returns CRLF). Re-run the graph validation after any concurrent-edit re-fetch and before retrying a write.

### 4. Confirm

Re-render the final table once after all revisions land, and say it is what the milestone workflow will execute.

## Failure modes

| Situation | Do this |
|---|---|
| An issue lacks an Execution block | Derive model/effort/fableplan from the `[C..]` band per `prd-to-issues`. Stamp no `Validate effort:` or `Plan effort:` line unless the user asked for a tier. Flag the backfilled block in the table |
| An issue lacks one or both ordering fields | Backfill from the approved prd-to-issues graph when available; otherwise infer from Approach/Problem, mark the value inferred in the table, and confirm before write-back |
| Revision references a row that does not exist | Show the table again; ask which issue they meant |
| Revision creates a cycle across either edge kind | Reject the batch without editing any issue; show the cycle path |
| Revision puts a non-Fable build's effort at `low` or `medium` | Set `high`, or switch the build to Fable 5.1 if that tier was the point; Opus/Sonnet run at high/xhigh only. A Codex CLI or Cursor CLI build accepts `low` to `xhigh` as stamped, and Codex also accepts `max` |
| Revision names an external CLI build without a known default model id | Only `Luna (Codex CLI)` and `Grok (Cursor CLI)` resolve an id; ask for the id in half a sentence and write it inside the parenthetical, because the pipeline blocks an unknown name |
| Revision puts a Fable build's effort at `low` | Allowed only on a band-5 issue (`[C81]`+), the Fable-only discretionary tier, no pushback needed. Outside band 5, raise to the band effort or push back once, the same scope `prd-to-issues` / `validate-issue` enforce |
| Revision puts any Fable 5.1 stage at `xhigh` | Write it as stamped. The revision is the explicit ask that permits `xhigh` on Fable; the unstamped default stays `high` (the LLM Attribution Footer section of CLAUDE.md owns this rule) |
| Revision names a validate model | Never stampable; it derives from the `[C<score>]` band (`validate-issue` step 6). Say so and drop that part; a heavier model means revisiting the score |
| Revision names a validate effort | Write the `Validate effort:` line. A Fable validate (`[C71]`+ or no prefix) runs every tier `low` to `xhigh` as stamped. An Opus validate (`[C0]`–`[C70]`) runs `high` and `xhigh` as stamped and raises `low` or `medium` to `high`; say so, and offer the score as the way to reach a Fable validate |
| A stamped Build model or Effort diverges from the issue's current `[C..]` band default | Restamp to the band default and say so (a re-scored prefix over an old stamp is the usual cause; the pipeline re-routes only when its own validator outranks the title band, so a stale stamp under a higher title score otherwise builds as stamped). Keep the stamp only when the user names it a deliberate override in this session. A Codex CLI or Cursor CLI stamp the user named this session is such an override: report it and leave it; a run-time rescore keeps the harness and only adds fableplan |
| Revision flips fableplan `Yes` → `No` on a band-4 (`[C71]`–`[C80]`) issue | Write it and say the issue loses its Fable plan. Build effort stays `xhigh`, the same as band 3 |
| Revision names a plan model | Only the effort is stampable; the fableplan stage is Fable 5.1 by definition. Drop the model part, keep the effort part, say so |
| Revision names a plan effort | Write the `Plan effort:` line with `low`, `medium`, `high`, or `xhigh`. A revision to `high` removes the line, since high is the default |
| Edits collide with concurrent issue edits | Re-fetch, re-apply only your delta |
