---
name: work-on-issue-loop
description: Use when the user asks to implement a GitHub issue and drive it through review to completion autonomously — "work on issue and loop until approved", "work-on-issue-loop", or as the automatic follow-on from validate-issue-loop. Runs work-on-issue to implement and open the PR, triggers the first review from the selected review bot itself (@claude by default, @codex when selected), then waits for each review to land and calls fix-pr-review to resolve it. Stops on a bare LGTM with nothing left to fix; once past 5 review cycles it stops at the first LGTM it sees even if non-blocking findings remain, rather than continuing to chase them.
---

# work-on-issue-loop

Drive an issue from "validated" to "PR reviewed to convergence" without stopping. Step 1 implements the issue and opens the PR; the review cycle after that is fix-pr-review-loop's convergence loop run against the new PR. fix-pr-review-loop owns the loop mechanics (bot selection, preflight, wait, stop conditions, cycle cap, resolution, terminal table). This skill adds the implementation step, the follow-on issue sweep, and a terminal state for a run that never produces a PR. With an existing PR and no issue to implement, use fix-pr-review-loop directly.

## Input

- Nothing — the issue validated this session, else `gh issue list --limit 1`.
- `#<N>` / `<N>` / URL / `owner/repo#N`.
- Optional `targetBranch` (`{ issue, targetBranch }` or a prose "target branch <name>"): passed unchanged to `work-on-issue`. The review loop follows the PR's own base branch.

## Steps

### 1. Implement, open the PR, and trigger the first review

Invoke the `work-on-issue` skill (Skill tool, `skill: work-on-issue`). It implements, verifies, commits, pushes, and opens the PR (`Closes #<N>`). It never requests review; that is this loop's job. Gate on its outcome:

- **Stopped with no PR** (closed issue, existing PR, wrong repo, or any other stop `work-on-issue` defines; it owns the list) → nothing to drive; stop and relay its report with its stop reason.
- **PR opened** → capture the PR number/URL and branch, then post the first trigger yourself as a separate one-line comment with no footer: `gh pr comment <PR-number> --body "<band-derived trigger>"`. Do not wait on CI; the reviewer surfaces check failures itself. Match the repo's trigger phrase if recent PR comments show it differs.

**Which trigger.** `validate-issue` step 6 owns the first-review table with its Claude and Codex columns; this file states no boundary of its own. The score source is the issue just implemented: a stamped `PR review:` line in its Execution block overrides the band, else its `[C<score>]` title prefix. A missing score routes to the heaviest row.

**Map a stamped model before posting it.** `claude.yml` resolves only `opus`, `sonnet` and `fable`: a stamped `sonnet` or `haiku` posts `@claude sonnet review`, `opus` posts `@claude opus review effort:high`, `fable` posts `@claude fable review effort:high`, each keeping a stamped `effort:<tier>` in place of `high`. An unadmitted shorthand becomes the Action's route keyword and can select the write-capable fix-pr job, which pushes commits. On Codex, `sonnet`/`haiku` map to `@codex luna review` and `opus`/`fable` to the bare `@codex review`. fix-pr-review-loop step 1 owns both mappings.

**Bot selection and preflight.** Apply fix-pr-review-loop step 1's two rules: `@claude` by default, `@codex` only on explicit selection, never switch bots mid-cycle; before waiting, confirm a review workflow for the selected bot exists (with the Codex secret and variable checks when Codex is selected).

Record the trigger timestamp and set `review_count = 1`.

### 2. Run the convergence loop

Run fix-pr-review-loop steps 2 through 4 against the PR, carrying `review_count` and the trigger timestamp:

- **fix-pr-review-loop step 2** — wait for the review to land (both jq gotchas, background until-loop, ~30-minute cap).
- **fix-pr-review-loop step 3** — the merge-conflict check and the stop conditions: a bare LGTM with nothing left to fix stops the loop; when `review_count > 5`, stop at the first LGTM even with non-blocking findings; a `Needs Updates` verdict never stops the loop by cycle count alone. The one exception is the divergence brake: `pr_cycle_count >= 4` **and** `Needs Updates` **and** every blocking finding sits in code an earlier cycle added. `pr_cycle_count` is fix-pr-review step 4's growth-check count read from the PR's trigger comments, never the in-memory `review_count`. A blocking finding that cannot be attributed to a cycle (no `file:line`, or a path the head no longer has) defeats the brake, and a line a base merge brought in is base-branch work. When the brake fires, stop and report per step 5's **Diverging** row.
- **fix-pr-review-loop step 4** — resolve with fix-pr-review, increment `review_count`, loop to its step 2.

On a "Done" terminal state continue with step 3; on any other terminal state go to step 4.

### 3. File named follow-on issues (mandatory before reporting success)

On either "Done" state, sweep the PR body, commit messages, and any docs the diff changed for follow-on work the implementation named ("follow-on", "own issue", "future work", "next step", "not yet wired/deployed", "needs a follow-up"). This is separate from the review's `Create Follow-up Issue` section, which fix-pr-review handles.

- Search first (`gh issue list --search "<keywords>" --state all`); skip items that already have an issue.
- File each remaining item as a fully-specced issue per `github-issue-format` (complexity-prefixed title, complete body with a `## Plain simple English` section under 55 words, attribution footer). Never file a stub; an item that cannot be specced yet is named in the step 4 report as **deliberately unfiled**.
- Include every filed issue URL and every deliberately unfiled item in the step 4 report.

### 4. Report

Report per fix-pr-review-loop step 5: same terminal-state table and same `**Verification limitation:**` handling (a `Verification limitation` line is not a finding; list each unverified source outside the word cap, omit when none). Three deltas:

- Replace its "PR was already `merged`/`closed`" row with: work-on-issue stopped with no PR → **Nothing to drive.** Relay its report with the stop reason it gave; zero review cycles ran.
- Add every follow-on issue filed in step 3 (URLs) and any item deliberately left unfiled.
- On the **Diverging** row, the scope yardstick is the acceptance criteria of the issue this loop implements; report which of them the PR already satisfies.

## Red Flags — STOP

fix-pr-review-loop's Red Flags table applies while the loop runs. Additional rows:

| Situation | Action |
|---|---|
| work-on-issue stopped with no PR | Do not trigger a review or enter the wait loop; report per step 4 |
| About to report "Done" while the PR or docs name follow-on work with no issue filed | Run step 3 first; a named follow-on with no issue and no "deliberately unfiled" note is a silent drop |

## Common Mistakes

fix-pr-review-loop's Common Mistakes list applies unchanged, including the cycle-cap rules its step 3 owns. One addition: skipping the step 3 follow-on sweep drops work named only in prose.
