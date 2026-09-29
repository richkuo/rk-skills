---
name: sync-docs-release
description: Use when the user wants to sync docs and then cut a release in one shot. Combines sync-docs (which lands its edits through its own docs PR) → optional merge of that PR → create-release in sequence. Triggers on phrases like "sync docs and release", "sync and cut a release", "update docs and publish a release".
---

# sync-docs-release

Runs three operations in strict sequence, all in the main session. Do not skip steps or reorder them, and do not delegate any step to a subagent — every edit, commit, and release action stays visible in this session.

## Step 1 — Sync docs

Invoke the `sync-docs` skill via the Skill tool and follow it to completion here, passing the user's request plus any session context (target branch, last-sync SHA, specific files).

sync-docs works in its own worktree off the latest `origin/<default>` and ends with either "no doc changes" or an open docs PR. Summarize the doc edits and the PR for the user before proceeding.

## Step 2 — Decide how the docs PR relates to the release

If sync-docs reported no doc changes, go straight to Step 3.

Otherwise a release cut before the docs PR merges will not contain the doc changes. When the caller's approved plan already authorizes the docs-sync PR and its merge (as the `milestone-workflow` close-out does with merging on), take the merge-then-release choice below without asking. Otherwise ask the user once — via AskUserQuestion — how Step 3 should relate to it:

- **Merge the doc PR once its checks pass, then release from the updated default branch** (recommend this one).
- **Release now without the doc changes**, leaving the PR open.
- **Stop here** — no release.

Treat their answer, or the caller's plan, as authorization for that one merge only. Their answer never authorizes the version-bump PR merge that create-release asks about. Never merge without that answer or that plan, and never merge past a failing or pending check.

## Step 3 — Create a release

Skip this step entirely if the user chose "stop here".

If they chose merge-then-release, first wait for the PR's checks (`gh pr checks <n> --watch`); a failing or pending check stops the run with the PR left open and no release. Then merge it with its head pinned (`--match-head-commit <head-sha>`). On both release paths, remove the sync-docs worktree (`git worktree remove <path>`; the branch and the PR stay) and run `git fetch origin` before create-release starts, so its clean-tree precondition sees no leftover worktree. Do not check out or pull the local default branch: create-release reads `origin/<default>`, never the local branch.

Then invoke the `create-release` skill via the Skill tool and follow it to completion here, carrying the user's original context (target version or bump type, release-notes specifics) and how the doc changes landed — the PR number and merge commit, or the fact that they are still unmerged.

Report the tag and the release URL to the user.
