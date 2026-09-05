---
name: work-on-issue
description: Use when the user says "work on issue", "implement issue", "/work-on-issue", or asks to implement a GitHub issue end-to-end (not merely validate it). Takes an issue URL or number (defaults to the just-validated issue). Implements the fix in an isolated worktree, verifies it, commits and pushes, and opens a PR that closes the issue. Default follow-on when validate-issue offers "work on issue".
---

# work-on-issue

Take a GitHub issue to an open pull request that closes it: isolated worktree, implement, verify, commit and push, open the PR. Do not pause to ask the user; report at the end. Build the fix the traced code supports, even where the issue prose suggests another.

## Input

One of: nothing (the issue validated this session, else `gh issue list --limit 1`); `#<N>` / `<N>` / URL / `owner/repo#N`; or the orchestration form `{ issue: <N>, targetBranch?: "<branch>", baseRefs?: [{ pr, ref, sha }, ...] }`. `baseRefs` order is authoritative; each entry pins a predecessor PR's reviewed head. `targetBranch` (or a prose "target branch develop") names the branch the PR merges into and the worktree starts from; default is the repo default branch. If the issue lives in another repo, work in a local clone of it, or stop and say which repo is needed.

## Steps

### 0. Resolve the issue, gate-check it, and detect a plan

