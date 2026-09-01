---
name: milestone-workflow
description: Use when the user wants a milestone of Execution-block-stamped GitHub issues implemented via a multi-agent dynamic workflow — "create the workflow for v0", "run v0 continuously", "/milestone-workflow v0". Builds dependency tracks, presents the run plan for approval, then runs the milestone-pipeline workflow: per-issue model/effort from the Execution blocks, optional fableplan stage, PRs, optional review loops until LGTM — the repo's @claude Action by default, or in-session subagent reviewers in subagent mode — then pauses at each LGTM so the orchestrating session merges the PR in-session (no merge subagents) and resumes, and, when every issue merges, the orchestrator syncs docs and publishes a release. Stage 7 of the new-app-pipeline.
---

# milestone-workflow

Turn a reviewed milestone into a running multi-agent pipeline. The dependency graph is decided here with the user; the workflow builds hard-dependent work from reviewed predecessor code. With merging on (the default when review loops run), no subagent ever holds merge authority: at each LGTM the run pauses as `awaiting_merge`, the orchestrating session merges in-session (step 5), then resumes with the merge recorded in `args.merged`. When every issue merges, the orchestrator syncs docs and publishes the release. For a read-only table of the milestone first, use `milestoneplan`.

## Steps

### 1. Build the dependency tracks

- List the milestone's issues with `--state all` and search for open PRs that close each one. Three buckets: **build**, **resume** (open issue with an open PR — run `fix-pr-review-loop` on it, never a fresh build), **skip** (closed).
- Cross-bucket edges must be settled here, never dropped. Predecessor merged: drop the edge. Predecessor in resume: finish its loop first; with merging on, also merge it at LGTM plus green CI (the approved plan covers this); with merging off, a hard edge excludes the dependent and its hard descendants as **blocked pending merge of PR #X**. Predecessor closed without a merged PR: exclude the dependent and its hard descendants as **blocked pending decision** and ask whether to reopen or re-scope.
- Read `**Depends on:**` (hard) and `**Runs after:**` (ordering-only). An explicit `none` is authoritative. For an issue missing a field, infer only that edge kind from the prose and label every inferred edge; flag an unclear kind for plan review instead of guessing.
- Reject references outside the milestone and cycles across both edge kinds.
- Tracks are `{ issues: [...], after: [<track>...], runsAfter: [<track>...] }`. Combine issues into one `issues` array only when every serial edge is hard; ordering-only chains stay separate tracks joined by `runsAfter`. Unrelated tracks start together; multiple hard predecessors stay separate `after` entries.

### 2. Present the run plan — approval is mandatory

Show numbered tracks with titles, hard `after` edges apart from `runsAfter` edges, inferred edges, each issue's model/effort/fableplan (fableplan issues always plan at high), the readiness boundary, and merge order. **Do not invoke the Workflow tool until the user approves this plan**; the approval is the multi-agent opt-in.

State the GitHub writes the run performs: validation corrections to issue bodies, plan comments on `fableplan: Yes` issues, PRs, review-trigger and disposition comments, and, with merging on, in-session squash-merges at LGTM plus green CI, branch deletion, issue closure, a docs-sync change, and a GitHub release. Approving the plan authorizes those merges and the release; `merge: false` keeps merging manual.

Add a **Run size** line: the baseline `1 prep + per issue (1 validate + (fableplan ? 1 plan : 0) + 1 implement + (subagent review ? 1 reviewer : 0))`, and the retry-aware ceiling `baseline + 3 × issues`. Compare both with the session's Dynamic workflow size guideline (else Claude Code's default of more than 25 scheduled agents) and name the source. Both are planning bounds: review loops dispatch fix and re-review agents beyond them, and a projected token total above 1.5 million also triggers the warning. When either count crosses the threshold, recommend splitting the milestone into separate invocations. With a token target, the run defers an issue as `budget_deferred` when fewer than `budgetFloor` tokens (default 80k) remain at its start; size the floor to one issue's worst-case cost.

### 3. Preflight the repo

- `gh auth status` succeeds and `gh api repos/<owner>/<repo> --jq .permissions.push` is `true`.
- Review mode: the default `reviewMode: 'github'` needs `.github/workflows/claude.yml` (from `templates/claude-workflow/workflows/claude.yml`, plus `CLAUDE_CODE_OAUTH_TOKEN` and the Claude GitHub App) and working Actions; with `reviewBot: 'codex'` it needs `codex.yml` plus the secrets the `fix-pr-review-loop` preflight lists. Set `runs-on` to your runner label when no self-hosted runner exists. Without a bot, pass `reviewMode: 'subagent'` or `reviewLoop: false`. Actions-hosted CI stays a separate dependency.
- With merging on, the account must be allowed to squash-merge and delete branches on the base; otherwise relax protection or run `merge: false`.
- The target repo's CLAUDE.md covers package manager and test commands.

### 4. Run

Invoke `{name: 'milestone-pipeline', args: {tracks: [...], reviewLoop: true, maxReviewCycles: 5}}`. Options: `budgetFloor`; `reviewMode` (`'github'` default, `'subagent'`); `reviewBot` (`'claude'` default, `'codex'` only when the user names Codex, never inferred from a `codex.yml`); `merge` (defaults to `reviewLoop`; `merge: true` with `reviewLoop: false` is rejected); `merged` (records from step 5, empty at first); `release` (defaults to `merge`; rejected without merge).

