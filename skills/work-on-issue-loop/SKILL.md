---
name: work-on-issue-loop
description: Use when the user asks to implement a GitHub issue and drive it through review to completion autonomously — "work on issue and loop until approved", "work-on-issue-loop", or as the automatic follow-on from validate-issue-loop. Runs work-on-issue to implement and open the PR, triggers the first review from the selected review bot itself (@claude by default, @codex when selected), then waits for each review to land and calls fix-pr-review to resolve it. Stops on a bare LGTM with nothing left to fix; once past 5 review cycles it stops at the first LGTM it sees even if non-blocking findings remain, rather than continuing to chase them.
---

# work-on-issue-loop

Drive an issue from "validated" to "PR reviewed to convergence" without stopping in between. Step 1 implements the issue and opens the PR. The review cycle after that is fix-pr-review-loop's convergence loop, run against the new PR. fix-pr-review-loop owns the loop mechanics (bot selection, preflight, wait procedure, stop conditions, cycle cap, resolution); this skill adds the implementation step, the follow-on issue sweep, and its own terminal state for a run that never produces a PR. Use fix-pr-review-loop directly when there is no issue to implement first, just an existing PR to drive to approval.

## Input

- Nothing — default to the issue just validated this session, else the latest open issue (`gh issue list --limit 1`).
- `#<N>` / `<N>` / full URL / `owner/repo#N`.

## Steps

### 1. Implement, open the PR, and trigger the first review

Invoke the `work-on-issue` skill for the issue (Skill tool, `skill: work-on-issue`). It implements the fix in an isolated worktree, verifies it, commits, pushes, and opens the PR (`Closes #<N>`). It does **not** request review; that is this loop's job.

**Gate on its outcome before continuing — work-on-issue can legitimately stop early:**

- **Stopped with no PR** (issue already closed, an existing PR already addresses it, wrong repo checked out) → there is nothing to drive; stop and relay its report.
- **PR opened** → capture the PR number/URL and the branch, then trigger the first review yourself. Don't wait on CI or poll `gh pr checks` — CI runs in parallel and the reviewer surfaces check failures itself. Post a **separate, one-line** comment so the bot fires cleanly (match the repo's trigger phrase if it differs — check recent PR comments; a trigger mention is not authored content — no footer):

```bash
gh pr comment <PR-number> --body "@claude review"
```

**Review bot selection and preflight:** apply fix-pr-review-loop step 1's two rules to this first trigger (the selection logic itself is fix-pr-review step 10's rule). Bot selection: `@claude` by default, `@codex` only on explicit selection, and never switch bots mid-cycle. Preflight: before you enter the wait, confirm a review workflow for the selected bot exists, with the Codex secret and variable checks when Codex is selected.

Record the timestamp of the trigger comment and set `review_count = 1` — that review is #1 in flight.

### 2. Run the convergence loop

Run fix-pr-review-loop steps 2 through 4 against the PR:

- **fix-pr-review-loop step 2** — wait for the review to land, with both jq gotchas, the background until-loop, and the ~30-minute wait cap.
- **fix-pr-review-loop step 3** — check the review against the merge-conflict check and the stop conditions: a bare LGTM with nothing left to fix stops the loop; when `review_count > 5`, stop at the first LGTM even if non-blocking findings remain; a `Needs Updates` verdict never stops the loop by cycle count alone.
- **fix-pr-review-loop step 4** — resolve the review with fix-pr-review, increment `review_count`, and loop back to its step 2.

Carry the `review_count` and trigger timestamp from step 1 into that loop. When the loop reaches a "Done" terminal state, continue with step 3 below; on any other terminal state go to step 4.

### 3. File named follow-on issues — MANDATORY before reporting success

On either "Done" terminal state (before step 4), sweep the deliverables for follow-on work the implementation itself named — this is separate from the review's `Create Follow-up Issue` section (fix-pr-review handles those) and is routinely missed without an explicit pass:

- Scan the **PR body**, **commit message(s)**, and **any docs/READMEs the diff added or changed** for phrases like "follow-on", "own issue", "future work", "next step", "not yet wired/deployed", "needs a follow-up".
- For each named item: file a **fully-specced** issue per the repo's issue conventions (complexity-prefixed title, complete body — problem, goal, approach, acceptance, a `## Plain simple English` section under 55 words — attribution footer; `github-issue-format` owns the full rule). Never file a stub; if an item genuinely can't be specced yet, don't file it — name it in the step 4 report as **deliberately unfiled** instead.
- Skip items that already have an issue (search first: `gh issue list --search "<keywords>" --state all`).
- Include every filed issue URL (and any deliberately-unfiled item) in the step 4 report.

The failure mode this prevents: a PR merges with follow-ons named only in prose, everyone moves on, and the work silently evaporates.

### 4. Report

Report per fix-pr-review-loop step 5: same terminal-state table, same 55-word cap, and same `**Verification limitation:**` list. A `Verification limitation` line is not a finding and does not prevent a clean pass; in the report, name each unverified source in that list, outside the word cap, and omit the field when none. Apply two deltas:

- Replace its "PR was already `merged`/`closed`" row with: work-on-issue stopped with no PR (closed issue / existing PR / wrong repo) → **Nothing to drive.** Relay its report; zero review cycles ran.
- Add to the report contents: every follow-on issue filed in step 3 (URLs) and any item deliberately left unfiled.

## Red Flags — STOP

Every row in fix-pr-review-loop's Red Flags table applies while the loop runs. These rows are additional:

| Situation | Action |
|---|---|
| work-on-issue stopped with no PR | Don't trigger a review or enter the wait loop — gate on its outcome in step 1 and report per step 4 |
| About to report "Done" while the PR/README names follow-on work with no issue filed | Stop — run step 3 first; a named follow-on with no issue and no "deliberately unfiled" note in the report is a silent drop |

## Common Mistakes

fix-pr-review-loop's Common Mistakes list applies unchanged, including the cycle-cap rules its step 3 owns. One addition:

- **Skipping the follow-on sweep.** Step 3 runs before any "Done" report; without it, follow-on work named only in prose gets dropped.
