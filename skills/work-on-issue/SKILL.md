---
name: work-on-issue
description: Use when the user says "work on issue", "implement issue", "/work-on-issue", or asks to implement a GitHub issue end-to-end (not merely validate it). Takes an issue URL or number (defaults to the just-validated issue). Implements in an isolated worktree, verifies, commits, pushes, and opens a PR that closes the issue. Stops at the open PR; work-on-issue-loop owns review.
---

# work-on-issue

Take the issue to a verified, open pull request (PR). The repository's CLAUDE.md/AGENTS.md owns engineering, test-edit, attribution, and Response Style rules. Never pause to ask; report at the end, or stop and report when a gate fails. Review triggers, merge, and follow-on issues belong to the caller.

## Input

An issue number, URL, `owner/repo#N`, or `{ issue, targetBranch?, baseRefs?: [{ pr, ref, sha }, ...] }`. With no identifier, use the issue validated or planned this session, else stop and ask; never pick one from a list. `targetBranch` also accepts prose ("target branch develop"). `baseRefs` pins reviewed predecessor heads in caller order.

## Steps

### 0. Resolve the issue, gate-check it, and detect a plan

Work in a clone whose remotes match the issue's repository; pass `-R <owner>/<repo>` to every `gh` command. Read the full body and every comment (`gh issue view <N> --comments`, paginated) before any mutation.

Gates: the issue is open and no open PR already fixes it. Check `gh pr list --state open --search "#<N> in:title,body"` and `gh issue view <N> --json closedByPullRequestsReferences`, then open each candidate; a passing mention does not count, and a PR whose head is this issue's own branch (step 1) routes to step 6. A failed lookup blocks; an existing fix stops the run with its URL.

A plan is a comment starting with `## Implementation plan` (any parenthetical model tag), or one a maintainer or caller clearly frames as a plan. Adopt the newest posted plan, even over a caller-supplied one, unless the user selects one; a caller's plan applies only when none is posted. Earlier plans are superseded, never merged. Record its author, source, date, and whether a Fable 5.1 model authored it (heading or footer) for step 6's `, fableplan` marker. No plan is normal.

Honor an explicit build model/harness assignment; a driver dispatching a stamped Codex or Cursor build loads `cli-dispatch`.

### 1. Create the isolated worktree on a verified base

**Target.** `targetBranch`, else `gh repo view --json defaultBranchRef -q .defaultBranchRef.name`, resolved once and kept through publication. Before shell use, any ref must match `^[A-Za-z0-9][A-Za-z0-9._/@+-]*$`, contain no `..` or `refs/` prefix, and pass `git check-ref-format --branch`. `git ls-remote --heads origin "refs/heads/<target>"` must return exactly that ref (a bare name tail-matches `release/<target>`). `git fetch origin <target>` and record its commit. A missing or invalid target blocks; never substitute a branch.

**Base.** The fetched target commit, or with `baseRefs` the result of [dependency-base.md](dependency-base.md), applied before any worktree exists.

**Name.** `<prefix>/issue-<N>-<slug>`, prefix `cc/`, `cursor/`, or `codex/` for the harness; `<slug>` is the title lowercased, non-alphanumeric runs replaced by one hyphen, first 5 words, so a retry finds the same worktree.

**Resume or create.** Follow [worktree.md](worktree.md): reuse only a worktree or branch proven to belong to this issue with the same target and pins, never create a second one or reset an existing one, and confirm `HEAD` before implementing. Never implement on the target branch or in the main checkout. Anchor later commands with `-C <worktree-path>`.

### 2. Understand the issue and the code

Trace the affected paths and map every acceptance criterion, including negative ones, to an observable check. Read validation findings and the docs for the touched subsystem. Where the issue's sketch is doubtful or conflicts with the code, implement the optimal direction and note the discrepancy in the PR body. An already-satisfied issue gets an evidence report, no empty PR; an ambiguous or infeasible goal gets a report of the blocking decision.

**An adopted plan is the blueprint**: implement to it instead of re-deriving. Three overrides, in order: (1) **the traced code**: where the plan contradicts what the code does, follow the code; (2) **anything newer on the issue**: a later maintainer comment or edit supersedes the part it touches; (3) **correctness and safety**: a plan step that breaks an invariant is wrong. When overrides conflict, the higher number wins. Existing behavior never cancels a requested change or acceptance criterion; explicit user requirements stay authoritative. Name every deviation in the PR body with its reason. This is the single plan-deviation policy; a caller restatement never narrows it, and a caller sentence permitting one override does not remove the other two.

