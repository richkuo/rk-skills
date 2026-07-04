---
name: work-on-issue-loop
description: Use when the user asks to implement a GitHub issue and drive it through review to completion autonomously — "work on issue and loop until approved", "work-on-issue-loop", or as the automatic follow-on from validate-issue-loop. Runs work-on-issue to implement and open the PR (which already triggers the first @claude review), then waits for each review to land and calls fix-pr-review to resolve it. Stops on a bare LGTM with nothing left to fix; once past 5 review cycles it stops at the first LGTM it sees even if non-blocking findings remain, rather than continuing to chase them.
---

# work-on-issue-loop

Drive an issue from "validated" to "PR reviewed to convergence" without stopping in between: implement (work-on-issue), wait for the review bot, resolve what it finds (fix-pr-review), and repeat. Past 5 cycles the bar for "done" relaxes — any LGTM ends the loop — so a PR with recurring minor findings doesn't get fix-pr-review'd forever. Steps 2–5 below are this same convergence loop that `fix-pr-review-loop` runs standalone against any already-open PR — use that skill directly when there's no issue to implement first, just an existing PR to drive to approval.

## Input

- Nothing — default to the issue just validated this session, else the latest open issue (`gh issue list --limit 1`).
- `#<N>` / `<N>` / full URL / `owner/repo#N`.

## Steps

### 1. Implement and open the PR

Invoke the `work-on-issue` skill for the issue (Skill tool, `skill: work-on-issue`). It implements the fix in an isolated worktree, verifies it, commits, pushes, opens the PR (`Closes #<N>`), and triggers the first `@claude review`.

**Gate on its outcome before looping — work-on-issue can legitimately stop early:**

- **Stopped with no PR** (issue already closed, an existing PR already addresses it, wrong repo checked out) → there is nothing to drive; stop and relay its report.
- **PR opened but review never triggered** (its bounded red-CI exit: CI stayed red after several fix rounds) → don't poll for a review that was never requested, and don't blindly retry what it already tried; stop and report per step 5.
- **PR opened and review triggered** → capture the PR number/URL, the branch, and the timestamp of the trigger comment. Set `review_count = 1` — that review is #1 in flight.

### 2. Wait for the review to land

Poll the PR for a new review or issue comment posted **after** the last trigger you sent — reviews can land as a formal PR review or as an issue comment (the `@claude` bot usually posts as an issue comment; see fix-pr-review step 1 for the `gh` calls to check — it also fetches inline diff threads, which matter when a human reviewer weighs in). An until-loop is the right shape here — you want to be notified once the condition is true, not to busy-poll inline:

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

Run this as a background until-loop (e.g. via the Monitor tool) so you're notified on completion instead of blocking synchronously. Cap the wait at roughly 30 minutes; if no review appears in that window, stop and report to the user that the `@claude` bot didn't respond — don't loop indefinitely on a bot that may be down or misconfigured. Before trusting a freshly armed monitor, sanity-check its condition once inline against the live PR — if a review is already present it must print `true`.

### 3. Check the review against the stop conditions

Fetch the latest review and classify it exactly like fix-pr-review steps 1–2: verdict (`LGTM` / `Needs Updates`) and which sections are present (`Needs Fixing`, `Requires Human Review`, `Recommended Optional`, `Create Follow-up Issue`).

Evaluate in this order:

1. **Clean pass — stop, success.** Verdict is `LGTM` and **no sections at all** — nothing under Recommended Optional or Create Follow-up Issue either. Nothing left to fix, at any `review_count`. Go to step 5.
2. **Past the cap and it's an LGTM — stop, first one wins.** `review_count > 5` **and** verdict is `LGTM` (even with Recommended Optional / Create Follow-up Issue items still listed). Once the loop has run more than 5 cycles, the first LGTM it sees ends it — don't spend a 6th+ fix-pr-review cycle chasing non-blocking findings. Go to step 5.
3. **Otherwise — keep going.** Verdict is `Needs Updates` (at any `review_count` — there is no cycle count that alone stops a `Needs Updates` PR; only an LGTM does, per rules 1–2), or verdict is `LGTM` with findings still listed and `review_count <= 5`. Continue to step 4.

### 4. Resolve the review and loop

Invoke the `fix-pr-review` skill for the PR (Skill tool, `skill: fix-pr-review`). It re-validates every finding against the code, fixes what's real, implements the judgment calls and optional improvements to the best-solution standard, commits, pushes, posts the disposition comment, and triggers a fresh `@claude` review itself (routed to Sonnet when it addressed only non-blocking items, otherwise to the repo default, per fix-pr-review step 7).

fix-pr-review also tiers its own working model by the PR's LGTM history (its step 1.5): no LGTM yet → inline on the session model, one LGTM → an Opus subagent, two or more → a Sonnet subagent. It counts LGTMs from the PR itself, so don't pass it a count or override its choice — just record which model each cycle reported running on, for the step 5 report.

