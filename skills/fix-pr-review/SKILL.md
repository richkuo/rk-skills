---
name: fix-pr-review
description: Use when the user asks to fix, address, or respond to a PR review — "fix the PR review", "address the review comments", "/fix-pr-review". Takes an optional PR number/URL (defaults to the current branch's PR) and an optional `codex` argument, in either order, to select Codex as the review bot (e.g. "/fix-pr-review 123 codex"). Fetches every unaddressed review channel (formal reviews, review-style issue comments, inline diff threads, already-failed CI checks), RE-VALIDATES each finding against the actual code before touching anything (never blind-implements), fixes what survives, and derives and implements the absolute-best solution for judgment calls and optional improvements without pausing. Then resolves base-branch merge conflicts, commits and pushes, posts a per-finding disposition comment, and triggers a fresh re-review from the selected bot (@claude by default, @codex when selected).
---

# fix-pr-review

Resolve every unaddressed review finding on a pull request autonomously: validate each one, fix or refute it, implement the judgment calls and the optional improvements to the absolute-best-solution standard, report back on the PR, and request a re-review. Don't stop to ask the user; do the work.

**The review is a hypothesis, not a work order.** A reviewer (human or `@claude`) can cite a stale line, misread a conditional, or flag a non-bug. Implementing a wrong suggestion ships a regression with a reviewer's blessing. So every finding is traced to current `file:line` and confirmed *before* you change anything. You are not performing agreement — you are verifying claims and acting only on the ones that hold.

## Input

The user provides, in any order:
- An optional PR reference: `#<N>` / `<N>` / full URL / `owner/repo#N`. Omit it to **default to the PR for the current branch** (`gh pr view`).
- An optional literal bot token, `codex` (case-insensitive), selecting Codex as this cycle's re-review bot (step 10). A token that is neither a PR reference nor `codex` is not a bot selection.

A token matching neither category (a typo like `codexx`, a malformed reference like `#abc`, a stray extra word) doesn't block resolution: ignore it for parsing — fall back to the current-branch PR if no valid reference was given, and to `@claude` if `codex` wasn't given — but name it in the step 11 report as an unrecognized argument, so a mistyped intent doesn't silently produce the wrong outcome.

If the current branch has no PR and none was given, say so and stop — there's nothing to fix.

## Steps

### 0. Resolve the PR and sync the branch

```bash
gh pr view <N|--> --json number,headRefName,headRepositoryOwner,baseRefName,url,state,isDraft,mergeable,mergeStateStatus
git fetch origin
git branch --show-current
```

- Confirm you are **on the PR's head branch** (`headRefName`); if not, check it out with `gh pr checkout <N>`, which handles fork-hosted heads and sets upstream tracking. Fixes land on the branch the PR tracks. Never fix a review by committing to the base branch.
- Note whether the PR is from a **fork** (`headRepositoryOwner` differs from the base repo's owner) — its head lives in the fork, so pulls and pushes go to the tracked upstream rather than `origin`.
- Pull the latest head so you fix against what the reviewer saw: `git pull --ff-only` on the tracked upstream (if it can't fast-forward, stop and tell the user the branch diverged).
- Note the PR state. If it's already `merged` or `closed`, stop and report — don't reopen work on a closed PR without the user.
- Note `mergeable`/`mergeStateStatus`. If the PR is `CONFLICTING`/`DIRTY`, resolving the conflict is part of this run (step 7) — a reviewed PR that can't merge isn't done.

### 1. Fetch all unaddressed review feedback

Review feedback arrives through three channels: formal GitHub PR reviews, plain issue comments (the `@claude` bot posts the verdict-and-sections format as an issue comment), and **inline diff comments** (line-level threads, where human reviewers most often comment). Fetch all three with the queries in [fetch-recipes.md](fetch-recipes.md) — read it completely; it includes the GraphQL thread query with resolution state and the pagination rule.

Determine the **cutoff**: the timestamp of your most recent disposition comment on the PR (or the last commit you pushed addressing a review). Then collect:

- Every formal review or review-formatted issue comment **newer than the cutoff** (no cutoff → everything since the PR opened) — it opens with a `LGTM` / `Needs Updates` verdict, contains review sections like `### Needs Fixing`, or is otherwise clearly review feedback. **If multiple reviews landed — e.g. two reviewers — address all of them**, not just the latest. Skip `DISMISSED` reviews.
- Every **unresolved** inline thread (`isResolved: false`), **regardless of age** — resolution state, not timestamp, decides whether a thread is open work. A thread from before the cutoff that the reviewer never resolved is still open. Exception: if the thread's last comment is your own disposition reply and no one has responded since, it's awaiting the reviewer — skip it. `isOutdated` alone doesn't mean resolved. Treat each thread as one finding.
- Ignore your own prior disposition comments and `@claude review` trigger comments. That scoping is the fixer's alone — it skips its own words when collecting *new* work. The reviewer reads those same disposition comments on purpose, because `pr-review` requires the prior-cycle read before it drafts, so never delete, edit, or bury a disposition comment to keep the next review clean.

State what you picked (authors + timestamps) so the user can confirm it's the right set.

**Note whether the collected set contains any blocking finding** — a `Needs Fixing` or `Requires Human Review` item from any review, an inline thread asserting a real defect (classified in step 3), or any failing CI check from step 2. This drives the re-review routing in step 10.

**If the only new feedback is `LGTM` with no blocking sections,** nothing is blocking, but the non-blocking items are still this run's work:
- Implement each `Recommended Optional` item per step 6, and file each `Create Follow-up Issue` item as an issue per step 3's bar — step 6 edits no code for it, unless scope rule 1 claims it (a defect in code this PR adds or changes, or a hazard it creates), which is fixed here. Don't invent work the review never raised.
- **Bare `LGTM`, no finding items, no open inline threads** — a `**Verification limitation:**` line does not count as a finding, and step 3 owns that rule: report the PR approved and stop, naming every such line in the step 11 report.
- **Exception:** if step 0 flagged merge conflicts, still run step 7 (resolve, verify, push, disposition comment) so the approved PR is actually mergeable.

### 2. Fetch failing CI checks

Take one snapshot of check status with `gh pr checks` (command in [fetch-recipes.md](fetch-recipes.md)). This is a point-in-time read, never a wait or a poll.

`bucket` normalizes `state` into `pass`/`fail`/`pending`/`skipping`/`cancel`:
- `bucket: pending` or `skipping` — **skip it entirely.** A check still running is not this run's problem; the next pass catches it. Don't retry the call, and don't treat "not done yet" as a finding.
- `bucket: cancel` — skip unless the run log shows a real upstream failure caused the cancel; apply the cancelled-check attribution procedure in [fetch-recipes.md](fetch-recipes.md) to decide whether it becomes its own finding, and never invent an unverified upstream cause.
- `bucket: fail` — pull just the failing detail, not the whole log, via the fail-bucket recipes in [fetch-recipes.md](fetch-recipes.md).
- Each failing check becomes one finding: **CI Failure — `<check name>`**.

### 3. Extract findings

Parse all collected feedback — structured reviews, inline diff threads, and failing CI checks alike — into discrete findings, tagged by section:
- **Needs Fixing** — blocking; reviewer asserts a real defect. Every CI Failure from step 2 starts here by default — a red check is real until step 4 proves otherwise.
- **Requires Human Review** — blocking; reviewer couldn't decide (a genuine tradeoff or missing context).
- **Recommended Optional** — non-blocking improvement.
- **Create Follow-up Issue** — out-of-scope, track separately. Wherever this run files one (step 1's LGTM-only path, or the disposition's deferred section), the issue gets a complete body per `github-issue-format`, which owns the full rule — including a `## Plain simple English` section under 55 words. Never file a stub.

A `**Verification limitation:**` line is not a finding. Skip every such line when classifying — do not bucket it, dispose it, rebut it, or treat it as remaining work. It does not block the approved-and-stop path and does not count toward "findings still listed."

For free-form feedback with no sections — including inline diff comments — classify each point yourself into the same four buckets by its substance. Keep each finding atomic — split compound feedback ("fix X and also Y") into separate findings so each gets its own verdict. When the same defect is raised by more than one source — reviewer, thread, *or* a CI Failure finding from step 2 (e.g. a reviewer flags "this breaks the type check" while the type-check job is already `bucket: fail`) — merge into one finding and note all sources, including the check name alongside the reviewer(s).

### 4. Re-validate each finding against the code (the core step)

For **every** finding — including ones that read as obviously correct — trace the claim to current code and assign a verdict. Endorsement is a verification act, not a relay: re-derive the finding from the code with your own `file:line`, don't transcribe the reviewer's reasoning.

| Verdict | Meaning | Action |
|---------|---------|--------|
| ✅ **Confirmed** | Code at `file:line` matches the finding; the defect/improvement is real | Fix it (step 6) |
| ❌ **Refuted** | Code does not do what the finding claims, or the suggested change would itself be wrong/regressive | Do **not** change; record a one-line, code-grounded rebuttal for the reply |
| ⚠️ **Partial** | Real but narrower/broader than stated, or true only on one path | Fix the true part; note the correction |
| ❓ **Judgment** | A real tradeoff or a decision the reviewer couldn't make (most `Requires Human Review` items) | Derive the absolute-best solution and **implement it** — the paragraph below owns the rule |

Validation discipline (this is where fixing a review goes wrong):
- **Read the body, not just the cited line.** A name states intent; open the function and trace the conditional fully before agreeing.
- **Prove negatives by reading the path.** "X is never validated / never freed / not awaited" — confirm the absence across *all* relevant paths, not the one the reviewer looked at; the behavior may be produced elsewhere.
- **A suggested fix is its own claim.** "Just add a lock here" can deadlock; "default it to N" can break a caller. Verify the *remedy* is correct for this codebase, not only that the *problem* exists. Derive the right fix from first principles if the suggested one is suboptimal — correctness and safety outrank matching the reviewer's wording.
- **Safety carve-out** — money, data integrity, security, or an auto-protective mechanism. Such a finding gets fixed or escalated to the user even at low confidence; never silently dropped as Refuted unless you can prove from code it's a non-issue.
- **CI Failures validate differently — there's no reviewer to be wrong, only the log to explain.** Read the failing step's actual error/assertion, not just the job name. ✅ Confirmed if the failure traces to this PR's diff — fix it (and reproduce the exact failing command locally where feasible, so step 6's verification actually exercises it). ❌ Refuted only with evidence it's *not* this PR's doing — pre-existing on `<baseRefName>` (check CI history / reproduce on base) or a one-off infra flake (timeout/network blip unrelated to any path this PR touches) — don't patch around it; note it in the disposition and flag it to the user, since a flaky or broken base branch is worth knowing about independent of this PR.

#### Scope: the second axis on every finding

A verdict says whether a finding is real. It does not say whether its remedy belongs in this pull request. Decide both, because a real finding whose remedy is a new subsystem is how a two-line fix becomes a thousand-line one, one justified round at a time. **The scope yardstick** is what the rules read "asked for" against: the issue(s) this PR closes — the union of their asks when it closes several — or, when the PR closes no issue or its linked issue was deleted, the PR body's own stated scope (its Summary and verification/acceptance statements), so the test always has a defined result.

Classify each ✅/⚠️/❓ finding's **remedy** — except one the reviewer already routed to `### Create Follow-up Issue`, which is **filed and never implemented**, whatever the rules below would say. Rule 1 is that exclusion's only exception: when the defect lives in code this PR adds or changes, or this PR creates the hazard, rule 1 outranks the reviewer's routing, the fix lands here, and the disposition says so. Apply the rules **in order — the first match decides**, and rule 1 outranks everything later in this skill:

| # | Rule | Test | Action |
|---|---|---|---|
| 1 | **PR-caused — always in scope** | The defect lives in code this PR adds or changes, or this PR itself creates the hazard (a new race, a destructive power handed to existing callers) | Implement it (step 6), however much mechanism the fix needs. No later rule, step, or growth check may reclassify it out of scope — shipping a known hazard to defer work is never the trade. |
| 2 | **New mechanism the yardstick never asked for — out of scope** | The remedy introduces a mechanism the PR does not have — a new persistent store, a new lifecycle or generation scheme, a new cross-cutting invariant, a retry or recovery path, a new subsystem — and the scope yardstick does not ask for it | File a follow-up issue; do not implement. When the deferred defect is a pre-existing hazard, the issue says so plainly. |
| 3 | **Everything else — in scope** | Includes a pre-existing defect whose remedy needs no new mechanism — the trivially-fixable same-bug-class instance `pr-review` routes into the PR | Implement it (step 6) |

**The size of the remedy never decides scope, in either direction.** "It is only a few lines" does not open the gate for a new mechanism — rule 2 files it however small the patch looks. "The fix is huge" does not evict a defect this PR caused — rule 1 keeps it however large the remedy. The questions are "did this PR cause it" and "does the remedy need a mechanism the PR lacks", never "how big is the patch". Rule 1 is the safety carve-out in scope form; a pre-existing hazard the PR merely reveals takes rule 2 or rule 3 like any other finding — a mechanism-free fix to it lands here (rule 3), and a mechanism-shaped one is filed (rule 2) with the hazard named.

**A reviewer's `Recommended Optional` is a suggestion, not a work order.** It carries no authority to enlarge the PR: run the same test on it, and file the out-of-scope ones. An optional finding that arrives with an out-of-scope remedy is the single most common start of unbounded growth — in the case this rule comes from, one optional durability suggestion about **pre-existing** state produced four further review cycles and a persisted journal the issue never asked for — a rule-2 remedy (a new persistent store the yardstick never asked for), so it is filed. Had that same durability gap sat in code the PR itself added, rule 1 would have matched first and the journal would have been built here.

**Growth check — run it once per invocation, before step 6.** Compare the PR's own diff against the base now with the same reading taken at its first push — `git diff --stat $(git merge-base origin/<baseRefName> HEAD)..HEAD` against `git diff --stat $(git merge-base origin/<baseRefName> <first-push-sha>)..<first-push-sha>` — and count the review cycles so far; both inputs come from the PR itself, so a resumed loop reads the same values. **Both readings exclude the base branch**, so the base commits a step 7 merge brings into the head are never counted as growth of this PR; never measure growth with a plain `<first-push-sha>..HEAD` two-dot diff, which carries every base change since the branch point. `<first-push-sha>` is, from `gh pr view <N> --json commits`, the newest commit whose `committedDate` is at or before the cycle-1 trigger comment's timestamp ([rereview-routing.md](rereview-routing.md)'s earliest-trigger rule names that comment; with no trigger comment, use the PR's `createdAt` as the cutoff) — a first push of several commits resolves to the last of them. The cycle count — `pr_cycle_count`, the name fix-pr-review-loop's divergence brake uses for it, never the loop's in-memory `review_count` — is the PR's `@<bot> … review` trigger comments read chronologically per that same file, skipping the cheap non-blocking re-triggers, plus one when review feedback predates every trigger comment (fix-pr-review-loop step 1's "unaddressed feedback already present" branch). When the diff has grown past roughly three times its first push, or this is cycle 4 or later, state both numbers in the step 11 report and in the disposition comment's `Growth check:` line, and re-run the scope test on every finding you were about to implement. Sustained growth across cycles is evidence the scope test is being applied too loosely, not evidence the PR is thorough.

**For every ❓ Judgment finding, do the analysis the reviewer couldn't and implement the result — don't hand the tradeoff back.** Trace the code, enumerate the viable approaches, and derive the **absolute-best solution** per the global "absolute best solution" rule in CLAUDE.md/AGENTS.md, then implement it (step 6) in this same run. Do **not** pause to ask the user. A **Recommended proposed solution:** line is the reviewer's preferred option: verify it against the code and that same standard, then implement it if it holds, or implement the better alternative and say why. Record the decision in the disposition comment — the chosen solution, the code-grounded reasoning (`file:line`), and the rejected alternatives in one line each — so the human can override after the fact if they disagree.

The same standard governs `Recommended Optional` improvements: implement the in-scope ones too. This paragraph sets *how well* a remedy is derived; the scope test above decides *whether* it is derived here at all, and it runs first.

### 5. Decide whether to delegate implementation

Steps 3–4 always run inline in this session — validation is the hard thinking, so it never gets delegated. Now decide whether steps 6–11 run inline or get delegated to a subagent. Delegation never picks a model — the subagent inherits the session model; its value is a fresh context window for implementation when the session is already long. If a parent harness (a workflow or another skill) wants a specific model for implementation, it passes one down through its own dispatch — this skill doesn't choose.

Stay inline when this gate applies:
- Any ❓ Judgment call whose remedy is still open-ended, or any finding under step 4's safety carve-out — open decisions and high blast radius never get delegated.

Otherwise, delegate **only when the session is already long** — enough context has been consumed that a fresh window genuinely helps; on a short session, run steps 6–11 inline and skip the handoff cost. Delegate with the Agent tool (`subagent_type: general-purpose`, synchronous — `run_in_background: false`), and a prompt telling the subagent to read this SKILL.md and execute steps 6 through 11 exactly for PR `<N>`, skipping steps 0–5 (no re-validation, no recursive dispatch). Paste in the findings and verdicts you produced in steps 3–4, including the pinned-down remedies and any derived best-solution designs, so it implements your analysis rather than re-deciding. Its **LLM Attribution Footers** (commit + disposition comment) name the model actually running it. Relay its step 11 report verbatim; don't redo its work.

### 6. Implement the fixes

Implement every **in-scope** finding that calls for a change: ✅ Confirmed, ⚠️ Partial (the true part), ❓ Judgment (the absolute-best solution you derived), and `Recommended Optional` (best-solution standard). Skip ❌ Refuted items, `Create Follow-up Issue` items — file them, never implement them, with scope rule 1 the only exception (a defect in code this PR adds or changes, or a hazard it creates, is fixed here however the reviewer routed it, and the disposition says so) — and every finding step 4's scope test put out of scope.

- File each out-of-scope finding as an issue per `github-issue-format` — complete body, never a stub — and carry its number into the disposition comment, with the basis that placed it — the scope rule you applied, or the reviewer's own `### Create Follow-up Issue` routing for an item step 4's exclusion filed without running one — so the reviewer can see the work was placed rather than dropped. A finding you neither implement nor file is a finding you dropped. **Search before you file:** `gh issue list --search "<keywords>" --state all` — an earlier cycle, or another reviewer's copy of the same finding, may already have filed it. When an existing issue covers the finding, cite that issue's number in the disposition instead of filing a duplicate; when a human closed it, say so rather than reopening or re-filing.
- Read the surrounding code and follow existing conventions before editing.
- Keep each fix scoped to its finding; don't smuggle in unrelated refactors.
- **When implementation reveals that an in-scope remedy cannot work without a new mechanism, re-run step 4's scope rules in order — discovery changes the classification only where those rules allow it.** A rule-1 finding (a defect in code this PR adds or changes, or a hazard this PR creates) stays in scope, and the mechanism gets built here. A rule-3 finding that turns out to need a mechanism moves to rule 2: stop implementing and file it — do not build the mechanism and carry on.
- After all fixes, **verify**: run the project's tests/build/lint (check the repo's `CLAUDE.md` / `package.json` / Makefile for the commands — e.g. `bun test`, `go test -race ./...`, `bun run build`). Evidence before assertions: do not claim a fix works without running verification, and report any failures honestly rather than papering over them.
- If a fix turns out infeasible or reveals the finding was actually Refuted, move it to the Refuted bucket with the reason.
- **A test the fix makes stale follows the CLAUDE.md/AGENTS.md rule "The optimal solution comes first, and the tests follow it".** Edit an existing test only under one of its three cases — **Outdated**, **Wrong**, or **Obsolete** — and name that case's checkable ground before you touch the test; a confirmed finding is the ground for a test its fix makes outdated. The rule covers fixtures, snapshots, and helper expectations as well as assertions. A test that breaks in another location is checked before it is edited.** The refute check runs first: a red test may show the finding itself was wrong, and that finding moves to the Refuted bucket with no test edit. When the finding stands, read the test and decide whether it is Outdated (the fix deliberately replaces the tested behavior) or Obsolete (the behavior is deleted, or another test covers it). One of those is rewritten or removed under that case with its ground. A test that is neither means the fix broke real behavior, so leave the test as it is and fix the code. Not every fix needs a new test; write one when it guards behavior that can regress. A test with no ground stays as it is, and tests are still a correctness floor.** Your own reading that a test is wrong is the claim under test and never its own ground. Never delete, skip, loosen, or narrow a test to reach a green tree. When the correct fix still cannot make an ungrounded test pass, do not commit: stop before step 8, leave the branch as it is, and report the test with its `file:line`, what it asserts, and why the correct fix conflicts with it (step 11). Findings already fixed in this run stay uncommitted with it, so the next cycle lands them together once the maintainer answers. Disclose every test edit** in the commit message (step 8) and under `### Test edits` in the disposition comment (step 9): the test, its case, that case's ground, and what the replacement asserts. A removal gives the ground in place of the replacement, and for the redundancy ground it names the surviving test.

