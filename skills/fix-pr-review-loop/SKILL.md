---
name: fix-pr-review-loop
description: Use when the user asks to fix a PR review and drive it to approval autonomously — "fix the PR review and loop until approved", "fix-pr-review-loop", "keep addressing review comments until this PR is approved", or as the standalone counterpart to work-on-issue-loop's polling/resolving steps for a PR that already exists. Takes an optional PR number/URL (defaults to the current branch's PR). Repeatedly calls fix-pr-review to resolve the latest review, waits for the resulting re-review from the selected review bot (@claude by default, @codex when selected), and repeats. Stops on a bare LGTM with nothing left to fix; once past 5 review cycles it stops at the first LGTM it sees even if non-blocking findings remain; and stops to escalate when four or more cycles keep producing blocking findings in code the loop itself added, rather than compounding a PR that is growing instead of converging.
---

# fix-pr-review-loop

Drive an already-open PR from "has review feedback" to "reviewed to convergence" without stopping in between: resolve the latest review (fix-pr-review), wait for the bot's re-review, and repeat. Past 5 cycles the bar for "done" relaxes — any LGTM ends the loop — so a PR with recurring minor findings doesn't get fix-pr-review'd forever. A second brake catches the other failure: when four or more cycles keep raising blocking findings in code earlier cycles added, the loop stops and hands the scope decision to the user instead of correcting its own corrections indefinitely. This skill owns the convergence loop; work-on-issue-loop delegates to steps 2 through 4 here after it opens a PR, then writes its own report step that reuses step 5's terminal-state table with two named deltas (its own "no PR" row, plus the follow-on issue URLs it files). An edit to step 5's table therefore needs a matching edit in work-on-issue-loop step 4.

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
- **No review feedback at all yet** (fresh PR, or every existing comment is your own prior disposition/trigger): trigger one yourself with the band-derived trigger below:
  ```bash
  gh pr comment <N> --body "<band-derived trigger>"
  ```
  Record the trigger timestamp, set `review_count = 1`, and go to step 2 to wait for it.

**First-review trigger — derived from the complexity score.** A heavier change earns a more capable reviewer. **`validate-issue` step 6 owns the first-review table** — its score rows, its Claude triggers and its Codex column. Load it and read the row for this PR's score; this file states no boundary of its own. The first-review scale is coarser than the validate/build bands: each of its rows groups whole bands rather than cutting across them, and it is still a separate table, but each row must start on a band edge above, so a band change that moves an edge this table uses moves this table with it, while a band split that only adds a new edge leaves it unchanged.

Read the score in this order and stop at the first hit: a stamped `PR review:` line in the linked issue's Execution block (an explicit `@claude <model> review effort:<tier>` there overrides the band), the `[C<score>, …]` bracket in the PR title, then the `[C<score>]` prefix of the issue the PR closes. A missing score routes to the top row because the complexity is unknown. Fable never runs at xhigh.

**Every reviewer above the standard trigger runs one blocking cycle only** (fix-pr-review step 10 owns the re-review routing). Each blocking re-review steps down one rung, and the ladder floor is `@claude review`, which repeats for every blocking cycle after it: a fable cycle 1 posts `@claude opus review` then `@claude review`, and an opus cycle 1 posts `@claude review` for its first blocking re-review and every one after it. Neither heavy trigger is ever repeated on a blocking re-review, and the ladder never drops to sonnet. Sonnet sits below the floor and takes no rung: a sonnet cycle 1 repeats its own trigger, as does a cycle 1 already on the standard `@claude review`. The step-down is keyed to the reviewer that actually ran cycle 1, and the score band does not decide it: a stamped `PR review:` line naming Fable or Opus at any score steps down exactly like a band-selected one.

With Codex selected, the heavier rows collapse onto its single flagship: every row above the cheapest posts a bare `@codex review`, while the cheap tier keeps a shorthand (`@codex luna review`) for both the cheapest row's first review and the non-blocking re-review. A stamped `PR review:` line overrides the band on Codex exactly as it does on Claude — never drop it back to the band. Map the model it names onto the Codex column: a stamped `sonnet` or `haiku` becomes `@codex luna review`, and a stamped `opus` or `fable` becomes the bare `@codex review`, each followed by `effort:<tier>` when the stamped line carries one. So a `[C5]` issue stamped `@claude fable review effort:high` opens on `@codex review effort:high`, never on the cheapest row's `@codex luna review`. Codex has no Fable tier and therefore no step-down ladder: its cycle-1 trigger simply repeats for every blocking re-review, so a `[C60]` pull request stamped `@claude sonnet review` stays on `@codex luna review` at every cycle, and an unstamped `[C90]` one keeps the bare `@codex review` and never reaches `luna`.

