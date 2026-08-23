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
- Ignore your own prior disposition comments and `@claude review` trigger comments.

State what you picked (authors + timestamps) so the user can confirm it's the right set.

**Note whether the collected set contains any blocking finding** — a `Needs Fixing` or `Requires Human Review` item from any review, an inline thread asserting a real defect (classified in step 3), or any failing CI check from step 2. This drives the re-review routing in step 10.

**If the only new feedback is `LGTM` with no blocking sections,** nothing is blocking, but the non-blocking items are still this run's work:
- Implement each `Recommended Optional` item per step 6, and file each `Create Follow-up Issue` item as an issue per step 3's bar — step 6 edits no code for it. Don't invent work the review never raised.
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

**For every ❓ Judgment finding, do the analysis the reviewer couldn't and implement the result — don't hand the tradeoff back.** Trace the code, enumerate the viable approaches, and derive the **absolute-best solution** per the global "absolute best solution" rule in CLAUDE.md/AGENTS.md, then implement it (step 6) in this same run. Do **not** pause to ask the user. A **Recommended proposed solution:** line is the reviewer's preferred option: verify it against the code and that same standard, then implement it if it holds, or implement the better alternative and say why. Record the decision in the disposition comment — the chosen solution, the code-grounded reasoning (`file:line`), and the rejected alternatives in one line each — so the human can override after the fact if they disagree.

The same standard governs `Recommended Optional` improvements: implement them too.

### 5. Decide whether to delegate implementation

Steps 3–4 always run inline in this session — validation is the hard thinking, so it never gets delegated. Now decide whether steps 6–11 run inline or get delegated to a subagent. Delegation never picks a model — the subagent inherits the session model; its value is a fresh context window for implementation when the session is already long. If a parent harness (a workflow or another skill) wants a specific model for implementation, it passes one down through its own dispatch — this skill doesn't choose.

Stay inline when this gate applies:
- Any ❓ Judgment call whose remedy is still open-ended, or any finding under step 4's safety carve-out — open decisions and high blast radius never get delegated.

Otherwise, delegate **only when the session is already long** — enough context has been consumed that a fresh window genuinely helps; on a short session, run steps 6–11 inline and skip the handoff cost. Delegate with the Agent tool (`subagent_type: general-purpose`, synchronous — `run_in_background: false`), and a prompt telling the subagent to read this SKILL.md and execute steps 6 through 11 exactly for PR `<N>`, skipping steps 0–5 (no re-validation, no recursive dispatch). Paste in the findings and verdicts you produced in steps 3–4, including the pinned-down remedies and any derived best-solution designs, so it implements your analysis rather than re-deciding. Its **LLM Attribution Footers** (commit + disposition comment) name the model actually running it. Relay its step 11 report verbatim; don't redo its work.

### 6. Implement the fixes

Implement every finding that calls for a change: ✅ Confirmed, ⚠️ Partial (the true part), ❓ Judgment (the absolute-best solution you derived), and `Recommended Optional` (best-solution standard). Skip only ❌ Refuted and `Create Follow-up Issue` items.

- Read the surrounding code and follow existing conventions before editing.
- Keep each fix scoped to its finding; don't smuggle in unrelated refactors.
- After all fixes, **verify**: run the project's tests/build/lint (check the repo's `CLAUDE.md` / `package.json` / Makefile for the commands — e.g. `bun test`, `go test -race ./...`, `bun run build`). Evidence before assertions: do not claim a fix works without running verification, and report any failures honestly rather than papering over them.
- If a fix turns out infeasible or reveals the finding was actually Refuted, move it to the Refuted bucket with the reason.

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

Terse summary: which reviews/threads you acted on, counts per disposition (fixed / partial / refuted / judgment-resolved / optional / deferred), the commit SHA, verification result, and that a re-review was requested (note which model it was routed to). When the review carried any `**Verification limitation:**` lines, name each unverified source in the report — omit that field when none. When the invocation carried an unrecognized argument (Input section), name it too — omit that field when none. Flag the resolved judgment calls so the user can override if they disagree — but the work is already done, not waiting on them.

## Red Flags — STOP

Before acting on any edge case, read the Red Flags table in [red-flags-and-mistakes.md](red-flags-and-mistakes.md) — it lists every stop condition and the required action.

## Common Mistakes

Read the Common Mistakes list in [red-flags-and-mistakes.md](red-flags-and-mistakes.md) — it names the failure patterns this skill exists to avoid.
