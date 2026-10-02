---
name: execution-plan-review
description: Use when the user wants to review or revise the ordering/model/effort/fableplan/plan-effort assignments on a milestone's GitHub issues — "review the execution plan", "/execution-plan-review", "show me the model assignments", or piecemeal revisions like "11 should be medium" or "plan 17 at xhigh". Renders the assignment table from the issues' Execution blocks, validates revisions, and writes them back. Stage 5 of the new-app-pipeline.
---

# execution-plan-review

Show a milestone's per-issue ordering and execution assignments as one table, take the user's revisions, and sync the GitHub issues (the source of truth cold agents read). `milestoneplan` is the read-only view of this table; it routes Execution-block fixes here.

## Steps

### 1. Render the table from the issues, not from memory

Fetch every milestone issue (`gh issue list --milestone "<title>" --json number,title,body`, with the title quoted) and parse the `## Execution` blocks:

| Issue | C | Depends on | Runs after | Build model | Effort | Validate | fableplan first? | Plan effort |
|---|---|---|---|---|---|---|---|---|

Cell rules:
- **Validate** is the effective `<model> · <effort>` the pipeline dispatches. The model comes from the `[C<score>]` band (a missing prefix routes as band 5) unless a `Validate model:` line stamps `Fable 5.1`, `Opus 5.5`, or `<Name> (Codex CLI[, <model-id>])`; the effort is the band default unless a `Validate effort:` line stamps one. The `validate-issue` step 6 band table is the authority; do not restate it. Show a stamp as `Fable 5.1 · low (stamped; band Opus 5.5 · high)` or `Astra · low (Codex CLI, gpt-6-astra; stamped; band Fable 5.1 · high)`, and a clamp as `Opus 5.5 · high (stamped low → high: low is a Fable-only tier)`. Only `low` clamps on an Opus validate; `medium` runs as stamped.
- **Plan effort** defaults to `high` on `fableplan first: Yes` issues; a stamped line shows as `<tier> (stamped)`. On a `No` issue show `—` only when no line is stamped; any stamped line, `high` included, shows as `<tier> (inert — no plan stage runs)`.
- An absent ordering field shows as `missing`, never `none`.

Then add 2–3 sentences on the pattern (dominant bands, which issues plan first at score ≥ 71, the review trigger) as a sanity check against the `validate-issue` step 6 band table.

### 2. Take revisions

- Shorthand: "11 should be medium", "12 depends on 8 and 9", "13 runs after 12", "clear 14's dependencies", "plan 17 at medium", "validate 271 at medium". Resolve row-vs-issue ambiguity against the table just shown; confirm in half a sentence when still ambiguous. A bare effort revision means the **build** effort; confirm in half a sentence when the issue also has a plan stage.
- External CLI builds ("build 275 with luna on codex at max", "277 grok on cursor high", "278 on cursor with cursor-grok-4.6-high") write `- **Build model:** <Name> (Codex CLI)` or `<Name> (Cursor CLI)`, with `, <model-id>` inside the parenthetical when the user names an id, and the tier to `Effort:`. `max` is a Codex CLI-only tier: write a Cursor `max` as `xhigh`, and a Claude `max` as `xhigh` on every Claude model, Fable included; say the clamp applied.
- "validate <n> at <tier>" writes `- **Validate effort:** <tier>`; "validate <n> with fable" or "validate <n> with fable at low" writes `- **Validate model:** Fable 5.1` (or `Opus 5.5`) plus any tier; "validate 20 with astra on codex at low" writes `- **Validate model:** Astra (Codex CLI, <model-id>)` with the id the user names and `- **Validate effort:** low` (`low` to `max`); "plan <n> at <tier>" writes `- **Plan effort:** <tier>`. A revision that names the band default for that stage removes the line instead of stamping it; say so. A milestone-wide revision ("every Fable validate at medium", "all plans at medium", "validate both with fable on low") applies, in one batch, to every issue whose stage runs on that model after the batch.
- **Push back once when a revision conflicts with the score band** (`validate-issue` step 6 / `prd-to-issues`): fableplan below score 71, or dropping below Opus on a money/security/irreversible-deletion issue. Give one recommendation with the reason; the user decides.
- Batch revisions; do not round-trip to GitHub per message.
- A Plan effort revision on a `fableplan first: No` issue is inert. Say so once and drop it, or ask whether they meant to turn fableplan on. A flip to `Yes` plans at `high` unless the same batch stamps a `Plan effort:` line. A flip `Yes` → `No` on an issue with a `Plan effort` line strips that line during write-back; say you dropped it. Offer once to strip any inert stamp already on an issue instead of silently carrying it forward.
- Preserve the edge kind: `Depends on` stays a hard prerequisite, `Runs after` stays ordering-only. Never move an issue between the fields to simplify the graph.
- Before writing: verify every referenced issue exists, reject self-references, deduplicate each list, reject a predecessor present in both fields, and recursively fetch referenced issues outside the milestone until the explicit ordering graph closes.
- **Reject the whole batch before write-back** if the combined graph (every `Depends on` and `Runs after` edge, including unchanged and external issues) contains a cycle. Edit no issue, and show the cycle path.

