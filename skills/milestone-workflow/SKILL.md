---
name: milestone-workflow
description: Use when the user wants a milestone of Execution-block-stamped GitHub issues implemented via a multi-agent dynamic workflow — "create the workflow for v0", "run v0 continuously", "/milestone-workflow v0". Builds dependency tracks, presents the run plan for approval, then runs the milestone-pipeline workflow: per-issue model/effort from the Execution blocks, optional fableplan stage, PRs, and optional @claude review loops until LGTM. Stage 5–6 of the new-app-pipeline.
---

# milestone-workflow

Turn a reviewed milestone into a running multi-agent pipeline. Static plan, dependency-aware dispatch: the dependency graph is decided here with the user; execution waits for stable predecessor results and builds hard-dependent work from their reviewed code.

## Steps

### 1. Build the dependency tracks

Fetch the milestone's issues and build a typed dependency graph before grouping them into tracks.

- Read `**Depends on:**` first for hard code/product prerequisites and `**Runs after:**` for ordering-only constraints. An explicit `none` is authoritative: never infer an edge for a field that is present. For an older issue missing either field, infer only that missing edge kind from Approach/Problem prose and label every inferred edge in the plan.
- Classify an inferred code/product prerequisite as a hard edge and an inferred same-package or no-overlap constraint as an ordering edge. If the prose does not establish the edge kind, flag it for the mandatory plan review instead of guessing.
- Reject missing issue references and cycles across the union of both edge kinds. A hard edge means the successor needs predecessor code; an ordering edge only prevents overlapping work.
- Express each track as `{ issues: [...], after: [<track index>...], runsAfter: [<track index>...] }`. Dependency-free islands have neither predecessor list. Combine issues into one `issues` array only when every serial edge is truly hard; untyped serial edges are treated as hard by the workflow, so ordering-only chains must remain separate tracks joined by `runsAfter`.
- Preserve concurrency: unrelated tracks start together. Multiple hard predecessors remain separate `after` entries so the runtime can create and verify one integration base containing every head.
- Use separate workflow invocations only when repository policy requires prerequisites to merge to the default branch before successors can start.

### 2. Present the run plan — review before beginning (mandatory)

Show: numbered tracks with issue titles; hard `after` edges separately from ordering-only `runsAfter` edges; which edges were inferred; each issue's model/effort/fableplan; the stable readiness boundary; and merge-order expectations. **Do not invoke the Workflow tool until the user approves this plan** — the approval is both the safety checkpoint and the explicit multi-agent opt-in the Workflow tool requires.

State the GitHub writes the run performs, so the approval covers them explicitly: agents apply validation corrections to issue bodies, post each `fableplan: Yes` issue's implementation plan as a comment on that issue, open PRs, and (with review loops on) post review-trigger and disposition comments. Merging still stays with the user.

Add a **Run size** line before asking for approval:

- Compute the planned direct-agent baseline, assuming every issue reaches each enabled phase, as `1 prep + sum over issues of (1 validate + (fableplan ? 1 plan : 0) + 1 implement + (reviewLoop ? 1 review-loop : 0))`.
- Also compute the retry-aware direct ceiling as `planned direct-agent count + number of issues`, because each issue's validation can dispatch one retry. Show both numbers.
- Label them as planning bounds, not a total-agent guarantee: invalid issues or failures can reduce the count, while review loops can dispatch nested fix agents beyond the retry-aware ceiling. The warning counts all scheduled agents, so never label a plan safe merely because either direct count is below the threshold. `maxReviewCycles` changes the stopping rule after an LGTM; it is not a guaranteed cap while reviews keep returning `Needs Updates`.
- Compare both direct counts with the effective Dynamic workflow size guideline when one is present in session context; otherwise use Claude Code's documented default threshold of more than 25 scheduled agents. Name the threshold source in the plan so the comparison is inspectable. If the baseline crosses it, mark the warning expected; if only the retry-aware ceiling crosses it, mark the run retry-sensitive; if both stay under and review loops are enabled, state that nested fixes can still trigger the warning. The [Claude Code workflow cost documentation](https://code.claude.com/docs/en/workflows#cost) is authoritative.
- State that Claude Code can also trigger `Large workflow` when its projected token total exceeds 1.5 million. In an ultracode session, label both comparisons informational because the warning is suppressed.
- When either risk is apparent, call it out before approval and recommend splitting the milestone into separate tracked `Workflow` invocations. Disabling `reviewLoop` reduces the direct count but forfeits automatic review readiness. Lowering `maxReviewCycles` may reduce repeat work after non-blocking LGTM reviews, but never present it as a guaranteed cap.

