---
name: sync-docs-release
description: Use when the user wants to sync docs and then cut a release in one shot. Combines sync-docs → land the doc changes (branch + PR, or a direct commit when the repo allows it) → create-release in sequence. Triggers on phrases like "sync docs and release", "sync and cut a release", "update docs and publish a release".
---

# sync-docs-release

Runs three operations in strict sequence, all in the main session. Do not skip steps or reorder them, and do not delegate any step to a subagent — every edit, commit, and release action stays visible in this session.

## Step 1 — Sync docs

Invoke the `sync-docs` skill via the Skill tool and follow it to completion here, passing the user's request plus any session context (target branch, last-sync SHA, specific files).

Summarize the doc edits for the user before proceeding.

## Step 2 — Land the doc changes

sync-docs leaves its edits uncommitted in the current checkout. **Never commit them to the repository's default branch**, and never treat a direct commit as acceptable merely because the checkout happens to be sitting on that branch.

First, if `git status` shows no doc changes at all, report "no doc changes to commit" and go straight to Step 3.

Otherwise pick the landing path:

1. Read the current branch (`git rev-parse --abbrev-ref HEAD`) and the default branch (`gh repo view --json defaultBranchRef -q .defaultBranchRef.name`).
2. Check the repo's `CLAUDE.md` / `AGENTS.md` for a branch, worktree, or pull-request policy.
3. Choose:
   - **Branch + PR** — the default. Required whenever the checkout is on the default branch or the repo mandates worktree/PR landing, and the right choice whenever the policy is unclear.
   - **Direct commit** — only when the checkout is already on a non-default working branch *and* no repo rule forbids committing there.

### Direct-commit path

1. Run `git status` and `git diff` to see all changes.
2. Run `git log --oneline -10` to understand the commit message style used in this repo.
3. Confirm you are NOT on the repository's default branch. If you are, stop and report that instead of committing.
4. Stage only documentation files changed by sync-docs (CLAUDE.md, AGENTS.md, SKILL.md, README.md, and any other .md files that were modified — never stage .env, secrets, or unrelated files).
5. If there is nothing staged after step 4 (nothing changed), skip the commit and report "no doc changes to commit".
6. Otherwise, draft a concise commit message focused on the "why" and create the commit: `git commit -m "$(cat <<'EOF'\n<message>\nEOF\n)"`.
7. Run `git status` to verify.

Do not push. Report the result (commit SHA or "no changes") to the user.

### Branch + PR path

1. Save the edits as a patch before touching anything: `git diff -- <doc files> > <scratchpad>/docs-sync.patch`. Verify the patch is non-empty.
2. Only once the patch exists, restore the original checkout: `git checkout -- <doc files>`.
3. `git fetch origin`, then create a worktree off the latest default branch with the branch prefix the repo requires (`cc/` on Claude Code) — e.g. `cc/sync-docs-<date>`.
4. Apply the patch in the worktree with `git apply`, confirm the resulting diff matches what sync-docs produced, and stage only doc files.
5. Commit with a message focused on the "why", ending in the repo's attribution footer.
6. Push the branch and open a PR against the default branch, following the repo's PR title and body conventions.

A release cut before that PR merges will not contain the doc changes, so ask the user once — via AskUserQuestion — how Step 3 should relate to it:

- **Merge the doc PR once its checks pass, then release from the updated default branch** (recommend this one).
- **Release now without the doc changes**, leaving the PR open.
- **Stop here** — no release.

Treat their answer as authorization for that action. Never merge without asking, and never merge past failing checks.

## Step 3 — Create a release

Skip this step entirely if the user chose "stop here".

If they chose merge-then-release, first wait for the PR's checks (`gh pr checks <n> --watch`), merge it, then update the local default branch (`git checkout <default> && git pull --ff-only`) and remove the worktree — the release must be cut from a checkout that actually contains the merged docs.

Then invoke the `create-release` skill via the Skill tool and follow it to completion here, carrying the user's original context (target version or bump type, release-notes specifics) and how the doc changes landed — the PR number and merge commit, or the fact that they are still unmerged.

Report the tag and the release URL to the user.
