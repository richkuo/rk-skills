---
name: fix-pr-review
description: Use when the user asks to fix, address, or respond to a PR review — "fix the PR review", "/fix-pr-review". Optional PR number/URL (defaults to the current branch's PR); optional `codex` argument selects Codex.
---

# fix-pr-review

Resolve every unaddressed review finding autonomously: validate, fix or refute, implement judgment calls and optional improvements, and request a re-review. Don't stop to ask the user. **The review is a hypothesis, not a work order**: trace every finding to current `file:line` and confirm it *before* changing anything.

## Input

In any order: an optional PR reference (number or URL; default = the current branch's PR) and an optional literal `codex` token selecting Codex as this cycle's re-review bot. Any other token doesn't block — use the defaults and name it in the step 11 report. No PR found and none given → say so and stop.

## Steps

### 0. Resolve the PR and sync

`gh pr view <N|--> --json headRefName,headRepositoryOwner,baseRefName,state,mergeable,mergeStateStatus`, then `git fetch origin`. Be **on the PR's head branch** (`gh pr checkout <N>` if not; never fix a review on the base branch); on a **fork** PR (`headRepositoryOwner` differs), pull and push to the tracked upstream, never assume `origin`. `git pull --ff-only` — can't fast-forward → stop and report. `merged`/`closed` → stop and report. `CONFLICTING`/`DIRTY` → step 7 is part of this run.

### 1. Fetch all unaddressed review feedback

Three channels: formal reviews, issue comments, and inline diff threads. Fetch and select the unaddressed set per [fetch-recipes.md](fetch-recipes.md) — read it completely; it defines the cutoff and collection rules. **Never delete, edit, or bury a disposition comment**: the next review reads them on purpose. State what you picked and **note whether the set contains any blocking finding** (a `Needs Fixing` / `Requires Human Review` item, a thread asserting a real defect, or a failing check) — this drives step 10.

**LGTM with no blocking sections** still gets its non-blocking items: implement `Recommended Optional` per step 6, file `Create Follow-up Issue` items (fixed here only under scope rule 1). **Bare `LGTM`, no finding items, no open threads** — a `**Verification limitation:**` line is not a finding — report approved and stop, naming such lines; conflicts still get step 7.

### 2. Fetch failing CI checks

One `gh pr checks` snapshot, never a wait or a poll; bucket handling, failing detail, and cancelled-check attribution per [fetch-recipes.md](fetch-recipes.md). Each `fail`-bucket check is one finding: **CI Failure — `<check name>`**.

### 3. Extract findings

Parse everything into atomic findings — split compound feedback, merge duplicates across sources noting all — tagged: **Needs Fixing** (blocking; every CI Failure starts here), **Requires Human Review** (blocking; the reviewer couldn't decide), **Recommended Optional** (non-blocking), **Create Follow-up Issue** (track separately; any issue this run files gets a complete body per `github-issue-format`, including a `## Plain simple English` section under 55 words — never a stub).

A `**Verification limitation:**` line is never a finding — skip it when classifying. Free-form feedback classifies into the same buckets by substance.

### 4. Re-validate each finding

For **every** finding, trace the claim to current code and assign a verdict with your own `file:line`: ✅ **Confirmed** (code matches → fix it, step 6); ❌ **Refuted** (the claim or its remedy doesn't hold → no change; record a code-grounded rebuttal); ⚠️ **Partial** (real but narrower/broader → fix the true part; note the correction); ❓ **Judgment** (a real tradeoff → derive and **implement** the best solution, below).

A `### Needs Fixing` item's stated `**Reachability:**` precondition is part of its claim — trace it to current code. On a code-grounded refutation of the trigger, the blocking status is refuted while the defect may still stand: re-route the finding to `### Recommended Optional`, scope-test its remedy, and record it under `### Corrected scope (partial)` in the disposition. A finding never re-routes on a likelihood judgment of your own; with no stated precondition it is validated as written.

Apply the validation-discipline list in [red-flags-and-mistakes.md](red-flags-and-mistakes.md): whole-body reads and negative proofs, a suggested fix verified as its own claim, the **safety carve-out** (money, data integrity, security, auto-protective mechanisms — fix or escalate even at low confidence, never silently drop without code proof), and CI-failure attribution (fix only failures this PR's diff caused).

#### Scope: the second axis on every finding

A verdict says whether a finding is real; scope says whether its remedy belongs in this PR. **The yardstick**: the issue(s) this PR closes (union of asks), else the PR body's stated scope. Classify each ✅/⚠️/❓ finding's **remedy** — except one the reviewer routed to `### Create Follow-up Issue`, which is **filed and never implemented**; Rule 1 is that exclusion's only exception (the disposition says so). Apply in order — first match decides; rule 1 outranks everything later:

1. **PR-caused — always in scope.** The defect lives in code this PR adds or changes, or this PR creates the hazard → implement it, however much mechanism the fix needs; no later rule or step may reclassify it.
2. **New mechanism the yardstick never asked for — out of scope.** The remedy introduces a mechanism the PR lacks (a new persistent store, lifecycle scheme, cross-cutting invariant, retry path, a new subsystem) → file a follow-up issue, naming a deferred pre-existing hazard plainly.
3. **Everything else — in scope**, including a pre-existing defect whose remedy needs no new mechanism → implement it (step 6).

**Remedy size never decides scope, in either direction**, and **a reviewer's `Recommended Optional` carries no authority to enlarge the PR** — same test, file the out-of-scope ones.

**Growth check — once per invocation, before step 6.** Measure growth and cycle count per the Growth check section of [rereview-routing.md](rereview-routing.md) — base-excluded diff against the first push, and `pr_cycle_count` (never the loop's in-memory `review_count`). Past roughly 3x the first push, or at cycle 4+: state both numbers in the step 11 report and the disposition's `Growth check:` line, and re-run the scope test on every finding you were about to implement; sustained growth means the test is applied too loosely.

**For every ❓ Judgment finding, do the analysis the reviewer couldn't and implement the result** — never hand the tradeoff back or pause. Derive the absolute-best solution per the global rule in CLAUDE.md/AGENTS.md (a **Recommended proposed solution:** line is verified like any remedy), and record the decision, `file:line` reasoning, and rejected alternatives in the disposition. In-scope `Recommended Optional` items get the same standard; the scope test runs first.

### 5. Delegate implementation?

Steps 3–4 always run inline — validation never gets delegated. Steps 6–11 may go to a synchronous `general-purpose` subagent, inheriting the session model, only on a long session, never for an open-ended ❓ Judgment or safety carve-out finding; hand it the verdicts and remedies, its footers name its own model, and relay its report verbatim.

### 6. Implement the fixes

Implement every in-scope ✅/⚠️/❓/`Recommended Optional` finding. Never implement ❌ Refuted or `Create Follow-up Issue` items — file the latter, rule 1 the only exception.

- File each out-of-scope finding per `github-issue-format`, carrying its number plus the basis (the scope rule applied, or the reviewer's routing) into the disposition. A finding you neither implement nor file is a finding you dropped. **Search before filing:** `gh issue list --search "<keywords>" --state all` — cite an existing issue instead of duplicating; when a human closed it, say so.
- Follow existing conventions; keep each fix scoped to its finding. When implementation reveals an in-scope remedy needs a new mechanism, re-run the scope rules in order: rule 1 stays and the mechanism gets built here; a rule-3 finding moves to rule 2 — stop and file it.
- After all fixes, **verify**: run the project's tests/build/lint and report failures honestly; an infeasible fix moves its finding to Refuted with the reason.
- **A stale test follows the CLAUDE.md/AGENTS.md rule "The optimal solution comes first, and the tests follow it"** — edit one only as **Outdated**, **Wrong**, or **Obsolete**, naming that case's checkable ground first — a confirmed finding grounds a test its fix makes outdated; fixtures and snapshots included. **A test that breaks in another location is checked before it is edited.** The refute check runs first: a red test may show the finding was wrong — it moves to Refuted with no test edit. When the finding stands, decide: Outdated (the fix deliberately replaces the tested behavior), Obsolete (the behavior is deleted, or another test covers it — name the surviving test carrying every assertion), or Wrong (the test was never correct). A test that is none of the three means the fix broke real behavior — leave the test and fix the code; a test with no ground stays as it is — your own reading is never a ground — and never delete, skip, loosen, or narrow a test for a green tree. When the correct fix cannot pass an ungrounded test, do not commit: stop before step 8 and report the test, `file:line`, and the conflict (step 11). **Disclose every test edit** in the commit message and under `### Test edits` in the disposition: the test, its case, the ground, and what the replacement asserts (a removal gives the ground instead).

### 7. Resolve merge conflicts

If the PR is `CONFLICTING`: `git fetch origin <baseRefName> && git merge origin/<baseRefName>` on the head branch — never rebase a pushed PR branch, never blanket `ours`/`theirs`; preserve the intent of both sides, re-deriving your fix on new base code where they overlap. An irreconcilable conflict in safety-class code → stop and surface to the user. Re-run verification after resolving; give the resolution its own line in the disposition and the report.

### 8. Commit and push

Only after verification passes: `git status`; stage **each fix file by name** (never `git add -A`); `git commit -F <msg-file>`; `git push` to the tracked upstream (a fork's head is not on `origin`). Message: "Address review on #<N>: <summary>" plus the **Updated**-verb LLM Attribution Footer per the global CLAUDE.md/AGENTS.md rule, `Harness: Claude Code`.

### 9. Post the disposition comment

Post one comment stating what happened to each finding, per [disposition-comment.md](disposition-comment.md), read completely.

### 10. Trigger the re-review

Post one trigger comment per [rereview-routing.md](rereview-routing.md), read completely. The step-down is keyed to the reviewer that actually ran cycle 1, never to a band; route by whether the addressed set contained **any blocking finding** (step 1), never by the newest verdict alone; the trigger is its **own** comment, never bundled into the disposition.

### 11. Report to the user

Terse summary: reviews/threads acted on, per-disposition counts, commit SHA, verification result, and the re-review reviewer. Name every test edit with its case and ground. If step 6 stopped on an ungrounded test, say no commit or push exists and name the test, its `file:line`, what it asserts, and the conflict. Include growth-check numbers, unexpected dirty files left unstaged (step 8), `**Verification limitation:**` sources, and any unrecognized argument only when present. Flag resolved judgment calls for override — the work is done. Edge cases: the stop-condition table in [red-flags-and-mistakes.md](red-flags-and-mistakes.md).