### 3. Preflight the repo

- When review loops are enabled, `.github/workflows/claude.yml` exists (the `@claude` review bot — copy from rk-skills `templates/claude-review.yml` and confirm the API-key secret if missing). Without a review bot, set `reviewLoop: false`; implementation then opens each PR without requesting review and becomes the readiness boundary.
- Base branch protection / merge expectations understood: agents open PRs; merging stays with the user unless they've said otherwise.
- CLAUDE.md in the target repo covers conventions the agents must follow (package manager, test commands).

### 4. Run

Invoke the Workflow tool with `{name: 'milestone-pipeline', args: {tracks: [{issues:[2,3]}, {issues:[9], after:[0]}, {issues:[12], runsAfter:[0]}], reviewLoop: true, maxReviewCycles: 5}}`. Legacy issue-array tracks remain accepted, but use typed objects for new plans. The workflow validates all assignments, predecessor indices, duplicates, and cycles before prep, then:

1. **Prep** — one agent reads every issue's `[C..]` score and Execution block → per-issue model/effort/fableplan.
2. **Validate** — immediately before each issue starts, a Fable agent runs the `validate-issue` procedure against the current dependency base, with deduplicated predecessor PRs/skips and hard base refs, at the issue's `Validate effort` (default high). `INVALID` issues are skipped and reported, never built.
3. **Plan** — issues flagged `fableplan: Yes` get a Fable 5 planning agent (validation-aware) whose plan is posted to the issue; the builder implements against it.
4. **Implement** — per-issue agent on its assigned model/effort applies validation corrections, invokes `work-on-issue` with the verified hard `baseRefs`, creates a deterministic integration base for multiple heads, opens the PR, and triggers `@claude review` when review loops are enabled.
5. **Review readiness** — `fix-pr-review-loop` runs until LGTM before any hard or ordering successor starts, preventing review fixes from racing same-package work. Unrelated tracks and their review loops stay concurrent. With `reviewLoop: false`, implementation completion is the readiness boundary.
6. **Failure propagation** — failed, blocked, or non-LGTM hard predecessors block descendants. Ordering-only skips without a PR do not; an unresolved predecessor PR does. Integration conflicts block before product changes.

### 5. Monitor and close out

Relay meaningful progress (PRs opened, review loops finishing, blockers) — not raw logs. On completion, report a results table: issue → PR → review status, plus flags the agents raised. Recommend dependency order, with every hard prerequisite before its descendants. If a later phase was deferred pending merges, offer to chain the next invocation.

## Context discipline

The orchestrating session holds no implementation detail — issues and PRs are the memory. Between phases (or after compaction), everything needed to resume lives in: the milestone's issues, their Execution blocks, and the open PRs. Losing the conversation must never lose state.

## Failure modes

| Situation | Do this |
|---|---|
| An issue lacks an Execution block at run time | Stop before running; send it through execution-plan-review |
| No `@claude` review workflow in the repo | Install from templates first, or run with `reviewLoop: false` and say what that forfeits |
| A successor hard-depends on unmerged predecessor PRs | Use `after`; the workflow waits for stable heads and `work-on-issue` verifies/integrates every base before implementation |
| A same-package predecessor is ordering-only | Use `runsAfter`; the successor waits but does not inherit code |
| A dependency integration conflicts | The affected track and hard descendants stop blocked before product changes; report the conflicting heads |
| Workflow returns empty/odd results | Read the run's `journal.jsonl` before re-running; resume with `resumeFromRunId` rather than restarting |
| User asks to start without reviewing the plan | Present the plan anyway — step 2 is not skippable |