### 7. Resolve merge conflicts with the base branch

If step 0 flagged the PR as conflicting (or the PR turns `CONFLICTING` after your fixes because the base moved mid-run — re-check before pushing if step 0 was a while ago), resolve the conflicts on the head branch — never on the base:

```bash
git fetch origin <baseRefName>
git merge origin/<baseRefName>        # merge base INTO the head branch; don't rebase a pushed PR branch
```

- Resolve each conflicted file by reading both sides and preserving the *intent* of both changes — never mechanically take `ours`/`theirs` for a whole file. If base-branch changes overlap the code you just fixed, re-derive the fix on top of the new base code.
- A conflict inside step 4's safety carve-out gets the same treatment as a finding: resolve from first principles, and if the two sides are irreconcilable in intent, stop and surface to the user rather than guessing.
- After resolving, re-run the step 6 verification (tests/build/lint) — a textual resolution can still be semantically wrong.
- Prefer merge over rebase: the branch is already pushed and reviewed; rebasing rewrites history and breaks the reviewer's context and any pending inline threads.
- Report the conflict resolution as its own line in the disposition comment and the user report (which files, how each side was reconciled).

### 8. Commit and push

Only after verification passes:

```bash
git status                      # confirm only the files you edited are dirty
git add <specific files>        # stage each file you changed for the fixes — never `git add -A` or `git add .`
git commit -F <msg-file>        # see footer below
git push                        # to the branch's tracked upstream — never assume `origin`
```

