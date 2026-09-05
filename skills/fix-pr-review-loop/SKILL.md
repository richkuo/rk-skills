---
name: fix-pr-review-loop
description: Use when the user asks to fix a PR review and drive it to approval autonomously — "fix the PR review and loop until approved", "fix-pr-review-loop", "keep addressing review comments until this PR is approved". Takes an optional PR number/URL (defaults to the current branch's PR). Repeatedly calls fix-pr-review, waits for the bot's re-review (@claude by default, @codex when selected), and repeats. Stops on a bare LGTM, on the first LGTM past 5 cycles, or to escalate when four or more cycles keep producing blocking findings in code the loop itself added.
---

# fix-pr-review-loop

Drive an open PR from "has review feedback" to "reviewed to convergence": resolve the latest review with `fix-pr-review`, wait for the bot's re-review, repeat. This skill owns the stop rules in step 3 and the terminal-state table in step 5. `work-on-issue-loop` runs steps 2 through 4 after it opens a PR and reuses step 5's table with its own deltas, so an edit to that table needs a matching edit in `work-on-issue-loop` step 4.

## Input

Nothing (the current branch's PR via `gh pr view`), or `#<N>` / `<N>` / URL / `owner/repo#N`.

## Steps

### 1. Resolve the PR and establish the starting state

`gh pr view <N|--> --json number,headRefName,headRepositoryOwner,baseRefName,url,state,isDraft`. A `merged` or `closed` PR: stop and report. Otherwise fetch existing feedback with fix-pr-review step 1's three-channel query (reviews, issue comments, inline threads).

- **Unaddressed feedback present** (newer than any prior disposition comment, or an unresolved inline thread): it is review 1. Set `review_count = 1`, note its timestamp, go to step 3. Never post a redundant trigger.
- **No feedback yet** (fresh PR, or only your own disposition or trigger comments): post the first-review trigger as its own one-line comment, `gh pr comment <N> --body "<trigger>"`. Record its timestamp, set `review_count = 1`, go to step 2.

**First-review trigger.** `validate-issue` step 6 owns the first-review table with its Claude and Codex columns; this file states no boundary of its own. Read the score in this order and stop at the first hit: a stamped `PR review:` line in the linked issue's Execution block (it overrides the band), the `[C<score>, …]` bracket in the PR title, the `[C<score>]` prefix of the issue the PR closes. A missing score routes to the top row. Fable runs at high unless the user asks for xhigh or stamps it.

**Map a stamped model before posting it.** `claude.yml` resolves only `opus`, `sonnet` and `fable`: a stamped `sonnet` or `haiku` posts `@claude sonnet review`, `opus` posts `@claude opus review effort:high`, `fable` posts `@claude fable review effort:high`, each keeping a stamped `effort:<tier>` in place of `high`. An unadmitted shorthand becomes the Action's route keyword and can select the write-capable fix-pr job, which pushes commits. On Codex, `sonnet`/`haiku` map to `@codex luna review` and `opus`/`fable` to the bare `@codex review`; never carry a `@claude` shorthand across to `@codex`. Blocking re-reviews step down one rung per cycle, keyed to the reviewer that actually ran cycle 1; `skills/fix-pr-review/rereview-routing.md` owns that ladder and the Codex rule.

**Bot selection.** `@claude` by default. `@codex` only when Codex was explicitly selected: the user said so, a caller argument named it (`reviewBot: codex`), or this run started from an `@codex` comment. A `codex.yml` merely existing does not select Codex. Never switch bots mid-cycle.

**Preflight.** Confirm a reviewer answers the selected bot: `gh api repos/{owner}/{repo}/contents/.github/workflows --jq '.[].name'` must list `claude.yml` (or the Claude GitHub App is installed) or `codex.yml`. With Codex, also check the `OPENAI_API_KEY` secret and, for the write routes, `CODEX_APP_ID`, `CODEX_APP_PRIVATE_KEY` and the `CODEX_BOT_LOGIN` variable. If none exists, stop and point the user at `templates/claude-workflow/workflows/claude.yml` (plus `CLAUDE_CODE_OAUTH_TOKEN`, the Claude GitHub App, and a `runs-on` they have) or `templates/codex-review.yml`.

### 2. Wait for the review to land

Poll for a review or issue comment posted after the last trigger timestamp. The `@claude` bot edits its placeholder comment in place; `createdAt` still follows your trigger. A Codex review is a plain `github-actions[bot]` comment with the verdict first.

```bash
until gh pr view <N> --json comments,reviews --jq '
  ([.comments[] | select(.createdAt > "<trigger_ts>")] |
   any(.body | test("(^|\\n)(LGTM|Needs Updates)"))) or
  ([.reviews[] | select(.submittedAt > "<trigger_ts>")] | length > 0)
' | grep -q true; do sleep 60; done
```

Match with `(^|\\n)`: jq's `m` flag is dot-matches-newline and a bare `^` never reaches a verdict under the bot's header. Pipe through `grep -q true`: `gh --jq` exits 0 on `false`. Run the loop in the background (Monitor tool) after one inline sanity check that prints `true` against a review already present. Cap the wait at roughly 30 minutes, then stop and report that the bot did not respond.

### 3. Check the review against the stop conditions

Classify the latest review as fix-pr-review steps 1 and 3 do: verdict (`LGTM` / `Needs Updates`) and which finding sections are present (`Needs Fixing`, `Requires Human Review`, `Recommended Optional`, `Create Follow-up Issue`). A `**Verification limitation:**` line is not a finding. Evaluate in this order:

0. **Merge conflict.** `gh pr view <N> --json mergeable,mergeStateStatus`. A `CONFLICTING`/`DIRTY` PR is never terminal: go to step 4, even on a bare LGTM.
1. **Clean pass, stop.** `LGTM` with no finding sections at all, at any `review_count`; nothing left to fix. Go to step 5.
2. **Past the cap, stop.** `review_count > 5` and the verdict is `LGTM`, even with `Recommended Optional` or `Create Follow-up Issue` items listed. Go to step 5.
3. **Diverging, stop.** `pr_cycle_count >= 4`, the verdict is `Needs Updates`, and every blocking finding sits in code an earlier cycle of this loop added. Go to step 5, **Diverging** row. `pr_cycle_count` is fix-pr-review step 4's growth-check count, read from the PR's trigger comments; it is never the in-memory `review_count`. A finding sits in code an earlier cycle added when `git blame` at the PR head names a commit that is an ancestor of neither `<first-push-sha>` nor `origin/<baseRefName>`; a line a step 7 base merge brought in is base-branch work and never counts. A blocking finding that cannot be attributed (no `file:line`, or a path or line the head no longer has) defeats this rule. Findings in the first push never trigger it.
4. **Otherwise, keep going.** `Needs Updates` with rule 3 not fired, at any count (no cycle count alone stops a `Needs Updates` PR whose findings sit in its original work), or `LGTM` with findings listed and `review_count <= 5`. Go to step 4.

### 4. Resolve the review and loop

Invoke the `fix-pr-review` skill (Skill tool, `skill: fix-pr-review`). It validates every finding, fixes what is real, resolves merge conflicts (its step 7), commits, pushes, posts the disposition comment, and posts its own re-review trigger (its step 10); never add a second one. It decides its own delegation (its step 5). When it posted a trigger, increment `review_count`, record that trigger's timestamp, and go to step 2. A pass that posted no trigger increments nothing and records no timestamp; the count reflects only the cycles step 2 waited on.

**Merge re-review rule** (the same decision as `milestone-workflow` step 5 sub-step 3): on a bare-LGTM PR whose only work this cycle was a hand-resolved base merge, fix-pr-review step 7 decides from the hand-resolved diff. Prose only keeps the LGTM and posts no trigger; a behavior change, or any doubt, means it posted `@claude sonnet review` (or `@codex luna review`), so go to step 2. When it posted no trigger under that rule, re-check `gh pr view <N> --json mergeable,mergeStateStatus`. `UNKNOWN` is GitHub recomputing after the push: wait 30 seconds and read again, up to roughly 5 minutes, then report it as the bot-never-responded row. `MERGEABLE`: the prior LGTM stands, go to step 5 as a clean pass. `CONFLICTING`/`DIRTY`: a new base conflict, go to step 4 again. Only a genuine conflict re-enters fix-pr-review.

### 5. Report

Report the terminal state; never claim blanket success.

| Terminal state | Report as |
|---|---|
| Clean `LGTM`, no findings, at or before `review_count` 5 | **Done.** PR is approved with nothing outstanding. Name each unverified source from any `**Verification limitation:**` lines; they are not outstanding work. |
| `review_count > 5` and an `LGTM` with non-blocking items ended the loop | **Done, with leftovers.** PR is approved; list the optional/follow-up items left unaddressed, plus any unverified sources. |
| Rule 3 fired | **Diverging, escalate the scope call.** Report `pr_cycle_count`, the PR's growth measured base-excluded per fix-pr-review step 4's growth check, and the chain: per cycle, the finding it fixed and the finding that fix produced. Name the mechanisms the PR grew that its scope yardstick (the linked issue(s), else the PR body) never asked for. Recommend one: revert to the last cycle whose findings were all in the original work and file the rest, or narrow the PR to the yardstick and file the remainder. Do not start another cycle. |
| fix-pr-review stopped before commit on an ungrounded failing test | **Blocked on a test.** Report the test with its `file:line`, what it asserts, and the conflict; no push or re-review happened, and the maintainer decides. |
| Bot never responded within the wait window | **Escalate.** The PR is pushed but review never landed; the user checks the bot's Action status. |
| PR was already `merged`/`closed` at start | **Nothing to drive.** Report the state; zero cycles ran. |

Always give the PR URL, cycles run, final verdict, and (when escalating) exactly what is left. Write the report per the Response Style rules in CLAUDE.md/AGENTS.md; the unverified-source list sits outside the word cap.

## Red Flags

- Latest "review" is your own disposition or trigger comment: skip it and keep polling.
- PR closed or merged mid-loop: stop at once; never push to a closed or merged PR.
- Losing count across cycles: track `review_count` explicitly; it separates a full fix cycle from first-LGTM-wins.
- Posting a second trigger: fix-pr-review step 10 already posts the re-review trigger.
