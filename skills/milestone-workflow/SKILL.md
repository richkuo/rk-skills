---
name: milestone-workflow
description: Use when the user wants a milestone of Execution-block-stamped GitHub issues implemented via a multi-agent dynamic workflow: "create the workflow for v0", "run v0 continuously", "/milestone-workflow v0". Builds tracks, gets the run plan approved, runs the milestone-pipeline workflow to LGTM PRs, merges them in-session, and releases when every issue merges. Stage 7 of the new-app-pipeline.
---

# milestone-workflow

No subagent ever holds merge authority: at each LGTM the run pauses as `awaiting_merge`, the session merges (step 5) and resumes with the merge in `args.merged`. Read-only table: `milestoneplan`.

## Steps

### 1. Build the dependency tracks

Follow `run-plan.md`: bucket every issue as build, resume, or skip; settle cross-bucket edges; read `**Depends on:**` (hard) and `**Runs after:**` (ordering-only) and label inferred edges; reject outside references and cycles; shape tracks as `{ issues, after, runsAfter }`.

### 2. Present the run plan; approval is mandatory

Show the target branch (repo default, or the user's `targetBranch`, which also means no release), numbered tracks with titles, hard `after` edges apart from `runsAfter` edges, inferred edges, each issue's model/effort/fableplan (plan effort: stamped, else high) with the harness named on every Codex CLI or Cursor CLI build (`cli-dispatch` under an Opus 5 driver, never a substituted Claude build), the readiness boundary, and merge order. **Do not invoke the Workflow tool until the user approves**; the approval is the multi-agent opt-in and step 2 is never skipped.

State the GitHub writes: issue-body corrections, plan comments, PRs, review comments, and, with merging on, squash-merges at LGTM plus green CI, branch deletion, issue closure, a docs-sync change, and a release. Approval authorizes them; `merge: false` keeps merging manual.

Add a **Run size** line: baseline `1 prep + per issue (1 validate + (fableplan ? 1 plan : 0) + 1 implement + (subagent review ? 1 reviewer : 0))`, ceiling `baseline + 3 × issues`. Compare both with the session's Dynamic workflow size guideline (else Claude Code's default of more than 25 scheduled agents), name the source, and recommend splitting the milestone when either crosses it or projected tokens exceed 1.5 million (review-loop agents sit outside both). With a token target, an issue that starts with fewer than `budgetFloor` tokens (default 80k) left returns `budget_deferred`. **External CLI spend is outside every number above.** A Codex CLI or Cursor CLI build spends on that CLI's account for the build and every fix pass or retry; say so on any plan with a CLI stamp.

### 3. Preflight the repo

Follow `run-plan.md`: push access, a reviewer (`claude.yml` or `codex.yml`, else `reviewMode: 'subagent'` or `reviewLoop: false`), an existing validated `targetBranch`, merge rights on the target, and for every external CLI stamp `codex login status` or `agent status`. An issue with no Execution block stops the run; send it through `execution-plan-review`.

### 4. Run