A fork PR's head lives in the fork, so `git push origin <headRefName>` would be wrong. If the branch has no upstream set (manual checkout instead of `gh pr checkout`), push explicitly to the PR's **head repository** remote.

Staging explicitly keeps unrelated dirty files, scratch files, and untracked artifacts out of the commit. If `git status` shows changes you didn't make, leave them unstaged and mention them in the report.

Commit message: a concise summary of what review findings were addressed (reference the PR, e.g. "Address review on #<N>: <one-line summary>"). This is a revision to an existing PR, so the footer uses the **Updated** verb:

```
---
Updated with LLM: <current model> | <effort> | Harness: Claude Code
```

The global LLM Attribution Footer rule in CLAUDE.md/AGENTS.md owns the field values; this skill only fixes the verb to **Updated**.

### 9. Post the disposition comment back to the PR

Post one comment that tells the reviewer exactly what happened to each finding — this is how a refuted finding gets its pushback on the record. Compose and post it per [disposition-comment.md](disposition-comment.md) — read it completely; it holds the template with its five sections, the slotting rules for CI Failure findings, the inline-thread reply recipe, the posting command, and the comment footer.

### 10. Trigger the re-review

Post one trigger comment asking the selected review bot for a fresh review. Compose and post it per [rereview-routing.md](rereview-routing.md) — read it completely; it holds the bot-selection rule, the rule for identifying the cycle-1 reviewer from the earliest trigger comment on the PR, the step-down ladder and its floor, the band table that applies only when no trigger comment exists, the non-blocking shorthand, and the posting commands for both bots. The step-down is keyed to the reviewer that actually ran cycle 1, at any score — never to a band.

