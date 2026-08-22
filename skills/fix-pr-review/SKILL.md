---
name: fix-pr-review
description: Use when the user asks to fix, address, or respond to a PR review — "fix the PR review", "address the review comments", "/fix-pr-review". Takes an optional PR number/URL (defaults to the current branch's PR) and an optional `codex` argument, in either order, to select Codex as the review bot (e.g. "/fix-pr-review 123 codex"). Fetches all unaddressed review feedback on the PR (formal reviews, review-style issue comments, inline diff comments, and any already-failed CI checks), RE-VALIDATES every finding against the actual code before touching anything (never blind-implements), fixes the findings that survive validation, and for judgment calls and optional improvements derives and implements the absolute-best solution autonomously without pausing, resolves any merge conflicts with the base branch, then commits and pushes, posts a per-finding disposition comment back to the PR, and triggers a fresh re-review from the selected review bot (@claude by default, @codex when selected).
---

# fix-pr-review

Take all unaddressed review feedback on a pull request and resolve it fully and autonomously: re-validate each finding against the code, fix the ones that are real, push back on the ones that aren't, and for the judgment calls the reviewer couldn't make — and for the optional improvements — derive and implement the absolute-best solution rather than pausing. Then report back on the PR and request a re-review. Don't stop to ask the user; do the work.

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

- Confirm you are **on the PR's head branch** (`headRefName`). If not, check it out with `gh pr checkout <N>` — it handles fork-hosted head branches and sets upstream tracking. Fixes must land on the branch the PR tracks, never on `main` or a divergent branch. Never fix a review by committing to the base branch.
- Note whether the PR is from a **fork** (`headRepositoryOwner` differs from the base repo's owner) — the head branch then lives in the fork, so pulls and pushes go to the branch's tracked upstream, not `origin`.
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

**If the only new feedback is `LGTM` with no blocking sections:** there's nothing blocking, but still address any non-blocking items the review raised — implement each `Recommended Optional` item with the absolute-best-solution standard (step 6), and file each `Create Follow-up Issue` item as a GitHub issue (complete body per its step 3 bar — never a stub). Don't invent work the review never raised; if the feedback is a bare `LGTM` with no finding items at all and no open inline threads — a `**Verification limitation:**` line does not count (step 3 owns that rule) — report that the PR is approved and stop, naming every `**Verification limitation:**` line from that review in the step-11 report (omit the field when none) — unless step 0 flagged merge conflicts, in which case still run step 7 (resolve, verify, push, disposition comment) so the approved PR is actually mergeable.

### 2. Fetch failing CI checks

Take one snapshot of check status with `gh pr checks` (command in [fetch-recipes.md](fetch-recipes.md)) — this is a point-in-time read, never a wait or a poll. A check that's still running is simply not this run's problem; it'll be there to catch on the next pass.

`bucket` normalizes `state` into `pass`/`fail`/`pending`/`skipping`/`cancel`:
- `bucket: pending` or `skipping` — **skip it entirely.** Don't wait for it, don't retry the call, don't treat "not done yet" as a finding.
- `bucket: cancel` — skip unless the run log shows a real upstream failure caused the cancel; apply the cancelled-check attribution procedure in [fetch-recipes.md](fetch-recipes.md) to decide whether it becomes its own finding, and never invent an unverified upstream cause.
- `bucket: fail` — pull just the failing detail, not the whole log, via the fail-bucket recipes in [fetch-recipes.md](fetch-recipes.md).
- Each failing check becomes one finding: **CI Failure — `<check name>`**.

### 3. Extract findings

Parse all collected feedback — structured reviews, inline diff threads, and failing CI checks alike — into discrete findings, tagged by section:
- **Needs Fixing** — blocking; reviewer asserts a real defect. Every CI Failure from step 2 starts here by default — a red check is real until step 4 proves otherwise.
- **Requires Human Review** — blocking; reviewer couldn't decide (a genuine tradeoff or missing context).
- **Recommended Optional** — non-blocking improvement.
- **Create Follow-up Issue** — out-of-scope, track separately. Wherever this run files one (the LGTM-only path in step 1, or the disposition's deferred section), the issue gets a complete body per the repo's issue conventions — complexity-prefixed title, problem, goal, approach, acceptance criteria, a `## Plain simple English` section under 55 words, attribution footer; `github-issue-format` owns the full rule. Never file a stub.

A `**Verification limitation:**` line is not a finding. Skip every such line when classifying — do not bucket it, dispose it, rebut it, or treat it as remaining work. It does not block the approved-and-stop path and does not count toward "findings still listed."

For free-form feedback with no sections — including inline diff comments — classify each point yourself into the same four buckets by its substance. Keep each finding atomic — split compound feedback ("fix X and also Y") into separate findings so each gets its own verdict. When the same defect is raised by more than one source — reviewer, thread, *or* a CI Failure finding from step 2 (e.g. a reviewer flags "this breaks the type check" while the type-check job is already `bucket: fail`) — merge into one finding and note all sources, including the check name alongside the reviewer(s).

### 4. Re-validate each finding against the code (the core step)

For **every** finding — including ones that read as obviously correct — trace the claim to current code and assign a verdict. Endorsement is a verification act, not a relay: re-derive the finding from the code with your own `file:line`, don't transcribe the reviewer's reasoning.

| Verdict | Meaning | Action |
|---------|---------|--------|
| ✅ **Confirmed** | Code at `file:line` matches the finding; the defect/improvement is real | Fix it (step 6) |
| ❌ **Refuted** | Code does not do what the finding claims, or the suggested change would itself be wrong/regressive | Do **not** change; record a one-line, code-grounded rebuttal for the reply |
| ⚠️ **Partial** | Real but narrower/broader than stated, or true only on one path | Fix the true part; note the correction |
| ❓ **Judgment** | A real tradeoff or a decision the reviewer couldn't make (most `Requires Human Review` items) | Derive the absolute-best solution and **implement it** (the paragraph below owns the rule). When the finding includes **Recommended proposed solution:**, treat that as the reviewer's preferred option: verify it against the code and absolute-best standard, then implement it if it holds (or implement the better alternative and explain why in the disposition). |

Validation discipline (this is where fixing a review goes wrong):
- **Read the body, not just the cited line.** A name states intent; open the function and trace the conditional fully before agreeing.
- **Prove negatives by reading the path.** "X is never validated / never freed / not awaited" — confirm the absence across *all* relevant paths, not the one the reviewer looked at; the behavior may be produced elsewhere.
- **A suggested fix is its own claim.** "Just add a lock here" can deadlock; "default it to N" can break a caller. Verify the *remedy* is correct for this codebase, not only that the *problem* exists. Derive the right fix from first principles if the suggested one is suboptimal — correctness and safety outrank matching the reviewer's wording.
- **Safety carve-out:** any finding touching money, data integrity, security, or an auto-protective mechanism gets fixed or escalated to the user even at low confidence — never silently dropped as Refuted unless you can prove from code it's a non-issue.
- **CI Failures validate differently — there's no reviewer to be wrong, only the log to explain.** Read the failing step's actual error/assertion, not just the job name. ✅ Confirmed if the failure traces to this PR's diff — fix it (and reproduce the exact failing command locally where feasible, so step 6's verification actually exercises it). ❌ Refuted only with evidence it's *not* this PR's doing — pre-existing on `<baseRefName>` (check CI history / reproduce on base) or a one-off infra flake (timeout/network blip unrelated to any path this PR touches) — don't patch around it; note it in the disposition and flag it to the user, since a flaky or broken base branch is worth knowing about independent of this PR.

**For every ❓ Judgment finding, do the analysis the reviewer couldn't and implement the result — don't hand the tradeoff back.** Trace the code, enumerate the viable approaches, and derive the **absolute-best solution** per the global "absolute best solution" rule in CLAUDE.md/AGENTS.md, then implement it (step 6) in this same run. Do **not** pause to ask the user. Record the decision in the disposition comment — the chosen solution, the code-grounded reasoning (`file:line`), and the rejected alternatives in one line each — so the human can override after the fact if they disagree.

The same standard governs `Recommended Optional` improvements: implement them too.

### 5. Decide whether to delegate implementation

Steps 3–4 always run inline in this session — validation is the hard thinking, so it never gets delegated. Now decide whether steps 6–11 run inline or get delegated to a subagent. Delegation never picks a model — the subagent inherits the session model; its value is a fresh context window for implementation when the session is already long. If a parent harness (a workflow or another skill) wants a specific model for implementation, it passes one down through its own dispatch — this skill doesn't choose.

Stay inline when this gate applies:
- Any ❓ Judgment call whose remedy is still open-ended, or any finding under the safety carve-out (money, data integrity, security, auto-protective mechanisms) — open decisions and high blast radius never get delegated.

Otherwise, delegate **only when the session is already long** — enough context has been consumed that a fresh window genuinely helps implementation; on a short session, run steps 6–11 inline and skip the handoff cost. When delegating, use the Agent tool (`subagent_type: general-purpose`, synchronous — `run_in_background: false`) with a prompt that tells the subagent to: read this SKILL.md file and execute steps 6 through 11 exactly (skipping steps 0–5 — no re-validation, no recursive dispatch), for PR `<N>`, using the validated findings and per-finding verdicts you produced in steps 3–4 (paste them into the prompt, including the pinned-down remedies for Confirmed/Partial findings and the derived best-solution designs for any Optional items, so it implements your analysis rather than re-deciding). The subagent's **LLM Attribution Footers** (commit + disposition comment) must name the model actually running the subagent (normally the same session model; whatever a parent harness passed down otherwise). When the subagent returns, relay its step-11 report to the user verbatim; don't redo its work.

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
- Conflicts touching money, data integrity, security, or auto-protective logic get the same safety carve-out as findings: resolve from first principles, and if the two sides are genuinely irreconcilable in intent, stop and surface to the user rather than guessing.
- After resolving, re-run the step 6 verification (tests/build/lint) — a textual resolution can still be semantically wrong.
- Prefer merge over rebase: the branch is already pushed and reviewed; rebasing rewrites history and breaks the reviewer's context and any pending inline threads.
- Report the conflict resolution as its own line in the disposition comment and the user report (which files, how each side was reconciled).

### 8. Commit and push

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

The global LLM Attribution Footer rule in CLAUDE.md/AGENTS.md owns the field values; this skill only fixes the verb to **Updated**.

### 9. Post the disposition comment back to the PR

Post one comment that tells the reviewer exactly what happened to each finding — this is how a refuted finding gets its pushback on the record. Compose and post it per [disposition-comment.md](disposition-comment.md) — read it completely; it holds the template with its five sections, the slotting rules for CI Failure findings, the inline-thread reply recipe, the posting command, and the comment footer.

### 10. Trigger the re-review

**Pick the bot first, then the model.** The re-review goes to the review bot of the **current cycle**, and the default is `@claude`. Use `@codex` only when this cycle selected Codex — one of: the user said so ("review with Codex", "use Codex"), a caller argument named it (`reviewBot: codex`), the invocation included the literal `codex` argument (Input section above), or this run itself was started by an `@codex` GitHub comment. A `codex.yml` merely existing in the repo does **not** select Codex. Once a cycle has a bot, every re-review in that cycle stays on it — never switch mid-cycle.

Then route by whether the set you addressed contained **any blocking finding** (noted in step 1) — never by the newest review's verdict alone: with multiple reviewers, a later `LGTM` from one does not erase another's `Needs Updates`.

- **Any blocking finding addressed** (`Needs Fixing` / `Requires Human Review` from any review, an inline thread that validated as a real defect, or any CI Failure finding from step 2 — **counted regardless of its verdict**, i.e. whether you fixed it or refuted it as pre-existing/flaky, exactly as the reviewer clauses count regardless of verdict): re-review on the PR's complexity band — `@claude review` at C0–C30, `@claude opus review` at C31–C70. Read the score with fix-pr-review-loop step 1's source order (stamped `PR review:` line, then the PR title bracket, then the closed issue's `[C<score>]` prefix). At C71+ or with no score the reviewer **steps down one rung per blocking re-review**, because fable reviews the first cycle only: post `@claude opus review` for the first blocking re-review after the fable one, and `@claude review` for every blocking re-review after that. Decide which rung you are on from the PR's own trigger comments — a prior `@claude opus review` posted after the `@claude fable review` one means the next rung is `@claude review`. A non-blocking cycle routes to sonnet and consumes no rung. A CI failure you refuted still routes here on purpose: if that refutation was wrong, the heavier re-review is what catches the real regression you dismissed.
- **Only non-blocking items** (optional improvements / follow-ups): the PR was already in good shape, so route the re-review to the cheap model shorthand instead — `@claude sonnet` on Claude, `@codex luna` on Codex. The band does not apply here.

Post a **separate** comment so the bot triggers cleanly on its own line:

```bash
# blocking findings were addressed, C0–C30 — and every blocking re-review
# after the first one at C71+ (fable steps down to opus, then to this)
gh pr comment <N> --body "@claude review"

# blocking findings were addressed, C31–C70 — and the FIRST blocking
# re-review after a fable first review at C71+
gh pr comment <N> --body "@claude opus review"

# only non-blocking items were addressed
gh pr comment <N> --body "@claude sonnet review"

# the same cases when this cycle selected Codex — both heavy tiers collapse onto the bare trigger
gh pr comment <N> --body "@codex review"
gh pr comment <N> --body "@codex luna review"
```

(If this repo uses a different review trigger phrase or model-shorthand syntax, match it — check the repo's `.github/workflows/claude.yml` or `codex.yml` for how it resolves the shorthand, and recent PR comments for the convention.) A trigger comment is a one-line mention, not authored content — no footer.

### 11. Report to the user

Terse summary: which reviews/threads you acted on, counts per disposition (fixed / partial / refuted / judgment-resolved / optional / deferred), the commit SHA, verification result, and that a re-review was requested (note which model it was routed to). When the review carried any `**Verification limitation:**` lines, name each unverified source in the report — omit that field when none. When the invocation carried an unrecognized argument (Input section), name it too — omit that field when none. Flag the resolved judgment calls so the user can override if they disagree — but the work is already done, not waiting on them.

## Red Flags — STOP

Before acting on any edge case, read the Red Flags table in [red-flags-and-mistakes.md](red-flags-and-mistakes.md) — it lists every stop condition and the required action.

## Common Mistakes

Read the Common Mistakes list in [red-flags-and-mistakes.md](red-flags-and-mistakes.md) — it names the failure patterns this skill exists to avoid.
