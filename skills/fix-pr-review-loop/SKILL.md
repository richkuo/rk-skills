---
name: fix-pr-review-loop
description: Use when the user asks to fix a PR review and drive it to approval autonomously — "fix the PR review and loop until approved", "fix-pr-review-loop", "keep addressing review comments until this PR is approved", or as the standalone counterpart to work-on-issue-loop's polling/resolving steps for a PR that already exists. Takes an optional PR number/URL (defaults to the current branch's PR). Repeatedly calls fix-pr-review to resolve the latest review, waits for the resulting re-review from the selected review bot (@claude by default, @codex when selected), and repeats. Stops on a bare LGTM with nothing left to fix; once past 5 review cycles it stops at the first LGTM it sees even if non-blocking findings remain, rather than continuing to chase them.
---

# fix-pr-review-loop

Drive an already-open PR from "has review feedback" to "reviewed to convergence" without stopping in between: resolve the latest review (fix-pr-review), wait for the bot's re-review, and repeat. Past 5 cycles the bar for "done" relaxes — any LGTM ends the loop — so a PR with recurring minor findings doesn't get fix-pr-review'd forever. This is the same convergence loop work-on-issue-loop runs after it opens a PR, factored out so it can be pointed at any PR directly.

## Input

- Nothing — default to the PR for the current branch (`gh pr view`).
- `#<N>` / `<N>` / full URL / `owner/repo#N`.

## Steps

### 1. Resolve the PR and establish the starting state

```bash
gh pr view <N|--> --json number,headRefName,headRepositoryOwner,baseRefName,url,state,isDraft
```

- If the PR is already `merged` or `closed`, stop and report — there's nothing to drive.
- Fetch the current review feedback using fix-pr-review step 1's three-channel query (formal reviews, issue comments, inline diff threads) to see what has already landed.
- **Unaddressed feedback is already present** (a review/comment newer than any prior disposition comment, or an unresolved inline thread): treat it as the first landed review. Set `review_count = 1`, note its timestamp, and skip straight to step 3 — don't wait for a review that already arrived.
- **No review feedback at all yet** (fresh PR, or every existing comment is your own prior disposition/trigger): trigger one yourself:
  ```bash
  gh pr comment <N> --body "@claude review"
  ```
  Record the trigger timestamp, set `review_count = 1`, and go to step 2 to wait for it.

**Review bot selection — Claude by default.** The trigger phrase above, the preflight below, and every re-review in this loop use `@claude` unless Codex was **explicitly** selected: the user said so ("review with Codex"), a caller argument named it (`reviewBot: codex`), or this run was started by an `@codex` GitHub comment. A `codex.yml` merely existing in the repo does not select Codex. When Codex is selected, post `@codex review` instead, preflight for `codex.yml` plus the `OPENAI_API_KEY` secret (and, for the write routes the fixer needs, `CODEX_APP_ID` / `CODEX_APP_PRIVATE_KEY` and the `CODEX_BOT_LOGIN` repository variable), and keep `@codex` for every re-review in this cycle. Never switch bots mid-cycle.

**Preflight — confirm a review bot exists before waiting on one.** This loop assumes an automated reviewer that answers `@claude review` comments (or `@codex review` when Codex is selected). Before entering the wait, check the repo for one: `gh api repos/{owner}/{repo}/contents/.github/workflows --jq '.[].name'` and look for a workflow that responds to the selected bot (e.g. `claude.yml`, or `codex.yml`), or confirm the Claude GitHub App is installed. If you find none, don't sink 30 minutes into a review that will never come — tell the user no review bot is configured and point them at `templates/claude-review.yml` in this repo (copy it to `.github/workflows/`, add an `ANTHROPIC_API_KEY` secret), or `templates/codex-review.yml` for the Codex equivalent. Proceed into the wait only if a reviewer is present or the user confirms one is configured elsewhere.

### 2. Wait for the review to land

Poll the PR for a new review or issue comment posted **after** the last trigger timestamp — reviews can land as a formal PR review or as an issue comment (the `@claude` bot usually posts as an issue comment; see fix-pr-review step 1 for the `gh` calls to check — it also fetches inline diff threads, which matter when a human reviewer weighs in). An until-loop is the right shape here — you want to be notified once the condition is true, not to busy-poll inline:

