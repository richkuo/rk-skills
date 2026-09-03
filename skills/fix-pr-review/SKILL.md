---
name: fix-pr-review
description: Use when the user asks to fix, address, or respond to a PR review — "fix the PR review", "/fix-pr-review". Optional PR number/URL (defaults to the current branch's PR); optional `codex` argument selects Codex.
---

# fix-pr-review

Resolve every unaddressed review finding autonomously: validate, fix or refute, implement judgment calls and optional improvements, request a re-review. Never stop to ask the user. **The review is a hypothesis**: trace every finding to current `file:line` before changing anything.

## Input

In any order: an optional PR reference (number or URL; default = the current branch's PR) and an optional literal `codex` token selecting Codex as this cycle's re-review bot. Any other token is ignored and named in the step 11 report. No PR found → say so and stop.

## Steps

### 0. Resolve the PR and sync

`gh pr view [<N>] --json number,headRefName,headRefOid,headRepositoryOwner,baseRefName,state,mergeable,mergeStateStatus`, then `git fetch origin`. `MERGED`/`CLOSED` → stop and report. Be **on the PR's head branch** (`gh pr checkout <N>` if not; never fix a review on the base branch). On a **fork** PR (`headRepositoryOwner` differs) pull from and push to the tracked upstream, which may differ from `origin`. `git pull --ff-only`; no fast-forward → stop and report. `CONFLICTING`/`DIRTY` → step 7 runs this invocation.

### 1. Fetch all unaddressed review feedback

Three channels: formal reviews, issue comments, inline diff threads. Fetch and select the unaddressed set per [fetch-recipes.md](fetch-recipes.md), read completely — it owns the cutoff and collection rules. **Never delete, edit, or bury a disposition comment**: the next review reads them on purpose. Record **whether the set contains any blocking finding** (a `Needs Fixing` / `Requires Human Review` item, a thread asserting a real defect, or a step 2 CI failure) — step 10 routes on it.

**LGTM with non-blocking items** still gets them. **Bare `LGTM`** — no finding items, no open threads, and after step 2 no CI failure this PR caused — report approved and stop, naming any `**Verification limitation:**` lines and any CI failure attributed elsewhere. A conflict on a bare-LGTM PR still runs steps 7 through 9, and step 7's merge re-review rule decides whether step 10 posts a trigger.

### 2. Fetch failing CI checks

One `gh pr checks` snapshot; never wait or poll. Buckets, failing detail, and cancelled-check attribution per [fetch-recipes.md](fetch-recipes.md). Each `fail`-bucket check is one finding: **CI Failure — `<check name>`**.

### 3. Extract findings

Parse everything into atomic findings — split compound feedback, merge duplicates across sources noting all — tagged **Needs Fixing** (blocking; every CI Failure starts here), **Requires Human Review** (blocking; the reviewer could not decide), **Recommended Optional** (non-blocking), or **Create Follow-up Issue** (tracked separately; an issue this run files gets a complete body per `github-issue-format`, including a `## Plain simple English` section under 55 words — never a stub). Free-form feedback classifies by substance. A `**Verification limitation:**` line is never a finding — skip it.

### 4. Re-validate each finding

For **every** finding, trace the claim to current code and assign a verdict with your own `file:line`: ✅ **Confirmed** (fix it, step 6); ❌ **Refuted** (the claim or its remedy does not hold, or the cited code already changed and the defect is gone → no change; record a code-grounded rebuttal); ⚠️ **Partial** (real but narrower or broader → fix the true part, note the correction); ❓ **Judgment** (a real tradeoff → derive and **implement** the best solution, below).

A `### Needs Fixing` item's stated `**Reachability:**` precondition is part of its claim — trace it to current code. On a code-grounded refutation of the trigger, the blocking status is refuted while the defect may still stand: re-route the finding to `### Recommended Optional`, scope-test its remedy, and record it under `### Corrected scope (partial)` in the disposition. A finding never re-routes on a likelihood judgment of your own; with no stated precondition it is validated as written.

Apply the validation discipline in [red-flags-and-mistakes.md](red-flags-and-mistakes.md): whole-body reads, negative proofs, a suggested fix verified as its own claim, the **safety carve-out** (money, data integrity, security, auto-protective mechanisms: fix or escalate even at low confidence; a drop needs code proof), and CI-failure attribution (fix only failures this PR's diff caused).

#### Scope: the second axis on every finding

A verdict says whether a finding is real; scope says whether its remedy belongs in this PR. **The yardstick**: the issue(s) this PR closes (union of asks), else the PR body's stated scope. Classify each ✅/⚠️/❓ finding's **remedy** — except one the reviewer routed to `### Create Follow-up Issue`, which is **filed and never implemented**; Rule 1 is that exclusion's only exception (the disposition says so). Apply in order; the first match decides:

1. **PR-caused — always in scope.** The defect lives in code this PR adds or changes, or this PR creates the hazard → implement it, however much mechanism the fix needs; no later rule or step may reclassify it.
2. **New mechanism the yardstick never asked for — out of scope.** The remedy introduces a mechanism the PR lacks (a new persistent store, lifecycle scheme, cross-cutting invariant, retry path, or subsystem) → file a follow-up issue, naming a deferred pre-existing hazard plainly.
3. **Everything else — in scope**, including a pre-existing defect whose remedy needs no new mechanism.

**Remedy size never decides scope, in either direction**, and a reviewer's `Recommended Optional` carries no authority to enlarge the PR — same test, file the out-of-scope ones.

**For every ❓ Judgment finding, do the analysis the reviewer could not and implement the result** — never hand the tradeoff back. Derive the absolute-best solution per the CLAUDE.md/AGENTS.md rule (a **Recommended proposed solution:** line is verified like any remedy); record the decision, `file:line` reasoning, and rejected alternatives in the disposition. In-scope `Recommended Optional` items get the same standard.

**Growth check — once per invocation, before step 6.** Measure per the Growth check section of [rereview-routing.md](rereview-routing.md): base-excluded diff against the first push, and `pr_cycle_count` (never the loop's in-memory `review_count`). Past roughly 3x the first push, or at cycle 4+: state both numbers in the step 11 report and the disposition's `Growth check:` line, and re-run the scope test on every finding you were about to implement — sustained growth means the test is applied too loosely.

### 5. Delegate implementation?

Steps 3–4 always run inline — validation is never delegated. Steps 6–11 may go to one synchronous `general-purpose` subagent on the session model, only on a long session and never for an open ❓ Judgment or safety carve-out finding; hand it the verdicts and remedies, its footers name its own model, relay its report verbatim.

### 6. Implement the fixes

Implement every in-scope ✅/⚠️/❓/`Recommended Optional` finding, each fix scoped to its finding, following existing conventions. Never implement a ❌ Refuted item.

- **File** each out-of-scope and reviewer-routed follow-up per `github-issue-format`, carrying its number and basis (the scope rule applied, or the reviewer's routing) into the disposition. A finding you neither implement nor file is a finding you dropped. **Search first:** `gh issue list --search "<keywords>" --state all` — cite an existing issue instead of duplicating; when a human closed it, say so.
- When implementation shows an in-scope remedy needs a new mechanism, re-run the scope rules in order: rule 1 stays and the mechanism gets built here; a rule-3 finding moves to rule 2 — stop and file it.
- **Verify** after all fixes: run the project's tests, build, and lint; report failures honestly. An infeasible fix moves its finding to Refuted with the reason. A failure pre-existing on the base branch never blocks the commit; name it in the report.
- **A stale test follows the CLAUDE.md/AGENTS.md rule "The optimal solution comes first, and the tests follow it"**: edit a test, fixture, or snapshot only as **Outdated**, **Wrong**, or **Obsolete**, naming that case's checkable ground first — a confirmed finding grounds a test its fix makes outdated. The refute check runs first: a red test may show the finding was wrong, moving it to Refuted with no test edit. **A test that breaks in another location is checked before it is edited** — read it and decide: Outdated (the fix deliberately replaces the tested behavior), Wrong (never correct), or Obsolete (behavior deleted, or another test covers it — name the surviving test carrying every assertion). None of the three means the fix broke real behavior: leave the test and fix the code. Your own reading is never a ground; never delete, skip, loosen, or narrow a test for a green tree. When the correct fix cannot pass an ungrounded test, do not commit: stop before step 8 and report the test, its `file:line`, and the conflict. **Disclose every test edit** in the commit message and under `### Test edits` in the disposition: the test, its case, the ground, and what the replacement asserts (a removal gives the ground instead).

### 7. Resolve merge conflicts

If the PR is `CONFLICTING`: `git fetch origin <baseRefName> && git merge origin/<baseRefName>` on the head branch — never rebase a pushed PR branch, never blanket `ours`/`theirs`; preserve the intent of both sides, re-deriving your fix on new base code where they overlap. An irreconcilable conflict in safety-class code → stop and surface it to the user. Re-run verification; give the resolution its own line in the disposition and the report.

**Merge re-review rule.** Record the hand-resolved set: every file git listed as conflicted (`UU`, `AA`, `DU`, `UD`) plus any file you edited by hand while resolving; files git auto-merged are base-branch work and do not count. When the addressed set held findings, step 10 routes as usual. When the addressed set was a bare LGTM, the hand-resolved set alone decides: **docs-only** (every file is a Markdown file or lives under a docs directory) → post no trigger, the prior LGTM stands; **anything else** (source, tests, config, workflows, scripts) → step 10 posts the cheap shorthand, consuming no rung. A hand-resolved code file is new work the approving reviewer never saw.

### 8. Commit and push

Only after step 6's verification: `git status`; stage **each fix file by name** (never `git add -A`; a step 7 merge commit stays as git created it); `git commit -F <msg-file>`; `git push` to the tracked upstream. Message: "Address review on #<N>: <summary>", every test edit disclosed, plus the **Updated**-verb LLM Attribution Footer per the global CLAUDE.md/AGENTS.md rule, `Harness: Claude Code`. Confirm the push landed: `gh pr view <N> --json headRefOid` must equal `git rev-parse HEAD`; on a mismatch stop, post nothing, and report it.

### 9. Post the disposition comment

One comment stating what happened to each finding, per [disposition-comment.md](disposition-comment.md), read completely — posted even when every finding was refuted; never silently no-op.

### 10. Trigger the re-review

One trigger comment per [rereview-routing.md](rereview-routing.md), read completely. The step-down is keyed to the reviewer that actually ran cycle 1; the band does not decide it. Route by whether the addressed set contained **any blocking finding** (step 1); the newest verdict alone does not decide it either. A bare-LGTM run that only merged the base routes by step 7's merge re-review rule: the cheap shorthand when the hand-resolved set holds a non-docs file, no trigger when it is docs-only. The trigger is its **own** comment; a trigger bundled into the disposition does not fire.

### 11. Report to the user

Terse summary: reviews and threads acted on, per-disposition counts, commit SHA, verification result, re-review reviewer (or that the merge re-review rule posted none, naming the hand-resolved set), and every test edit with its case and ground. A step 6 stop on an ungrounded test says no commit or push exists and names the test, its `file:line`, what it asserts, and the conflict. Only when present: growth-check numbers, pre-existing verification failures, unexpected dirty files left unstaged, `**Verification limitation:**` sources, an ignored argument. Flag resolved judgment calls for override — the work is done.