Before any worktree exists, run `gh issue view <N> --comments` and `gh pr list --state open --search "#<N> in:title,body"`. Gates: the issue must be open, and no open PR may already fix it (a passing mention does not count; this session's own branch does not count). A failed gate: stop and report.

Scan the comments for a plan: a comment starting with `## Implementation plan` (any parenthetical model tag), or one a maintainer clearly frames as a plan. The newest wins, even over a caller-supplied plan; earlier plans are superseded, never merged. Record the adopted plan's author, URL, date, and whether a Fable model authored it (heading or footer); step 6's `, fableplan` marker keys on that flag. No plan is normal.

### 1. Create the isolated worktree on a verified base

Never implement on the target branch or a divergent checkout. First run `gh repo view --json defaultBranchRef -q .defaultBranchRef.name` and `git fetch origin`.

**Target.** `targetBranch` when given, else the default branch. A given `targetBranch` must, before it reaches a shell, match `^[A-Za-z0-9][A-Za-z0-9._/@+-]*$`, contain no `..`, and pass `git check-ref-format --branch`; then `git ls-remote --heads origin "refs/heads/<target>"` must list exactly one line (the full ref is required because a bare name tail-matches `release/<target>`). A missing or invalid target stops the run with the reason; never substitute the default branch.

**Base.** Without `baseRefs`: `origin/<target>`. With `baseRefs`, validate the whole list before creating a worktree: reject an empty list, duplicates, non-positive PR numbers, SHAs outside 40 to 64 hex chars, and any ref failing `^[A-Za-z0-9][A-Za-z0-9._/@+-]*$` before it reaches a shell; then reject the target branch, the default branch, and `git check-ref-format --branch` failures. Verify each entry with `gh pr view <pr> --json headRefName,headRefOid,headRepository`: same repo, exact `ref` and `sha` match; fetch `pull/<pr>/head` into a namespaced local ref and confirm it resolves to `sha`. Any mismatch, missing, ambiguous, cross-repo, or changed head blocks the run; never fall back to the target or default branch. The first verified SHA is the initial base.

**Create and enter.** If `git worktree list` already shows a worktree for this issue, enter it; never create a duplicate. Claude Code: `EnterWorktree(name: "cc/issue-<N>-<slug>")`, `<slug>` = issue title kebab-cased to 5 words or fewer; if the tool altered the branch name, `git branch -m cc/issue-<N>-<slug>`. Cursor/Codex: `git worktree add .claude/worktrees/<prefix>/issue-<N>-<slug> -b <prefix>/issue-<N>-<slug> <resolved-base>` with `cursor/` or `codex/`, then `cd` in. Confirm `HEAD` equals the resolved base SHA; if a brand-new, commit-free worktree differs (`EnterWorktree` always branches from the default branch), `git -C <worktree-path> reset --hard <resolved-base>`. Never reset a re-entered worktree or one carrying work. Anchor every later command with `-C <worktree-path>`; shell state does not persist between calls.

**Multiple prerequisites.** Merge the remaining recorded SHAs in caller order with one `git merge --no-commit --no-ff` before touching product files. On any conflict, abort the merge and return blocked with the conflicting refs: no resolution, no implementation, no PR. Commit the merge with a dependency-integration message plus the attribution footer. Then verify `git merge-base --is-ancestor <sha> HEAD` for every recorded SHA (a single entry needs only this check); any failure blocks. The resulting `HEAD` is the only authorized base.

### 2. Understand the issue and the code

Read the issue body and comments, validation findings, and the repo's `CLAUDE.md`/docs for the touched subsystem. If validation marked the issue's sketch as doubtful or wrong, or it conflicts with the code, implement the optimal direction for this repo and note the discrepancy in the PR body.

**An adopted plan is the blueprint**: implement to it instead of re-deriving. Three overrides, in order: (1) **the traced code**: where the plan contradicts what the code does, follow the code; (2) **anything newer on the issue**: a later maintainer comment or edit supersedes the part it touches; (3) **correctness and safety**: a plan step that breaks an invariant is wrong. Name every deviation in the PR body with its reason. This is the single plan-deviation policy; a caller restatement never narrows it, and a caller sentence permitting one override does not remove the other two.

**Mirror the plan's steps into the task tracker** (`TodoWrite` or equivalent) before writing code, one item per step; mark an item complete only when its verify point passes. Derive missing numbering or per-step observable checks yourself. Without a tracker, keep the checklist in a scratchpad file outside the working tree. An overridden step closes as a recorded deviation carrying its own verify point (or the superseding comment) and a matching PR-body entry; it is never marked done and never left open. A borrowed verify point re-homes when its source step is overridden: to the replacement's verify point, else the item's own observable check, else the item closes as its own recorded deviation; re-homing cascades through borrowers of that item's check. No open item may wait on a check that can never run.

### 3. Implement the fix

Build the best solution per CLAUDE.md's engineering rules: follow existing conventions, respect invariants, keep the diff scoped to the issue. Write tests for the change; for a bug fix, prove the regression test is real (red then green) by running it against the unfixed code first.

CLAUDE.md's test-edit rules own stale-test edits: the cases Outdated, Wrong, and Obsolete, each with a named checkable ground, disclosed in the commit and PR body. A test with no ground stays as it is and the code gets the fix. A test that breaks in another location is checked before it is edited: classify it as Outdated, Wrong, or Obsolete and edit under that case with its ground; a test that is none of the three means the change broke real behavior, so fix the code. If the correct change still cannot pass an ungrounded test, stop before step 5, keep the worktree, and report it (step 7).

### 4. Verify before claiming anything

Run the project's build, tests, and linters (per its `CLAUDE.md`, `package.json`, or Makefile) and confirm they pass before committing. Report real results; never paper over a failure.

### 5. Commit and push

Review `git status` before staging; `git add -A` only when nothing unrelated appears, otherwise stage intended files by name. Commit with the repo's title convention referencing the issue, ending with the LLM Attribution Footer per CLAUDE.md (`Created`; `<harness>` is `Claude Code` interactively, or the GitHub Action identifier in CI). Push with `-u` and confirm the remote head equals the local `HEAD`.

### 6. Open the PR

Re-run the step 0 duplicate-PR search, then set `--base` to the step 1 target: re-detect the default branch when no `targetBranch` was given, else re-check that `origin/<targetBranch>` still exists. Title: the repo's PR-title convention (CLAUDE.md default); append `, fableplan` only when a Fable-authored plan (the step 0 flag, or one produced this session) drove the build; a maintainer's plan earns no marker. Body: `Closes #<N>`; `## Summary` and verification first; every test edit disclosed per CLAUDE.md; the adopted plan linked with every deviation and its reason (or "none"); with `baseRefs`, the predecessor PRs and verified heads in order, stating they must merge first (the PR base stays the target branch); with a non-default target, a `Target branch:` line; `## Plain simple English` last, per CLAUDE.md Response Style. Capture the PR URL.

### 7. Report to the user

The skill ends here; the caller triggers any `@claude` review and waits on CI. Report the worktree/branch, the target branch when it differs from the default, what was implemented, the verification result, the commit SHA, and the PR URL. When step 3 stopped the run on an ungrounded failing test, report instead that no commit or PR exists, name the test with its `file:line`, what it asserts, and the conflict, and keep the worktree. Name follow-on work the deliverables mention as unfiled. Cap the report at 55 words, plain simple English in ASD-STE100, per the Response Style rules.