**Review bot selection — Claude by default.** The trigger phrase above, the preflight below, and every re-review in this loop use `@claude` unless Codex was **explicitly** selected: the user said so ("review with Codex"), a caller argument named it (`reviewBot: codex`), or this run was started by an `@codex` GitHub comment. A `codex.yml` merely existing in the repo does not select Codex. When Codex is selected, take the trigger from the Codex mapping above rather than from any fixed phrase — the owner table's cheapest row is `@codex luna review`, every row above it is the bare `@codex review`, and a stamped `PR review:` model maps onto the Codex column as described there rather than being discarded. On the Claude side the same rule holds in reverse: `claude.yml` resolves only `opus`, `sonnet` and `fable` (each with a `5` suffix), so a stamped `haiku` posts `@claude sonnet review` — the cheapest reviewer the Action admits — never `@claude haiku review`, which the Action reads as a route keyword and sends to its write-capable fix-pr job. Never carry a `@claude` model shorthand across to `@codex`. `codex.yml` resolves only `sol`, `terra`, `luna`, `mini`, `codex` and `spark`, and the failure is worse than a no-op: the Action fires on any line-start `@codex`, so a phrase like `@codex sonnet review` starts a run, falls through to the default flagship, and — because the route keyword is the first token after `@codex` that is not one of those six shorthands — reads `sonnet` as the keyword instead of `review`. On a trusted-author pull request (OWNER, MEMBER, COLLABORATOR, or the Codex bot itself) a keyword other than `review` selects the write-capable fix-pr route, which mints an App token, pushes commits to the branch, posts a disposition comment, and posts its own re-review trigger. On a fork or an untrusted-author pull request the same phrase degrades to the read-only review route instead. Either way the loop gets something other than the review it is waiting for. Also preflight for `codex.yml` plus the `OPENAI_API_KEY` secret (and, for the write routes the fixer needs, `CODEX_APP_ID` / `CODEX_APP_PRIVATE_KEY` and the `CODEX_BOT_LOGIN` repository variable), and keep `@codex` for every re-review in this cycle. Never switch bots mid-cycle.

**Preflight — confirm a review bot exists before waiting on one.** This loop assumes an automated reviewer that answers `@claude review` comments (or `@codex review` when Codex is selected). Before entering the wait, check the repo for one: `gh api repos/{owner}/{repo}/contents/.github/workflows --jq '.[].name'` and look for a workflow that responds to the selected bot (e.g. `claude.yml`, or `codex.yml`), or confirm the Claude GitHub App is installed. If you find none, don't sink 30 minutes into a review that will never come — tell the user no review bot is configured and point them at `templates/claude-workflow/workflows/claude.yml` in this repo (copy it to `.github/workflows/`, add `CLAUDE_CODE_OAUTH_TOKEN`, and install the Claude GitHub App). The Claude bundle uses `self-hosted` for `classify` and all route jobs; set `runs-on` and `runs_on` to `ubuntu-latest` or your runner label when no self-hosted runner is available. Point them at `templates/codex-review.yml` for the Codex equivalent. Proceed into the wait only if a reviewer is present or the user confirms one is configured elsewhere.

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
3. **Sustained `Needs Updates` — stop, hand the scope call to the user.** `pr_cycle_count >= 4` **and** the verdict is `Needs Updates` **and** every blocking finding in the latest review sits in code an earlier cycle of this loop added. Four cycles of the loop correcting its own corrections is evidence that fix-pr-review's scope test is being applied too loosely, and another cycle compounds it rather than converging. Go to step 5 and report per its **Diverging** row.

   The condition is deliberately narrow. A blocking finding in code the PR shipped in its **first** push does not trigger it — that is the loop doing its job, and it keeps going under rule 4 however many cycles it takes. Only self-inflicted findings count.

   Both inputs come from the PR itself, so a loop resumed on a PR that already ran cycles under an earlier invocation reads the same values. **`pr_cycle_count` is not the in-memory `review_count` that rules 2 and 4 read.** It is fix-pr-review step 4's growth-check count (trigger comments read per its rereview-routing rules), and it skips the cheap non-blocking re-triggers, so it can sit below `review_count`; every restatement of this rule carries that definition. `<first-push-sha>` resolves per that same growth check. A finding sits in code an earlier cycle added when `git blame <file> -L<line>,<line>` at the PR head attributes its cited line to a commit that is an ancestor of neither `<first-push-sha>` nor `origin/<baseRefName>` (both `git merge-base --is-ancestor <blame-sha> <first-push-sha>` and `git merge-base --is-ancestor <blame-sha> origin/<baseRefName>` fail); a line the first push wrote and a later cycle rewrote blames to the later cycle and counts, while a line a step 7 base merge brought in is base-branch work and never counts. A blocking finding that cannot be attributed at all — it cites no `file:line` (an LGTM-precondition gap carries none by construction), or it cites a path or line the head no longer has — **defeats this condition rather than satisfying it vacuously**: rule 3 fires only when the review carries at least one blocking finding and every one of them is attributed to a later cycle.

