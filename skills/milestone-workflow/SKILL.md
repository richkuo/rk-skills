---
name: milestone-workflow
description: Use when the user wants a milestone of Execution-block-stamped GitHub issues implemented via a multi-agent dynamic workflow — "create the workflow for v0", "run v0 continuously", "/milestone-workflow v0". Builds dependency tracks, presents the run plan for approval, then runs the milestone-pipeline workflow: per-issue model/effort from the Execution blocks, optional fableplan stage, PRs, @claude review loops until LGTM. Stage 5–6 of the new-app-pipeline.
---

# milestone-workflow

Turn a reviewed milestone into a running multi-agent pipeline. Static plan, dynamic dispatch: the dependency graph is decided here with the user; execution reacts to reviews and merges as they land.

## Steps

### 1. Build the dependency tracks

Fetch the milestone's issues. From their Approach/Problem sections, derive **tracks**: an array of issue-number arrays where tracks run in parallel and issues within a track run sequentially.

- The **spine** (scaffold → schema → auth) is the first track — or, when everything depends on it, run the spine as its own Workflow invocation first and fan out in a second invocation after it merges. Cross-track dependencies cannot be expressed inside one invocation; chain invocations per phase instead, staying in the loop between them.
- Dependency-free islands (pure modules, landing pages) get single-issue tracks.
- Two issues touching the same package never sit in different tracks.

### 2. Present the run plan — review before beginning (mandatory)

Show: the tracks with issue titles, each issue's model/effort/fableplan from its Execution block, the review-loop behavior, and merge-order expectations. **Do not invoke the Workflow tool until the user approves this plan** — the approval is both the safety checkpoint and the explicit multi-agent opt-in the Workflow tool requires.

### 3. Preflight the repo

- `.github/workflows/claude.yml` exists (the `@claude` review bot — copy from rk-skills `templates/claude-review.yml` and confirm the API-key secret if missing). Review loops silently stall without it.
- Base branch protection / merge expectations understood: agents open PRs; merging stays with the user unless they've said otherwise.
- CLAUDE.md in the target repo covers conventions the agents must follow (package manager, test commands).

### 4. Run

Invoke the Workflow tool with `{name: 'milestone-pipeline', args: {tracks: [[...], ...], reviewLoop: true, maxReviewCycles: 5}}`. The workflow:

1. **Prep** — one agent reads every issue's `[C..]` score and Execution block → per-issue model/effort/fableplan.
2. **Validate** — immediately before each issue starts, a Fable agent runs the `validate-issue` procedure against the *current* code (issues go stale as earlier PRs land): verdict, issue-body corrections, hard implementation constraints. `INVALID` issues are skipped and reported, never built.
3. **Plan** — issues flagged `fableplan: Yes` get a Fable 5 planning agent (validation-aware) whose plan is posted to the issue; the builder implements against it.
4. **Implement** — per-issue agent on its assigned model/effort applies the validation corrections to the issue, then isolated worktree, `work-on-issue` procedure, opens the PR, triggers `@claude`.
5. **Review Loop** — `fix-pr-review-loop` per PR until LGTM, concurrent with later issues in the track; validation constraints outrank reviewer suggestions.

### 5. Monitor and close out

Relay meaningful progress (PRs opened, review loops finishing, blockers) — not raw logs. On completion, report a results table: issue → PR → review status, plus flags the agents raised. Recommend the merge order (track order). If a later phase was deferred pending this one's merges, offer to chain the next invocation.

## Context discipline

The orchestrating session holds no implementation detail — issues and PRs are the memory. Between phases (or after compaction), everything needed to resume lives in: the milestone's issues, their Execution blocks, and the open PRs. Losing the conversation must never lose state.

## Failure modes

| Situation | Do this |
|---|---|
| An issue lacks an Execution block at run time | Stop before running; send it through execution-plan-review |
| No `@claude` review workflow in the repo | Install from templates first, or run with `reviewLoop: false` and say what that forfeits |
| A track's issue hard-depends on an unmerged earlier PR | The workflow passes in-flight context; implementers may branch off the dependency's PR branch and must note merge order in the PR body |
| Workflow returns empty/odd results | Read the run's `journal.jsonl` before re-running; resume with `resumeFromRunId` rather than restarting |
| User asks to start without reviewing the plan | Present the plan anyway — step 2 is not skippable |
