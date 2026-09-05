---
name: milestoneplan
description: Use when the user wants a milestone's execution plan shown as a table — "milestoneplan v1", "/milestoneplan", "show the plan for v1". Read-only - reads every issue in the milestone and renders one table of issue number, description, complexity, dependencies, validate/build model and effort, fableplan, plan effort, and first-review trigger. Never edits an issue and never launches a run. Stage 6 of the new-app-pipeline.
---

# milestoneplan

Show a milestone's execution plan as one table. **This skill never writes**: no issue edits, comments, PRs, or Workflow runs. Fixes belong to `execution-plan-review`; the run belongs to `milestone-workflow`.

## Input

A milestone title (`v1`, `v1 — Desktop core call loop`), matched loosely on prefix. With no input, or when two titles match, list the open milestones with open/closed counts and ask which.

## Steps

### 1. Read the milestone

```
gh api "repos/{owner}/{repo}/milestones?state=all&per_page=100" --paginate --jq '.[] | "\(.title) [\(.state)] — open:\(.open_issues) closed:\(.closed_issues)"'
gh issue list --milestone "<title>" --state all --limit 500 --json number,title,state,body
```

`state=all` and `--paginate` with `per_page=100` are required: the defaults are open-only and 30 per page, so a closed or late milestone reads as not found. If the issue count equals `--limit`, re-fetch at a higher limit until a fetch returns strictly below its own limit. Strip `\r` from bodies (the API returns CRLF), then parse the `[C<score>]` title prefix and the `## Execution` block: `Depends on`, `Runs after`, build model, effort, fableplan, `PR review:`, and the optional `Validate effort:` and `Plan effort:` lines.

### 2. Render the table

Output is **exactly one pipe-delimited markdown table**, one row per issue ordered by number, capped at these 8 columns so terminals do not wrap it:

| # | Description | C | Deps/After | Validate | Build | Plan | Review |
|---|---|---|---|---|---|---|---|

- **Description** — the title with the `[C<score>]` prefix stripped, truncated to ~30 characters.
- **C** — the score from the title prefix.
- **Deps/After** — `<depends> / <after>`, issue numbers without `#`, `none` rendered as `—` (e.g. `12, 13 / —`); never infer edges from prose. When every `Runs after` is `none`, drop the ` / —` suffix and say so in the note.
- **Validate** — `<model> · <effort>`. The model comes from the score band, never from a stamp; the effort is the band default unless a `Validate effort:` line stamps one. Band defaults: `Opus 5 · medium` at `[C0]`–`[C9]`, `Opus 5 · high` at `[C10]`–`[C49]`, `Opus 5 · xhigh` at `[C50]`–`[C70]`, `Fable 5.1 · medium` at `[C71]`–`[C80]`, `Fable 5.1 · high` at `[C81]` and above (`validate-issue` step 6 is the authority; a missing prefix routes as Fable high). A stamped tier renders as the effective value plus `(stamped)`, e.g. `Fable 5.1 · xhigh (stamped)`; the pipeline clamps an Opus row stamped `low` or `medium` to `Opus 5 · high (stamped <tier> → high: Fable-only tier)` and applies no clamp to a Fable row stamped `xhigh`.
- **Build** — the stamped `<model> · <effort>`, e.g. `Opus 5 · xhigh`. An external harness renders as `<Name> · <effort> (<harness>)`, e.g. `Luna · max (Codex CLI)` or `Grok · high (Cursor CLI, cursor-grok-4.6-high)` when the stamp carries a model id. `max` is Codex CLI-only, so a Cursor or Claude row stamped `max` renders the clamp the pipeline applies, e.g. `Grok · xhigh (Cursor CLI, stamped max → xhigh)`.
- **Plan** — `Yes · <effort>` when fableplan is `Yes`: the stamped `Plan effort:` tier with ` (stamped)`, else `high`. Plain `No` when stamped `No`; a `Plan effort:` line on a `No` issue renders `No · <tier> (inert — no plan stage runs)`.
- **Review** — the first-review trigger from the `validate-issue` step 6 first-review table (this file states no boundary of its own; a missing prefix takes its heaviest row), unless `PR review:` stamps an explicit `@claude <model> review effort:<tier>` trigger. Render a stamped `haiku` as `@claude sonnet review`, the trigger the runtime posts, because `claude.yml` admits only `sonnet`/`opus`/`fable`. Append a parenthetical only for a real caveat (e.g. `may close with no PR`).

Every absent field renders *missing*, never blank or a guessed default. An issue with no `## Execution` block is *missing* across the Execution-derived cells, with a note line that the pipeline builds it from the validated score band's defaults (no prefix routes as band 5).

After the table, print **one note line** covering: the Validate factoring above (`validate-issue` step 6 is the authority); rows whose stamped `Validate effort` or `Plan effort` was clamped; rows built on an external CLI harness (the pipeline drives them through `cli-dispatch` under an Opus driver, and a rescore keeps the harness); rows whose stamped Build model or Effort diverges from the band default, naming the band value (informational: when validation confirms a higher score at run time, the pipeline re-routes to the band defaults and the orchestrating session restamps); and anything uniform that was dropped.

Print nothing else: no verdict, findings, wave plan, or cost projection.

### 3. Hand off

After the table, offer in one line each only the actions that apply, and launch neither unprompted:

- Stamps missing or wrong → `execution-plan-review` (it owns Execution-block edits).
- Ready to run → `milestone-workflow` (it presents its own run plan before dispatching).

## Failure modes

| Situation | Do this |
|---|---|
| No milestone named, several open | List them with open/closed counts and ask which |
| Milestone has no issues | Say so; there is nothing to tabulate |
| Milestone is closed | Still render; the milestones call needs `state=all` |
| Fetched issue count equals `--limit` | Re-fetch at a higher limit until proven complete |
