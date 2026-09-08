---
name: work-on-issue
description: Use when the user says "work on issue", "implement issue", "/work-on-issue", or asks to implement a GitHub issue end-to-end (not merely validate it). Takes an issue URL or number (defaults to the just-validated issue). Implements in an isolated worktree, verifies, commits, pushes, and opens a PR that closes the issue. Default follow-on from validate-issue, fableplan, or issueplan. Stops at the open PR; work-on-issue-loop owns review convergence.
---

# work-on-issue

Take the issue to a verified, open pull request (PR): isolated worktree, implement, verify, commit and push, open the PR. The repository's CLAUDE.md/AGENTS.md owns engineering, test-edit, attribution, and Response Style rules. Never pause to ask; report at the end, or stop and report when a gate fails. Review triggers, merge, and follow-on issues belong to the caller.

## Input

An issue number, URL, `owner/repo#N`, or `{ issue, targetBranch?, baseRefs?: [{ pr, ref, sha }, ...] }`. With no identifier, use the issue validated or planned this session; with none, stop and ask. Never pick an issue from `gh issue list` or any list. `targetBranch` also accepts prose ("target branch develop"). `baseRefs` pins reviewed predecessor heads in caller order.

## Steps

### 0. Resolve the issue, gate-check it, and detect a plan

Work in a clone whose remotes match the issue's repository; pass `-R <owner>/<repo>` to every `gh` command. Read the full body and every comment of `gh issue view <N> --comments` (paginate when truncated) before any mutation.

Gates: the issue is open, and no open PR already fixes it. Check `gh pr list --state open --search "#<N> in:title,body"` and `gh issue view <N> --json closedByPullRequestsReferences`, then open each candidate; a passing mention and this run's own PR do not count. A failed lookup blocks; an existing fix stops the run with its URL.

A plan is a comment starting with `## Implementation plan` (any parenthetical model tag), or one a maintainer or caller clearly frames as a plan. Adopt the newest posted plan, even over a caller-supplied one, unless the user selects one; the caller's plan applies only when none is posted. Earlier plans are superseded, never merged. Record its author, source, date, and whether a Fable 5.1 model authored it (heading or footer); step 6's `, fableplan` marker keys on that flag. No plan is normal.

Honor an explicit build model/harness assignment; a driver dispatching a stamped Codex or Cursor build loads `cli-dispatch`.

### 1. Create the isolated worktree on a verified base

**Target.** `targetBranch`, else `gh repo view --json defaultBranchRef -q .defaultBranchRef.name`, resolved once and kept through publication. Before shell use it must match `^[A-Za-z0-9][A-Za-z0-9._/@+-]*$`, contain no `..` or `refs/` prefix, and pass `git check-ref-format --branch`; `git ls-remote --heads origin "refs/heads/<target>"` must return exactly that ref (a bare name tail-matches `release/<target>`). `git fetch origin <target>` and record its commit. A missing or invalid target blocks; never substitute another branch.

**Base.** The fetched target commit, or with `baseRefs` the result of [dependency-base.md](dependency-base.md), applied before any worktree exists.

**Name.** `<prefix>/issue-<N>-<slug>`, prefix `cc/`, `cursor/`, or `codex/` for the harness; `<slug>` is the title lowercased, non-alphanumeric runs replaced by one hyphen, first 5 words. Deterministic, so a retry finds the same worktree.

**Resume.** Check `git worktree list --porcelain`, `git branch --list '*/issue-<N>-*'`, and `git ls-remote --heads origin "refs/heads/*/issue-<N>-*"`; one worktree and branch per issue at most. If one exists, prove from branch history, working-tree changes, session context, and any open PR that it belongs to this issue with the same target and pins; a matching name or ancestry alone proves nothing. Ambiguous ownership, changed pins, unrelated work, or an unfinished Git operation (`MERGE_HEAD`, rebase, cherry-pick) stops the run with the path and evidence; never create a second worktree, and never delete, reset, or clean the existing one. A remote-only hit resumes with `git fetch origin +refs/heads/<branch>:refs/remotes/origin/<branch>` (add `--unshallow` when `git rev-parse --is-shallow-repository` is true) then `git worktree add <path> -b <branch> origin/<branch>`; `HEAD` must equal the fetched commit, and the implementation base must be an ancestor of `HEAD`.

**Create.** Claude Code: `EnterWorktree(name: "cc/issue-<N>-<slug>")`; if the tool altered the branch name, `git branch -m cc/issue-<N>-<slug>`. `EnterWorktree` branches from the default branch, so on a brand-new, commit-free worktree whose `HEAD` differs from the resolved base, `git -C <worktree-path> reset --hard <resolved-base>`. Cursor/Codex: `git worktree add .claude/worktrees/<prefix>/issue-<N>-<slug> -b <prefix>/issue-<N>-<slug> <resolved-base>`, then `cd` in. Confirm `HEAD` equals the resolved base. Never implement on the target branch or in the main checkout. Anchor every later command with `-C <worktree-path>`; shell state does not persist between calls.

### 2. Understand the issue and the code

Trace the affected paths and map every acceptance criterion, including negative ones, to an observable check. Read validation findings and the repository docs for the touched subsystem. Where the issue's sketch is doubtful, wrong, or conflicts with the code, implement the optimal direction for this repository and note the discrepancy in the PR body. An already-satisfied issue gets an evidence report, no empty PR; an ambiguous or infeasible goal gets a report of the blocking decision.

