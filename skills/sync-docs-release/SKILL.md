---
name: sync-docs-release
description: Syncs the docs and then cuts a release in one run. It runs sync-docs through its own docs pull request, an optional merge of that PR, then create-release, and stops with no release when the sync is blocked. Use for "sync docs and release", "sync and cut a release", or "update docs and publish a release".
---

# sync-docs-release

Runs three operations in strict sequence, all in the main session. Do not skip steps or reorder them, except where a step below stops the run, and do not delegate any step to a subagent.

## Step 1 — Sync docs

Invoke the `sync-docs` skill via the Skill tool and follow it to completion here, passing the user's request plus any session context (target branch, last-sync SHA, specific files).

sync-docs works in its own worktree off the latest `origin/<default>` and ends with "no doc changes", an open docs PR, or **blocked** (sync-docs step 11: a guide that the sync made larger fails a mandatory size limit or falls under an unresolved size-policy conflict, and no decision resolved it; or an agent guide contract failure in `sync-docs` `guide-contract.md`: a malformed statement, a changed command file, or a regenerate or verify command that failed or changed a file it must not change). Summarize the doc edits and the PR for the user before proceeding.

On **blocked**, stop here: skip Steps 2 and 3, start no release, and report the blocked sync with each guide, its original and proposed byte counts, the limit and its source, and the worktree sync-docs kept. For an agent guide contract failure, report instead the cause, the command, its exit status, and its output, and the worktree sync-docs kept.

## Step 2 — Decide how the docs PR relates to the release

If sync-docs reported no doc changes, go straight to Step 3.

When the caller's approved plan already authorizes the docs-sync PR and its merge (as the `milestone-workflow` close-out does with merging on), take the merge-then-release choice below without asking. Otherwise ask the user once (AskUserQuestion) how Step 3 should relate to it:

- **Merge the doc PR once its checks pass, then release from the updated default branch** (recommend this one).
- **Release now without the doc changes**, leaving the PR open.
- **Stop here** with no release.

Treat their answer, or the caller's plan, as authorization for that one merge only. Their answer never authorizes the version-bump PR merge that create-release asks about. Never merge without that answer or that plan, and never merge past a failing or pending check.

## Step 3 — Create a release

Skip this step entirely if the user chose "stop here".

If they chose merge-then-release, first wait for the PR's checks (`gh pr checks <n> --watch`); a failing or pending check stops the run with the PR left open and no release. Apply the `create-release` step 4 Merge bullet's rules to this docs PR: its no-checks rule (no checks reported counts as no failing check only when `$DEFAULT` requires no status check) and its merge-method choice (`--squash`, else `--merge`, else `--rebase`, as the repo allows). Then merge it with that method and its head pinned (`--match-head-commit <head-sha>`). After the merge command, read `gh pr view <n> --json state,mergeCommit`. When `state` is not `MERGED` (a merge queue holds the PR, or `gh pr merge` only enabled auto-merge), stop with the PR left open, report its state, and start no release. Otherwise `git fetch origin` and confirm `git merge-base --is-ancestor <mergeCommit.oid> "origin/$DEFAULT"` holds before create-release starts. On both release paths, remove the sync-docs worktree (`git worktree remove <path>`; the branch and the PR stay) and run `git fetch origin` before create-release starts. Do not check out or pull the local default branch.

Then invoke the `create-release` skill via the Skill tool and follow it to completion here, carrying the user's original context (target version or bump type, release-notes specifics) and how the doc changes landed (the PR number and merge commit, or the fact that they are still unmerged).

Report the tag and the release URL to the user.
