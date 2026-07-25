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
gh api "repos/{owner}/{repo}/milestones?state=all&per_page=100" --paginate --jq '.[] | "\(.title) [\(.state)] — open:\(.open_issues) closed:\(.closed_issues)"'
gh issue list --milestone "<title>" --state all --limit 500 --json number,title,state,body,labels,stateReason,closedByPullRequestsReferences
```

Pass `state=all` on the milestones call: that endpoint defaults to open milestones only, so a closed milestone would otherwise return no record and silently become unauditable. **`--paginate` with `per_page=100` is equally load-bearing** — that endpoint returns 30 per page by default, so a repo with more milestones would silently show a subset and a milestone named by the user would read as not found. (Measured on `rust-lang/rust`: the bare call returns 30, `per_page=100` returns 100, `--paginate` returns all 140.) This is the same completeness discipline the issue fetch below insists on; the milestone list does not get an exemption.

**Prove the fetch was complete before auditing anything — from the fetch itself, never by comparing counts across endpoints.** `--limit` caps the page, so:

- A returned count **strictly below** the limit means the fetch is complete. Proceed, and print no truncation caveat.
- A returned count **equal to** the limit is indistinguishable from truncation. Re-fetch at a higher limit; if the higher fetch returns more, keep raising until a fetch comes back strictly below its own limit.
- Only when no limit yields a fetch below its own limit is the issue set an unproven unknown: report it as a **blocking unknown** and return **NO-GO**. Never emit a verdict over a possibly-partial milestone, never present a count equal to the limit as the complete milestone, and never absorb a shortfall on the grounds that the missing issues looked like leaves.

**Do not gate this on the milestone object's `open_issues` / `closed_issues`.** Those counters and `gh issue list` do not measure the same set — GitHub counts pull requests assigned to the milestone as issues, while `gh issue list` returns issues only, so a healthy, fully-fetched milestone that carries any PR reads as short by exactly the number of PRs it holds. (Measured on `rust-lang/rust`'s `1.0 beta` milestone: counters report 80, `gh issue list` returns 79, and one PR is assigned to it.) This pipeline's resume bucket exists precisely because milestones carry open PRs, so that divergence is the normal case here, not an edge case. Report the counters as context if useful; never let them trigger a NO-GO.

Strip `\r` from fetched bodies (the API returns CRLF) before parsing. Parse each issue's `[C<score>]` title prefix, complexity rationale line, and `## Execution` block into a record: score, `Depends on`, `Runs after`, build model, effort, validate effort, fableplan, plan effort, PR review line.

**Parse, never infer, when the field is present.** An explicit `none` is authoritative. Record an absent field as *missing* and carry that distinction into every later step — "missing" and "none" are different cells, and they produce different findings.

**Fetch every referenced issue that is not already in the milestone set — recursively, with the fields later steps consume.** Collect the distinct issue numbers named in every `Depends on` / `Runs after` (and any prose-inferred edges later labeled as such), drop those already fetched, and look up the rest in bounded batches — one request per ~50 numbers, never a repo-wide list. Each fetched issue's own Execution block may name further predecessors, so **repeat until no new numbers appear** (the same recursive close `execution-plan-review` uses):

```
gh issue view <n> --json number,title,state,stateReason,milestone,body,closedByPullRequestsReferences
```

Or the batched GraphQL equivalent (`issue(number:N){ number title state stateReason milestone{ title number } body closedByPullRequestsReferences{ number repository{ nameWithOwner owner{ login } name } } }`), aliased like the closing-PR lookups. Same-repo only here; a cross-repo issue reference still uses `-R <owner>/<repo>` per the failure-mode row below. A returned issue outside this milestone is a **cross-milestone predecessor** — use its `state`, `milestone`, `body`, and `closedByPullRequestsReferences` for the readiness and merge-state rows, never treat absence-from-the-milestone-fetch as "does not exist". A number that returns nothing is a genuinely nonexistent reference. A lookup that errors, throttles, or cannot be completed is a **blocking unknown** — never score it as nonexistent (that would NO-GO a healthy cross-milestone edge) and never invent a merge verdict from an unfetched `closedByPullRequestsReferences`. The request count is bounded by the size of the closed dependency closure reachable from this milestone's issues, not by repository size.

Then classify each issue into the same three buckets `milestone-workflow` uses, so the two skills agree on what a run would actually touch: **build** (open, no PR), **resume** (open with an open PR that closes it), **skip** (closed).

**Fetch the repo's open PRs once, then match locally** — never one search per issue:

```
gh pr list --state open --limit 500 --json number,title,body,headRefName
```

A per-issue `gh pr list --search "<issue number>"` costs one search request per issue (up to 500 at the limit above) against the search endpoint, which is rate-limited far more aggressively than the plain list. Request count must not grow with the milestone's size.

