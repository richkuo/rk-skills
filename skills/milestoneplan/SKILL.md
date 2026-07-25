---
name: milestoneplan
description: Use when the user wants a milestone inspected and its run planned before any agent starts — "milestoneplan v1", "/milestoneplan", "is v1 ready to run?", "what would running v1 cost?", "check the milestone before we launch". Read-only pre-flight for milestone-workflow - audits every issue's Execution block against the complexity band formula, closes the dependency graph, derives execution waves, projects run size, and returns a go / no-go verdict. Never edits an issue and never launches the run without approval. Stage 6 of the new-app-pipeline.
---

# milestoneplan

Plan mode for a milestone. Read every issue, prove the milestone is actually runnable, and present the plan the user approves — **before** `milestone-workflow` builds tracks and `milestone-pipeline` spends agents.

**This skill never writes.** It does not edit issue bodies, post comments, open PRs, or invoke the Workflow tool during the audit. Fixes are handed to `execution-plan-review`; the run is handed to `milestone-workflow`. That read-only guarantee is what makes it safe to run at any time, on any milestone, including one someone else owns.

## Input

A milestone — by title (`v1`, `v1 — Desktop core call loop`), or nothing, in which case list the repo's open milestones and ask which one. Match loosely on title prefix; when two milestones match, show both and ask.

## Steps

### 1. Read the milestone

```
gh api "repos/:owner/:repo/milestones?state=all" --jq '.[] | "\(.title) [\(.state)] — open:\(.open_issues) closed:\(.closed_issues)"'
gh issue list --milestone "<title>" --state all --limit 500 --json number,title,state,body,labels,stateReason,closedByPullRequestsReferences
```

Pass `state=all` on the milestones call: that endpoint defaults to open milestones only, so a closed milestone would otherwise return no record and silently become unauditable.

**Prove the fetch was complete before auditing anything — from the fetch itself, never by comparing counts across endpoints.** `--limit` caps the page, so:

- A returned count **strictly below** the limit means the fetch is complete. Proceed.
- A returned count **equal to** the limit is indistinguishable from truncation. Re-fetch at a higher limit; if the higher fetch returns more, keep raising until a fetch comes back strictly below its own limit.
- Only when no limit yields a fetch below its own limit is the issue set an unproven unknown: report it as a **blocking unknown** and return **NO-GO**. Never emit a verdict over a possibly-partial milestone, and never absorb a shortfall on the grounds that the missing issues looked like leaves.

**Do not gate this on the milestone object's `open_issues` / `closed_issues`.** Those counters and `gh issue list` do not measure the same set — GitHub counts pull requests assigned to the milestone as issues, while `gh issue list` returns issues only, so a healthy, fully-fetched milestone that carries any PR reads as short by exactly the number of PRs it holds. (Measured on `rust-lang/rust`'s `1.0 beta` milestone: counters report 80, `gh issue list` returns 79, and one PR is assigned to it.) This pipeline's resume bucket exists precisely because milestones carry open PRs, so that divergence is the normal case here, not an edge case. Report the counters as context if useful; never let them trigger a NO-GO.

Strip `\r` from fetched bodies (the API returns CRLF) before parsing. Parse each issue's `[C<score>]` title prefix, complexity rationale line, and `## Execution` block into a record: score, `Depends on`, `Runs after`, build model, effort, validate effort, fableplan, plan effort, PR review line.

**Parse, never infer, when the field is present.** An explicit `none` is authoritative. Record an absent field as *missing* and carry that distinction into every later step — "missing" and "none" produce different findings.

Then classify each issue into the same three buckets `milestone-workflow` uses, so the two skills agree on what a run would actually touch: **build** (open, no PR), **resume** (open with an open PR that closes it), **skip** (closed).

**Fetch the repo's open PRs once, then match locally** — never one search per issue:

```
gh pr list --state open --limit 500 --json number,title,body,headRefName
```