```bash
until gh pr view <N> --json comments,reviews --jq '
  ([.comments[] | select(.createdAt > "<trigger_ts>")] |
   any(.body | test("(^|\\n)(LGTM|Needs Updates)"))) or
  ([.reviews[] | select(.submittedAt > "<trigger_ts>")] | length > 0)
' | grep -q true; do sleep 60; done
```

Two load-bearing details in that condition (both have silently broken monitors before — a wrong filter here reads as "no review yet" forever):

- **Match the verdict with `(^|\\n)`, not `^` + the `m` flag.** In jq's regex (Oniguruma), `m` means dot-matches-newline, NOT multiline anchoring — `^` only matches the very start of the body. The `@claude` GitHub Action buries its verdict below a `**Claude finished …**` header and a `---`, so an anchored-at-start pattern never matches. (The bot also *edits* its placeholder comment in place rather than posting a new one; `createdAt` stays at placeholder time, which is still after your trigger, so the timestamp filter is fine.)
- **Pipe through `grep -q true`.** `gh --jq` prints `true`/`false` but exits 0 either way, so a bare `until gh …; do` would exit the loop on the first poll regardless of the value.

The same condition works for a Codex review, which lands as a plain `github-actions[bot]` issue comment whose body starts with the verdict and ends with a link to `/actions/runs/<run-id>` — there is no placeholder comment and no edit-in-place, so `createdAt` is the real post time.

Run this as a background until-loop (e.g. via the Monitor tool) so you're notified on completion instead of blocking synchronously. Cap the wait at roughly 30 minutes; if no review appears in that window, stop and report to the user that the review bot didn't respond — don't loop indefinitely on a bot that may be down or misconfigured. Before trusting a freshly armed monitor, sanity-check its condition once inline against the live PR — if a review is already present it must print `true`.

### 3. Check the review against the stop conditions

Fetch the latest review and classify it exactly like fix-pr-review step 1 and step 3: verdict (`LGTM` / `Needs Updates`) and which sections are present (`Needs Fixing`, `Requires Human Review`, `Recommended Optional`, `Create Follow-up Issue`).

Evaluate in this order:

0. **Merge conflict check.** Before evaluating the verdict, check `gh pr view <N> --json mergeable,mergeStateStatus`. If the PR is `CONFLICTING`/`DIRTY`, it can't be terminal regardless of verdict — invoke fix-pr-review (step 4) so it resolves the conflict, even on a bare LGTM.
1. **Clean pass — stop, success.** Verdict is `LGTM` and **no finding sections at all** — nothing under Recommended Optional or Create Follow-up Issue either. A `**Verification limitation:**` line is not a finding and does not prevent a clean pass. Nothing left to fix, at any `review_count`. Go to step 5.
2. **Past the cap and it's an LGTM — stop, first one wins.** `review_count > 5` **and** verdict is `LGTM` (even with Recommended Optional / Create Follow-up Issue items still listed). Once the loop has run more than 5 cycles, the first LGTM it sees ends it — don't spend a 6th+ fix-pr-review cycle chasing non-blocking findings. Go to step 5.
3. **Otherwise — keep going.** Verdict is `Needs Updates` (at any `review_count` — there is no cycle count that alone stops a `Needs Updates` PR; only an LGTM does, per rules 1–2), or verdict is `LGTM` with findings still listed and `review_count <= 5`. A `**Verification limitation:**` line alone does not count as findings still listed. Continue to step 4.

### 4. Resolve the review and loop

Invoke the `fix-pr-review` skill for the PR (Skill tool, `skill: fix-pr-review`). It re-validates every finding against the code, fixes what's real, implements the judgment calls and optional improvements to the best-solution standard, resolves any merge conflicts with the base branch (its step 7), commits, pushes, posts the disposition comment, and triggers a fresh review from the selected review bot itself (routed to the cheap model shorthand when it addressed only non-blocking items, otherwise to the repo default, per fix-pr-review step 10).