**Mirror the plan's steps into the task tracker** (`TodoWrite`, else the conversation) before writing code, one item per step; mark an item complete only when its verify point passes. Derive missing numbering or checks yourself. An overridden step closes as a recorded deviation carrying its own verify point (or the superseding comment) and a matching PR-body entry; never marked done, never left open. A borrowed verify point re-homes when its source step is overridden: to the replacement's verify point, else the item's own check, else the item closes as its own recorded deviation, cascading through borrowers. No open item may wait on a check that can never run. Without a plan, track the acceptance checks directly.

### 3. Implement the fix

Build the best solution per the repository's engineering rules: conventions, invariants, a diff scoped to the issue, and documentation the change makes stale. Write tests for behavior that can regress. For a bug fix, prove the regression test is real (red then green) against the unfixed base without losing current work; when reproduction is unavailable or the caller forbids execution (step 4), say so in the PR body. Documentation-only changes need relevant validation, no artificial tests.

The repository's test-edit rules own stale-test edits: the cases Outdated, Wrong, and Obsolete, each with a named checkable ground, disclosed in the commit and PR body. A test with no ground stays and the code gets the fix. A test that breaks in another location is checked before it is edited: classify it as Outdated, Wrong, or Obsolete and edit under that case with its ground; a test that is none of the three means the change broke real behavior, so fix the code. If the correct change still cannot pass an ungrounded test, stop before step 5 and report it (step 7).

### 4. Verify before claiming anything

Run the project's build, tests, and linters plus the step 2 acceptance checks. Review the full diff against the base for omissions, unrelated changes, and generated files. Close every plan item with evidence or a deviation.

Fix failures this change caused; check an alleged pre-existing failure against the unchanged base first. Failing or unrunnable required checks block the PR, except under a caller instruction that forbids running the project's code and defers to continuous integration (CI), such as the issue-workflow prompts' "do NOT run test suites" line; then the PR body names the checks left to CI. Rerun affected checks after later edits. Local success is not CI success.

### 5. Commit and push

Review `git status` and the staged diff; stage by name when anything unrelated appears. Commit per the repository's title convention referencing the issue, ending with the LLM Attribution Footer (`Created`; `<harness>` is `Claude Code` interactively, or the GitHub Action identifier in CI). `git push -u origin <branch>` and confirm `git ls-remote origin refs/heads/<branch>` equals local `HEAD`. Never force-push to repair a mismatch; inspect remote state before retrying an uncertain push.

### 6. Open the PR

Re-run the step 0 gates, re-check `origin/<target>`, and with `baseRefs` recheck the pins per dependency-base.md; a changed gate preserves the branch and reports. `--base` is the recorded target. Read `gh pr list --head <branch> --state all`: update an open PR on this branch; a merged PR whose merge commit contains `HEAD` means the work landed, so stop and report; otherwise create a new PR, never reopen one. After an uncertain create, search for the exact head/base pair before retrying.

Title: the repository's PR-title convention; append `, fableplan` only when the step 0 Fable flag is set or a Fable 5.1 plan produced this session drove the build; a maintainer's plan earns no marker. Body: `Closes #<N>`; `## Summary` and verification first, naming checks left to CI; every test edit disclosed per CLAUDE.md; the adopted plan linked with every deviation and its reason (or "none"); with `baseRefs`, the predecessor PRs and verified heads in order, which must merge first (the base stays the target); with a non-default target, a `Target branch:` line; `## Plain simple English` last before the footer. Pass multiline text via `--body-file`.

Read back `gh pr view <url> --json state,headRefName,headRefOid,baseRefName,body`; success only when the PR is open on the recorded base with the verified local commit as head.

### 7. Report to the user

The skill ends here; the caller triggers review and waits on CI. Report the worktree/branch, a non-default target, what was implemented, the verification result, the commit SHA, and the PR URL. On a blocker, state the stage, the evidence, the preserved worktree, and which commit, push, or PR already exists per branch history and GitHub. When step 3 stopped on an ungrounded failing test, name its `file:line`, assertion, and conflict. Name unfiled follow-on work and return caller-required fields from verified state. Cap the report at 55 words, plain simple English in ASD-STE100, per the Response Style rules.
