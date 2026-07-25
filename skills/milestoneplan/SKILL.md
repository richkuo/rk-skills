---
name: milestoneplan
description: Use when the user wants a milestone's per-issue routing shown before any agent starts — "milestoneplan v1", "/milestoneplan", "what would run for v1?", "check the milestone before we launch". Read-only pre-flight for milestone-workflow - renders each issue's Execution-block routing (complexity score, dependency fields, build model, effort, validate effort, fableplan, plan effort, first review) and recommends field changes wherever a stamp contradicts the complexity band formula. Never edits an issue and never launches the run. Stage 6 of the new-app-pipeline.
---

# milestoneplan

One table before the run: read every issue in the milestone, show exactly the routing `milestone-workflow` would execute, and recommend a change wherever a stamped field contradicts what the issue's own score prescribes.

**This skill never writes.** It does not edit issue bodies, post comments, open PRs, or invoke the Workflow tool. Recommendations are handed to `execution-plan-review` (Execution block lines) or `validate-issue` (body and title); the run is handed to `milestone-workflow`. Do not launch either one unprompted.

## Input

A milestone — by title (`v1`, `v1 — Desktop core call loop`), or nothing, in which case list the repo's open milestones and ask which one. Match loosely on title prefix; when two milestones match, show both and ask.

## Steps

### 1. Read the milestone

```
gh api "repos/{owner}/{repo}/milestones?state=all&per_page=100" --paginate --jq '.[] | "\(.title) [\(.state)] — open:\(.open_issues) closed:\(.closed_issues)"'
gh issue list --milestone "<title>" --state all --limit 500 --json number,title,state,body
```

Pass `state=all` and `--paginate` on the milestones call: that endpoint returns 30 per page by default and open milestones only, so a closed milestone — or one past the first page — would read as not found.

Strip `\r` from fetched bodies (the API returns CRLF) before parsing. Parse each issue's `[C<score>]` title prefix, complexity rationale line, and `## Execution` block into a record: score, `Depends on`, `Runs after`, build model, effort, validate effort, fableplan, plan effort, PR review line.

**Parse, never infer, when the field is present.** An explicit `none` is authoritative. Record an absent field as *missing* and mark it that way in the table — "missing" and "none" are different cells, and they get different recommendations.

### 2. Recompute the expected routing from the score

Compare what is stamped against what the issue's own score prescribes. The canonical formula lives in `validate-issue` step 6; the bands are:

**Derive both axes from the score — do not wait for the rationale line to publish them.** `validate-issue` defines the score as `25 × Capability + Volume` with `Volume ≤ 24`, so the `[C<score>]` prefix already parsed in step 1 fully determines `Capability = floor(score / 25)` and `Volume = score mod 25`. Every routing field the score determines is recomputed from the score. A missing rationale line gets its own recommendation; it never suppresses the effort check, because there is nothing left to look up. When the rationale line *does* publish a Volume that disagrees with `score mod 25`, that contradiction gets a recommendation too — the two cannot both be right. With no `[C<score>]` prefix at all nothing is derivable, and only the missing-prefix recommendation stands.

| Capability | Score | Build model | fableplan | Effort from Volume (0–7 / 8–15 / 16–24) |
|---|---|---|---|---|
| 0 | 0–24 | Sonnet-class | No | high / high / xhigh |
| 1 | 25–49 | Opus-class | No | high / high / xhigh |
| 2 | 50–74 | Opus-class | **Yes** | high / high / xhigh |
| 3 | 75–99 | Fable 5 | No (planning inherent) | medium / high / xhigh (discretionary low) |

**Band conformance is two-sided.** A build model that departs from its score's band in *either* direction gets a recommendation: below it (under-powered — the issue gets a model that cannot carry the work) and above it (silent overspend — a `[C10]` issue stamped Fable 5 reads clean while buying the most expensive model in the fleet). Over-band is common by construction, not theoretical: `workflows/milestone-pipeline.js` defaults any issue with no Execution block to `model fable, effort high`.

Recommend a change for: a build model that departs from its band in either direction; `fableplan: Yes` outside Capability 2; `fableplan: No` on a Capability-2 issue; an effort that contradicts the Volume tertile derived from the score; a rationale line whose published Volume disagrees with `score mod 25`; `Validate effort: xhigh` (only ever medium or high); a non-Fable build stamped `low`/`medium` (the pipeline silently raises these to `high` — say so, since the stamp lies about what will run); a `Plan effort` on a `fableplan: No` issue (inert — never read); a `fableplan: Yes` issue with no `Plan effort` (defaults to high, which is fine — note it, no change needed).

**Distinguish an override from a slip.** A body that explicitly records a deliberate departure ("deliberate override — C75 is Capability 3, where the band prescribes Fable 5") is a decision, not drift: list it under *Deliberate overrides*, never as a recommendation. An unexplained departure gets a recommendation. This distinction is the point of the check — a milestone where every deviation is annotated is healthy; one where they are silent is not.

### 3. Present the table and the recommendations

The per-issue table, one row per issue — this is what the run will execute:

```
# | State | C | Depends on | Runs after | Build | Effort | Validate | fableplan | Plan | 1st review
```

Mark missing values as *missing* (never blank, never a guessed default) and note that the pipeline would route a missing Execution block to `model fable, effort high`.

Then the recommendations, one line per contradicting field: `#N — <field>: <stamped> → <recommended> (<why, derived from the score>)`. Route each to the skill whose documented write scope actually covers it:

- **Execution-block fields** (ordering fields, build model, effort, validate effort, fableplan, plan effort, a missing `## Execution` block) → `execution-plan-review`. That is its whole revision vocabulary, and it edits *only* the intended Execution block lines.
- **Body-content items** (a missing or wrong `[C<score>]` title prefix, a missing or contradictory complexity rationale line) → `validate-issue`, which owns the issue body and title. `execution-plan-review` cannot clear any of these — it does not touch body prose.
- **Deliberate overrides** — list separately, so annotated decisions are not re-litigated every run.

Offer the next actions and let the user pick: `execution-plan-review` to apply Execution-block recommendations, `validate-issue` for body-content ones, `milestone-workflow` to run — it presents its own mandatory run plan before dispatching, so approving here is not yet approving the run.

## What this skill does not do

| Not this | Whose job |
|---|---|
| Editing Execution block lines | `execution-plan-review` (its write scope stops there) |
| Editing issue body prose or the title's `[C<score>]` prefix | `validate-issue` |
| Building tracks, deciding dispatch order, and running the pipeline | `milestone-workflow` |
| Verifying an issue's claims against the code | `validate-issue` (the pipeline runs it per issue at dispatch time) |
| Writing the plan for one issue | `fableplan` |

The routing table and its recommendations are the whole scope. Per-issue correctness belongs to the validation pass that runs immediately before each issue builds — do not duplicate it here, and do not report its absence as a finding.

## Failure modes

| Situation | Do this |
|---|---|
| No milestone named, several open | List them with open/closed counts and ask which |
| Milestone has no open issues | Report it as complete; there is nothing to plan |
| An issue has no `## Execution` block | Show every field as *missing*; recommend `execution-plan-review` stamp it, and say the pipeline would otherwise default it to `model fable, effort high` |
| An issue has no `[C<score>]` title prefix | Show the stamps as-is; the band check is underivable for that issue — recommend `validate-issue` set the prefix |
| Milestone is closed | Still viewable — the milestones call needs `state=all`, or a closed milestone returns no record at all |
| Findings are all deliberate overrides | Say so explicitly, so annotated decisions are not re-litigated every run |