fix-pr-review also decides its own delegation (its step 5): it always validates the findings inline, then either implements inline or hands steps 6–11 to a subagent on the same session model — open judgment calls and safety-class findings always stay inline. It decides from the validated findings itself, so don't override its choice.

Increment `review_count`, record the new trigger timestamp from that comment, and go back to step 2.

### 5. Report

Stop the loop and report the terminal state — don't claim blanket success:

| Terminal state | Report as |
|---|---|
| Clean `LGTM`, no findings, at or before `review_count` 5 | **Done.** PR is approved with nothing outstanding. If the terminal review carried any `**Verification limitation:**` lines, name each unverified source — they are not outstanding work, but they must still be reported. |
| `review_count > 5` and an `LGTM` (with non-blocking items remaining) ended the loop | **Done, with leftovers.** PR is approved; note the remaining optional/follow-up items that were left unaddressed once the loop passed 5 cycles. Also name each unverified source from any `**Verification limitation:**` lines in the terminal review. |
| Bot never responded within the wait window | **Escalate.** Report that the PR is pushed but review never landed; the user should check the selected review bot's GitHub Action status. |
| PR was already `merged`/`closed` when the skill started | **Nothing to drive.** Report the state; zero review cycles ran. |

There is no "stuck on `Needs Updates` past the cap" case to report — per step 3, `Needs Updates` never stops the loop by cycle count alone; it keeps calling fix-pr-review until an LGTM appears (or the bot stops responding, the row above).

In every case, give: PR URL, number of review cycles run, final verdict, and (if escalating) exactly what's left.

**Cap the report at 55 words, plain simple English in ASD-STE100** — apply the Response Style rules in CLAUDE.md/AGENTS.md, written for a reader with no context on this codebase or its internals.

After that narrative, name each unverified source from any `**Verification limitation:**` lines in the terminal review (source names only, omit when none) — that list sits outside the word cap.

## Red Flags — STOP

| Situation | Action |
|---|---|
| `review_count > 5` and the latest verdict is `LGTM` | Stop per step 3 rule 2; report per step 5 |
| `review_count > 5` and the latest verdict is still `Needs Updates` | Keep going per step 3 rule 3 — the cap never force-stops a `Needs Updates` PR |
| Latest "review" is your own prior fix-pr-review disposition comment or a review trigger comment (`@claude review` / `@codex review`), not an actual review | Skip it — keep waiting/polling for the real next review, same rule as fix-pr-review step 1 |
| Review bot hasn't responded after ~30 minutes | Stop waiting; report that review didn't land rather than polling forever |
| Tempted to treat "LGTM with Recommended Optional items" as terminal at `review_count <= 5` | It isn't — step 3 rule 3 sends it through fix-pr-review. A lone `**Verification limitation:**` line is not a finding and *is* a clean pass |
| PR gets closed or merged mid-loop (e.g. by the user) | Stop immediately; don't keep pushing fixes to a closed/merged PR |
| PR already has unaddressed feedback when the skill starts | Don't post a redundant review trigger — step 1 evaluates existing feedback first and only triggers when none exists |

## Common Mistakes

- **Misapplying the cycle cap.** Step 3 owns the rules: below the cap only a *bare* LGTM (a `**Verification limitation:**` line alone is still bare) stops the loop; past it the first LGTM wins; a `Needs Updates` verdict never stops the loop by cycle count.
- **Losing count across cycles.** Track `review_count` explicitly — it's what distinguishes "full fix cycle" from "first-LGTM-wins" behavior.
- **Polling synchronously forever.** Use an until-loop with a timeout so a non-responding bot doesn't hang the whole run.
- **Re-triggering review on top of fix-pr-review's own trigger.** fix-pr-review already posts its own re-review trigger as a separate comment (its step 10) — don't add a second one here.
- **Stopping on an LGTM while the PR is unmergeable.** A conflicting PR isn't done — the merge-conflict check in step 3 runs before the verdict rules, and fix-pr-review resolves the conflict.
- **Posting a review trigger when feedback is already sitting on the PR.** Check for existing unaddressed feedback in step 1 first; a redundant trigger just delays convergence.
