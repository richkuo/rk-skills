---
name: milestoneplan
description: Use when the user wants a milestone inspected and its run planned before any agent starts — "milestoneplan v1", "/milestoneplan", "is v1 ready to run?", "what would running v1 cost?", "check the milestone before we launch". Read-only pre-flight for milestone-workflow - audits every issue's Execution block against the complexity band formula, closes the dependency graph, derives execution waves, projects run size, and returns a go / no-go verdict. Never edits an issue and never launches the run without approval.
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
gh issue list --milestone "<title>" --state all --limit 100 --json number,title,state,body,labels
```

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

Flag: a build model below its band; `fableplan: Yes` outside Capability 2; `fableplan: No` on a Capability-2 issue; an effort that contradicts the Volume tertile when the rationale line publishes a Volume; `Validate effort: xhigh` (only ever medium or high); a non-Fable build stamped `low`/`medium` (the pipeline silently raises these to `high` — say so, since the stamp lies about what will run); a `Plan effort` on a `fableplan: No` issue (inert — never read); a `fableplan: Yes` issue with no `Plan effort` (defaults to high, which is fine — report as informational, not a finding).

**Distinguish an override from a slip.** A body that explicitly records a deliberate departure ("deliberate override — C75 is Capability 3, where the band prescribes Fable 5") is a decision, not drift: report it under *Deliberate overrides*, never as a defect. An unexplained departure is a finding. This distinction is the point of the check — a milestone where every deviation is annotated is healthy; one where they are silent is not.

**(c) Graph.** Resolve every referenced issue, including ones outside the milestone, until the graph closes. Flag: references to issues that do not exist; self-references; a predecessor listed in both fields; duplicates within a list; a cycle across the union of both edge kinds (show the path); an edge to an issue that is closed **without** a merged PR (unsatisfiable as filed); a hard edge into the resume bucket (its PR must merge first).

**(d) Readiness.** Cross-milestone prerequisites that are still open; issues whose hard predecessors all sit in a later milestone; an issue already closed but still carrying open dependents.

### 3. Derive the execution waves

Topologically sort the build bucket over the union of both edge kinds. Report:

- **Waves** — wave 1 is everything with no unmet predecessor inside the run; each later wave is what unblocks once the previous completes. This is the shape of the run, not a schedule; unrelated tracks execute concurrently.
- **Critical path** — the longest hard-edge chain, and the issue that gates the most descendants. Name it: that issue's failure or review churn stalls the widest part of the milestone.
- **Concurrency** — the widest wave, which is roughly the peak parallel agent count the run will reach.

### 4. Project the run size

Use the same accounting as `milestone-workflow` step 2 so the two never disagree:

- Planned direct agents: `1 prep + sum over build-bucket issues of (1 validate + (fableplan ? 1 plan : 0) + 1 implement + (reviewLoop ? 1 review-loop : 0))`.
- Retry-aware ceiling: `planned + number of issues` (each issue's validation may retry once).
- State both, label them planning bounds rather than a guarantee, and compare against the effective Dynamic workflow size guideline when session context carries one — otherwise Claude Code's documented default of more than 25 scheduled agents. Name which threshold you used.
- Note that review loops can dispatch nested fix agents beyond the retry-aware ceiling, so never call a run safe merely because a direct count sits under the threshold.

Report the per-model agent mix (how many agents land on Fable 5 versus Opus versus the rest), since that, not the raw count, drives what the run costs.

### 5. Present the plan and give a verdict

Lead with the verdict, then the evidence. Terse — this is a decision aid, not a report.

```
<milestone> — <GO | GO WITH FINDINGS | NO-GO>

<one line: what runs, in how many waves, at what agent count>

Buckets: <n> build · <n> resume · <n> skip
Waves: 1) #a #b  2) #c  3) #d
Critical path: #a → #c → #d (gates <n> issues)
Run size: <planned> planned / <ceiling> retry-aware direct agents (threshold: <n>, <source>)

Blocking (must fix before running):
- #N — <finding> → <recommended fix>

Non-blocking (run is still valid):
- #N — <finding> → <recommended fix>

Deliberate overrides (recorded in the issue, not defects):
- #N — <what and why>
```

Verdict rules: **NO-GO** when the run cannot proceed correctly — a cycle, a missing Execution block, an unsatisfiable dependency, a hard edge on an unmerged PR. **GO WITH FINDINGS** when everything runs but some stamps contradict their band. **GO** when clean.

Then the per-issue table, one row per build-bucket issue: `# | C | Depends on | Runs after | Build | Effort | Validate | fableplan | Plan | 1st review`. Mark inferred values and flag missing ones — this table is what the run will execute.

### 6. Hand off

Offer exactly the next actions the verdict supports, and let the user pick:

- **Blocking or non-blocking findings present** → `execution-plan-review` to apply the recommended fixes (it owns the write-back).
- **Verdict is GO / GO WITH FINDINGS** → `milestone-workflow` to run it. Say plainly that `milestone-workflow` presents its own mandatory run plan before dispatching, so approving here is not yet approving the run.
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
| User asks to skip straight to running | Give the verdict first — one line is enough — then hand off; never suppress a NO-GO |
| Findings are all deliberate overrides | GO. Say so explicitly, so annotated decisions are not re-litigated every run |