Right after the invocation returns, post its runId and script path as a comment on the milestone's first issue (footer: `Created with LLM: <current model> | high | Harness: milestone-workflow`).

Phases: **Prep** reads each issue's `[C..]` score and Execution block. **Validate** runs `validate-issue` per issue on the band route from `validate-issue` step 6; a higher validator score re-validates once upward and re-routes build model, effort, and fableplan, with a stamped `PR review:` reviewer kept unless the escalated review default outranks it; `INVALID` issues are skipped. **Plan** posts a Fable 5 plan at high for `fableplan: Yes` issues. **Implement** runs `work-on-issue` with verified `baseRefs`; in github mode it also runs review cycle 1 with the first-review trigger from the `validate-issue` step 6 table (or the stamped trigger), and `fix-pr-review-loop` owns the step-down ladder and the Codex mapping. **Review readiness** loops until LGTM before any successor starts; in subagent mode a reviewer agent posts a `pr-review` comment and a `fix-pr-review` fixer answers it. **Merge** counts a validated `args.merged` record as merged; a PR at LGTM without a record returns `awaiting_merge` (successors `merge_pending` or `dependency_blocked`) and the run ends for step 5. **Release** returns `release.deferred: true` when every issue merged; a partial milestone never publishes. Failed, blocked, or unmerged hard predecessors block descendants.

### 5. Merge-resume loop, monitor, close out

On each `awaiting_merge` return, merge that PR in-session, then resume:

1. `gh pr view <num> --json state,headRefName,headRefOid,mergeStateStatus`: OPEN, and `headRefOid` equals the reviewed readiness SHA the run returned. A different head means commits landed after the review: send the PR back through the review loop.
2. CI gate: `gh pr checks <num> --watch`; any failed check blocks. No checks counts as passing. If behind the base, `gh pr update-branch <num>` only when it merges cleanly, re-capture the head, and repeat the CI gate. On conflicts stop; never resolve conflicts yourself.
3. Fix `<verified-sha>`. Subagent mode: the reviewed SHA, or the re-captured head after a clean update (a base-only catch-up keeps the reviewed diff). Github mode: the reviewed SHA only; if the head changed, the standing LGTM predates it, so return to the review loop for a fresh LGTM. A second update forced by a concurrent merge re-applies the same rule.
4. **Github mode LGTM recency gate**, run last and again after every CI wait or branch update: re-fetch the live head and full comment history; find the newest one-line `@<bot> [model] review [effort]` trigger and the newest `github-actions[bot]` output linking `/actions/runs/<run-id>`; that run must be `completed` with `success`; the output must be later than the trigger and carry exactly one standalone `LGTM` line. A newer trigger or a missing matching output blocks; never fall back to an older LGTM. Do not compare the run's `head_sha` to the PR head (an `issue_comment` run reports the default branch). Instead require the output's `created_at` to be later than when the head became visible: the earliest check-suite `created_at` on `<verified-sha>`, else its committer date. Run sub-step 5 immediately after the gate; nothing in between.
5. `gh pr merge <num> --squash --delete-branch --match-head-commit <verified-sha>`, never unpinned. If GitHub rejects the head, restart from sub-step 1; never retry with a fresh SHA.
6. Confirm the issue closed (`gh issue view <n> --json state`; close it if needed) and capture the merge SHA (`gh pr view <num> --json mergeCommit`).
7. Resume with the same `scriptPath` and `resumeFromRunId`, passing the **complete original `args`** (`tracks` is required) with `args.merged` extended by `{issue, pr, merge_sha, issue_state}` for every merge so far. The run rejects an issue outside the run, a repeated issue or PR, or a PR that differs from the one it opened (`merge_record_mismatch`, blocking that issue's descendants), and reports unused records in `unmatched_merged_records`. Repeat until no `awaiting_merge` remains.

When the run returns `release.deferred: true`, run `sync-docs-release` in-session and report the tag and URL.

Relay progress (PRs opened, loops finishing, merges, blockers). On completion, report issue → PR → review status → merge status, agent flags, and the release outcome. For every `rescore` record: load `github-issue-format`, restamp the `[C..]` title and the Execution block's build model, effort, and fableplan to the values the run used (footer verb `Updated`), and tell the user what changed. With merging off, recommend merge order with every hard prerequisite first.

## Context discipline

The session holds no implementation detail: the milestone's issues, their Execution blocks, the open PRs, and the runId comment are the memory. Losing the conversation must never lose state.

## Failure modes

| Situation | Do this |
|---|---|
| An issue lacks an Execution block | Stop; send it through `execution-plan-review` |
| Actions billing or runner outage stalls reviews | Next invocation uses `reviewMode: 'subagent'`; running github-mode loops wait for Actions |
| Branch protection blocks squash merges or needs human approval | Run `merge: false`; successors stack on unmerged heads |
| Some issues did not reach `merged` | Release skipped; merge stragglers in-session and resume, or run `sync-docs-release` yourself |
| A dependency integration conflicts | The track and hard descendants stop before product changes; report the conflicting heads |
| Workflow returns empty or odd results | Read the run's `journal.jsonl`; resume with `resumeFromRunId` rather than restarting |
| User asks to skip the plan review | Step 2 is not skippable |
