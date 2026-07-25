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
gh api repos/:owner/:repo/milestones --jq '.[] | "\(.title) — open:\(.open_issues) closed:\(.closed_issues)"'
gh issue list --milestone "<title>" --state all --limit 500 --json number,title,state,body,labels
```

**Reconcile the fetched count against the milestone's true size before auditing anything.** The milestones call publishes `open_issues` and `closed_issues`; their sum is how many issues the milestone actually holds. `--limit` caps the page, so if the fetched count is short, raise the limit and re-fetch. If it is still short, the graph is missing issues and every downstream number — waves, critical path, run size, verdict — is computed over a partial milestone. Report that as a **blocking unknown** and return **NO-GO**: never emit a verdict over an incomplete issue set, and never absorb a shortfall silently on the grounds that the missing issues looked like leaves. A closed-heavy milestone is the trap — `--state all` fills the page with skip-bucket issues and pushes build-bucket ones off it, so the count reconciliation is what catches it, not a glance at the results.

Strip `\r` from fetched bodies (the API returns CRLF) before parsing. Parse each issue's `[C<score>]` title prefix, complexity rationale line, and `## Execution` block into a record: score, `Depends on`, `Runs after`, build model, effort, validate effort, fableplan, plan effort, PR review line.

**Parse, never infer, when the field is present.** An explicit `none` is authoritative. Record an absent field as *missing* and carry that distinction into every later step — "missing" and "none" produce different findings.

Then classify each issue into the same three buckets `milestone-workflow` uses, so the two skills agree on what a run would actually touch: **build** (open, no PR), **resume** (open with an open PR that closes it), **skip** (closed). Search for the PRs with `gh pr list --search "<issue number>" --state open` and confirm the PR actually closes the issue rather than merely mentioning it.

### 2. Audit each issue

Four independent checks per issue. Collect findings; do not stop at the first one.

