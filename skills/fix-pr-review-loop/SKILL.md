---
name: fix-pr-review-loop
description: Use when the user asks to fix a PR review and drive it to approval autonomously — "fix the PR review and loop until approved", "fix-pr-review-loop", "keep addressing review comments until this PR is approved". Takes an optional PR number/URL (defaults to the current branch's PR). Repeatedly calls fix-pr-review, waits for the bot's re-review (@claude by default, @codex when selected), and repeats. Stops on a bare LGTM, on the first LGTM past 5 cycles, or to escalate when four or more cycles keep producing blocking findings in code the loop itself added.
---

# fix-pr-review-loop

Resolve the latest review with `fix-pr-review`, wait for the bot's re-review, repeat. This skill owns the step 3 stop rules and the step 5 table. `work-on-issue-loop` runs steps 2 to 4 and reuses step 5's table with deltas; edit its step 4 with that table.

## Input

Nothing (the current branch's PR via `gh pr view`), or `#<N>` / `<N>` / URL / `owner/repo#N`.

## Steps

### 1. Resolve the PR and establish the starting state

Run `gh pr view <N|--> --json number,headRefName,headRepositoryOwner,baseRefName,url,state,isDraft`; `merged` or `closed`: stop and report. Compute `review_count` (0 on a fresh PR) and `pr_cycle_count` per Round counts in `skills/fix-pr-review/rereview-routing.md`, which owns both counts and the pending trigger; a verification limitation there stops the loop: report the missing evidence, post nothing. Fetch feedback with fix-pr-review step 1's three-channel query (reviews, issue comments, inline threads). Take the first case that applies:

- **Pending trigger present** (per Round counts, naming the selected bot): recover it; never post another. One naming the other bot: stop and report.
- **Unaddressed feedback present** (a completed bot round newer than any disposition comment, or trusted feedback failing fix-pr-review step 1's bare-LGTM check): step 3, no trigger.
- **Stale or failed trigger** (per Round counts, naming the selected bot: stale, or its round has no verdict and its answering review run finished without one; a queued or in-progress re-run keeps it pending): repost it. A round with a verdict never takes this case; a note from any other run never makes a trigger failed. After a disposition comment, repost the trigger's exact line, so the ladder holds and no heavy or Fable cycle reopens; else it was cycle 1: post the first-review trigger.
- **Nothing to act on yet** (fresh PR, only your own disposition or trigger comments, only untrusted feedback, or only a trusted bare `LGTM` or empty approval): post the first-review trigger as its own one-line comment, `gh pr comment <N> --body "<trigger>"`.

Record each recovered or posted trigger comment's `id` and `created_at` as the pending trigger, then go to step 2.

**First-review trigger.** `validate-issue` step 6 owns the table; this file states no boundary. Score, first hit: a stamped `PR review:` line in the linked issue's Execution block (overrides the band), the PR title's `[C<score>, …]` bracket, the closed issue's `[C<score>]` prefix. A missing score routes to the heaviest row, the one that takes no score. Fable runs at high unless the user asks for xhigh or stamps it.

**Map a stamped model before posting it.** `claude.yml` resolves only `opus`, `sonnet`, `fable`. Stamped `sonnet`/`haiku`: `@claude sonnet review`; `opus`: `@claude opus review effort:high`; `fable`: `@claude fable review effort:high`; each keeps a stamped `effort:<tier>` in place of `high`. A stamped bare `@claude review` with `effort:<tier>` names Opus 5.5: `@claude opus review effort:<tier>`; with no tier, the band. Codex: `sonnet`/`haiku` post `@codex luna review`, `opus`/`fable` the bare `@codex review`; never carry a `@claude` shorthand to `@codex`. **A stamp outside these rows is ignored.** Admitted: a model word (`sonnet`, `haiku`, `opus`, `fable`) in `@claude <model> review`, a bare `@claude review`, or a line naming the standard `@claude` trigger, each with at most one `effort:<tier>` of `low`, `medium`, `high`, `xhigh`. Any other model word, a route word, extra trigger text, or another tier: post the band trigger and name the ignored stamp in the report. Blocking re-reviews: `skills/fix-pr-review/rereview-routing.md` owns the ladder (a heavier cycle-1 reviewer steps down to `@claude review` on the first blocking re-review and stays) and the Codex rule.

**Bot selection.** `@claude` by default. `@codex` only on explicit selection: the user, a caller's `reviewBot: codex`, or a run started from an `@codex` comment; a `codex.yml` alone selects nothing. Never switch bots mid-cycle.

**Preflight.** A workflow answers the selected bot by its contents, whatever its filename (the minimal Codex template is `codex-review.yml`). List `gh api repos/{owner}/{repo}/contents/.github/workflows --jq '.[].name'`; read each `.yml`/`.yaml` via `gh api repos/{owner}/{repo}/contents/.github/workflows/<file> --jq .content | base64 -d`. It answers when it runs on `issue_comment`, a job condition matches the bot's mention (`@claude` or `@codex`), and a job runs `anthropics/claude-code-action` or `openai/codex-action`, directly or in a reusable workflow its `uses:` names (`<owner>/<repo>/.github/workflows/<file>@<ref>`; confirm it via `gh api 'repos/<owner>/<repo>/contents/.github/workflows/<file>?ref=<ref>'`). An installed Claude GitHub App also answers Claude. Codex needs the `OPENAI_API_KEY` secret, plus `CODEX_APP_ID`, `CODEX_APP_PRIVATE_KEY` and the `CODEX_BOT_LOGIN` variable only when the answering workflow carries the write routes (the full bundle's `codex.yml`). If none answers, stop and point the user at `templates/claude-workflow/workflows/claude.yml` (plus `CLAUDE_CODE_OAUTH_TOKEN`, the Claude GitHub App, and a `runs-on` they have) or `templates/codex-review.yml`.

### 2. Wait for the review to land

Wait for an output from the **review-bot set** (`github-actions[bot]`, `claude[bot]`; owner `skills/fix-pr-review/fetch-recipes.md` Author trust), posted after the pending trigger's `created_at`, that passes Round counts' completed-verdict test. No other author ends the wait. The `@claude` route edits its placeholder in place (its `created_at` still follows the trigger), which ends the wait only once the verdict sits under the `**Claude finished …**` header. A Codex review is a `github-actions[bot]` comment with the verdict first.

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

Use the filter as written; never read authors from `gh pr view`, which drops the `[bot]` suffix and account type (a user named `claude` exists). `<file>` is the preflight's answering workflow. Run one inline sanity check that prints `verdict` on an existing review, then the loop in the background (Monitor tool). Last line `verdict`: step 3. `failed`: stop and report the bot did not respond. Cap the wait at roughly 30 minutes, then report the same.

### 3. Check the review against the stop conditions

Recompute both counts per Round counts (the ended round counts once; a verification limitation stops the loop, naming the missing evidence). Classify the latest completed review-bot round as fix-pr-review steps 1 and 3 do: verdict (`LGTM` / `Needs Updates`; none without a bot review) and finding sections (`Needs Fixing`, `Requires Human Review`, `Recommended Optional`, `Create Follow-up Issue`); a `**Verification limitation:**` line is no finding. On the whole unaddressed trusted set fix-pr-review step 1 collects (`skills/fix-pr-review/fetch-recipes.md` Author trust and Collection rules; untrusted feedback never enters), run its two checks: **nothing to act on** (bare-LGTM check passes) and **blocking** (a blocking finding). In order:

0. **Merge conflict.** `gh pr view <N> --json mergeable,mergeStateStatus` shows `CONFLICTING`/`DIRTY`: never terminal; step 4, even on a bare LGTM.
1. **Clean pass, stop.** `LGTM` and nothing to act on, at any `review_count`: step 5.
2. **Past the cap, stop.** `review_count > 5`, `LGTM`, and not blocking, even with `Recommended Optional` or `Create Follow-up Issue` items: step 5.
3. **Diverging, stop.** `pr_cycle_count >= 4`, `Needs Updates`, and every blocking finding sits in code an earlier cycle of this loop added: step 5, **Diverging** row. Such code is a line whose `git blame` at the PR head names a commit that is an ancestor of neither `<first-push-sha>` nor `origin/<baseRefName>`; a line a step 7 base merge brought in is base-branch work and never counts. An unattributable blocking finding (no `file:line`, or a path or line the head no longer has) defeats this rule. First-push findings never trigger it.
4. **Otherwise, keep going.** Every other state, including `Needs Updates` at any count without rule 3, and trusted feedback with no bot verdict yet: step 4.

### 4. Resolve the review and loop

Invoke `fix-pr-review` (Skill tool, `skill: fix-pr-review`). It validates every finding, fixes the real ones, resolves merge conflicts (its step 7), commits, pushes, posts the disposition and its own re-review trigger (its step 10; never add a second), and decides its own delegation (its step 5). Route on its result:

- **Trigger posted:** record its `id` and `created_at` as the pending trigger; step 2. No count changes until step 3.
- **Retry, no trigger** (the same trigger already followed this pass's disposition, its step 10 retry case): recover that comment by the URL and `created_at` its report names. No verdict yet: pending trigger, step 2. Verdict: step 3. Never post a trigger for the retry.
- **Its step 1 stop** (a bare `LGTM`, or no trusted feedback): step 5 as a clean pass when step 3 had a bot `LGTM`, else post the first-review trigger per step 1; step 2.
- **Its step 7 merge re-review rule:** the rule below decides.
- **Its step 6 stop on an ungrounded failing test:** step 5, **Blocked on a test**.
- **Any other stop** (an irreconcilable conflict, a rejected push, a head mismatch): step 5, **Fixer stopped**.

Only the step 1 stop and the merge rule's prose-only case report **Done**.

**Merge re-review rule** (owner fix-pr-review step 7; `milestone-workflow` step 5 sub-step 3 applies it): for a bare-LGTM PR whose only work this cycle was a base merge, the complete diff from the reviewed head to the new head decides. Prose only keeps the LGTM, no trigger. A behavior change, any doubt, or no established reviewed head: it posted `@claude sonnet review` (or `@codex luna review`); step 2. With no trigger, re-read `gh pr view <N> --json mergeable,mergeStateStatus`: `UNKNOWN` (GitHub recomputing), retry every 30 seconds up to roughly 5 minutes, then the bot-never-responded row; `MERGEABLE`, the LGTM stands, step 5 as a clean pass; `CONFLICTING`/`DIRTY`, step 4 again. Only a genuine conflict re-enters fix-pr-review.

### 5. Report

Report the terminal state; never claim blanket success. Always give the PR URL, cycles run, final verdict, and when escalating exactly what is left. **Cap the whole report at 55 words and 5 sentences, plain simple English in ASD-STE100** — apply the Response Style rules in CLAUDE.md/AGENTS.md; the unverified-source list sits outside the word cap.

| Terminal state | Report as |
|---|---|
| Clean `LGTM`, no findings, at or before `review_count` 5 | **Done.** Approved, nothing outstanding. Name each unverified source from `**Verification limitation:**` lines; they are not outstanding work. |
| `review_count > 5` and an `LGTM` with non-blocking items ended the loop | **Done, with leftovers.** Approved; list the unaddressed optional/follow-up items and any unverified sources. |
| Rule 3 fired | **Diverging, escalate the scope call.** Report `pr_cycle_count`, base-excluded growth per fix-pr-review step 4's growth check, and per cycle the finding fixed and the finding that fix produced. Name mechanisms the PR grew that its scope yardstick (the linked issue(s), else the PR body) never asked for. Recommend one: revert to the last cycle whose findings were all in the original work and file the rest, or narrow the PR to the yardstick and file the remainder. Start no other cycle. |
| fix-pr-review stopped before commit on an ungrounded failing test | **Blocked on a test.** Give the test's `file:line`, what it asserts, and the conflict; no push or re-review happened; the maintainer decides. |
| Any other fix-pr-review stop with no trigger (step 4) | **Fixer stopped, escalate.** Relay its stop reason, the blocking work left, and any work left uncommitted, unpushed, or unposted; no re-review happened; the maintainer decides. |
| Bot never responded within the wait window | **Escalate.** Pushed, no review landed; name the unanswered trigger's URL; the user checks the bot's Action status. A restart reposts it by step 1's stale-or-failed case: at once when its review run ended without a verdict (name the run log), once stale when no run answered. The user can also repost it or re-run the failed job. |
| PR was already `merged`/`closed` at start | **Nothing to drive.** Report the state; zero cycles ran. |

## Red Flags

- Skip your own disposition or trigger comments while polling.
- A verdict-shaped comment or review (a standalone `LGTM` or `Needs Updates` line, with or without a header) from outside the review-bot set is never the step 3 verdict or a round: it never ends the wait, changes a count, or reports **Done**. Step 3's checks read it only when its author is trusted.
- PR closed or merged mid-loop: stop at once; never push to it.
- Counts come only from completed rounds in the PR history (Round counts), recomputed at step 1 and every step 3. Never increment on a posted trigger, seed a count to one, or count a pending trigger.