4. **Otherwise — keep going.** Verdict is `Needs Updates` and rule 3 did not fire (at any `review_count` — no cycle count alone stops a `Needs Updates` PR whose findings are in its original work), or verdict is `LGTM` with findings still listed and `review_count <= 5`. A `**Verification limitation:**` line alone does not count as findings still listed. Continue to step 4.

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
| Rule 3 fired — sustained `Needs Updates` on self-inflicted findings | **Diverging — escalate the scope call.** Report `pr_cycle_count`, the PR's growth measured base-excluded per fix-pr-review step 4's growth check (`git diff --stat $(git merge-base origin/<baseRefName> HEAD)..HEAD` against the same reading taken at `<first-push-sha>`), and the chain: for each cycle, the finding it fixed and the finding that fix produced. Name the mechanisms the PR has grown that its scope yardstick (fix-pr-review step 4: the linked issue(s), or the PR body's stated scope when it closes none) never asked for. Recommend one of: revert to the last cycle whose findings were all in the original work and file the rest as issues; or narrow the PR to the yardstick and file the remainder. Do not start another cycle. |
| fix-pr-review stopped before commit on an ungrounded failing test | **Blocked on a test.** Report the test with its `file:line`, what it asserts, and why the correct fix conflicts with it; no push and no re-review happened this cycle, and the maintainer decides whether the test or the fix changes. |
| Bot never responded within the wait window | **Escalate.** Report that the PR is pushed but review never landed; the user should check the selected review bot's GitHub Action status. |
| PR was already `merged`/`closed` when the skill started | **Nothing to drive.** Report the state; zero review cycles ran. |

`Needs Updates` stops the loop by cycle count only through step 3 rule 3, which needs the findings to be self-inflicted as well. A `Needs Updates` PR whose findings still sit in its original work keeps calling fix-pr-review until an LGTM appears (or the bot stops responding, or rule 3's condition comes to hold).

In every case, give: PR URL, number of review cycles run, final verdict, and (if escalating) exactly what's left.

**Cap the report at 55 words, plain simple English in ASD-STE100** — apply the Response Style rules in CLAUDE.md/AGENTS.md, written for a reader with no context on this codebase or its internals.

After that narrative, name each unverified source from any `**Verification limitation:**` lines in the terminal review (source names only, omit when none) — that list sits outside the word cap.

## Red Flags — STOP

| Situation | Action |
|---|---|
| `review_count > 5` and the latest verdict is `LGTM` | Stop per step 3 rule 2; report per step 5 |
| `review_count > 5` and the latest verdict is still `Needs Updates`, findings in the PR's original work | Keep going per step 3 rule 4 |
| `pr_cycle_count >= 4` (step 3 rule 3's derived count, never the in-memory `review_count`), verdict `Needs Updates`, every blocking finding attributed to code an earlier cycle added | Stop per step 3 rule 3; report per step 5's **Diverging** row |
| Latest "review" is your own prior fix-pr-review disposition comment or a review trigger comment (`@claude review` / `@codex review`), not an actual review | Skip it — keep waiting/polling for the real next review, same rule as fix-pr-review step 1 |
| Review bot hasn't responded after ~30 minutes | Stop waiting; report that review didn't land rather than polling forever |
| Tempted to treat "LGTM with Recommended Optional items" as terminal at `review_count <= 5` | It isn't terminal — step 3 rule 4 sends it through fix-pr-review; step 3 rule 1 defines the only clean pass |
| PR gets closed or merged mid-loop (e.g. by the user) | Stop immediately; don't keep pushing fixes to a closed/merged PR |
| PR already has unaddressed feedback when the skill starts | Don't post a redundant review trigger — step 1 evaluates existing feedback first and only triggers when none exists |

## Common Mistakes

- **Misapplying the cycle cap.** Step 3 rules 1–4 own the cap and the `**Verification limitation:**` handling; apply them as written.
- **Reading rule 3 as a plain cycle cap.** It needs both halves: four or more cycles **and** every blocking finding sitting in code an earlier cycle added. A PR still being corrected in its original work keeps going under rule 4.
- **Losing count across cycles.** Track `review_count` explicitly — it's what distinguishes "full fix cycle" from "first-LGTM-wins" behavior.
- **Polling synchronously forever.** Use an until-loop with a timeout so a non-responding bot doesn't hang the whole run.
- **Re-triggering review on top of fix-pr-review's own trigger.** fix-pr-review already posts its own re-review trigger as a separate comment (its step 10) — don't add a second one here.
- **Stopping on an LGTM while the PR is unmergeable.** A conflicting PR isn't done — the merge-conflict check in step 3 runs before the verdict rules, and fix-pr-review resolves the conflict.
- **Posting a review trigger when feedback is already sitting on the PR.** Check for existing unaddressed feedback in step 1 first; a redundant trigger just delays convergence.