**Use GitHub's own linkage first and the keyword scan as the fallback — not the other way round.** `closedByPullRequestsReferences`, already fetched with the issues above at no extra request, is the linkage GitHub itself acts on at merge time, and it covers *both* ways a PR gets attached: a closing keyword in the body, **and** a PR linked by hand through the Development sidebar with no keyword anywhere in the text. A keyword-only scan misses the second form completely, leaving an issue that already has an open PR in **build** — the duplicate-PR outcome the resume bucket exists to prevent. That form is real, not hypothetical: measured on `cli/cli`, open issue `#13968` is linked to open PR `#13969` whose body carries no closing keyword for it, so the regex alone would classify it as build.

**Establish "open" by intersecting with the open-PR list — the field carries no PR state.** As this step says below, `closedByPullRequestsReferences` names the PRs that close each issue but **not** whether they are open or merged. So: an issue is **resume** when any of its same-repo reference numbers appears in the open-PR list fetched above (match on `number`). A same-repo reference whose number is *not* in that list is not open; do not treat it as resume from the field alone — fall through to the keyword scan. A **cross-repo** reference cannot be decided by the local list — resolve it with the same targeted lookup this step already publishes for cross-repo closing PRs (`gh pr view <n> -R <owner>/<repo> --json number,state,mergedAt`, taking the repo from the reference's own `repository`). `state: OPEN` → **resume**; any other resolvable state → not resume from that reference. A repository the token cannot read, or a lookup that errors/throttles, is a **blocking unknown**, never assumed open and never assumed closed: assuming open would send a dead PR into `fix-pr-review-loop`, and assuming closed would collapse back to the keyword scan the sidebar-linkage rule exists to replace. These lookups are bounded by the number of *cross-repo* linked references, not by milestone size. Then scan the fetched open-PR bodies with the pattern below for anything the field did not report.

**Match every closing keyword GitHub itself recognizes** — all nine, case-insensitive: `close`, `closes`, `closed`, `fix`, `fixes`, `fixed`, `resolve`, `resolves`, `resolved`. Recognizing only a subset silently drops a real closing relationship: a PR body reading `Fixed #12` would land that issue in **build**, putting an issue that already has an open PR into both the wave plan and the cost projection.

Anchor the pattern so it stays precise:

```
(?i)\b(close[sd]?|fix(?:es|ed)?|resolve[sd]?)\s+(?:([\w.-]+/[\w.-]+)#|#)(\d+)\b(?!\d)
```

Group 2 is the optional `owner/repo` prefix; group 3 is the issue number. **A closing reference counts only when it names this repository** — bare `#12` (no group 2) counts, and `owner/repo#12` counts only when group 2 equals this repo's `{owner}/{repo}`; a foreign `otherorg/other#12` must be discarded, never used to classify a local issue as resume. The trailing boundary keeps `#12` from matching `#123`. The keyword alternation is non-capturing on purpose so those group numbers stay stable. A bare mention with no keyword is not a resume-bucket PR; only a closing relationship is.

**A failed lookup is not "no PR found."** If the single query errors, is throttled, or returns a truncated page (same limit rule as above), stop and report it as a **blocking unknown** — do not fall through to classifying every issue as build. That misclassification is exactly what would send an already-open PR back through a fresh build and open a duplicate, which is the case `milestone-workflow` step 1's resume bucket exists to prevent.

**Resolve the merge state of every closed predecessor a runnable issue hard-depends on — the severity table turns on it, so it has to be fetched, not assumed.** Step 2c distinguishes a predecessor closed *with* a merged PR (a satisfied edge, no finding) from one closed *without* (unsatisfiable, excluded), and neither the issue list nor the open-PR query above can tell those apart on its own. `closedByPullRequestsReferences` (fetched with the issues above) names the PRs that close each issue but **not** whether they merged. Resolve exactly the PRs the verdict needs: collect the **distinct closing PR numbers** across the closed predecessors that build-bucket issues hard-depend on, and look them up in one batched GraphQL query — one alias per PR, chunked at ~50 aliases per request:

```
gh api graphql -F owner='{owner}' -F repo='{repo}' -f query='query($owner:String!,$repo:String!){ repository(owner:$owner,name:$repo){
  pr101: pullRequest(number:101){ number state mergedAt }
  pr108: pullRequest(number:108){ number state mergedAt } } }'
```

**No fetch in this step grows with the repository's history.** A repo-wide `gh pr list --state merged`, raised until it proves itself complete, reads as one request but pulls every merged PR the repository has ever had, bodies included — merged PRs accumulate monotonically, so on an established repo that is thousands of paginated requests, and a repo whose history outruns the escalation would turn "too much history" into NO-GO on a perfectly healthy milestone. The set the verdict actually needs is bounded and known: the distinct closing PRs on the milestone's own hard-edge closed predecessors, never larger than the issue list already fetched. The aliased query above spends one request per ~50 of them, whatever the repository's age — a milestone is never declared unrunnable because the repository has too many merged pull requests. A GraphQL error, a throttle, or a missing PR node in the response is an **indeterminate** edge under the rule below — never silently "unsatisfiable", and never a reason to fall back to a repo-wide list.

**A cross-repo closing PR still needs its own targeted lookup**, because the batched query above is anchored to *this* repository and cannot contain it:

```
gh pr view <n> -R <owner>/<repo> --json number,state,mergedAt
```

Take `<owner>/<repo>` from the reference's own `repository` (`repository.owner.login` / `repository.name`, both returned with the issue list). `gh pr view 42` with no `-R` resolves *this* repo's PR 42, so a predecessor closed by `otherorg/repo#42` would be decided by an unrelated same-numbered local PR — worse than an error, because it returns a confident merge verdict either way: satisfied (the dependent builds against code that does not exist) or unsatisfiable (a healthy subtree excluded). A cross-repo PR in a repository the token cannot read is a **blocking unknown** under the indeterminate rule below, never a verdict from a local PR of the same number. These lookups are bounded by the number of *cross-repo* closing references, which does not grow with the milestone.

Then, per closed predecessor, from the state each lookup returned:

- A referenced PR resolving `state: MERGED` → the edge is **satisfied**. Drop it; no finding.
- `state: OPEN` → its code is not in the base branch yet. The predecessor issue is still **closed** (skip bucket), so do **not** route this through the resume-bucket rows — `milestone-workflow` drops closed issues from the plan and will not run `fix-pr-review-loop` on them. Disposition by edge kind: a **hard** edge → *Blocked — excluded* (dependent needs the unmerged code); an **ordering-only** edge → *no finding* (a closed issue leaves no work to overlap).
- `state: CLOSED` → closed **unmerged** → genuinely **unsatisfiable**; a hard dependent and its hard descendants are excluded.
- **Merge state is the deciding fact, not `stateReason`.** An issue closed `NOT_PLANNED` whose closing PR merged is still satisfied; one closed `COMPLETED` with no merged PR is not. Use `stateReason` as context in the report, never as the test.

**An empty `closedByPullRequestsReferences` is not proof that no PR closed the issue.** Every other lookup in this step refuses to read absence as evidence, and this field gets the same treatment. Two things are separately true. First, the field *does* report merged closing PRs — verified against a closed issue in this repo whose closing PR is `MERGED`, which the field returns — so an empty array is not an artifact of merged PRs being hidden from `gh`. Second, it is still not proof of the negative: an issue closed by hand after its work merged under a PR that only *mentions* it carries no reference at all. So when the array is empty on a closed predecessor a runnable issue hard-depends on, corroborate from the issue's **own timeline** before concluding anything — the cross-references GitHub recorded on the issue, bounded per issue and batchable with aliases exactly like the closing-PR lookups, so this too costs nothing that scales with the repository:

```
gh api graphql -F owner='{owner}' -F repo='{repo}' -F after=null -f query='query($owner:String!,$repo:String!,$after:String){ repository(owner:$owner,name:$repo){
  i42: issue(number:42){ timelineItems(first:100, after:$after, itemTypes:[CROSS_REFERENCED_EVENT]){ pageInfo{hasNextPage endCursor}
    nodes{ ... on CrossReferencedEvent { source { ... on PullRequest { number state mergedAt body repository{ nameWithOwner } } } } } } } }'
```

When `hasNextPage` is true for an issue, re-query **that issue** with `-F after="<endCursor>"` until the page ends — the query takes `$after` so the paging instruction is executable. Alias-batch the first page across several issues when useful; once any alias needs a further page, page that issue alone with its own cursor rather than inventing a shared one.
- A merged PR among the cross-references that closes it by keyword (the pattern above, run over the returned `body`) → **satisfied**; the reference simply was never recorded.
- A merged PR that only mentions it → **satisfied**, reported as informational with the PR named — the code is in the base branch either way, and this is the one case where a bare mention carries weight.
- Nothing in a **complete** cross-reference sweep names a merged PR → "closed with no PR" is now *established* rather than inferred, so the hard-edge exclusion stands. Complete means paged to the end: when `hasNextPage` is true, keep paging with `endCursor` — the same completeness discipline as every fetch above.
- A sweep that errored, throttled, or could not be paged to completion → **indeterminate**, i.e. a blocking unknown. Never exclude a subtree on an absence you could not verify.

**Never resolve an undecidable merge state to the blocking branch.** If a PR lookup errors or throttles, the edge is *indeterminate*: report it as a **blocking unknown** with the issue and PR numbers, rather than quietly excluding a healthy dependent. On a partially-completed milestone re-run — the case the skip bucket exists for — guessing "unsatisfiable" would exclude every merged-predecessor subtree and could return NO-GO on a milestone `milestone-workflow` would run to completion.

### 2. Audit each issue

Four independent checks per issue. Collect findings; do not stop at the first one.

**Audit every issue in the milestone, but derive severity from the bucket the finding's owning issue sits in.** The audit itself stays milestone-wide — bucket membership is not decidable without the whole set, and a closed or resume issue is still a predecessor whose merge state a runnable issue's edge turns on. Severity is the part that scopes, because the projected run only ever *dispatches* the runnable build bucket:

- **Runnable build-bucket issue** → severity exactly as step 5's table assigns it.
- **Skip bucket (closed)** → **informational**, never blocking. `milestone-workflow` step 1 drops closed issues from the plan, and prep reads only the issues that appear in `tracks` (`workflows/milestone-pipeline.js` builds its issue list from the tracks it was handed), so nothing in a closed issue's Execution block is ever read. One pre-convention closed issue must not NO-GO the partially-completed re-run the skip bucket exists to make possible.
- **Resume bucket** → **informational**, with the re-entry named. Its PR runs through `fix-pr-review-loop` *outside* the pipeline, so its Execution block is not read this run either — but if that PR closes unmerged the issue returns to the build bucket, where the same finding becomes blocking. Say that in the report rather than dropping the finding: it is deferred, not resolved.
- **Blocked — excluded build-bucket issue** → **Informational** for any finding that would be **NO-GO** on a runnable issue (deferred — becomes blocking once the blocker clears and the issue re-enters the runnable set). Stamp/band contradictions and other Non-blocking findings keep **Non-blocking** so step 6's recommendations still land. Never NO-GO this run on a finding owned only by an excluded issue — that class reaches a row; it does not vanish and it does not block the remaining runnable set.

**An edge finding has two endpoints, and its owner is the endpoint this run would dispatch.** A hard edge from a runnable issue into the resume bucket, to a closed-unmerged predecessor, or to an open cross-milestone prerequisite is a finding *about the runnable dependent* — the issue that would otherwise build against code that is not in the base branch — so it takes the dependent's bucket, never the predecessor's. Reading the predecessor as "the finding's issue" would demote exactly the *Blocked — excluded* rows that exist because the predecessor sits outside the build bucket, and release a dependent the run would then dispatch against missing code. Only a finding owned by a skip- or resume-bucket issue demotes: a single-issue finding on such an issue, or an edge whose *dependent* endpoint sits in skip or resume. A hard edge whose two endpoints both sit in the build bucket is ordering the waves already handle — no finding exists there for the demotion to touch.

The one milestone-wide exception is the step 1 fetch itself: an incomplete fetch stays NO-GO regardless of buckets, because bucket membership is exactly what an incomplete fetch makes undecidable.

**(a) Completeness.** Missing `## Execution` block; missing `Depends on` / `Runs after`; missing acceptance criteria or problem statement; a `[C<score>]` prefix absent from the title; a missing complexity rationale line; a stale model name that no longer routes — meaning a name the pipeline's prep mapping cannot place at all, such as a non-Anthropic model. An older Opus spelling is *not* stale: prep maps any Opus name to `opus` (`workflows/milestone-pipeline.js` says "Opus 5" (any Opus)→opus), so only a genuinely unmappable name qualifies.

**(b) Band conformance.** Recompute the expected routing from the issue's own score and compare against what is stamped. The canonical formula lives in `validate-issue` step 6; the bands are:

**Derive both axes from the score — do not wait for the rationale line to publish them.** `validate-issue` defines the score as `25 × Capability + Volume` with `Volume ≤ 24`, so the `[C<score>]` prefix already parsed in step 1 fully determines `Capability = floor(score / 25)` and `Volume = score mod 25`. Every routing field the score determines is recomputed from the score. A missing rationale line is its own completeness finding; it never suppresses the effort check, because there is nothing left to look up. When the rationale line *does* publish a Volume that disagrees with `score mod 25`, that contradiction is itself a finding — the two cannot both be right. With no `[C<score>]` prefix at all nothing is derivable, and only the completeness finding stands.

| Capability | Score | Build model | fableplan | Effort from Volume (0–7 / 8–15 / 16–24) |
|---|---|---|---|---|
| 0 | 0–24 | Sonnet-class | No | high / high / xhigh |
| 1 | 25–49 | Opus-class | No | high / high / xhigh |
| 2 | 50–74 | Opus-class | **Yes** | high / high / xhigh |
| 3 | 75–99 | Fable 5 | No (planning inherent) | medium / high / xhigh (discretionary low) |

**The band is a floor, not a ceiling.** `validate-issue` step 6 states there are no hard ceilings — the band *is* the floor — for model and for every other band-determined field, including build effort. An under-band build model (below what the score prescribes) is a finding — the issue is under-powered. An under-tertile **build** effort is a finding — raise it. An over-band build model or an over-tertile build effort is an **observation**, never a downgrade recommendation: quiet overspend is still worth naming on a non-safety issue, since this skill's per-model mix is what estimates the run's cost, so report it under *Over-band observations* — but do not tell the user to weaken the stamp. Safety carve-outs (money, data integrity, security, auto-protective) remain absolute overrides in consumers that already have them — they force the capable path when flagged even if Risk was under-scored. Never recommend dropping the model **or** the build effort on an issue whose body touches those surfaces, annotated or not — that is exactly the carve-out's purpose, and `execution-plan-review` warns against the same downgrade (it pushes back only on effort that is too *low*). Over-band is also common by construction: `workflows/milestone-pipeline.js` defaults any issue with no Execution block to `model fable, effort high`.

Flag: an under-band build model; `fableplan: Yes` outside Capability 2; `fableplan: No` on a Capability-2 issue **whose build model is not already Fable 5** (a Cap-2 issue deliberately stamped Fable 5 has planning inherent — the same "No (planning inherent)" the band table records for Capability 3 — so do not recommend adding a fableplan stage in front of a Fable build, while Cap-2 + Opus with `fableplan: No` stays a finding); a **build** effort *below* the Volume tertile derived from the score (never above — over-tertile is an observation under *Over-band observations*; Validate effort and Plan effort are judged by their own rules below, never this tertile — and a Fable build stamped `low` is the discretionary Fable-only tier only when Volume ≤ 7, i.e. scores `[C75]`–`[C82]`, one tier below that band's `medium` floor: never flag those, but a Fable `low` on a higher Volume is under-tertile and stays a finding); a rationale line whose published Volume disagrees with `score mod 25`; Validate effort that breaks its own rules — vocabulary is only `medium | high` (never `xhigh`, and `low` is outside the vocabulary: the prep schema maps `low→medium` with no runtime log, so the stamp lies about what runs), default is high, and `medium` is on-rule only for Capability 0 with Volume ≤ 7 (so a `[C90]` at `medium` is off-rule); a non-Fable build stamped `low`/`medium` (the pipeline raises these to `high` and **logs** the normalization — say so, since the stamp lies about what will run); a `Plan effort` on a `fableplan: No` issue (inert — never read); a `fableplan: Yes` issue with no `Plan effort` (defaults to high, which is fine — report as informational, not a finding).

**Distinguish an override from a slip.** A body that explicitly records a deliberate departure ("deliberate override — C75 is Capability 3, where the band prescribes Fable 5") is a decision, not drift: report it under *Deliberate overrides*, never as a defect. An unexplained under-band departure is a finding. An unexplained over-band departure — model or build effort — is an observation, not a defect and never a recommendation to downgrade. This distinction is the point of the check — a milestone where every deviation is annotated is healthy; one where they are silent is not.

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
Concurrency: <n> (widest wave — peak parallel agents)
Run size: <planned> planned / <ceiling> retry-aware / <worst> review worst case direct agents
  assumes reviewLoop:<v> · reviewMode:<v> · maxReviewCycles:<n> — agent threshold: <n>, <source> · token Large-workflow at 1.5M
  plus <n> resume-bucket fix-pr-review-loop agents, outside those sums
Per-model mix: Fable 5 × <n> · Opus × <n> · Sonnet × <n> · session(prep) × <n>  (from the attribution table; mode-named)

Blocking (must fix before running):
- #N — <finding> → <recommended fix>

Blocked — excluded from the run (the rest still runs):
- #N — <why> → also excludes #a #b (hard descendants) → unblocks when <PR #X merges | decision>

Non-blocking (run is still valid):
- #N — <finding> → <recommended fix>

Informational (cannot affect this run):
- #N — <finding> → <why this run never reads it | what would make it blocking>

Over-band observations (not defects, never downgrade recommendations):
- #N — <stamped model or build effort> against a Capability-<n> / Volume tertile → <what it costs, why it may be intended>

Deliberate overrides (recorded in the issue, not defects):
- #N — <what and why>
```

**Every severity the table below can assign has a section above, and the mapping is fixed:** a **NO-GO** row prints under *Blocking*, **Blocked — excluded** under its own heading, **Non-blocking** and **Informational** under theirs, and a *no finding* row prints nowhere by definition. A severity with no section is a finding that silently vanishes — which is exactly what would happen to every bucket-demoted finding without the *Informational* heading, against step 2's requirement that a demoted resume finding be reported rather than dropped.

**Verdict rules.** Every finding class maps to exactly one severity, and that severity matches what `milestone-workflow` would actually *do* with the same milestone — never blocking a run it would happily execute, never green-lighting an edge it would reject:

| Finding | Severity | Because |
|---|---|---|
| A cycle across the union of both edge kinds, every issue in it runnable | **NO-GO** | `milestone-workflow` step 1 rejects it — no track order exists |
| A cycle routed through a skip-, resume-, or *Blocked — excluded* issue | **Informational** | that node never enters `tracks`, and its edges are disposed of by the cross-bucket rules — no cycle reaches the runner. Show the path anyway; it is a filing defect |
| A **runnable** issue with no `## Execution` block | **NO-GO** | the pipeline's prep step routes it on conservative defaults (`fable`/`high`) instead of what the issue intends |
| A reference that does not resolve to an existing issue, or an unreachable cross-repo issue, on an edge a **runnable** issue holds | **NO-GO** | that edge's disposition is undecidable, so no bound is trustworthy |
| A fetch that did not cover the whole milestone (step 1) | **NO-GO** | the verdict would be computed over a partial issue set |
| The open-PR query errored, throttled, or returned a truncated page (step 1) | **NO-GO** | bucket classification is unreliable — falling through to build would open duplicate PRs |
| A linked closing-PR reference's openness could not be established after the step-1 lookup (unreadable cross-repo, or the targeted `gh pr view -R` errored/throttled) | **NO-GO** | resume-vs-build is undecidable; assuming either direction misroutes the issue |
| Merge state of a closed predecessor a **runnable** issue hard-depends on could not be determined | **NO-GO** | the distinction the rows below turn on is undecidable, and guessing would exclude a healthy subtree |
| A hard edge into the resume bucket (predecessor's PR still open) | **Blocked — excluded** | step 1 excludes the dependent plus its hard descendants as *blocked pending merge of PR #X* and runs everything else |
| An **ordering-only** edge into the resume bucket | **Informational** | step 1 runs that PR's `fix-pr-review-loop` to completion before the pipeline starts, which satisfies it — name the sequencing, do not block |
| A **hard** edge to a predecessor closed with **no** PR, or with one closed unmerged | **Blocked — excluded** | step 1 excludes it as *blocked pending decision* — unsatisfiable as filed, and merge state decides that, not `stateReason` |
| A **hard** edge to a closed predecessor whose closing PR is still **open** | **Blocked — excluded** | the predecessor's code is not in the base branch; the predecessor is skip-bucket (closed), so do not route through resume / `fix-pr-review-loop` |
| An **ordering-only** edge to that same predecessor — closed with no PR, with one closed unmerged, **or** with a closing PR still open | *no finding* | a closed issue is dropped from the plan, so no work is left to overlap and the constraint is already met |
| An open **hard** cross-milestone prerequisite | **Blocked — excluded** | the predecessor's code does not exist yet, and step 1 rejects out-of-milestone references |
| An open **ordering-only** cross-milestone prerequisite | **Non-blocking** | it cannot be expressed in `tracks`, so the constraint simply goes unenforced — say so, and recommend either waiting for it or dropping the edge |
| An out-of-milestone referenced issue could not be fetched (errored, throttled, or incomplete) | **NO-GO** | existence/state/milestone are undecidable; never score an unfetched reference as nonexistent |
| A predecessor closed **with** a merged PR (resolved in step 1 from the targeted closing-PR lookups) | *no finding* | the edge is satisfied; the base branch has the code |
| A self-reference on a runnable issue | **NO-GO** | a degenerate cycle — no edge from an issue to itself can be ordered, and `milestone-workflow` step 1 rejects cycles across the union |
| `Depends on` / `Runs after` missing, and the prose gestures at a dependency but does not establish the edge **kind** | **NO-GO** | step 1 refuses to guess hard-vs-ordering and sends it to plan review, and the two kinds produce different waves — this row is only the ambiguous-kind case, never a satisfied empty graph |
| `Depends on` / `Runs after` missing, edges inferable from the prose | **Non-blocking** | label every inferred edge; `milestone-workflow` step 1 infers the same way and runs |
| `Depends on` / `Runs after` missing, and the prose implies **no** edge of that kind | **Non-blocking** | `milestone-workflow` step 1 infers nothing and runs — a satisfied empty graph, not an undecidable kind; recommend `execution-plan-review` stamp `none` |
| A runnable issue missing acceptance criteria or a problem statement | **Non-blocking** | the run proceeds, but the per-issue validate and review agents lose the contract they check against — route to `validate-issue` |
| A runnable issue with no `[C<score>]` title prefix | **Non-blocking** | prep records complexity 0 and the band check becomes underivable for that issue; the Execution block's own stamps still drive the run |
| A runnable issue with no complexity rationale line | **Non-blocking** | every routing field is recomputed from the score prefix, so the run loses nothing but the published reasoning — body content, route to `validate-issue` |
| A rationale line whose published Volume contradicts `score mod 25` | **Non-blocking** | the two cannot both be right, but the run executes the Execution block's stamps either way — body content, route to `validate-issue` |
| A predecessor listed in both `Depends on` and `Runs after` | **Non-blocking** | the union takes the hard edge, which subsumes the ordering one — redundant, not wrong |
| A duplicate entry within one edge list | **Non-blocking** | it dedupes to the same graph |
| A stamp contradicting its band (an under-band build model, a build effort *below* its Volume tertile, `fableplan` set against its Capability band, or a Validate effort off its own medium-or-high rules), an inert field (a `Plan effort` stamped on a `fableplan: No` issue), a stale build model name that no longer maps, or a stamp that lies about what will run (a non-Fable build stamped `low`/`medium`, or `Validate effort: xhigh` — the runtime **logs** those two normalizations to `high`; a Validate-effort `low` is mapped `low→medium` by the prep schema with no runtime log) | **Non-blocking** | the run proceeds; only the paperwork is wrong. A stale model name belongs here because prep's output schema forces one of the four model ids, so an unmappable name gets coerced to whichever of the four the prep agent picks — unpredictably, since the `fable` default applies only to a missing Execution block, which has its own NO-GO row — and the stamp misreports what will actually run |
| **Any row above whose owning issue sits in the skip or resume bucket** — the fetch row excepted, and never a cross-bucket edge row: an edge finding is owned by its runnable dependent (step 2's ownership rule), which *is* dispatched | **Informational** | a finding owned by a skip- or resume-bucket issue cannot decide the verdict — neither bucket is dispatched this run (step 2's scoping rule). For a resume issue, name the re-entry: its finding becomes blocking if that PR closes unmerged |
| **Any NO-GO-class finding whose owning issue sits in a *Blocked — excluded* subtree** — Non-blocking stamp/band findings on those issues stay Non-blocking (step 6 still recommends) | **Informational** | the issue is not dispatched this run (step 2's excluded scoping rule). Name the re-entry: the finding becomes blocking once the blocker clears and the issue re-enters the runnable set |

Two classes from step 2 deliberately have no row of their own, because they resolve through rows that are already here: an issue whose hard predecessors all sit in a **later** milestone is the open-hard-cross-milestone row, and an issue that is **closed but still carries open dependents** is reported through those dependents' own closed-predecessor edge rows — the finding lands on the issues that are actually runnable, not on the closed one.

An **over-band build model or over-tertile build effort is not in this table at all**, by construction: both are observations under step 2(b)'s floor rule, printed under *Over-band observations*, and neither ever carries a severity or a downgrade recommendation.

**A blocked subtree never suppresses the rest of the run.** `milestone-workflow` excludes it and runs around it, so this skill must not answer NO-GO where the real runner would execute eleven of twelve issues. Report each blocked issue with the descendants it takes with it, drop that subtree from the waves and the projection, and give the verdict on what remains.

- **GO** — the runnable set is clean and nothing is excluded.
- **GO WITH FINDINGS** — the run proceeds, but something is excluded, contradicts its band, or is unenforceable.
- **NO-GO** — a NO-GO row above is present *anywhere in the runnable set*, including on a subtree unrelated to the blocked one (an independent cycle still forces NO-GO alongside a merely-blocked subtree), **or** any step-1 **blocking unknown** (incomplete issue fetch, failed/throttled/truncated open-PR query, a linked reference whose openness could not be established, or an out-of-milestone referenced issue that could not be fetched), **or** the exclusions empty the runnable set so there is nothing left to run. A finding confined to the skip bucket, the resume bucket, or a *Blocked — excluded* subtree never produces this verdict.

Then the per-issue table, **one row per issue in the milestone** — the closed and resume rows are context, not work, and a closed predecessor named in a runnable issue's `Depends on` has to stay readable:

```
# | State | Bucket | C | Depends on | Runs after | Build | Effort | Validate | fableplan | Plan | 1st review
```

**Only the runnable build-bucket rows are what the run will execute.** Mark every other row so the table alone distinguishes dispatched from not — never present a closed, resume, or excluded row as pending pipeline work. Use the `Bucket` cell: `build` for runnable, `build (excluded)` for a *Blocked — excluded* subtree member (its bucket is still build, but it is not dispatched), `resume`, or `skip`. Mark inferred values as inferred and missing ones as *missing* (never blank, never a guessed default), and note that the pipeline would route a missing Execution block to `model fable, effort high`.

### 6. Hand off

**Route each finding to a skill whose documented write scope actually covers it** — every finding class this audit emits has exactly one owner, and handing a finding to a skill that cannot clear it leaves a NO-GO that never lifts:

- **Execution-block findings** (ordering fields, build model, effort, validate effort, fableplan, plan effort, a missing `## Execution` block) → `execution-plan-review`. That is its whole revision vocabulary, and it edits *only* the intended Execution block lines.
- **Body-content findings** (missing acceptance criteria, missing problem statement, a missing or wrong `[C<score>]` title prefix, a missing or contradictory complexity rationale line) → `validate-issue`, which owns the issue body and title: it edits both, sets or corrects the `[C<score>]` prefix and the rationale line, and stacks the attribution footer. `execution-plan-review` cannot clear any of these — it does not touch body prose.

Write each recommendation as one line per contradicting field, on a **build-bucket issue that is either runnable or *Blocked — excluded***: `#N — <field>: <stamped> → <recommended> (<why, derived from the score>)`. Excluded issues re-enter the runnable set once their blocker clears, so fix their stamps now rather than leaving a blank under *Non-blocking*. Field contradictions on skip- or resume-bucket issues print under *Informational*, never as change recommendations routed to `execution-plan-review` or `validate-issue` — those skills would edit a body this run never reads.

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
| Milestone has no open issues | Report it as complete; there is nothing to plan — do not emit a wall of closed-issue findings |
| A **runnable** issue has no Execution block | Blocking finding — the pipeline's prep step would fall back to conservative defaults and silently route it wrong |
| A **closed or resume-bucket** issue has no Execution block | Informational — prep never reads it. Never NO-GO on it, or one pre-convention issue permanently blocks the re-runs the skip bucket exists for. For a resume issue, add that the finding returns as blocking if its PR closes unmerged |
| A **Blocked — excluded** issue has no Execution block (or any other NO-GO-class finding) | Informational — deferred until the blocker clears; never NO-GO this run on an excluded-only finding. Stamp/band contradictions on excluded issues stay Non-blocking recommendations |
| Ordering fields missing but prose implies edges | Infer for the wave derivation, label every inferred edge, and recommend that `execution-plan-review` stamp them |
| Ordering fields missing and prose implies no edge of that kind | Non-blocking — a satisfied empty graph; recommend `execution-plan-review` stamp `none`. Never NO-GO |
| Ordering fields missing, prose gestures at a dependency but does not establish kind | NO-GO — refuse to guess hard vs ordering; same as `milestone-workflow` step 1's plan-review flag |
| A referenced issue lives in another repo | Resolve with `-R owner/repo`; if unreachable, report it as a blocking unknown rather than dropping the edge |
| Cycle found among runnable issues | NO-GO; show the full path and the edge kinds forming it |
| Cycle found, but it routes through a closed, resume-bucket, or *Blocked — excluded* issue | Informational — that node never enters `tracks`, so the runner sees no cycle. Show the path; it is still a filing defect |
| Fetched issue count equals `--limit` | Indistinguishable from truncation — re-fetch at a higher limit until a fetch returns strictly below its own limit; only then is completeness proven, and only then does the table print with no truncation caveat |
| Fetched count is below the milestone's `open_issues + closed_issues` | Not a finding on its own — those counters include PRs assigned to the milestone while `gh issue list` does not. Never NO-GO on that gap |
| Milestone is closed | Still auditable — the milestones call needs `state=all`, or a closed milestone returns no record at all |
| The single open-PR query errors, throttles, or hits its limit | Blocking unknown — never fall through to classifying every issue as build, which would open duplicate PRs |
| A closed predecessor's merge state can't be resolved | Blocking unknown naming the issue and PR — never assume unsatisfiable, which would exclude a healthy subtree on a re-run |
| A closed predecessor has an empty `closedByPullRequestsReferences` | Not proof there was no PR — sweep the issue's own cross-references for a merged PR that closes it by keyword or mentions it first. Only a *complete* sweep with none establishes "closed with no PR"; one that could not be paged to completion is a blocking unknown |
| An open issue's PR is linked through the Development sidebar with no closing keyword | Still **resume** — `closedByPullRequestsReferences` reports it; the keyword scan is only the fallback |
| The repo has more than 30 milestones | The bare milestones call returns only the first 30 — always `--paginate` with `per_page=100`, or a named milestone can read as not found |
| A closed predecessor's closing PR lives in another repo | Look it up with `gh pr view <n> -R <owner>/<repo>` from the reference's own `repository`; a bare `gh pr view <n>` would decide the edge from an unrelated same-numbered local PR. Unreadable repo → blocking unknown, never a verdict |
| A closed predecessor was closed `NOT_PLANNED` but its closing PR merged | Satisfied edge — merge state decides, not the close reason |
| An ordering-only edge points into the resume bucket | Informational, not blocked — the pre-pipeline `fix-pr-review-loop` satisfies it; report the sequencing |
| An ordering-only edge points at a closed predecessor whose PR never merged | Satisfied, not excluded — a closed issue is dropped from the plan, so there is no work left to overlap |
| Finding is body content (acceptance criteria, problem statement, `[C..]` prefix) | Route to `validate-issue`, not `execution-plan-review` — the latter only edits Execution block lines |
| A build-bucket issue hard-depends on a resume- or skip-bucket issue | Not a NO-GO — exclude that issue and its hard descendants, report them under *Blocked*, and give the verdict on what still runs |
| Every build-bucket issue ends up excluded | NO-GO — the exclusions left nothing runnable |
| An issue is stamped a model or build effort above its band / Volume tertile | Observation, never a downgrade recommendation — the band is a floor for both. Print it under *Over-band observations*; annotated, it is a deliberate override |
| A closing PR reference's openness cannot be established after `gh pr view -R` (unreadable cross-repo, or the lookup errored/throttled) | Blocking unknown → **NO-GO** — never assume open (would resume a dead PR) and never assume closed (would miss a sidebar-linked open PR). A readable cross-repo reference resolves to open or not-open via that lookup; it is not undecidable |
| A Fable build is stamped `low` at Volume ≤ 7 (`[C75]`–`[C82]`) | On-rule — the discretionary Fable-only tier one step below that band's `medium` floor. Never flag it |
| A Fable build is stamped `low` at Volume > 7 | Under-tertile finding — the discretionary tier does not waive a multi-tier drop |
| User asks to skip straight to running | Give the verdict first — one line is enough — then hand off; never suppress a NO-GO |
| Findings are all deliberate overrides | GO. Say so explicitly, so annotated decisions are not re-litigated every run |