**(a) Completeness.** Missing `## Execution` block; missing `Depends on` / `Runs after`; missing acceptance criteria or problem statement; a `[C<score>]` prefix absent from the title; a stale model name that no longer routes (e.g. an Opus version the pipeline's prep step no longer maps).

**(b) Band conformance.** Recompute the expected routing from the issue's own score and compare against what is stamped. The canonical formula lives in `validate-issue` step 6; the bands are:

| Capability | Score | Build model | fableplan | Effort from Volume (0–7 / 8–15 / 16–24) |
|---|---|---|---|---|
| 0 | 0–24 | Sonnet-class | No | high / high / xhigh |
| 1 | 25–49 | Opus-class | No | high / high / xhigh |
| 2 | 50–74 | Opus-class | **Yes** | high / high / xhigh |
| 3 | 75–99 | Fable 5 | No (planning inherent) | medium / high / xhigh (discretionary low) |

**Band conformance is two-sided.** A build model that departs from its score's band in *either* direction is a finding: below it (under-powered — the issue gets a model that cannot carry the work) and above it (silent overspend — a `[C10]` issue stamped Fable 5 audits clean while buying the most expensive model in the fleet). Since this skill's per-model mix is what estimates the run's cost, quiet overspend has to surface too. Over-band is common by construction, not theoretical: `workflows/milestone-pipeline.js` defaults any issue with no Execution block to `model fable, effort high`. Report a Capability-3 issue at Fable 5 as on-band and silent, and treat an annotated over-band stamp as a *Deliberate override* rather than a defect.

Flag: a build model that departs from its band in either direction; `fableplan: Yes` outside Capability 2; `fableplan: No` on a Capability-2 issue; an effort that contradicts the Volume tertile when the rationale line publishes a Volume; `Validate effort: xhigh` (only ever medium or high); a non-Fable build stamped `low`/`medium` (the pipeline silently raises these to `high` — say so, since the stamp lies about what will run); a `Plan effort` on a `fableplan: No` issue (inert — never read); a `fableplan: Yes` issue with no `Plan effort` (defaults to high, which is fine — report as informational, not a finding).

**Distinguish an override from a slip.** A body that explicitly records a deliberate departure ("deliberate override — C75 is Capability 3, where the band prescribes Fable 5") is a decision, not drift: report it under *Deliberate overrides*, never as a defect. An unexplained departure is a finding. This distinction is the point of the check — a milestone where every deviation is annotated is healthy; one where they are silent is not.

**(c) Graph.** Resolve every referenced issue, including ones outside the milestone, until the graph closes. Flag: references to issues that do not exist; self-references; a predecessor listed in both fields; duplicates within a list; a cycle across the union of both edge kinds (show the path); an edge to an issue that is closed **without** a merged PR (unsatisfiable as filed); a hard edge into the resume bucket (its PR must merge first).

A predecessor that is closed **with** a merged PR is a *satisfied* edge, not a finding — the base branch already carries its code, exactly as `milestone-workflow` step 1 treats it. Drop the edge and say nothing.

**(d) Readiness.** Cross-milestone prerequisites that are still open — recorded separately by edge kind, because they carry different severities: an open **hard** cross-milestone prerequisite means the code does not exist yet *and* `milestone-workflow` step 1 rejects out-of-milestone references outright, while an open **ordering-only** one is merely unenforceable in `tracks`. Also flag: issues whose hard predecessors all sit in a later milestone; an issue already closed but still carrying open dependents.

Every finding this step can produce maps to exactly one severity in step 5's table — none of them falls through the rules.

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
  - `reviewMode: 'github'`: that work genuinely nests inside one `fix-pr-review-loop` agent per issue, so the `1 review-loop` term holds and the subagent worst case must **not** be applied. Name the mode that produced the number.
  - `reviewLoop: false`: the review term is zero in every bound.
- **Resume-bucket cost, reported separately.** Each resume-bucket issue runs `fix-pr-review-loop` on its existing PR (`milestone-workflow` step 1), outside the build-bucket sums entirely — but it still costs, and its agents are no more bounded by `maxReviewCycles` than the build bucket's are. Report the count and say it sits outside the totals; never fold it in silently and never omit it.
- **Thresholds.** Compare every bound against the effective Dynamic workflow size guideline when session context carries one — otherwise Claude Code's documented default of more than 25 scheduled agents. Name which threshold you used. Also state that Claude Code triggers `Large workflow` when a run's projected token total exceeds 1.5 million, so a run sitting under the agent threshold can still cross the token one. In an ultracode session, label both comparisons informational — the warning is suppressed.
- Label all of them planning bounds, not a guarantee. `maxReviewCycles` changes the stopping rule after an LGTM; it is not a guaranteed cap while reviews keep returning `Needs Updates`. Never call a run safe merely because a direct count sits under a threshold.

Report the per-model agent mix (how many agents land on Fable 5 versus Opus versus the rest), since that, not the raw count, drives what the run costs.

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
| A cycle across the union of both edge kinds | **NO-GO** | `milestone-workflow` step 1 rejects it — no track order exists |
| An issue with no `## Execution` block | **NO-GO** | the pipeline's prep step routes it on conservative defaults (`fable`/`high`) instead |
| A reference that does not resolve, or an unreachable cross-repo issue | **NO-GO** | the graph never closes, so no bound is trustworthy |
| A fetch that did not cover the whole milestone (step 1) | **NO-GO** | the verdict would be computed over a partial issue set |
| A hard edge into the resume bucket (predecessor's PR still open) | **Blocked — excluded** | step 1 excludes the dependent plus its hard descendants as *blocked pending merge of PR #X* and runs everything else |
| A hard edge to an issue closed **without** a merged PR | **Blocked — excluded** | step 1 excludes it as *blocked pending decision* |
| An open **hard** cross-milestone prerequisite | **Blocked — excluded** | the predecessor's code does not exist yet, and step 1 rejects out-of-milestone references |
| An open **ordering-only** cross-milestone prerequisite | **Non-blocking** | it cannot be expressed in `tracks`, so the constraint simply goes unenforced — say so, and recommend either waiting for it or dropping the edge |
| A predecessor closed **with** a merged PR | *no finding* | the edge is satisfied; the base branch has the code |
| A stamp contradicting its band, an inert field, a stamp that lies about what will run | **Non-blocking** | the run proceeds; only the paperwork is wrong |

**A blocked subtree never suppresses the rest of the run.** `milestone-workflow` excludes it and runs around it, so this skill must not answer NO-GO where the real runner would execute eleven of twelve issues. Report each blocked issue with the descendants it takes with it, drop that subtree from the waves and the projection, and give the verdict on what remains.

- **GO** — the runnable set is clean and nothing is excluded.
- **GO WITH FINDINGS** — the run proceeds, but something is excluded, contradicts its band, or is unenforceable.
- **NO-GO** — a NO-GO row above is present *anywhere* in the milestone, including on a subtree unrelated to the blocked one (an independent cycle still forces NO-GO alongside a merely-blocked subtree), **or** the exclusions empty the runnable set so there is nothing left to run.

Then the per-issue table, one row per build-bucket issue: `# | C | Depends on | Runs after | Build | Effort | Validate | fableplan | Plan | 1st review`. Mark inferred values and flag missing ones — this table is what the run will execute.

### 6. Hand off

Offer exactly the next actions the verdict supports, and let the user pick:

- **Blocking or non-blocking findings present** → `execution-plan-review` to apply the recommended fixes (it owns the write-back).
- **Verdict is GO / GO WITH FINDINGS** → `milestone-workflow` to run it. Say plainly that `milestone-workflow` presents its own mandatory run plan before dispatching, so approving here is not yet approving the run.
- **Blocked subtrees excluded** → still offer the run, on the reduced set. Name what it leaves out and why in one line, and offer to re-run the milestone once the blocking PR merges or the decision lands — the same offer `milestone-workflow` makes for the same case.
- **NO-GO** → name the single blocking item to resolve first. Never offer the run.

Do not launch either one unprompted. If the user says run it despite findings, restate the highest-severity finding in one sentence, then hand off — their call.

## What this skill does not do

| Not this | Whose job |
|---|---|
| Editing Execution blocks or issue bodies | `execution-plan-review` |
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
| An issue has no Execution block | Blocking finding — the pipeline's prep step would fall back to conservative defaults and silently route it wrong |
| Ordering fields missing but prose implies edges | Infer for the wave derivation, label every inferred edge, and recommend that `execution-plan-review` stamp them |
| A referenced issue lives in another repo | Resolve with `-R owner/repo`; if unreachable, report it as a blocking unknown rather than dropping the edge |
| Cycle found | NO-GO; show the full path and the edge kinds forming it |
| Fetched issue count is short of the milestone's `open_issues + closed_issues` | Raise `--limit` and re-fetch; if still short, NO-GO as a blocking unknown — never verdict over a partial milestone |
| A build-bucket issue hard-depends on a resume- or skip-bucket issue | Not a NO-GO — exclude that issue and its hard descendants, report them under *Blocked*, and give the verdict on what still runs |
| Every build-bucket issue ends up excluded | NO-GO — the exclusions left nothing runnable |
| An issue is stamped a model above its band | Finding, same as below-band — unexplained is a defect, annotated is a deliberate override |
| User asks to skip straight to running | Give the verdict first — one line is enough — then hand off; never suppress a NO-GO |
| Findings are all deliberate overrides | GO. Say so explicitly, so annotated decisions are not re-litigated every run |
