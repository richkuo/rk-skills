---
name: milestoneplan
description: Use when the user wants a milestone's execution plan shown as a table — "milestoneplan v1", "/milestoneplan", "show the plan for v1". Read-only - reads every issue in the milestone and renders one table of issue number, description, complexity, dependencies, validate/build model and effort, fableplan, plan effort, and first-review trigger. Never edits an issue and never launches a run. Stage 6 of the new-app-pipeline.
---

# milestoneplan

Show a milestone's execution plan as a single table. **This skill never writes.** It does not edit issue bodies, post comments, open PRs, or invoke the Workflow tool. Fixes belong to `execution-plan-review`; the run belongs to `milestone-workflow`.

## Input

A milestone — by title (`v1`, `v1 — Desktop core call loop`), or nothing, in which case list the repo's open milestones and ask which one. Match loosely on title prefix; when two milestones match, show both and ask.

## Steps

### 1. Read the milestone

```
gh api "repos/{owner}/{repo}/milestones?state=all&per_page=100" --paginate --jq '.[] | "\(.title) [\(.state)] — open:\(.open_issues) closed:\(.closed_issues)"'
gh issue list --milestone "<title>" --state all --limit 500 --json number,title,state,body
```

Pass `state=all` on the milestones call (it defaults to open only) and `--paginate` with `per_page=100` (it returns 30 per page by default). If the issue fetch returns a count equal to `--limit`, re-fetch at a higher limit until a fetch returns strictly below its own limit — never render the table over a possibly-partial milestone.

Strip `\r` from fetched bodies (the API returns CRLF) before parsing. Parse each issue's `[C<score>]` title prefix and `## Execution` block: `Depends on`, `Runs after`, build model, build effort, validate effort, fableplan, plan effort, PR review line.

### 2. Render the table

Output is **exactly one markdown table** — one row per issue in the milestone, ordered by issue number. A real pipe-delimited markdown table, never prose, bullets, or a code block. Terminals wrap wide tables into unreadable pseudo-lists, so the table is capped at 8 columns (~100 characters) by merging related fields into compound cells:

| # | Description | C | Deps/After | Validate | Build | Plan | Review |
|---|---|---|---|---|---|---|---|

- **#** — the issue number.
- **Description** — the issue title with the `[C<score>]` prefix stripped, truncated to ~30 characters.
- **C** — the score from the `[C<score>]` title prefix; *missing* when absent.
- **Deps/After** — the stamped `Depends on` and `Runs after` edge lists as one cell, `<depends> / <after>`, issue numbers without the `#` prefix and `none` rendered as `—` (e.g. `12, 13 / —`); *missing* on either side when that field is absent — never infer edges from prose. When every row's `Runs after` is `none`, drop the ` / —` suffix from all cells and say so in the note line below the table.
- **Validate** — the stamped `Validate effort`; *missing* when absent (the pipeline defaults to high). The model needs no column: it is always Fable 5 (the pipeline dispatches every validate agent on Fable 5 regardless of the Build model) — state that once in the note line below the table.
- **Build** — the stamped build model and effort as one cell, `<model> · <effort>` (e.g. `Opus 5 · xhigh`); *missing* on either half when absent.
- **Plan** — `Yes · <plan effort>` when fableplan is stamped `Yes` (e.g. `Yes · high`; *missing* for the effort half when unstamped; a stamped `xhigh` renders as `xhigh (illegal — Fable caps at high)` since the planner is always Fable 5), plain `No` when stamped `No` (plan effort is never read), *missing* when the fableplan stamp is absent.
- **Review** — the issue's `PR review:` line compressed to its trigger (e.g. `@claude`); append a short parenthetical only when the line carries a real caveat (e.g. `may close with no PR`).

After the table, print **one note line** stating what was factored out of the columns: validate model is always Fable 5, plus anything uniform that was dropped (e.g. `Runs after` all `none`).

Mark any absent field as *missing* — never blank, never a guessed default. An issue with no `## Execution` block gets *missing* across the Execution-derived cells, with an extra line in the note that the pipeline would route it to `model fable, effort high`.

Print nothing else besides the table and the note. No verdict, no findings list, no wave plan, no cost projection.

### 3. Hand off

Offer, in one line each, only the actions that apply — and only after the table:

- Stamps missing or wrong → `execution-plan-review` (it owns Execution-block edits).
- Ready to run → `milestone-workflow` (it presents its own run plan before dispatching).

Do not launch either one unprompted.

## Failure modes

| Situation | Do this |
|---|---|
| No milestone named, several open | List them with open/closed counts and ask which |
| Milestone has no issues | Say so; there is nothing to tabulate |
| Milestone is closed | Still render — the milestones call needs `state=all` |
| Fetched issue count equals `--limit` | Re-fetch at a higher limit until proven complete |
| The repo has more than 30 milestones | Always `--paginate` with `per_page=100`, or a named milestone can read as not found |
