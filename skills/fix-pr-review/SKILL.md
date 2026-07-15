---
name: fix-pr-review
description: Use when the user asks to fix, address, or respond to a PR review — "fix the PR review", "address the review comments", "/fix-pr-review". Takes an optional PR number/URL (defaults to the current branch's PR). Fetches all unaddressed review feedback on the PR (formal reviews, review-style issue comments, inline diff comments, and any already-failed CI checks), RE-VALIDATES every finding against the actual code before touching anything (never blind-implements), fixes the findings that survive validation, and for judgment calls and optional improvements derives and implements the absolute-best solution autonomously without pausing, resolves any merge conflicts with the base branch, then commits and pushes, posts a per-finding disposition comment back to the PR, and triggers a fresh @claude re-review.
---

# fix-pr-review

Take all unaddressed review feedback on a pull request and resolve it fully and autonomously: re-validate each finding against the code, fix the ones that are real, push back on the ones that aren't, and for the judgment calls the reviewer couldn't make — and for the optional improvements — derive and implement the absolute-best solution rather than pausing. Then report back on the PR and request a re-review. Don't stop to ask the user; do the work.

**The review is a hypothesis, not a work order.** A reviewer (human or `@claude`) can cite a stale line, misread a conditional, or flag a non-bug. Implementing a wrong suggestion ships a regression with a reviewer's blessing. So every finding is traced to current `file:line` and confirmed *before* you change anything. You are not performing agreement — you are verifying claims and acting only on the ones that hold.

## Input

The user provides one of:
- Nothing — **default to the PR for the current branch** (`gh pr view`).
- `#<N>` / `<N>` / full URL / `owner/repo#N`.

If the current branch has no PR and none was given, say so and stop — there's nothing to fix.

## Steps

### 0. Resolve the PR and sync the branch

```bash
gh pr view <N|--> --json number,headRefName,headRepositoryOwner,baseRefName,url,state,isDraft,mergeable,mergeStateStatus
git fetch origin
git branch --show-current
```

- Confirm you are **on the PR's head branch** (`headRefName`). If not, check it out with `gh pr checkout <N>` — it handles fork-hosted head branches and sets upstream tracking. Fixes must land on the branch the PR tracks, never on `main` or a divergent branch. Never fix a review by committing to the base branch.
- Note whether the PR is from a **fork** (`headRepositoryOwner` differs from the base repo's owner) — the head branch then lives in the fork, so pulls and pushes go to the branch's tracked upstream, not `origin`.
- Pull the latest head so you fix against what the reviewer saw: `git pull --ff-only` on the tracked upstream (if it can't fast-forward, stop and tell the user the branch diverged).
- Note the PR state. If it's already `merged` or `closed`, stop and report — don't reopen work on a closed PR without the user.
- Note `mergeable`/`mergeStateStatus`. If the PR is `CONFLICTING`/`DIRTY`, resolving the conflict is part of this run (step 4.5) — a reviewed PR that can't merge isn't done.

### 1. Fetch all unaddressed review feedback

Review feedback arrives through three channels: formal GitHub PR reviews, plain issue comments (the `@claude` bot posts the verdict-and-sections format as an issue comment), and **inline diff comments** (line-level threads, where human reviewers most often comment). Fetch all three:

```bash
# PR reviews (formal review events) — state included so DISMISSED reviews can be skipped
gh api repos/{owner}/{repo}/pulls/<N>/reviews --paginate --jq '.[] | {id, user: .user.login, state, submitted_at, body}'
# Issue comments on the PR (where @claude review output usually lands) — REST + --paginate for completeness
gh api repos/{owner}/{repo}/issues/<N>/comments --paginate --jq '.[] | {author: .user.login, created_at, body}'
# Inline diff threads WITH resolution state — REST can't report isResolved, so use GraphQL
gh api graphql -F owner='{owner}' -F repo='{repo}' -F pr=<N> -f query='
  query($owner:String!,$repo:String!,$pr:Int!){ repository(owner:$owner,name:$repo){ pullRequest(number:$pr){
    reviewThreads(first:100){ pageInfo{hasNextPage endCursor} nodes{ isResolved isOutdated path line
      comments(first:50){ nodes{ databaseId author{login} createdAt body } } } } } } }'
```

(If `hasNextPage` is true, paginate with `endCursor` — don't silently drop threads past 100.)

Determine the **cutoff**: the timestamp of your most recent disposition comment on the PR (or the last commit you pushed addressing a review). Then collect:

- Every formal review or review-formatted issue comment **newer than the cutoff** (no cutoff → everything since the PR opened) — it opens with a `LGTM` / `Needs Updates` verdict, contains review sections like `### Needs Fixing`, or is otherwise clearly review feedback. **If multiple reviews landed — e.g. two reviewers — address all of them**, not just the latest. Skip `DISMISSED` reviews.
- Every **unresolved** inline thread (`isResolved: false`), **regardless of age** — resolution state, not timestamp, decides whether a thread is open work. A thread from before the cutoff that the reviewer never resolved is still open. Exception: if the thread's last comment is your own disposition reply and no one has responded since, it's awaiting the reviewer — skip it. `isOutdated` alone doesn't mean resolved. Treat each thread as one finding.
- Ignore your own prior disposition comments and `@claude review` trigger comments.

State what you picked (authors + timestamps) so the user can confirm it's the right set.

**Note whether the collected set contains any blocking finding** — a `Needs Fixing` or `Requires Human Review` item from any review, an inline thread asserting a real defect (classified in step 2), or any failing CI check from step 1.5. This drives the re-review routing in step 7.

**If the only new feedback is `LGTM` with no blocking sections:** there's nothing blocking, but still address any non-blocking items the review raised — implement each `Recommended Optional` item with the absolute-best-solution standard (step 4), and file each `Create Follow-up Issue` item as a GitHub issue. Don't invent work the review never raised; if the feedback is a bare `LGTM` with no items at all and no open inline threads, report that the PR is approved and stop — unless step 0 flagged merge conflicts, in which case still run step 4.5 (resolve, verify, push, disposition comment) so the approved PR is actually mergeable.

### 1.5 Fetch failing CI checks

Take one snapshot of check status — this is a point-in-time read, never a wait or a poll. A check that's still running is simply not this run's problem; it'll be there to catch on the next pass.

```bash
gh pr checks <N> --json name,state,bucket,link,startedAt,completedAt
```

`bucket` normalizes `state` into `pass`/`fail`/`pending`/`skipping`/`cancel`:
- `bucket: pending` or `skipping` — **skip it entirely.** Don't wait for it, don't retry the call, don't treat "not done yet" as a finding.
- `bucket: cancel` — skip unless the run log shows it was cancelled by a real failure upstream (e.g. a required prior job failed) rather than a manual/administrative cancel. When it was, don't inspect the cancelled run's own log — its steps report `cancelled`, not `failure`, so there's nothing to fetch there. Instead pull detail from the upstream check that actually failed, using the `fail`-bucket procedure below, and cite that upstream check's name (not the cancelled one) as the finding's `<check name>`.
- For each check with `bucket: fail`, pull just the failing detail, not the whole log:
  - GitHub Actions: resolve the run ID from the check's `link`, then `gh run view <run-id> --log-failed` for the failing step(s) only.
  - Non-Actions / external CI: `gh api` only auto-fills `{owner}`/`{repo}`/`{branch}` — `{sha}` is not one of them, so get the head commit explicitly first: `gh pr view <N> --json headRefOid --jq .headRefOid`. Substitute that for `<sha>`: `gh api repos/{owner}/{repo}/commits/<sha>/check-runs --jq '.check_runs[] | select(.conclusion=="failure") | {name, output}'` for whatever summary the provider publishes.
- Each failing check becomes one finding: **CI Failure — `<check name>`**.

### 2. Extract findings

Parse all collected feedback — structured reviews, inline diff threads, and failing CI checks alike — into discrete findings, tagged by section:
- **Needs Fixing** — blocking; reviewer asserts a real defect. Every CI Failure from step 1.5 starts here by default — a red check is real until step 3 proves otherwise.
- **Requires Human Review** — blocking; reviewer couldn't decide (a genuine tradeoff or missing context).
- **Recommended Optional** — non-blocking improvement.
- **Create Follow-up Issue** — out-of-scope, track separately.

For free-form feedback with no sections — including inline diff comments — classify each point yourself into the same four buckets by its substance. Keep each finding atomic — split compound feedback ("fix X and also Y") into separate findings so each gets its own verdict. When the same defect is raised by more than one reviewer or thread, merge into one finding and note all sources.

### 3. Re-validate each finding against the code (the core step)

For **every** finding — including ones that read as obviously correct — trace the claim to current code and assign a verdict. Endorsement is a verification act, not a relay: re-derive the finding from the code with your own `file:line`, don't transcribe the reviewer's reasoning.

| Verdict | Meaning | Action |
|---------|---------|--------|
| ✅ **Confirmed** | Code at `file:line` matches the finding; the defect/improvement is real | Fix it (step 4) |
| ❌ **Refuted** | Code does not do what the finding claims, or the suggested change would itself be wrong/regressive | Do **not** change; record a one-line, code-grounded rebuttal for the reply |
| ⚠️ **Partial** | Real but narrower/broader than stated, or true only on one path | Fix the true part; note the correction |
| ❓ **Judgment** | A real tradeoff or a decision the reviewer couldn't make (most `Requires Human Review` items) | Derive the absolute-best solution and **implement it** (see below) — don't pause, don't guess blindly, don't punt empty-handed. When the finding includes **Recommended proposed solution:**, treat that as the reviewer's preferred option: verify it against the code and absolute-best standard, then implement it if it holds (or implement the better alternative and explain why in the disposition). |

Validation discipline (this is where fixing a review goes wrong):
- **Read the body, not just the cited line.** A name states intent; open the function and trace the conditional fully before agreeing.
- **Prove negatives by reading the path.** "X is never validated / never freed / not awaited" — confirm the absence across *all* relevant paths, not the one the reviewer looked at; the behavior may be produced elsewhere.
- **A suggested fix is its own claim.** "Just add a lock here" can deadlock; "default it to N" can break a caller. Verify the *remedy* is correct for this codebase, not only that the *problem* exists. Derive the right fix from first principles if the suggested one is suboptimal — correctness and safety outrank matching the reviewer's wording.
- **Safety carve-out:** any finding touching money, data integrity, security, or an auto-protective mechanism gets fixed or escalated to the user even at low confidence — never silently dropped as Refuted unless you can prove from code it's a non-issue.
- **CI Failures validate differently — there's no reviewer to be wrong, only the log to explain.** Read the failing step's actual error/assertion, not just the job name. ✅ Confirmed if the failure traces to this PR's diff — fix it (and reproduce the exact failing command locally where feasible, so step 4's verification actually exercises it). ❌ Refuted only with evidence it's *not* this PR's doing — pre-existing on `<baseRefName>` (check CI history / reproduce on base) or a one-off infra flake (timeout/network blip unrelated to any path this PR touches) — don't patch around it; note it in the disposition and flag it to the user, since a flaky or broken base branch is worth knowing about independent of this PR.

**For every ❓ Judgment finding, do the analysis the reviewer couldn't and implement the result — don't hand the tradeoff back.** Trace the code, enumerate the viable approaches, and derive the **absolute-best solution**, evaluated as if cost, effort, time, resources, token spend, and code volume were unlimited — they are *not* factors and must never narrow the option space. The only things that can override "best" are correctness and safety. Choose the most correct, most robust design even when it's far more work, then implement it (step 4) in this same run. Do **not** pause to ask the user. Record the decision in the disposition comment — the chosen solution, the code-grounded reasoning (`file:line`), and the rejected alternatives in one line each — so the human can override after the fact if they disagree.

This same absolute-best-solution standard governs `Recommended Optional` improvements: implement them too, choosing the best design with cost/effort/time/resources treated as non-factors.

### 3.5 Select the working model from the validated findings

Steps 2–3 always run inline in this session — validation is the hard thinking and doubles as the model-selection signal, so it never gets delegated. Now choose who implements, keyed to the **implementation complexity of the surviving work** — not its blocking/optional category (a blocking fix can be a trivial one-liner; an optional refactor can be genuinely hard).

First, two absolute inline gates that override any complexity read:
- Any ❓ Judgment call whose remedy is still open-ended, or any finding under the safety carve-out (money, data integrity, security, auto-protective mechanisms) — open decisions and high blast radius never get delegated.

Otherwise, rate each surviving fix's complexity from your validation (you just traced the code, so you know): **scope** (files/layers touched, cross-cutting vs. local), **subtlety** (concurrency, ordering, invariants, edge-case reasoning vs. mechanical edits), and **verification difficulty** (needs careful test design vs. existing suite covers it). The **most complex fix** sets the tier for the whole set (never the average, never split across subagents):

- **Opus subagent (`model: "opus"`)** — any fix is non-trivial: multi-file or cross-layer, touches subtle logic, or its correctness needs real reasoning to preserve.
- **Sonnet subagent (`model: "sonnet"`)** — every fix is simple and mechanical: localized edits with a pinned-down remedy, plus any `Create Follow-up Issue` filings and Refuted rebuttals to write up.

When in doubt between tiers, take the higher one — misrouting hard work down costs correctness; misrouting easy work up costs nothing that matters.

When dispatching, use the Agent tool (`subagent_type: general-purpose`, synchronous — `run_in_background: false`) with a prompt that tells the subagent to: read this SKILL.md file and execute steps 4 through 8 exactly (skipping steps 0–3.5 — no re-validation, no recursive dispatch), for PR `<N>`, using the validated findings and per-finding verdicts you produced in steps 2–3 (paste them into the prompt, including the pinned-down remedies for Confirmed/Partial findings and the derived best-solution designs for any Optional items, so it implements your analysis rather than re-deciding). The subagent's **LLM Attribution Footers** (commit + disposition comment) must name the model actually doing the work (e.g. `Opus 4.8` / `Sonnet 5`), not the session model. When the subagent returns, relay its step-8 report to the user verbatim plus which model ran; don't redo its work.

If the Agent tool's model override is unavailable in the current harness, fall back to running inline and note the intended model in the report.

### 4. Implement the fixes

Implement every finding that calls for a change: ✅ Confirmed, ⚠️ Partial (the true part), ❓ Judgment (the absolute-best solution you derived), and `Recommended Optional` (best-solution standard). Skip only ❌ Refuted and `Create Follow-up Issue` items.

- Read the surrounding code and follow existing conventions before editing.
- Keep each fix scoped to its finding; don't smuggle in unrelated refactors. (Scope ≠ minimalism: for Judgment and Optional items, pick the *best* design, not the smallest diff — correctness and robustness outrank brevity.)
- After all fixes, **verify**: run the project's tests/build/lint (check the repo's `CLAUDE.md` / `package.json` / Makefile for the commands — e.g. `bun test`, `go test -race ./...`, `bun run build`). Evidence before assertions: do not claim a fix works without running verification, and report any failures honestly rather than papering over them.
- If a fix turns out infeasible or reveals the finding was actually Refuted, move it to the Refuted bucket with the reason.

### 4.5 Resolve merge conflicts with the base branch

If step 0 flagged the PR as conflicting (or the PR turns `CONFLICTING` after your fixes because the base moved mid-run — re-check before pushing if step 0 was a while ago), resolve the conflicts on the head branch — never on the base:

```bash
git fetch origin <baseRefName>
git merge origin/<baseRefName>        # merge base INTO the head branch; don't rebase a pushed PR branch
```

- Resolve each conflicted file by reading both sides and preserving the *intent* of both changes — never mechanically take `ours`/`theirs` for a whole file. If base-branch changes overlap the code you just fixed, re-derive the fix on top of the new base code.
- Conflicts touching money, data integrity, security, or auto-protective logic get the same safety carve-out as findings: resolve from first principles, and if the two sides are genuinely irreconcilable in intent, stop and surface to the user rather than guessing.
- After resolving, re-run the step 4 verification (tests/build/lint) — a textual resolution can still be semantically wrong.
- Prefer merge over rebase: the branch is already pushed and reviewed; rebasing rewrites history and breaks the reviewer's context and any pending inline threads.
- Report the conflict resolution as its own line in the disposition comment and the user report (which files, how each side was reconciled).

### 5. Commit and push

Only after verification passes:

```bash
git status                      # confirm only the files you edited are dirty
git add <specific files>        # stage each file you changed for the fixes — never `git add -A` or `git add .`
git commit -F <msg-file>        # see footer below
git push                        # to the branch's tracked upstream — for a fork PR the head lives in the fork, so `git push origin <headRefName>` would be wrong
```

If the branch has no upstream set (manual checkout instead of `gh pr checkout`), push explicitly to the PR's **head repository** remote — never assume `origin`.

Staging explicitly prevents sweeping in unrelated dirty files, scratch files, or untracked artifacts. If `git status` shows changes you didn't make, leave them unstaged and mention them in the report.

Commit message: a concise summary of what review findings were addressed (reference the PR, e.g. "Address review on #<N>: <one-line summary>"). This is a revision to an existing PR, so the footer uses the **Updated** verb:

```
---
Updated with LLM: <current model> | <effort> | Harness: Claude Code
```

Fill `<current model>` (e.g. `Opus 4.8`) and `<effort>` (`high` by default). Per the user's workflow, never include time/effort estimates in the message body.

### 6. Post the disposition comment back to the PR

Post one comment that tells the reviewer exactly what happened to each finding — this is how a refuted finding gets its pushback on the record. Write it as direct, scannable status:

```
Addressed review feedback (<reviewer(s)> · <timestamp(s)>) in <commit-sha>.

### Fixed
1. **<finding title>** — <what changed> (`file:line`).

### Corrected scope (partial)
1. **<finding title>** — <what was real and fixed vs. what wasn't> (`file:line`).

### Not changed (refuted)
1. **<finding title>** — <code-grounded reason the suggestion doesn't apply> (`file:line`).

### Resolved judgment calls (was Requires Human Review)
1. **<finding title>** — implemented <the absolute-best solution and why, `file:line`>. Alternatives rejected: <one line each>. Override if you'd prefer one of these.

### Deferred to follow-up
1. **<finding title>** — <why it's out of scope; issue link filed>.
```

Omit any empty section. Keep each item one line with a `file:line` anchor. CI Failure findings slot into the same sections — fixed ones under **Fixed**, pre-existing/flaky ones under **Not changed (refuted)** with the base-branch or flake evidence in place of a code citation. For findings that came from inline diff threads, also post a one-line reply in the thread itself — use the root comment's `databaseId` from step 1's thread query: `gh api repos/{owner}/{repo}/pulls/<N>/comments/<databaseId>/replies -f body=...` — that's where the reviewer is watching. Post the main comment via:

```bash
gh pr comment <N> --body-file <file>
```

Footer on the comment uses the **Created** verb (it's a new comment):

```
---
Created with LLM: <current model> | <effort> | Harness: Claude Code
```

### 7. Trigger the @claude re-review

Route the re-review by whether the set you addressed contained **any blocking finding** (noted in step 1) — never by the newest review's verdict alone: with multiple reviewers, a later `LGTM` from one does not erase another's `Needs Updates`.

- **Any blocking finding addressed** (`Needs Fixing` / `Requires Human Review` from any review, an inline thread that validated as a real defect, or a fixed CI Failure): trigger plain — this repo's default (Opus) reviews the fix.
- **Only non-blocking items** (optional improvements / follow-ups): the PR was already in good shape, so route the re-review to Sonnet via the `@claude sonnet` shorthand instead.

Post a **separate** comment so the bot triggers cleanly on its own line:

```bash
# blocking findings were addressed
gh pr comment <N> --body "@claude review"

# only non-blocking items were addressed
gh pr comment <N> --body "@claude sonnet review"
```

(If this repo uses a different review trigger phrase or model-shorthand syntax, match it — check the repo's `.github/workflows/claude.yml` for how it resolves `@claude <shorthand>`, and recent PR comments for the convention.) A trigger comment is a one-line mention, not authored content — no footer.

### 8. Report to the user

Terse summary: which reviews/threads you acted on, counts per disposition (fixed / partial / refuted / judgment-resolved / optional / deferred), the commit SHA, verification result, and that a re-review was requested (note which model it was routed to). Flag the resolved judgment calls so the user can override if they disagree — but the work is already done, not waiting on them.

## Red Flags — STOP

| Situation | Action |
|-----------|--------|
| Finding cites a line that no longer matches current code | Re-validate against current `file:line`; it may already be fixed — mark Refuted with the reason |
| Suggested fix would touch money/data/security/auto-protective logic | Never blind-apply; verify the remedy from first principles and implement the safest correct design |
| Reviewer's remedy is plausible but you can't confirm it's correct here | Don't implement on faith — trace it, then implement the absolute-best solution you can stand behind from the code |
| A collected "review" is actually your own prior disposition comment or an `@claude review` trigger | Skip it; act only on *actual* review feedback |
| Only some feedback channels checked (e.g. formal reviews but not inline diff threads or CI) | Fetch every review-feedback channel (step 1) and the CI snapshot (step 1.5) before extracting findings — inline threads are where human reviewers usually comment, and a red check is a finding too |
| CI check's `bucket` is `pending` or `skipping` | Skip it — take the `gh pr checks` snapshot as-is, don't wait or poll; a run that finishes later gets caught on the next pass |
| CI failure doesn't trace to this PR's diff (pre-existing on the base branch, or a one-off flake) | Don't fix around it — mark Refuted with the base-branch/flake evidence and flag it to the user; only fix failures this PR actually caused |
| `git status` shows dirty files you didn't edit | Stage only your fix files; leave the rest and mention them in the report |
| You're on `main` or a divergent branch, not the PR head | Check out the PR head first; never commit review fixes to the base branch |
| Branch can't fast-forward to its upstream head | Stop — the branch diverged; surface to the user, don't force anything |
| PR is from a fork | Check out with `gh pr checkout` and push to the tracked upstream — `origin` is the wrong remote for the head branch |
| All findings refuted | Still post the disposition comment with the rebuttals and request re-review — don't silently no-op |
| `Requires Human Review` item | Prefer the item's **Recommended proposed solution:** when present; still verify against absolute-best (cost/effort/time/resources ignored; only correctness and safety override). Implement the chosen solution; document the decision + rejected alternatives in the comment so the user can override. Never pause for confirmation, punt the bare tradeoff, or guess blindly |
| Tests/build fail after fixes | Report the failure; don't push or claim success |
| PR is `CONFLICTING` with the base branch | Resolve via step 4.5 (merge base into head, reconcile intent of both sides, re-verify) — never rebase a pushed PR branch, never resolve by blanket `ours`/`theirs`, never leave an approved PR unmergeable |
| Conflict sides are irreconcilable in intent (esp. money/data/security/auto-protective code) | Stop and surface to the user instead of guessing a resolution |

## Common Mistakes

- **Blind-implementing the review.** Performative agreement ships regressions. Validate first, every time.
- **Delegating validation.** Steps 2–3 always run inline — the model-selection gate keys off *validated* verdicts, and a lighter model triaging its own workload defeats the gate. Dispatch only steps 4–8, tiered by the most complex surviving fix (open judgment/safety → inline, any non-trivial fix → Opus, all-mechanical → Sonnet), and never split one review across subagents. The subagent's footers must name the model that actually ran, not the session model.
- **Missing inline diff comments or CI.** Fetching only formal reviews and issue comments skips the line-level threads where human reviewers usually comment, and skipping step 1.5 misses failing CI checks. Fetch every channel in steps 1 and 1.5.
- **Waiting or polling on in-progress CI.** Step 1.5 is a single snapshot; skip anything whose `bucket` is `pending` or `skipping` rather than blocking the run on it.
- **Patching around a pre-existing or flaky CI failure.** Verify the failure traces to this PR's diff before touching code — otherwise it's Refuted with evidence, not a fix target.
- **Addressing only the latest review when several landed.** Every review newer than your last disposition and every unresolved inline thread (any age) gets addressed.
- **Routing the re-review by the newest verdict.** A later `LGTM` from one reviewer doesn't erase another's blocking findings — route by whether any blocking finding was addressed.
- **`git add -A`.** Stage the fix files explicitly; a blanket add can commit unrelated dirty or untracked files.
- **Dropping a refuted finding silently.** Push back on the record in the comment with a code-grounded reason — that's how the reviewer learns it was wrong.
- **Committing to the base branch.** Fixes land on the PR head branch only.
- **Skipping verification before push.** Run the tests/build; report real results.
- **Pausing or punting on a judgment call.** Do the analysis the reviewer couldn't and *implement* the absolute-best solution (cost/effort/time/resources are not factors; only correctness and safety override it); document it for override. Don't stop to ask, don't relay the bare tradeoff, don't guess blindly.
- **Skipping the optional improvements.** `Recommended Optional` items get implemented to the same best-solution standard, not deferred.
- **Ignoring merge conflicts because "the review is addressed".** An unmergeable PR isn't done — check `mergeable` in step 0 and resolve conflicts in step 4.5, with the same verification and safety discipline as findings.
- **Bundling the re-review trigger into the disposition comment.** Keep `@claude review` as its own comment so the bot fires reliably.