Increment `review_count`, record the new trigger timestamp from that comment, and go back to step 2.

### 4.5. File named follow-on issues — MANDATORY before reporting success

On either "Done" terminal state (before step 5), sweep the deliverables for follow-on work the implementation itself named — this is separate from the review's `Create Follow-up Issue` section (fix-pr-review handles those) and is routinely missed without an explicit pass:

- Scan the **PR body**, **commit message(s)**, and **any docs/READMEs the diff added or changed** for phrases like "follow-on", "own issue", "future work", "next step", "not yet wired/deployed", "needs a follow-up".
- For each named item: file a **fully-specced** issue per the repo's issue conventions (complexity-prefixed title, complete body — problem, goal, approach, acceptance — attribution footer). Never file a stub; if an item genuinely can't be specced yet, don't file it — name it in the step 5 report as **deliberately unfiled** instead.
- Skip items that already have an issue (search first: `gh issue list --search "<keywords>" --state all`).
- Include every filed issue URL (and any deliberately-unfiled item) in the step 5 report.

The failure mode this prevents: a PR merges with follow-ons named only in prose, everyone moves on, and the work silently evaporates.

### 5. Report

Stop the loop and report the terminal state — don't claim blanket success:

| Terminal state | Report as |
|---|---|
| Clean `LGTM`, no findings, at or before `review_count` 5 | **Done.** PR is approved with nothing outstanding. |
| `review_count > 5` and an `LGTM` (with non-blocking items remaining) ended the loop | **Done, with leftovers.** PR is approved; note the remaining optional/follow-up items that were left unaddressed once the loop passed 5 cycles. |
| Bot never responded within the wait window | **Escalate.** Report that the PR is implemented and pushed but review never landed; the user should check the `@claude` GitHub Action / bot status. |
| work-on-issue stopped with no PR (closed issue / existing PR / wrong repo) | **Nothing to drive.** Relay its report; zero review cycles ran. |
| work-on-issue opened the PR but its red-CI exit fired (review never triggered) | **Escalate.** Report the PR URL and the red CI state; the user decides whether to keep pushing on CI. |

There is no "stuck on `Needs Updates` past the cap" case to report — per step 3, `Needs Updates` never stops the loop by cycle count alone; it keeps calling fix-pr-review until an LGTM appears (or the bot stops responding, the row above).

In every case, give: PR URL, number of review cycles run, final verdict, which model each fix cycle ran on (per fix-pr-review's LGTM tiering), any follow-on issues filed in step 4.5 (URLs) or deliberately left unfiled, and (if escalating) exactly what's left.

**Cap the report at 55 words, ELI18** — plain language, no jargon, as if explaining the outcome to a smart 18-year-old with no context on this codebase or its internals.

## Red Flags — STOP

| Situation | Action |
|---|---|
| `review_count > 5` and the latest verdict is `LGTM` | Stop right there — don't invoke fix-pr-review again just because non-blocking findings remain; report per step 5 |
| `review_count > 5` and the latest verdict is still `Needs Updates` | Keep going — invoke fix-pr-review and loop again; the cap only changes what counts as "done" on an LGTM, it never force-stops a `Needs Updates` PR |
| Latest "review" is your own prior fix-pr-review disposition comment or an `@claude review` trigger comment, not an actual review | Skip it — keep waiting/polling for the real next review, same rule as fix-pr-review step 1 |
| Review bot hasn't responded after ~30 minutes | Stop waiting; report that review didn't land rather than polling forever |
| Tempted to treat "LGTM with Recommended Optional items" as terminal at `review_count <= 5` | It isn't — below the cap, LGTM-with-findings still goes through fix-pr-review; only past the cap does the first LGTM end it regardless of findings |
| PR gets closed or merged mid-loop (e.g. by the user) | Stop immediately; don't keep pushing fixes to a closed/merged PR |
| work-on-issue ended without triggering a review | Don't enter the wait loop — gate on its outcome in step 1 and report per step 5 |
| About to report "Done" while the PR/README names follow-on work with no issue filed | Stop — run step 4.5 first; a named follow-on with no issue and no "deliberately unfiled" note in the report is a silent drop |

## Common Mistakes

- **Treating any LGTM at or below `review_count` 5 as terminal.** Below the cap, only a *bare* LGTM (no sections) stops the loop; an LGTM with leftover optional/follow-up findings still goes through another fix-pr-review cycle.
- **Hard-stopping a `Needs Updates` PR once `review_count` passes 5.** There's no such rule — the cap only lowers the bar for what counts as "done" once an LGTM shows up; it never stops the loop on its own.
- **Losing count across cycles.** Track `review_count` explicitly — it's what distinguishes "full fix cycle" from "first-LGTM-wins" behavior.
- **Polling synchronously forever.** Use an until-loop with a timeout so a non-responding bot doesn't hang the whole run.
- **Re-triggering review on top of fix-pr-review's own trigger.** fix-pr-review already posts its own re-review trigger as a separate comment (its step 7) — don't add a second one here.