### 3. Write back

Load `github-issue-format`. For each changed issue, `gh issue edit` preserving the entire body and changing only the intended Execution block lines; the footer verb flips to `Updated`. Strip `\r` from `gh`-fetched bodies. When edits collide with concurrent issue edits, re-fetch and re-apply only your delta. Re-run the graph validation after any concurrent-edit re-fetch and before retrying a write.

### 4. Confirm

Re-render the final table once after all revisions land, and say it is what the milestone workflow will execute.

## Failure modes

| Situation | Do this |
|---|---|
| An issue lacks an Execution block | Derive model/effort/fableplan from the `[C..]` band per `prd-to-issues`. Stamp no `Validate effort:` or `Plan effort:` line unless the user asked for a tier. Flag the backfilled block in the table |
| An issue lacks one or both ordering fields | Backfill from the approved prd-to-issues graph when available; otherwise infer from Approach/Problem, mark the value inferred in the table, and confirm before write-back |
| Revision references a row that does not exist | Show the table again; ask which issue they meant |
| Revision puts a non-Fable build's effort at `low` or `medium` | Set `high`, or switch the build to Fable 5.1 if that tier was the point; Opus/Sonnet run at high/xhigh only. A Codex CLI or Cursor CLI build accepts `low` to `xhigh` as stamped, and Codex also accepts `max` |
| Revision names an external CLI build or validate without a known default model id | Only `Luna (Codex CLI)`, `Astra (Codex CLI)`, and `Grok (Cursor CLI)` resolve an id; before writing, ask for the id in half a sentence and write it inside the parenthetical. The pipeline blocks an unknown name |
| Revision puts a Fable build's effort at `low` | Allowed with no pushback only on a band-5 issue (`[C81]`+). Outside band 5, raise to the band effort or push back once, the scope `prd-to-issues` / `validate-issue` enforce |
| Revision puts any Fable 5.1 stage at `xhigh` | Write it as stamped. The revision is the explicit ask that permits `xhigh` on Fable; the unstamped default stays `high` (the LLM Attribution Footer section of CLAUDE.md owns this rule) |
| Revision names a validate model | Write `- **Validate model:** Fable 5.1`, `Opus 5.5`, or `<Name> (Codex CLI[, <model-id>])`; a stamped model overrides the band (`validate-issue` step 6). Reject a Cursor CLI validate and keep the prior stamp; say the pipeline runs a validate pass only in the Codex read-only sandbox. Ask about any other Claude name in half a sentence |
| Revision names a validate effort | Write the `Validate effort:` line. A Fable validate (stamped, `[C71]`+, or no prefix) runs every tier `low` to `xhigh` as stamped; a Codex CLI validate runs `low` to `max` as stamped. An Opus validate (stamped, or `[C0]`–`[C70]` unstamped) runs `medium`, `high`, and `xhigh` as stamped and raises `low` to `high`; say so, and offer a `Validate model:` stamp as the way to reach a Fable or Codex validate |
| A stamped Build model or Effort diverges from the issue's current `[C..]` band default | Apply `validate-issue/issue-editing.md` (Edit the title): a stamp at or above the band default on a field (a heavier model, a Fable 5.1 build, a Codex CLI or Cursor CLI harness, a higher effort, `fableplan first: Yes`) is a deliberate override from any session. Keep it, and mark it in the table as stamped above band. Restamp a stamp below the band default up to the default and report it, unless the user names the lower stamp deliberate in this session, with the step 2 push-back. A run-time rescore keeps a harness or Fable 5.1 stamp and only adds fableplan |
| Revision flips fableplan `Yes` → `No` on a band-4 (`[C71]`–`[C80]`) issue | Write it and say the issue loses its Fable plan. Build effort stays `high`, the same as band 3 |
| Revision names a plan model | Only the effort is stampable; the fableplan stage is Fable 5.1 by definition. Drop the model part, keep the effort part, say so |
| Revision names a plan effort | Write the `Plan effort:` line with `low`, `medium`, `high`, or `xhigh`. A revision to `high` removes the line, since high is the default |