Invoke `{name: 'milestone-pipeline', args: {tracks: [...], reviewLoop: true, maxReviewCycles: 5}}`. Options: `budgetFloor`; `reviewMode` (`'github'` default, `'subagent'`); `reviewBot` (`'claude'` default, `'codex'` only when the user names Codex, never inferred from a `codex.yml`); `merge` (default `reviewLoop`; rejected with `reviewLoop: false`); `merged` (step 5 records, empty at first); `release` (default `merge`, or `false` with `targetBranch`; rejected without merge); `targetBranch` (every PR's base and worktree start, passed through to `validate-issue` and `work-on-issue`; returned as `target_branch`).

When the invocation returns, post its runId and script path as a comment on the milestone's first issue (footer: `Created with LLM: <current model> | high | Harness: milestone-workflow`). That comment, the issues with their Execution blocks, and the open PRs are the run's only state.

The workflow script owns the phases. Outcomes the orchestrator relies on: `INVALID` issues are skipped; a higher validator score re-routes the build and yields a `rescore` record; review loops run until LGTM before any successor starts (subagent mode: a `pr-review` reviewer agent and a `fix-pr-review` fixer; `fix-pr-review-loop` owns the step-down ladder); a validated `args.merged` record counts as merged, and a PR at LGTM without one returns `awaiting_merge` (successors `merge_pending` or `dependency_blocked`) and ends the run for step 5; `release.deferred: true` returns only when every issue merged; failed, blocked, or unmerged hard predecessors block descendants, and a dependency integration conflict stops before product changes and reports the conflicting heads.

### 5. Merge-resume loop, monitor, close out

On each `awaiting_merge` return, merge that PR in-session, then resume. Merge one PR at a time and finish sub-steps 1 to 6 before the next, so every remaining PR is recomputed against the new base. A PR merges only on a bare LGTM: one standalone `LGTM` line and no recommended or optional items. An LGTM that still lists items returns to `fix-pr-review-loop`, whose stop rule (bare LGTM, or the first LGTM past 5 cycles) still applies.

1. `gh pr view <num> --json state,headRefName,headRefOid,mergeStateStatus`: OPEN, and `headRefOid` equals the reviewed SHA the run returned; a different head goes back to the review loop.
2. CI gate: `gh pr checks <num> --watch`; any failed check blocks; no checks passes. `baseRefName` must equal the target branch. If behind the base, `gh pr update-branch <num>` only when it merges cleanly, re-capture the head, and repeat the CI gate. On conflicts (`mergeStateStatus` `DIRTY`, or a failed update), resolve them in-session: check out the PR branch in a worktree, merge the base, keep the intent of both sides, run the repo tests and stop on any failure, push, record the conflicted file list, re-capture the head, and repeat the CI gate on that head.
3. Fix `<verified-sha>`. Subagent mode: the reviewed SHA, or the re-captured head after a clean update. Github mode: the reviewed SHA only; a changed head returns to the review loop for a fresh LGTM. **Conflict re-review decision** (both modes): when the only commits after the reviewed SHA are conflict resolutions this session pushed, read the diff from the reviewed SHA to the head and decide whether it changes behavior. Prose only (wording, docs, formatting that nothing executes): the standing LGTM holds and `<verified-sha>` becomes the new head. A behavior change, or any doubt (source, tests, config, workflows, scripts, agent-executed Markdown such as `SKILL.md`): post `@claude sonnet review` (github mode) or run one subagent `pr-review` cycle (subagent mode) and require a fresh bare LGTM on the new head. Record the decision and reason in the progress relay; `fix-pr-review` step 7 and `fix-pr-review-loop` step 4 make the same decision.
4. **Github mode LGTM recency gate**, run last and again after every CI wait or branch update: re-fetch the live head and comment history; find the newest one-line `@<bot> [model] review [effort]` trigger and the newest `github-actions[bot]` output linking `/actions/runs/<run-id>`; that run must be `completed` with `success`, and the output later than the trigger with exactly one standalone `LGTM` line. A newer trigger or a missing matching output blocks; never fall back to an older LGTM. Never compare the run's `head_sha` to the PR head (an `issue_comment` run reports the default branch); require the output's `created_at` to be later than the head became visible: the earliest check-suite `created_at` on `<verified-sha>`, else its committer date. One exemption, the prose-only conflict case from sub-step 3: when it decided the diff from `<reviewed-sha>` to `<verified-sha>` is prose only, the visibility time is the reviewed SHA's, so the standing LGTM passes the gate on `<verified-sha>`. Any other commit after the LGTM, including an author push, blocks. Run sub-step 5 immediately after.
5. `gh pr merge <num> --squash --delete-branch --match-head-commit <verified-sha>`, never unpinned. If GitHub rejects the head, restart from sub-step 1; never retry with a fresh SHA.
6. Confirm the issue closed (`gh issue view <n> --json state`; close it if needed) and capture the merge SHA (`gh pr view <num> --json mergeCommit`).
7. Resume with the same `scriptPath` and `resumeFromRunId`, passing the **complete original `args`** (`tracks` is required) with `args.merged` extended by `{issue, pr, merge_sha, issue_state}` for every merge so far. The run rejects an unknown or repeated issue or PR, or a PR other than the one it opened (`merge_record_mismatch`, blocking that issue's descendants), and lists unused records in `unmatched_merged_records`. Repeat until no `awaiting_merge` remains; on empty or odd results read the run's `journal.jsonl` and resume rather than restart.

Close out: on `release.deferred: true`, run `sync-docs-release` in-session and report the tag and URL, unless `target_branch` differs from the repo default branch (`create-release` cuts only from the default), in which case the release stays manual until the target merges into the default. Issues that never reached `merged`: merge stragglers in-session and resume, or run `sync-docs-release` yourself. Branch protection that blocks squash merges means `merge: false` with successors stacking on unmerged heads; an Actions outage means `reviewMode: 'subagent'` on the next invocation.

Relay progress. On completion, report issue, PR, review status, merge status, agent flags, and the release outcome. For every `rescore` record: load `github-issue-format`, restamp the `[C..]` title and the Execution block's build model, effort, and fableplan to the values the run used (footer verb `Updated`), and say what changed. With merging off, recommend a merge order with every hard prerequisite first.
