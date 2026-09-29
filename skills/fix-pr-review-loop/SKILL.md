---
name: fix-pr-review-loop
description: Use when the user asks to fix a PR review and drive it to approval autonomously — "fix the PR review and loop until approved", "fix-pr-review-loop", "keep addressing review comments until this PR is approved". Takes an optional PR number/URL (defaults to the current branch's PR). Repeatedly calls fix-pr-review, waits for the bot's re-review (@claude by default, @codex when selected), and repeats. Stops on a bare LGTM, on the first LGTM past 5 cycles, or to escalate when four or more cycles keep producing blocking findings in code the loop itself added.
---

# fix-pr-review-loop

Resolve an open PR's latest review with `fix-pr-review`, wait for the bot's re-review, and repeat until convergence. This skill owns the step 3 stop rules and the step 5 terminal-state table. `work-on-issue-loop` runs steps 2 through 4 after it opens a PR and reuses step 5's table with its own deltas, so an edit to that table needs a matching edit in `work-on-issue-loop` step 4.

## Input

Nothing (the current branch's PR via `gh pr view`), or `#<N>` / `<N>` / URL / `owner/repo#N`.

## Steps

### 1. Resolve the PR and establish the starting state

`gh pr view <N|--> --json number,headRefName,headRepositoryOwner,baseRefName,url,state,isDraft`. A `merged` or `closed` PR: stop and report. Otherwise compute `review_count` and `pr_cycle_count` from the round history per Round counts in `skills/fix-pr-review/rereview-routing.md`, which owns both counts and the pending trigger; a fresh PR has `review_count = 0`. A verification limitation there stops the loop: report the missing evidence and post nothing. Fetch existing feedback with fix-pr-review step 1's three-channel query (reviews, issue comments, inline threads) and take the first case that applies:

- **Pending trigger present** (Round counts' pending trigger, naming the selected bot): recover it, go to step 2, and never post another trigger. One that names the other bot stops the loop: report it, since a second trigger would split the cycle across bots.
- **Unaddressed feedback present** (a completed bot round newer than any prior disposition comment, or trusted feedback that fails fix-pr-review step 1's bare-LGTM check): go to step 3 with no trigger.
- **Stale or failed trigger** (Round counts, naming the selected bot: a stale trigger, or one whose round has no verdict and whose answering review run finished without one; a re-run still queued or in progress keeps it pending): repost it and go to step 2. A round holding a verdict never takes this case, and a note from any other run never makes a trigger failed. When a disposition comment precedes the trigger, repost the trigger's exact line, so a re-review keeps the ladder and never reopens a heavy or Fable cycle; otherwise it was cycle 1, so post the first-review trigger.
- **Nothing to act on yet** (fresh PR, only your own disposition or trigger comments, only untrusted feedback, or only a trusted bare `LGTM` or empty approval): post the first-review trigger as its own one-line comment, `gh pr comment <N> --body "<trigger>"`, and go to step 2.

Before step 2, record each recovered or posted trigger comment's `id` and `created_at` as the pending trigger.

**First-review trigger.** `validate-issue` step 6 owns the first-review table (Claude and Codex columns); this file states no boundary of its own. Take the score from the first hit: a stamped `PR review:` line in the linked issue's Execution block (it overrides the band), the `[C<score>, …]` bracket in the PR title, the `[C<score>]` prefix of the issue the PR closes. A missing score routes to the top row. Fable runs at high unless the user asks for xhigh or stamps it.

**Map a stamped model before posting it.** `claude.yml` resolves only `opus`, `sonnet` and `fable`: stamped `sonnet` or `haiku` posts `@claude sonnet review`, `opus` posts `@claude opus review effort:high`, `fable` posts `@claude fable review effort:high`, each keeping a stamped `effort:<tier>` in place of `high`. A stamped bare `@claude review` with an `effort:<tier>` names Opus 5.5 and posts `@claude opus review effort:<tier>`; with no tier it takes the band. An unadmitted shorthand becomes the Action's route keyword and can select the write-capable fix-pr job, which pushes commits. On Codex, `sonnet`/`haiku` map to `@codex luna review` and `opus`/`fable` to the bare `@codex review`; never carry a `@claude` shorthand to `@codex`. **A stamp outside these rows is ignored.** The admitted rows are a model word (`sonnet`, `haiku`, `opus`, `fable`) in a `@claude <model> review` trigger, a bare `@claude review`, or a line naming the standard `@claude` trigger, each with at most one `effort:<tier>` from `low`, `medium`, `high`, `xhigh`. Any other model word, a route word, extra text on the trigger, or another tier matches no row: post the band trigger and name the ignored stamp in the report. Blocking re-reviews are keyed to the reviewer that actually ran cycle 1: a heavier cycle-1 reviewer steps down to `@claude review` on the first blocking re-review and stays there; `skills/fix-pr-review/rereview-routing.md` owns that ladder and the Codex rule.

**Bot selection.** `@claude` by default. `@codex` only on explicit selection: the user said so, a caller argument named it (`reviewBot: codex`), or this run started from an `@codex` comment. An existing `codex.yml` alone selects nothing. Never switch bots mid-cycle.

**Preflight.** Confirm by its contents that a workflow answers the selected bot; the filename decides nothing (the shipped minimal Codex template keeps its `codex-review.yml` name). List the files (`gh api repos/{owner}/{repo}/contents/.github/workflows --jq '.[].name'`) and read each `.yml` or `.yaml` (`gh api repos/{owner}/{repo}/contents/.github/workflows/<file> --jq .content | base64 -d`). A file answers when it runs on `issue_comment`, its job condition matches the bot's mention (`@claude` or `@codex`), and a job runs the reviewer: `anthropics/claude-code-action` or `openai/codex-action` directly, or inside a reusable workflow the job's `uses:` names (`<owner>/<repo>/.github/workflows/<file>@<ref>`), confirmed by reading that file at that ref (`gh api 'repos/<owner>/<repo>/contents/.github/workflows/<file>?ref=<ref>'`). For Claude, an installed Claude GitHub App also answers. With Codex, also check the `OPENAI_API_KEY` secret (the review route needs it), and check `CODEX_APP_ID`, `CODEX_APP_PRIVATE_KEY` and the `CODEX_BOT_LOGIN` variable only when the answering workflow also carries the write routes (the full bundle's `codex.yml`). If no workflow answers, stop and point the user at `templates/claude-workflow/workflows/claude.yml` (plus `CLAUDE_CODE_OAUTH_TOKEN`, the Claude GitHub App, and a `runs-on` they have) or `templates/codex-review.yml`.

### 2. Wait for the review to land

Poll for a completed verdict on the pending trigger: an output from the **review-bot set**, posted after the pending trigger's `created_at`, that passes Round counts' completed-verdict test (`skills/fix-pr-review/rereview-routing.md`). `skills/fix-pr-review/fetch-recipes.md` (Author trust) owns the set: `github-actions[bot]` and `claude[bot]`. Any other author's comment or review never ends the wait, whatever its first line says. The `@claude` route edits its placeholder comment in place: its `created_at` still follows your trigger, and it ends the wait only when an edit puts the verdict under the `**Claude finished …**` header. A Codex review is a plain `github-actions[bot]` comment with the verdict first.

```bash
st='select(.user.type == "Bot" and (.user.login == "github-actions[bot]" or .user.login == "claude[bot]"))
  | (.body // "") as $b
  | if ($b | sub("^[ \\t\\r\\n]*\\*\\*Claude finished [^\\n]*\\n[ \\t\\r\\n]*---[ \\t\\r]*\\n"; "")
           | test("^[ \\t\\r\\n]*(LGTM|Needs Updates)[ \\t\\r]*(\\n|$)")) then "verdict"
    elif ($b | test("\\*\\*Workflow (cancelled|failed) before completion\\.\\*\\*"))
    then "note \(($b | capture("/actions/runs/(?<r>[0-9]+)")? // {r: "none"}).r)"
    else empty end'
state() {
  gh api repos/{owner}/{repo}/issues/<N>/comments --paginate --jq ".[] | select(.created_at > \"<trigger_ts>\") | $st"
  gh api repos/{owner}/{repo}/pulls/<N>/reviews --paginate --jq ".[] | select(.submitted_at > \"<trigger_ts>\") | $st"
}
review_failed() {
  gh api repos/{owner}/{repo}/actions/runs/$1 --jq "select(.path == \".github/workflows/<file>\" and .status == \"completed\" and .created_at >= \"<trigger_ts>\") | .id" | grep -q . &&
  gh api repos/{owner}/{repo}/actions/runs/$1/jobs --paginate --jq '.jobs[] | select(.conclusion != "skipped") | .name' | grep -qE '^review( / |$)'
}
result() {
  s=$(state)
  if printf '%s\n' "$s" | grep -qx verdict; then echo verdict; return; fi
  for r in $(printf '%s\n' "$s" | sed -n 's/^note \([0-9][0-9]*\)$/\1/p' | sort -u); do
    if review_failed "$r"; then echo failed; return; fi
  done
  echo waiting
}
until [ "$(result)" != waiting ]; do sleep 60; done
result
```

Read the author from REST, where a bot login keeps its `[bot]` suffix and `type` is `Bot`; never from `gh pr view`, which drops the suffix and shows no account type (a user account named `claude` exists). Keep the filter as written: the `sub` strips the supported header, and the `test` accepts only a standalone verdict line in the verdict position. It prints `verdict` per completed verdict and `note <run-id>` per workflow status note on an output with no verdict; the verdict test runs first, so a review with a note appended after its verdict, or quoting the note text, still prints `verdict`. `<file>` is the answering workflow the preflight found. `review_failed` binds a note to the run answering the pending trigger, per Round counts' Ended without a verdict: that run must come from the answering workflow, start at or after the trigger, have run a non-skipped `review` job, and have status `completed`; a queued or in-progress re-run keeps the wait going. A note from a write or question run, or from another workflow's run, never ends the wait, whichever bot login posted it. Run the loop in the background (Monitor tool) after one inline sanity check that prints `verdict` against a review already present. The loop's last line decides: `verdict` (it wins whenever any completed verdict exists) goes to step 3; `failed` (the answering review run ended without a verdict) stops with a report that the bot did not respond. Cap the wait at roughly 30 minutes, then stop and report the same.

### 3. Check the review against the stop conditions

Recompute `review_count` and `pr_cycle_count` from the PR history per Round counts in `skills/fix-pr-review/rereview-routing.md`; the round the wait ended on now counts once, and a verification limitation there stops the loop with the missing evidence named. Classify the latest completed round from the review-bot set (its round verdict, step 2's author filter) as fix-pr-review steps 1 and 3 do: verdict (`LGTM` / `Needs Updates`) and which finding sections are present (`Needs Fixing`, `Requires Human Review`, `Recommended Optional`, `Create Follow-up Issue`). A `**Verification limitation:**` line is not a finding. With no bot review yet, there is no verdict. Then run fix-pr-review step 1's two checks on the whole unaddressed trusted set it collects (`skills/fix-pr-review/fetch-recipes.md` Author trust and Collection rules): **nothing to act on** (its bare-LGTM check passes) and **blocking** (the set holds a blocking finding). Untrusted feedback never enters the set. Evaluate in this order:

0. **Merge conflict.** `gh pr view <N> --json mergeable,mergeStateStatus`. A `CONFLICTING`/`DIRTY` PR is never terminal: go to step 4, even on a bare LGTM.
1. **Clean pass, stop.** The verdict is `LGTM` and there is nothing to act on, at any `review_count`. Go to step 5.
2. **Past the cap, stop.** `review_count > 5`, the verdict is `LGTM`, and the set is not blocking, even with `Recommended Optional` or `Create Follow-up Issue` items listed. Go to step 5.
3. **Diverging, stop.** `pr_cycle_count >= 4`, the verdict is `Needs Updates`, and every blocking finding sits in code an earlier cycle of this loop added. Go to step 5, **Diverging** row. A finding sits in code an earlier cycle added when `git blame` at the PR head names a commit that is an ancestor of neither `<first-push-sha>` nor `origin/<baseRefName>`; a line a step 7 base merge brought in is base-branch work and never counts. A blocking finding that cannot be attributed (no `file:line`, or a path or line the head no longer has) defeats this rule. Findings in the first push never trigger it.
4. **Otherwise, keep going.** Every other state, including a `Needs Updates` verdict with rule 3 not fired at any count, and trusted feedback with no bot verdict yet. Go to step 4.

### 4. Resolve the review and loop

Invoke the `fix-pr-review` skill (Skill tool, `skill: fix-pr-review`). It validates every finding, fixes what is real, resolves merge conflicts (its step 7), commits, pushes, posts the disposition comment and its own re-review trigger (its step 10; never add a second one), and decides its own delegation (its step 5). Route on its result:

- **Trigger posted:** record that comment's `id` and `created_at` as the pending trigger and go to step 2; no count changes until step 3 recomputes it from the completed verdict.
- **Retry, no trigger** (the same trigger already followed this pass's disposition, its step 10 retry case): recover that exact comment from the PR history by the URL and `created_at` its report names. With no verdict yet in its round, record it as the pending trigger and go to step 2; with a verdict, go to step 3 and process it. Never post a trigger for the retry.
- **Its step 1 stop** (a bare `LGTM`, or no trusted feedback; nothing to act on): go to step 5 as a clean pass when step 3 had a bot `LGTM` verdict, else post the first-review trigger per step 1 and go to step 2.
- **Its step 7 merge re-review rule:** the rule below decides.
- **Its step 6 stop on an ungrounded failing test:** step 5, **Blocked on a test**.
- **Any other stop** (an irreconcilable conflict, a rejected push, a head mismatch): step 5, **Fixer stopped**.

Only the step 1 stop and the merge rule's prose-only case ever report **Done**.

**Merge re-review rule** (fix-pr-review step 7 owns the decision; `milestone-workflow` step 5 sub-step 3 applies it): on a bare-LGTM PR whose only work this cycle was a base merge, fix-pr-review step 7 decides from the complete diff between the reviewed head and the new head. Prose only keeps the LGTM and posts no trigger; a behavior change, any doubt, or no established reviewed head means it posted `@claude sonnet review` (or `@codex luna review`), so go to step 2. When it posted no trigger under that rule, re-check `gh pr view <N> --json mergeable,mergeStateStatus`. `UNKNOWN` (GitHub recomputing after the push): read again every 30 seconds for up to roughly 5 minutes, then report the bot-never-responded row. `MERGEABLE`: the prior LGTM stands; step 5 as a clean pass. `CONFLICTING`/`DIRTY`: a new base conflict; step 4 again. Only a genuine conflict re-enters fix-pr-review.

### 5. Report

Report the terminal state; never claim blanket success.

| Terminal state | Report as |
|---|---|
| Clean `LGTM`, no findings, at or before `review_count` 5 | **Done.** PR is approved with nothing outstanding. Name each unverified source from any `**Verification limitation:**` lines; they are not outstanding work. |
| `review_count > 5` and an `LGTM` with non-blocking items ended the loop | **Done, with leftovers.** PR is approved; list the optional/follow-up items left unaddressed, plus any unverified sources. |
| Rule 3 fired | **Diverging, escalate the scope call.** Report `pr_cycle_count`, the PR's growth measured base-excluded per fix-pr-review step 4's growth check, and the chain: per cycle, the finding it fixed and the finding that fix produced. Name the mechanisms the PR grew that its scope yardstick (the linked issue(s), else the PR body) never asked for. Recommend one: revert to the last cycle whose findings were all in the original work and file the rest, or narrow the PR to the yardstick and file the remainder. Do not start another cycle. |
| fix-pr-review stopped before commit on an ungrounded failing test | **Blocked on a test.** Report the test with its `file:line`, what it asserts, and the conflict; no push or re-review happened, and the maintainer decides. |
| fix-pr-review stopped with no trigger for another reason (an irreconcilable conflict, a rejected push, a head mismatch) | **Fixer stopped, escalate.** Relay fix-pr-review's stop reason, the blocking work left, and any work it left uncommitted, unpushed, or unposted; no re-review happened, and the maintainer decides. |
| Bot never responded within the wait window | **Escalate.** The PR is pushed but review never landed; name the unanswered trigger's URL; the user checks the bot's Action status. A restart reposts that trigger by step 1's stale-or-failed case: at once when its review run ended without a verdict (name the run log), and once it is stale when no run answered. The user can also post it again or re-run the failed job. |
| PR was already `merged`/`closed` at start | **Nothing to drive.** Report the state; zero cycles ran. |

Always give the PR URL, cycles run, final verdict, and (when escalating) exactly what is left. Write the report per the Response Style rules in CLAUDE.md/AGENTS.md; the unverified-source list sits outside the word cap.

## Red Flags

- Latest "review" is your own disposition or trigger comment: skip it and keep polling.
- A verdict-shaped comment or review (a standalone `LGTM` or `Needs Updates` line, with or without a header) from outside the review-bot set is never the step 3 verdict or a round: it never ends the wait, changes a count, or reports **Done** by itself. Step 3's checks still read it when its author is trusted; an untrusted one never counts.
- PR closed or merged mid-loop: stop at once; never push to a closed or merged PR.
- Counting in memory: `review_count` and `pr_cycle_count` come only from the completed rounds in the PR history (Round counts), recomputed at step 1 and at every step 3. Never increment on a posted trigger, seed a count to one, or count a pending trigger; a restart then reads the same values an uninterrupted run holds.
- Posting a second trigger: fix-pr-review step 10 already posts the re-review trigger, and a pending or retried trigger is recovered, never reposted.
