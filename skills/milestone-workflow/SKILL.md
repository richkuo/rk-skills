---
name: milestone-workflow
description: Use when the user wants a milestone of Execution-block-stamped GitHub issues implemented via a multi-agent dynamic workflow — "create the workflow for v0", "run v0 continuously", "/milestone-workflow v0". Builds dependency tracks, presents the run plan for approval, then runs the milestone-pipeline workflow: per-issue model/effort from the Execution blocks, optional fableplan stage, PRs, and optional review loops until LGTM — in-session subagent reviewers by default, or the @claude Action in github mode. Stage 5–6 of the new-app-pipeline.
---

# milestone-workflow

Turn a reviewed milestone into a running multi-agent pipeline. Static plan, dependency-aware dispatch: the dependency graph is decided here with the user; execution waits for stable predecessor results and builds hard-dependent work from their reviewed code.

## Steps

### 1. Build the dependency tracks

Fetch the milestone's issues and build a typed dependency graph before grouping them into tracks.

- Filter for idempotency first: list the milestone's issues with `--state all` and search for open PRs that close each one. Drop closed issues from the plan. An open issue with an existing open PR is planned as a **resume** — run `fix-pr-review-loop` on that PR instead of dispatching it through the pipeline — never a fresh build, which would open a duplicate PR. Show three buckets in the run plan: build, resume, skip (closed).
- Resolve cross-bucket dependency edges before building tracks — `after`/`runsAfter` can only reference tracks in this run, so an edge from a build-bucket issue to a resume- or skip-bucket issue must be settled here, never silently dropped (the implement agent would otherwise build from the default branch and miss the predecessor's unmerged code). A predecessor whose PR **merged**: the edge is satisfied — drop it, the base branch has the code. A predecessor in the **resume** bucket: run its `fix-pr-review-loop` to completion before invoking the pipeline — that satisfies ordering-only edges; a hard edge still needs the predecessor's code, so exclude the dependent issue and its hard descendants from this run's `tracks`, report them as **blocked pending merge of PR #X** in the run plan, and offer to re-run the milestone once it merges. A predecessor **closed without a merged PR**: the dependency is unsatisfiable as filed — exclude the dependent and its hard descendants, report them as **blocked pending decision**, and ask the user whether to reopen the predecessor or re-scope the dependent.
- Read `**Depends on:**` first for hard code/product prerequisites and `**Runs after:**` for ordering-only constraints. An explicit `none` is authoritative: never infer an edge for a field that is present. For an older issue missing either field, infer only that missing edge kind from Approach/Problem prose and label every inferred edge in the plan.
- Classify an inferred code/product prerequisite as a hard edge and an inferred same-package or no-overlap constraint as an ordering edge. If the prose does not establish the edge kind, flag it for the mandatory plan review instead of guessing.
- Reject references to issues outside the milestone, and cycles across the union of both edge kinds (edges to resume/skip-bucket issues inside the milestone are resolved by the cross-bucket rules above, not rejected). A hard edge means the successor needs predecessor code; an ordering edge only prevents overlapping work.
- Express each track as `{ issues: [...], after: [<track index>...], runsAfter: [<track index>...] }`. Dependency-free islands have neither predecessor list. Combine issues into one `issues` array only when every serial edge is truly hard; untyped serial edges are treated as hard by the workflow, so ordering-only chains must remain separate tracks joined by `runsAfter`.
- Preserve concurrency: unrelated tracks start together. Multiple hard predecessors remain separate `after` entries so the runtime can create and verify one integration base containing every head.
- Use separate workflow invocations only when repository policy requires prerequisites to merge to the default branch before successors can start.

### 2. Present the run plan — review before beginning (mandatory)

Show: numbered tracks with issue titles; hard `after` edges separately from ordering-only `runsAfter` edges; which edges were inferred; each issue's model/effort/fableplan; the stable readiness boundary; and merge-order expectations. **Do not invoke the Workflow tool until the user approves this plan** — the approval is both the safety checkpoint and the explicit multi-agent opt-in the Workflow tool requires.

State the GitHub writes the run performs, so the approval covers them explicitly: agents apply validation corrections to issue bodies, post each `fableplan: Yes` issue's implementation plan as a comment on that issue, open PRs, and (with review loops on) post review-trigger and disposition comments. Merging still stays with the user.

Add a **Run size** line before asking for approval:

- Compute the planned direct-agent baseline, assuming every issue reaches each enabled phase, as `1 prep + sum over issues of (1 validate + (fableplan ? 1 plan : 0) + 1 implement + (reviewLoop ? 1 review-loop : 0))`. In the default subagent review mode the `1 review-loop` term is the happy-path first reviewer; every additional review cycle dispatches a fixer + re-reviewer pair, but the final cycle stops before dispatching a fixer if it's still unresolved, so the worst case is `2×maxReviewCycles − 1` review-phase agents per issue (`maxReviewCycles` reviewers + `maxReviewCycles−1` fixers), where github mode instead nests that work inside one review-loop agent.
- Also compute the retry-aware direct ceiling as `planned direct-agent count + number of issues`, because each issue's validation can dispatch one retry. Show both numbers.
- Label them as planning bounds, not a total-agent guarantee: invalid issues or failures can reduce the count, while review loops can dispatch nested fix agents beyond the retry-aware ceiling. The warning counts all scheduled agents, so never label a plan safe merely because either direct count is below the threshold. `maxReviewCycles` changes the stopping rule after an LGTM; it is not a guaranteed cap while reviews keep returning `Needs Updates`.
- Compare both direct counts with the effective Dynamic workflow size guideline when one is present in session context; otherwise use Claude Code's documented default threshold of more than 25 scheduled agents. Name the threshold source in the plan so the comparison is inspectable. If the baseline crosses it, mark the warning expected; if only the retry-aware ceiling crosses it, mark the run retry-sensitive; if both stay under and review loops are enabled, state that nested fixes can still trigger the warning. The [Claude Code workflow cost documentation](https://code.claude.com/docs/en/workflows#cost) is authoritative.
- State that Claude Code can also trigger `Large workflow` when its projected token total exceeds 1.5 million. In an ultracode session, label both comparisons informational because the warning is suppressed.
- When either risk is apparent, call it out before approval and recommend splitting the milestone into separate tracked `Workflow` invocations. Disabling `reviewLoop` reduces the direct count but forfeits automatic review readiness. Lowering `maxReviewCycles` may reduce repeat work after non-blocking LGTM reviews, but never present it as a guaranteed cap.
- When the user set a token target (a "+500k"-style directive), state that the workflow enforces a floor: before each issue starts, if fewer than 80k tokens remain (override with `budgetFloor`), that issue and the rest of its track are deferred as `budget_deferred` and the run returns partial results cleanly instead of an agent dying at the hard ceiling. Without a target, no floor applies. The floor is best-effort, not a guarantee: it is checked only when an issue starts, so an in-flight issue's agents can still hit the hard ceiling, and concurrent tracks can each pass the check before spending. Size `budgetFloor` to roughly one issue's worst-case cost — implement plus a full review loop — which is typically well above the 80k default when review loops are on.

### 3. Preflight the repo

- `gh auth status` succeeds and `gh api repos/<owner>/<repo> --jq .permissions.push` returns `true`. A bad token or read-only access must stop the run here — otherwise it surfaces as confusing per-agent failures mid-run.
- Review-mode dependencies: the default `reviewMode: 'subagent'` reviews in-session (a reviewer agent posts a `pr-review-format` comment, a fixer agent resolves it) and needs no GitHub Actions infrastructure — Actions/runner outages cannot stall it. Only `reviewMode: 'github'` requires `.github/workflows/claude.yml` (the `@claude` review bot — copy from rk-skills `templates/claude-review.yml` and confirm the API-key secret if missing); without that bot, use subagent mode or set `reviewLoop: false` (implementation then opens each PR without requesting review and becomes the readiness boundary). Note CI checks that run on Actions are an independent dependency either way — subagent mode removes the review's Actions dependency, not CI's.
- Base branch protection / merge expectations understood: agents open PRs; merging stays with the user unless they've said otherwise.
- CLAUDE.md in the target repo covers conventions the agents must follow (package manager, test commands).

### 4. Run

Invoke the Workflow tool with `{name: 'milestone-pipeline', args: {tracks: [{issues:[2,3]}, {issues:[9], after:[0]}, {issues:[12], runsAfter:[0]}], reviewLoop: true, maxReviewCycles: 5}}`. Legacy issue-array tracks remain accepted, but use typed objects for new plans. `budgetFloor` (tokens, default 80000) is accepted when a token target is set. `reviewMode` defaults to `'subagent'`; pass `'github'` to route reviews through the repo's `@claude` Action instead.

Immediately after the invocation returns, post its runId and persisted script path as a comment on the milestone's first issue (footer: `Created with LLM: <current model> | high | Harness: milestone-workflow`), so run state survives losing the conversation — `resumeFromRunId` resumes same-session; cross-session the record enables a hand-authored continuation from the persisted script.

The workflow validates all assignments, predecessor indices, duplicates, and cycles before prep, then:

1. **Prep** — one agent reads every issue's `[C..]` score and Execution block → per-issue model/effort/fableplan.
2. **Validate** — immediately before each issue starts, a Fable agent runs the `validate-issue` procedure against the current dependency base, with deduplicated predecessor PRs/skips and hard base refs, at the issue's `Validate effort` (default high). `INVALID` issues are skipped and reported, never built.
3. **Plan** — issues flagged `fableplan: Yes` get a Fable 5 planning agent (validation-aware) whose plan is posted to the issue; the builder implements against it.
4. **Implement** — per-issue agent on its assigned model/effort applies validation corrections, invokes `work-on-issue` with the verified hard `baseRefs`, creates a deterministic integration base for multiple heads, opens the PR, and (github review mode only) triggers `@claude review`.
5. **Review readiness** — the review loop runs until LGTM before any hard or ordering successor starts, preventing review fixes from racing same-package work. In subagent mode (default) the script alternates an independent reviewer agent (first review on the issue's `PR review:` model/effort, default opus/high; posts a `pr-review-format` comment) with a `fix-pr-review` fixer agent on the build model/effort — a re-review after only non-blocking fixes drops to sonnet/high. In github mode one `fix-pr-review-loop` agent drives the `@claude` Action instead. Unrelated tracks and their review loops stay concurrent. With `reviewLoop: false`, implementation completion is the readiness boundary.
6. **Failure propagation** — failed, blocked, or non-LGTM hard predecessors block descendants. Ordering-only skips without a PR do not; an unresolved predecessor PR does. Integration conflicts block before product changes.

### 5. Monitor and close out

Relay meaningful progress (PRs opened, review loops finishing, blockers) — not raw logs. On completion, report a results table: issue → PR → review status, plus flags the agents raised. Recommend dependency order, with every hard prerequisite before its descendants. If a later phase was deferred pending merges, offer to chain the next invocation.

## Context discipline

The orchestrating session holds no implementation detail — issues and PRs are the memory. Between phases (or after compaction), everything needed to resume lives in: the milestone's issues, their Execution blocks, the open PRs, and the runId comment posted in step 4. Losing the conversation must never lose state.

## Failure modes

| Situation | Do this |
|---|---|
| An issue lacks an Execution block at run time | Stop before running; send it through execution-plan-review |
| No `@claude` review workflow in the repo | Use the default `reviewMode: 'subagent'` (no Actions dependency); only github mode needs the template installed, and `reviewLoop: false` remains the no-review fallback |
| GitHub Actions billing or a self-hosted runner outage stalls reviews | Switch the next invocation to `reviewMode: 'subagent'`; already-running github-mode loops stay blocked until Actions recovers |
| A successor hard-depends on unmerged predecessor PRs | Use `after`; the workflow waits for stable heads and `work-on-issue` verifies/integrates every base before implementation |
| A same-package predecessor is ordering-only | Use `runsAfter`; the successor waits but does not inherit code |
| A build-bucket issue hard-depends on a resume- or skip-bucket issue | Apply the step-1 cross-bucket rules: merged PR → drop the edge; open PR → exclude the dependent (and hard descendants), blocked pending merge; closed unmerged → blocked pending decision |
| A dependency integration conflicts | The affected track and hard descendants stop blocked before product changes; report the conflicting heads |
| Workflow returns empty/odd results | Read the run's `journal.jsonl` before re-running; resume with `resumeFromRunId` rather than restarting |
| User asks to start without reviewing the plan | Present the plan anyway — step 2 is not skippable |
