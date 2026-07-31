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

Output is **exactly one markdown table** — one row per issue in the milestone, ordered by issue number. A real pipe-delimited markdown table, never prose, bullets, or a code block:

| # | Description | C | Depends on | Runs after | Validate model | Validate effort | Build model | Build effort | fableplan | Plan effort | 1st review |
|---|---|---|---|---|---|---|---|---|---|---|---|

- **#** — the issue number.
- **Description** — the issue title with the `[C<score>]` prefix stripped, truncated to a short phrase.
- **C** — the score from the `[C<score>]` title prefix; *missing* when absent.
- **Depends on / Runs after** — the stamped edge lists from the Execution block, verbatim (`none` stays `none`); *missing* when the field is absent — never infer edges from prose.
- **Validate model** — always **Fable 5** (the pipeline dispatches every validate agent on Fable 5 regardless of the Build model).
- **Validate effort** — the stamped `Validate effort`; *missing* when absent (the pipeline defaults to high).
- **Build model / Build effort** — the stamped values from the Execution block.
- **fableplan** — `Yes` / `No` as stamped.
- **Plan effort** — the stamped `Plan effort`; `—` on a `fableplan: No` issue (never read).
- **1st review** — the issue's `PR review:` line (reviewer model / trigger).

Mark any absent field as *missing* — never blank, never a guessed default. An issue with no `## Execution` block gets *missing* across the Execution-derived cells, with a one-line note under the table that the pipeline would route it to `model fable, effort high`.

Print nothing else besides the table and that note. No verdict, no findings list, no wave plan, no cost projection.

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
