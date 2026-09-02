---
name: execution-plan-review
description: Use when the user wants to review or revise the ordering/model/effort/fableplan/plan-effort assignments on a milestone's GitHub issues — "review the execution plan", "/execution-plan-review", "show me the model assignments", or piecemeal revisions like "11 should be medium" or "plan 17 at xhigh". Renders the assignment table from the issues' Execution blocks, validates revisions, and writes them back. Stage 5 of the new-app-pipeline.
---

# execution-plan-review

Present the per-issue ordering and execution assignments as one table, absorb the user's revisions, and keep the GitHub issues — the single source of truth cold agents read — in sync.

## Steps

### 1. Render the table from the issues, not from memory

Fetch every issue in the milestone (`gh issue list --milestone ... --json number,title,body`) and parse the `## Execution` blocks. The table:

| Issue | C | Depends on | Runs after | Build model | Effort | Validate | fableplan first? | Plan effort |
|---|---|---|---|---|---|---|---|---|

(Show **Validate** as the effective `<model> · <effort>` the pipeline will dispatch. The model comes from the `[C<score>]` band and is never stampable: Opus 5 at 0–70, Fable 5.1 at 71 and above or when the prefix is missing. The effort defaults to the band value — `Opus 5 · medium` at 0–9, `Opus 5 · high` at 10–50, `Opus 5 · xhigh` at 51–70, `Fable 5.1 · medium` at 71–80, `Fable 5.1 · high` at 81 and above or when the prefix is missing (this is the one inline copy in this file; the `validate-issue` step 6 band table is the authoritative source) — and a stamped `Validate effort:` line overrides it for that issue. Show a stamped tier as the effective value with the band default beside it, e.g. `Fable 5.1 · medium (stamped; band high)`. When the stamp cannot run as written, show the clamp: a Fable validate stamped `xhigh` shows `Fable 5.1 · high (stamped xhigh → high: Fable ceiling)`, and an Opus validate stamped `low` or `medium` shows `Opus 5 · high (stamped <tier> → high: low/medium are Fable-only)`. Reject any request to stamp a `Validate model:` line. **Plan effort defaults to `high` on `fableplan first: Yes` issues** and a stamped `Plan effort:` line overrides it; show the effective tier, marking a stamp as `<tier> (stamped)` and a stamped `xhigh` as `high (stamped xhigh → high: Fable ceiling)`. Show Plan effort as `—` on a `fableplan first: No` issue only when it stamps no line at all, since no plan stage runs; when such an issue carries any stamped `Plan effort:` line — including `high` — show `<tier> (inert — no plan stage runs)` and never a bare `—`. An inert stamp from a hand edit must be visible in the table that is meant to be the source of truth, not masked by it; the milestone pipeline logs it on every run. Display an absent ordering field as `missing`, not `none`, so legacy prose inference is not silently discarded.)

Follow with 2–3 sentences on the pattern (which score bands dominate, which issues plan first at score ≥ 71, what the review trigger is) — enough for the user to sanity-check against the `prd-to-issues` / `validate-issue` band table, not a lecture.

### 2. Take revisions

- The user revises in shorthand ("11 should be medium", "12 depends on 8 and 9", "13 runs after 12", "clear 14's dependencies", "plan 17 at medium", "validate 271 at medium"). Resolve ambiguous references (row position vs issue number) against the table just shown; when genuinely ambiguous, confirm in half a sentence. A bare effort revision ("11 should be medium") means the **build** effort — confirm in half a sentence when the issue also has a plan stage. "validate <n> at <tier>" writes a `- **Validate effort:** <tier>` line; "plan <n> at <tier>" writes a `- **Plan effort:** <tier>` line. A revision that names the band default for that stage removes the line instead of writing a redundant stamp, and say so. A milestone-wide revision ("every Fable validate at medium", "all plans at medium") applies to every issue whose stage runs on Fable, in one batch.
- **Push back once when a revision conflicts with the score band** (canonical table in `validate-issue` step 6 / `prd-to-issues`) — e.g. fableplan below score 71, or dropping below Opus on a money/security/irreversible-deletion issue (high Risk → a high score). One recommendation with the reason, then the user decides. Money/security/irreversible-deletion issues dropping below the top model deserve an explicit warning.
- Batch multiple revisions; don't round-trip to GitHub per message.
- **A Plan effort revision on a `fableplan first: No` issue is inert** — no plan stage runs, so the value is never read. Say so once and either drop the revision or ask whether they meant to turn fableplan on. When a revision flips fableplan to `Yes`, the plan runs at `high` unless the same batch also stamps a `Plan effort:` line.
- **When a revision flips fableplan `Yes` → `No` on an issue that carries a `Plan effort` line, strip that line during write-back** and say you dropped it. Refusing to *write* an inert stamp is only half the rule — one left behind is read by nobody, shows as an inert tier in the next table, and makes the milestone pipeline log it on every run. The same applies to any inert stamp you find already on an issue: offer to strip it once rather than carrying it forward silently.
- Preserve the edge kind exactly: a `Depends on` revision remains a hard prerequisite, while a `Runs after` revision remains ordering-only. Never move an issue between the fields merely to simplify the graph.
- Before writing, verify every referenced issue exists, reject self-references, deduplicate each list, and reject a predecessor present in both fields. Recursively fetch referenced issues outside the milestone until the explicit ordering graph closes so every reachable typed edge participates in validation.
- **Reject the whole revision batch before write-back** if the combined graph contains a cycle; the graph is the union of every `Depends on` and `Runs after` edge, including unchanged and externally referenced issues.