A per-issue `gh pr list --search "<issue number>"` costs one search request per issue (up to 500 at the limit above) against the search endpoint, which is rate-limited far more aggressively than the plain list. Request count must not grow with the milestone's size.

**Match every closing keyword GitHub itself recognizes** — all nine, case-insensitive: `close`, `closes`, `closed`, `fix`, `fixes`, `fixed`, `resolve`, `resolves`, `resolved`. Recognizing only a subset silently drops a real closing relationship: a PR body reading `Fixed #12` would land that issue in **build**, putting an issue that already has an open PR into both the wave plan and the cost projection.

Anchor the pattern so it stays precise:

```
(?i)\b(close[sd]?|fix(es|ed)?|resolve[sd]?)\s+(?:[\w.-]+/[\w.-]+)?#(\d+)\b(?!\d)
```

The optional `owner/repo` prefix catches the cross-repo `owner/repo#12` form, and the trailing boundary keeps `#12` from matching `#123`. A bare mention with no keyword is not a resume-bucket PR; only a closing relationship is.

**A failed lookup is not "no PR found."** If the single query errors, is throttled, or returns a truncated page (same limit rule as above), stop and report it as a **blocking unknown** — do not fall through to classifying every issue as build. That misclassification is exactly what would send an already-open PR back through a fresh build and open a duplicate, which is the case `milestone-workflow` step 1's resume bucket exists to prevent.

**Resolve the merge state of every closed predecessor — the severity table turns on it, so it has to be fetched, not assumed.** Step 2c distinguishes a predecessor closed *with* a merged PR (a satisfied edge, no finding) from one closed *without* (unsatisfiable, excluded), and neither the issue list nor the open-PR query above can tell those apart on its own. `closedByPullRequestsReferences` (fetched with the issues above) names the PRs that close each issue but **not** whether they merged, so resolve each **distinct** referenced PR once:

```
gh pr view <n> -R <owner>/<repo> --json number,state,mergedAt
```

**Always pass `-R`, taken from the reference's own `repository`** (`repository.owner.login` / `repository.name` — both come back with the issue list above). `gh pr view 42` with no `-R` resolves *this* repo's PR 42, so a predecessor closed by `otherorg/repo#42` would be decided by an unrelated same-numbered local PR — which is worse than an error, because it returns a confident merge verdict either way: satisfied (the dependent builds against code that does not exist) or unsatisfiable (a healthy subtree excluded). A cross-repo PR in a repository the token cannot read is a **blocking unknown** under the indeterminate rule below, never a verdict from a local PR of the same number.

That is bounded by the number of distinct closing PRs on closed predecessors — not by the milestone's size. Then:

- PR `state: MERGED` (non-null `mergedAt`) → the edge is **satisfied**. Drop it; no finding.
- PR closed **unmerged** → genuinely **unsatisfiable**; the dependent and its hard descendants are excluded.
- No `closedByPullRequestsReferences` at all → closed with no PR → also excluded.
- **Merge state is the deciding fact, not `stateReason`.** An issue closed `NOT_PLANNED` whose closing PR merged is still satisfied; one closed `COMPLETED` with no merged PR is not. Use `stateReason` as context in the report, never as the test.

**Never resolve an undecidable merge state to the blocking branch.** If a PR lookup errors or throttles, the edge is *indeterminate*: report it as a **blocking unknown** with the issue and PR numbers, rather than quietly excluding a healthy dependent. On a partially-completed milestone re-run — the case the skip bucket exists for — guessing "unsatisfiable" would exclude every merged-predecessor subtree and could return NO-GO on a milestone `milestone-workflow` would run to completion.

### 2. Audit each issue

Four independent checks per issue. Collect findings; do not stop at the first one.

**Audit every issue in the milestone, but derive severity from the bucket the finding's issue sits in.** The audit itself stays milestone-wide — bucket membership is not decidable without the whole set, and a closed or resume issue is still a predecessor whose merge state a runnable issue's edge turns on. Severity is the part that scopes, because the projected run only ever *dispatches* the runnable build bucket:

- **Runnable build-bucket issue** → severity exactly as step 5's table assigns it.
- **Skip bucket (closed)** → **informational**, never blocking. `milestone-workflow` step 1 drops closed issues from the plan, and prep reads only the issues that appear in `tracks` (`workflows/milestone-pipeline.js` builds its issue list from the tracks it was handed), so nothing in a closed issue's Execution block is ever read. One pre-convention closed issue must not NO-GO the partially-completed re-run the skip bucket exists to make possible.
- **Resume bucket** → **informational**, with the re-entry named. Its PR runs through `fix-pr-review-loop` *outside* the pipeline, so its Execution block is not read this run either — but if that PR closes unmerged the issue returns to the build bucket, where the same finding becomes blocking. Say that in the report rather than dropping the finding: it is deferred, not resolved.

The one milestone-wide exception is the step 1 fetch itself: an incomplete fetch stays NO-GO regardless of buckets, because bucket membership is exactly what an incomplete fetch makes undecidable.

**(a) Completeness.** Missing `## Execution` block; missing `Depends on` / `Runs after`; missing acceptance criteria or problem statement; a `[C<score>]` prefix absent from the title; a stale model name that no longer routes (e.g. an Opus version the pipeline's prep step no longer maps).

**(b) Band conformance.** Recompute the expected routing from the issue's own score and compare against what is stamped. The canonical formula lives in `validate-issue` step 6; the bands are:

**Derive both axes from the score — do not wait for the rationale line to publish them.** `validate-issue` defines the score as `25 × Capability + Volume` with `Volume ≤ 24`, so the `[C<score>]` prefix already parsed in step 1 fully determines `Capability = floor(score / 25)` and `Volume = score mod 25`. Every routing field the score determines is recomputed from the score. A missing rationale line is its own completeness finding; it never suppresses the effort check, because there is nothing left to look up. When the rationale line *does* publish a Volume that disagrees with `score mod 25`, that contradiction is itself a finding — the two cannot both be right. With no `[C<score>]` prefix at all nothing is derivable, and only the completeness finding stands.

| Capability | Score | Build model | fableplan | Effort from Volume (0–7 / 8–15 / 16–24) |
|---|---|---|---|---|
| 0 | 0–24 | Sonnet-class | No | high / high / xhigh |
| 1 | 25–49 | Opus-class | No | high / high / xhigh |
| 2 | 50–74 | Opus-class | **Yes** | high / high / xhigh |
| 3 | 75–99 | Fable 5 | No (planning inherent) | medium / high / xhigh (discretionary low) |

**Band conformance is two-sided.** A build model that departs from its score's band in *either* direction is a finding: below it (under-powered — the issue gets a model that cannot carry the work) and above it (silent overspend — a `[C10]` issue stamped Fable 5 audits clean while buying the most expensive model in the fleet). Since this skill's per-model mix is what estimates the run's cost, quiet overspend has to surface too. Over-band is common by construction, not theoretical: `workflows/milestone-pipeline.js` defaults any issue with no Execution block to `model fable, effort high`. Report a Capability-3 issue at Fable 5 as on-band and silent, and treat an annotated over-band stamp as a *Deliberate override* rather than a defect.

Flag: a build model that departs from its band in either direction; `fableplan: Yes` outside Capability 2; `fableplan: No` on a Capability-2 issue; an effort that contradicts the Volume tertile derived from the score; a rationale line whose published Volume disagrees with `score mod 25`; `Validate effort: xhigh` (only ever medium or high); a non-Fable build stamped `low`/`medium` (the pipeline silently raises these to `high` — say so, since the stamp lies about what will run); a `Plan effort` on a `fableplan: No` issue (inert — never read); a `fableplan: Yes` issue with no `Plan effort` (defaults to high, which is fine — report as informational, not a finding).

**Distinguish an override from a slip.** A body that explicitly records a deliberate departure ("deliberate override — C75 is Capability 3, where the band prescribes Fable 5") is a decision, not drift: report it under *Deliberate overrides*, never as a defect. An unexplained departure is a finding. This distinction is the point of the check — a milestone where every deviation is annotated is healthy; one where they are silent is not.

**(c) Graph.** Resolve every referenced issue, including ones outside the milestone, until the graph closes. Flag: references to issues that do not exist; self-references; a predecessor listed in both fields; duplicates within a list; a cycle across the union of both edge kinds (show the path); a **hard** edge to an issue that is closed **without** a merged PR (unsatisfiable as filed); a hard edge into the resume bucket (its PR must merge first); an **ordering-only** edge into either the resume bucket or a closed predecessor (a different disposition in both cases — see below, not the same as the hard one).

**Both edge kinds into the resume bucket get a disposition, and they differ.** `milestone-workflow` step 1 runs a resume predecessor's `fix-pr-review-loop` to completion *before* invoking the pipeline, and says that pre-step is what satisfies **ordering-only** edges — so an ordering-only edge into resume is *satisfied by sequencing*, not blocked. Report it as informational: name the edge and the PR whose loop must finish first, so the sequencing is visible in the plan. A **hard** edge into resume still needs the predecessor's merged code and stays *Blocked — excluded*.

A predecessor that is closed **with** a merged PR is a *satisfied* edge, not a finding — the base branch already carries its code, exactly as `milestone-workflow` step 1 treats it. Drop the edge and say nothing.

**An ordering-only edge to a closed predecessor is satisfied whether or not its PR merged.** An ordering edge only prevents overlapping work (`milestone-workflow` step 1), and a closed issue is dropped from the plan outright — there is no work left to overlap. So the unmerged-PR exclusion is a **hard**-edge disposition only; excluding an ordering-only dependent (plus its own hard descendants) would drop runnable issues out of the waves and the projection over a constraint the run already meets. Report it as informational at most.

**(d) Readiness.** Cross-milestone prerequisites that are still open — recorded separately by edge kind, because they carry different severities: an open **hard** cross-milestone prerequisite means the code does not exist yet *and* `milestone-workflow` step 1 rejects out-of-milestone references outright, while an open **ordering-only** one is merely unenforceable in `tracks`. Also flag: issues whose hard predecessors all sit in a later milestone; an issue already closed but still carrying open dependents.

Every finding this step can produce maps to exactly one severity in step 5's table — none of them falls through the rules, and none of them lands in two.

### 3. Derive the execution waves

Topologically sort the build bucket over the union of both edge kinds — over the **runnable set**, meaning the build bucket minus every subtree step 5 classifies as *Blocked — excluded*. Those issues never reach an agent, so counting them in the waves or the projection overstates the run. List them separately instead, each with the descendants it takes with it. Report:

- **Waves** — wave 1 is everything with no unmet predecessor inside the run; each later wave is what unblocks once the previous completes. This is the shape of the run, not a schedule; unrelated tracks execute concurrently.
- **Critical path** — the longest hard-edge chain, and the issue that gates the most descendants. Name it: that issue's failure or review churn stalls the widest part of the milestone.
- **Concurrency** — the widest wave, which is roughly the peak parallel agent count the run will reach.

### 4. Project the run size

Reproduce **every** term `milestone-workflow` step 2 computes, for the review mode you are projecting under, so the two never disagree. This is the skill's headline "what will it cost?" answer, so it is worthless — worse, misleading — without its assumptions stated alongside it.

**State the assumptions first.** Default to the pipeline's own defaults (`reviewLoop: true`, `reviewMode: 'subagent'`, `maxReviewCycles: 5`) and say so explicitly; if the user names different ones, project under theirs and label it. Every number below is scoped to the runnable set from step 3 — the build bucket minus excluded subtrees.

- **Planned direct agents:** `1 prep + sum over the runnable build-bucket issues of (1 validate + (fableplan ? 1 plan : 0) + 1 implement + (reviewLoop ? 1 review-loop : 0))`.
- **Retry-aware ceiling:** `planned + the runnable-set issue count` — each issue's validation can dispatch one retry. Count the runnable set, never the milestone's full issue list: resume- and skip-bucket issues are not in the sum.
- **Review worst case — the term the happy-path formula hides, and it differs by mode.** The `1 review-loop` above is only the first reviewer.
  - `reviewMode: 'subagent'` (the default): every cycle past the first dispatches a fixer + re-reviewer pair as **direct** agents, so the worst case is `2×maxReviewCycles − 1` review-phase agents per issue (`maxReviewCycles` reviewers + `maxReviewCycles−1` fixers). Report the worst-case total as the planned count with the per-issue review term raised from 1 to that value, plus the retry term. At the default cap of 5 that is 9 review agents per issue, not 1 — so a 10-issue milestone projects up to 90 review agents where the happy path shows 10. Quote both bounds; never the happy path alone.
  - `reviewMode: 'github'`: that work genuinely nests inside one `fix-pr-review-loop` agent per issue, so the `1 review-loop` term holds and the subagent worst case must **not** be applied. Name the mode that produced the number — and attribute that single agent to the issue's **Build model**, not to Opus: the pipeline dispatches it with the Build model and the issue's build effort. The reviews it responds to come from the `@claude` GitHub Action, which is not a pipeline agent and so is outside these counts entirely.
  - `reviewLoop: false`: the review term is zero in every bound.
- **Resume-bucket cost, reported separately — and it comes first.** Each resume-bucket issue runs `fix-pr-review-loop` on its existing PR, and `milestone-workflow` step 1 runs those loops **to completion before invoking the pipeline**. So this cost is not concurrent with the build bucket's; it is sequenced ahead of it, and the plan has to say so or the number reads as if it overlapped. It sits outside the build-bucket sums entirely, still costs, and its agents are no more bounded by `maxReviewCycles` than the build bucket's are. Report the count, its sequencing, and that it is outside the totals; never fold it in silently and never omit it.
- **Thresholds.** Compare every bound against the effective Dynamic workflow size guideline when session context carries one — otherwise Claude Code's documented default of more than 25 scheduled agents. Name which threshold you used. Also state that Claude Code triggers `Large workflow` when a run's projected token total exceeds 1.5 million, so a run sitting under the agent threshold can still cross the token one. In an ultracode session, label both comparisons informational — the warning is suppressed.
- Label all of them planning bounds, not a guarantee. `maxReviewCycles` changes the stopping rule after an LGTM; it is not a guaranteed cap while reviews keep returning `Needs Updates`. Never call a run safe merely because a direct count sits under a threshold.

**Attribute every agent to the model the pipeline actually dispatches it on — not to the issue's Build model, and not to a single model per term.** The Build model parsed in step 1 governs the implement term, the subagent-mode fixers, and — in github mode only — the review loop itself. Every other term is fixed by `workflows/milestone-pipeline.js` independently of anything stamped on the issue, and the review term depends on the mode:

| Projected agent | Model it actually runs on |
|---|---|
| Prep (once for the whole run) | **the session model** — the pipeline passes no `model`, only `effort: 'low'`, so prep inherits whatever model the session runs on (Opus 5 in this repo's normal usage, not a cheap tier; a Fable session makes it a Fable agent) |
| Validate (every issue) | **always Fable 5**, regardless of the Build model |
| Plan (`fableplan: Yes` issues) | **always Fable 5** — a second Fable agent the Build model never predicts |
| Implement | the issue's **Build model** |
| First review, `reviewMode: 'subagent'` (the default) | the issue's `PR review:` model, **defaulting to Opus** — never the Build model |
| Review-loop fixer, subagent mode (each cycle past the first) | the issue's **Build model** |
| Re-review after a fix pass that cleared only non-blocking findings, subagent mode | **Sonnet** |
| The single `review-loop` agent, `reviewMode: 'github'` | the issue's **Build model**, at the issue's build effort — the `PR review:` model is *never read* in this mode, so a `PR review:` line on a github-mode issue changes nothing about the mix |

**The review term is Build-model-dependent in exactly one of the two modes, so name the mode before naming the model.** Under the default subagent mode a 10-issue Capability-0 milestone is not ~20 Sonnet agents: it is 10 Fable (validate) + 10 Sonnet (implement) + 10 Opus (first review), plus one prep. The same milestone in github mode is 10 Fable + 10 Sonnet + 10 **Sonnet** (the loop agents) + prep — no Opus reviewer in the mix at all. Report the mix from this table, and state which terms the Build model did and did not determine.

With `reviewLoop: false` no reviewer or fixer model enters the mix in either mode. In the subagent worst case above, the extra review-phase agents split between the first-review model (the re-reviewers) and the Build model (the fixers), with any post-non-blocking re-review at Sonnet.

Report the per-model agent mix (how many agents land on Fable 5 versus Opus versus the rest), since that, not the raw count, drives what the run costs. Every row above places into that mix, prep included — it lands under whatever model the session is on.

### 5. Present the plan and give a verdict

Lead with the verdict, then the evidence. Terse — this is a decision aid, not a report.

```
<milestone> — <GO | GO WITH FINDINGS | NO-GO>

<one line: what runs, in how many waves, at what agent count>

Buckets: <n> build (<n> runnable · <n> excluded) · <n> resume · <n> skip
Waves: 1) #a #b  2) #c  3) #d
Critical path: #a → #c → #d (gates <n> issues)
Run size: <planned> planned / <ceiling> retry-aware / <worst> review worst case direct agents
  assumes reviewLoop:<v> · reviewMode:<v> · maxReviewCycles:<n> — threshold: <n>, <source>
  plus <n> resume-bucket fix-pr-review-loop agents, outside those sums

Blocking (must fix before running):
- #N — <finding> → <recommended fix>

Blocked — excluded from the run (the rest still runs):
- #N — <why> → also excludes #a #b (hard descendants) → unblocks when <PR #X merges | decision>

Non-blocking (run is still valid):
- #N — <finding> → <recommended fix>

Deliberate overrides (recorded in the issue, not defects):
- #N — <what and why>
```

**Verdict rules.** Every finding class maps to exactly one severity, and that severity matches what `milestone-workflow` would actually *do* with the same milestone — never blocking a run it would happily execute, never green-lighting an edge it would reject:

| Finding | Severity | Because |
|---|---|---|
| A cycle across the union of both edge kinds, every issue in it runnable | **NO-GO** | `milestone-workflow` step 1 rejects it — no track order exists |
| A cycle routed through a skip- or resume-bucket issue | **Informational** | that node never enters `tracks`, and its edges are disposed of by the cross-bucket rules — no cycle reaches the runner. Show the path anyway; it is a filing defect |
| A **runnable** issue with no `## Execution` block | **NO-GO** | the pipeline's prep step routes it on conservative defaults (`fable`/`high`) instead of what the issue intends |
| A reference that does not resolve, or an unreachable cross-repo issue, on an edge a **runnable** issue holds | **NO-GO** | that edge's disposition is undecidable, so no bound is trustworthy |
| A fetch that did not cover the whole milestone (step 1) | **NO-GO** | the verdict would be computed over a partial issue set |
| Merge state of a closed predecessor a **runnable** issue hard-depends on could not be determined | **NO-GO** | the distinction the rows below turn on is undecidable, and guessing would exclude a healthy subtree |
| A hard edge into the resume bucket (predecessor's PR still open) | **Blocked — excluded** | step 1 excludes the dependent plus its hard descendants as *blocked pending merge of PR #X* and runs everything else |
| An **ordering-only** edge into the resume bucket | **Informational** | step 1 runs that PR's `fix-pr-review-loop` to completion before the pipeline starts, which satisfies it — name the sequencing, do not block |
| A **hard** edge to a predecessor closed with **no** PR, or with one closed unmerged | **Blocked — excluded** | step 1 excludes it as *blocked pending decision* — unsatisfiable as filed, and merge state decides that, not `stateReason` |
| An **ordering-only** edge to that same predecessor — closed with no PR, or with one closed unmerged | *no finding* | a closed issue is dropped from the plan, so no work is left to overlap and the constraint is already met |
| An open **hard** cross-milestone prerequisite | **Blocked — excluded** | the predecessor's code does not exist yet, and step 1 rejects out-of-milestone references |
| An open **ordering-only** cross-milestone prerequisite | **Non-blocking** | it cannot be expressed in `tracks`, so the constraint simply goes unenforced — say so, and recommend either waiting for it or dropping the edge |
| A predecessor closed **with** a merged PR (resolved via `gh pr view -R`, step 1) | *no finding* | the edge is satisfied; the base branch has the code |
| A stamp contradicting its band, an inert field, a stamp that lies about what will run | **Non-blocking** | the run proceeds; only the paperwork is wrong |
| **Any row above, when the finding's issue sits in the skip or resume bucket** — the fetch row excepted | **Informational** | neither bucket is dispatched this run, so nothing in it can decide the verdict (step 2's scoping rule). For a resume issue, name the re-entry: its finding becomes blocking if that PR closes unmerged |

**A blocked subtree never suppresses the rest of the run.** `milestone-workflow` excludes it and runs around it, so this skill must not answer NO-GO where the real runner would execute eleven of twelve issues. Report each blocked issue with the descendants it takes with it, drop that subtree from the waves and the projection, and give the verdict on what remains.

- **GO** — the runnable set is clean and nothing is excluded.
- **GO WITH FINDINGS** — the run proceeds, but something is excluded, contradicts its band, or is unenforceable.
- **NO-GO** — a NO-GO row above is present *anywhere in the runnable set*, including on a subtree unrelated to the blocked one (an independent cycle still forces NO-GO alongside a merely-blocked subtree), **or** the step 1 fetch was incomplete, **or** the exclusions empty the runnable set so there is nothing left to run. A finding confined to the skip or resume bucket never produces this verdict.

Then the per-issue table, one row per build-bucket issue: `# | C | Depends on | Runs after | Build | Effort | Validate | fableplan | Plan | 1st review`. Mark inferred values and flag missing ones — this table is what the run will execute.

### 6. Hand off

**Route each finding to a skill whose documented write scope actually covers it** — every finding class this audit emits has exactly one owner, and handing a finding to a skill that cannot clear it leaves a NO-GO that never lifts:

- **Execution-block findings** (ordering fields, build model, effort, validate effort, fableplan, plan effort, a missing `## Execution` block) → `execution-plan-review`. That is its whole revision vocabulary, and it edits *only* the intended Execution block lines.
- **Body-content findings** (missing acceptance criteria, missing problem statement, a missing or wrong `[C<score>]` title prefix, a missing or contradictory complexity rationale line) → `validate-issue`, which owns the issue body and title: it edits both, sets or corrects the `[C<score>]` prefix and the rationale line, and stacks the attribution footer. `execution-plan-review` cannot clear any of these — it does not touch body prose.

Then offer exactly the next actions the verdict supports, and let the user pick:

- **Execution-block findings present** → `execution-plan-review` to apply those fixes (it owns that write-back).
- **Body-content findings present** → `validate-issue` on each affected issue. Name the issues; do not fold these into the `execution-plan-review` offer.
- **Verdict is GO / GO WITH FINDINGS** → `milestone-workflow` to run it. Say plainly that `milestone-workflow` presents its own mandatory run plan before dispatching, so approving here is not yet approving the run.
- **Blocked subtrees excluded** → still offer the run, on the reduced set. Name what it leaves out and why in one line, and offer to re-run the milestone once the blocking PR merges or the decision lands — the same offer `milestone-workflow` makes for the same case.
- **NO-GO** → name the single blocking item to resolve first. Never offer the run.

Do not launch either one unprompted. If the user says run it despite findings, restate the highest-severity finding in one sentence, then hand off — their call.

## What this skill does not do

| Not this | Whose job |
|---|---|
| Editing Execution block lines | `execution-plan-review` (its write scope stops there) |
| Editing issue body prose or the title's `[C<score>]` prefix | `validate-issue` |
| Building tracks and dispatching the pipeline | `milestone-workflow` |
| Verifying an issue's claims against the code | `validate-issue` (the pipeline runs it per issue at dispatch time) |
| Deciding whether an issue is well-scoped or too large | `validate-issue` step 6.5 |
| Writing the plan for one issue | `fableplan` |

Milestone-level readiness is the whole scope. Per-issue correctness belongs to the validation pass that runs immediately before each issue builds — do not duplicate it here, and do not report its absence as a finding.

## Failure modes

| Situation | Do this |
|---|---|
| No milestone named, several open | List them with open/closed counts and ask which |
| Milestone has no open issues | Report it as complete; there is nothing to plan |
| A **runnable** issue has no Execution block | Blocking finding — the pipeline's prep step would fall back to conservative defaults and silently route it wrong |
| A **closed or resume-bucket** issue has no Execution block | Informational — prep never reads it. Never NO-GO on it, or one pre-convention issue permanently blocks the re-runs the skip bucket exists for. For a resume issue, add that the finding returns as blocking if its PR closes unmerged |
| Ordering fields missing but prose implies edges | Infer for the wave derivation, label every inferred edge, and recommend that `execution-plan-review` stamp them |
| A referenced issue lives in another repo | Resolve with `-R owner/repo`; if unreachable, report it as a blocking unknown rather than dropping the edge |
| Cycle found among runnable issues | NO-GO; show the full path and the edge kinds forming it |
| Cycle found, but it routes through a closed or resume-bucket issue | Informational — that node never enters `tracks`, so the runner sees no cycle. Show the path; it is still a filing defect |
| Fetched issue count equals `--limit` | Indistinguishable from truncation — re-fetch at a higher limit until a fetch returns strictly below its own limit; only then is completeness proven |
| Fetched count is below the milestone's `open_issues + closed_issues` | Not a finding on its own — those counters include PRs assigned to the milestone while `gh issue list` does not. Never NO-GO on that gap |
| Milestone is closed | Still auditable — the milestones call needs `state=all`, or a closed milestone returns no record at all |
| The single open-PR query errors, throttles, or hits its limit | Blocking unknown — never fall through to classifying every issue as build, which would open duplicate PRs |
| A closed predecessor's merge state can't be resolved | Blocking unknown naming the issue and PR — never assume unsatisfiable, which would exclude a healthy subtree on a re-run |
| A closed predecessor's closing PR lives in another repo | Look it up with `gh pr view <n> -R <owner>/<repo>` from the reference's own `repository`; a bare `gh pr view <n>` would decide the edge from an unrelated same-numbered local PR. Unreadable repo → blocking unknown, never a verdict |
| A closed predecessor was closed `NOT_PLANNED` but its closing PR merged | Satisfied edge — merge state decides, not the close reason |
| An ordering-only edge points into the resume bucket | Informational, not blocked — the pre-pipeline `fix-pr-review-loop` satisfies it; report the sequencing |
| An ordering-only edge points at a closed predecessor whose PR never merged | Satisfied, not excluded — a closed issue is dropped from the plan, so there is no work left to overlap |
| Finding is body content (acceptance criteria, problem statement, `[C..]` prefix) | Route to `validate-issue`, not `execution-plan-review` — the latter only edits Execution block lines |
| A build-bucket issue hard-depends on a resume- or skip-bucket issue | Not a NO-GO — exclude that issue and its hard descendants, report them under *Blocked*, and give the verdict on what still runs |
| Every build-bucket issue ends up excluded | NO-GO — the exclusions left nothing runnable |
| An issue is stamped a model above its band | Finding, same as below-band — unexplained is a defect, annotated is a deliberate override |
| User asks to skip straight to running | Give the verdict first — one line is enough — then hand off; never suppress a NO-GO |
| Findings are all deliberate overrides | GO. Say so explicitly, so annotated decisions are not re-litigated every run |