**An adopted plan is the blueprint**: implement to it instead of re-deriving. Three overrides, in order: (1) **the traced code**: where the plan contradicts what the code does, follow the code; (2) **anything newer on the issue**: a later maintainer comment or edit supersedes the part it touches; (3) **correctness and safety**: a plan step that breaks an invariant is wrong. When overrides conflict, the higher number wins. Existing behavior never cancels a requested change or an acceptance criterion; explicit user requirements remain authoritative. Name every deviation in the PR body with its reason. This is the single plan-deviation policy; a caller restatement never narrows it, and a caller sentence permitting one override does not remove the other two.

**Mirror the plan's steps into the task tracker** (`TodoWrite` or equivalent, else the conversation) before writing code, one item per step; mark an item complete only when its verify point passes. Derive missing numbering or per-step checks yourself. An overridden step closes as a recorded deviation carrying its own verify point (or the superseding comment) and a matching PR-body entry; never marked done, never left open. A borrowed verify point re-homes when its source step is overridden: to the replacement's verify point, else the item's own check, else the item closes as its own recorded deviation; re-homing cascades through borrowers. No open item may wait on a check that can never run. Without a plan, track the acceptance checks directly.

### 3. Implement the fix

Build the best solution per the repository's engineering rules: existing conventions, invariants, a diff scoped to the issue, and documentation the change makes stale. Write tests for behavior that can regress. For a bug fix, prove the regression test is real (red then green) against the unfixed base without losing current work, or say reproduction was unavailable. Documentation-only changes need relevant validation, no artificial runtime tests.

The repository's test-edit rules own stale-test edits: the cases Outdated, Wrong, and Obsolete, each with a named checkable ground, disclosed in the commit and PR body. A test with no ground stays and the code gets the fix. A test that breaks in another location is checked before it is edited: classify it as Outdated, Wrong, or Obsolete and edit under that case with its ground; a test that is none of the three means the change broke real behavior, so fix the code. If the correct change still cannot pass an ungrounded test, stop before step 5, keep the worktree, and report it (step 7).

### 4. Verify before claiming anything

Run the project's build, tests, and linters (per its `CLAUDE.md`, `package.json`, or Makefile) plus the step 2 acceptance checks. Review the full diff against the base for omissions, unrelated changes, and generated files. Close every plan item with evidence or a recorded deviation.

Fix failures this change caused; check an alleged pre-existing failure against the unchanged base first. Failing or unrunnable required checks block the commit and PR. One exception: a caller instruction that forbids running the project's code and defers to continuous integration (CI), such as the issue-workflow prompts' "do NOT run test suites" line, authorizes publication, and the PR body names the checks left to CI. Rerun affected checks after later edits. Local success is not CI success.

### 5. Commit and push

Review `git status` and the staged diff; `git add -A` only when nothing unrelated appears, else stage by name. Commit per the repository's title convention referencing the issue, ending with the LLM Attribution Footer (`Created`; `<harness>` is `Claude Code` interactively, or the GitHub Action identifier in CI). `git push -u origin <branch>` and confirm `git ls-remote origin refs/heads/<branch>` equals local `HEAD`. Never force-push to repair a mismatch; after an uncertain push, inspect remote state before retrying.

### 6. Open the PR

Re-run the step 0 gates, re-check `origin/<target>` exists, and with `baseRefs` recheck the pins per dependency-base.md; a changed gate preserves the branch and reports. `--base` is the recorded target. Read `gh pr list --head <branch> --state all`: update this run's open PR instead of creating another; a merged PR whose merge commit contains `HEAD` means the work landed, so stop and report; a merged PR with commits past it, or a closed unmerged PR, is not this run's, so create a new one, never reopen. After an uncertain create response, search for the exact head/base pair before retrying.

Title: the repository's PR-title convention (CLAUDE.md default); append `, fableplan` only when the step 0 Fable flag is set or a Fable 5.1 plan produced this session drove the build; a maintainer's plan earns no marker. Body: `Closes #<N>`; `## Summary` and verification first, naming checks left to CI; every test edit disclosed per CLAUDE.md; the adopted plan linked with every deviation and its reason (or "none"); with `baseRefs`, the predecessor PRs and verified heads in order, stating they must merge first (the base stays the target branch); with a non-default target, a `Target branch:` line; `## Plain simple English` last before the footer, per Response Style. Pass multiline text via `--body-file`.

Read back `gh pr view <url> --json state,headRefName,headRefOid,baseRefName,body`; success only when the PR is open with the recorded base, the head equals the verified local commit, and the change is in the PR diff.

### 7. Report to the user

The skill ends here; the caller triggers any `@claude` review and waits on CI. Report the worktree/branch, a non-default target, what was implemented, the verification result, the commit SHA, and the PR URL. On a blocker, state the stage, the evidence, the preserved worktree, and which commit, push, or PR already exists per branch history and GitHub. When step 3 stopped on an ungrounded failing test, name it with its `file:line`, what it asserts, and the conflict. Name follow-on work the deliverables mention as unfiled. Return caller-required structured fields from verified state. Cap the report at 55 words, plain simple English in ASD-STE100, per the Response Style rules.