Two rules that decide everything there: route by whether the addressed set contained **any blocking finding** (noted in step 1), never by the newest review's verdict alone; and post the trigger as its **own** comment, never bundled into the disposition comment.

### 11. Report to the user

Terse summary: which reviews/threads you acted on, counts per disposition (fixed / partial / refuted / judgment-resolved / optional / deferred), the commit SHA, verification result, and that a re-review was requested (note which model it was routed to). Name every test edit with its case and ground. When step 6 stopped the run on an ungrounded test, say that no commit and no push exist, name the test with its `file:line`, and state what it asserts and why the correct fix conflicts with it. When step 4's growth check fired, include both of its numbers — the diff ratio against the first push and the cycle count — and omit them when it did not. When the review carried any `**Verification limitation:**` lines, name each unverified source in the report — omit that field when none. When the invocation carried an unrecognized argument (Input section), name it too — omit that field when none. Flag the resolved judgment calls so the user can override if they disagree — but the work is already done, not waiting on them.

## Red Flags — STOP

Before acting on any edge case, read the Red Flags table in [red-flags-and-mistakes.md](red-flags-and-mistakes.md) — it lists every stop condition and the required action.

## Common Mistakes

Read the Common Mistakes list in [red-flags-and-mistakes.md](red-flags-and-mistakes.md) — it names the failure patterns this skill exists to avoid.