### 3. Write back

Load `github-issue-format` before editing. For each changed issue: `gh issue edit` preserving the entire body, updating only the intended Execution block lines; footer verb flips to `Updated`. Strip `\r` from `gh`-fetched bodies before editing (the API returns CRLF). Re-run the graph validation after any concurrent-edit re-fetch and before retrying a write.

### 4. Confirm

Re-render the final table once after all revisions land. This table is what the milestone workflow will execute — say so.

To see the whole milestone's execution plan as one table — issue, complexity, dependencies, validate/build model and effort, fableplan, plan effort, first review — read-only, before it runs, that is `milestoneplan`. It reads without editing and routes any Execution-block fixes back here.

## Failure modes

| Situation | Do this |
|---|---|
| An issue lacks an Execution block | Add one by deriving model/effort/fableplan from the `[C..]` band per `prd-to-issues`. Stamp no `Validate effort:` or `Plan effort:` line unless the user asked for a tier — absent lines mean the band default and high. Flag the backfilled block in the table |
| An issue lacks one or both ordering fields | Backfill from the approved prd-to-issues graph when available; otherwise infer from Approach/Problem, mark the value as inferred in the table, and confirm it before write-back |
| User revision references a row that doesn't exist | Show the table again, ask which issue they meant |
| A revision creates a cycle across either edge kind | Reject the batch without editing any issue and show the cycle path |
| Revision would put a non-Fable build's effort at `low` or `medium` | Set `high`, or switch the build to Fable 5.1 if that tier was the point — Opus/Sonnet run at high/xhigh only |
| Revision would put a Fable build's effort at `low` | Allowed only on a band-5 issue (`[C81]`+) — the Fable-only discretionary tier for a top-band issue judged lighter than its Volume warrants, no pushback needed. Outside band 5, raise to the band effort (or push back once) — same scope `prd-to-issues` / `validate-issue` enforce |
| Revision would put any Fable 5.1 stage at `xhigh` | Set `high` and say why — **Fable never runs at xhigh; high is Fable's ceiling on every stage (build, plan, validate, review, fix)** (the LLM Attribution Footer section of CLAUDE.md owns this ceiling) |
| Revision names a validate model | The model is never stampable — it is derived from the `[C<score>]` band (the step 1 Validate mapping; `validate-issue` step 6 is the authority). Say so and drop that part; if they want the heavier model, the score is what to revisit |
| Revision names a validate effort ("validate 271 at medium") | Write the `Validate effort:` line. On a Fable validate (`[C71]`+ or no prefix) `low`, `medium`, and `high` run as stamped and `xhigh` is written as `high` — say the ceiling applied. On an Opus validate (`[C0]`–`[C70]`) `high` and `xhigh` run as stamped, and `low` or `medium` is raised to `high` — say so, because those tiers are Fable-only, and offer the score as the way to reach a Fable validate |
| A stamped Build model or Effort diverges from the issue's current `[C..]` band default | Restamp to the band default and say so in the report (a re-scored prefix over an old stamp is the usual cause; the pipeline would re-route it upward at run time anyway — restamping now keeps the issue truthful). Keep the stamp only when the user names it a deliberate override in this session |
| A revision flips fableplan `Yes` → `No` on a band-4 (`[C71]`–`[C80]`) issue | Recommend restoring the build effort to `xhigh` in the same batch — band 4 builds at high only because a posted Fable plan precedes the build; without the plan the harder issue must not run at less effort than band 3 |
| Revision names a plan model, not just an effort | Only the effort is stampable — the fableplan stage is Fable 5.1 by definition. Drop the model part, keep the effort part, and say so |
| Revision names a plan effort ("plan 271 at medium") | Write the `Plan effort:` line with `low`, `medium`, or `high`; write `xhigh` as `high` and say the Fable ceiling applied. A revision to `high` removes the line, since high is the default |
| Edits collide with someone else's concurrent issue edits | Re-fetch, re-apply only your delta |
