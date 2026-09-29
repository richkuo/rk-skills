---
name: create-release
description: Use when the user asks to "create a release", "cut a release", "tag a version", "publish release notes", or ship a new versioned GitHub release for the current repo.
---

# create-release

Tag a SHA on `origin/<default>` (annotated semver) and publish a GitHub release with generated notes. A release can publish irreversibly, so the local branch never decides what ships. Never push to the default branch: the version bump and notes entry land through a pull request (PR).

## Preconditions: verify ALL before doing anything

```bash
gh auth status # must succeed
git status --porcelain -- . ':(exclude).claude/worktrees' # must print nothing: stop if dirty, surface the diff
DEFAULT=$(gh repo view --json defaultBranchRef -q .defaultBranchRef.name)
git fetch origin --tags # every later read uses origin/$DEFAULT
```

Any failure: **stop and tell the user**.

**Tag-target invariant.** The tagged commit must pass `git merge-base --is-ancestor <sha> "origin/$DEFAULT"` right after a fresh `git fetch origin`. No confirmation, flag, or caller instruction overrides this. On failure, stop and report the SHA and `origin/$DEFAULT`.

## Steps

1. **Inspect actual tags.** Never trust memory or CHANGELOG: `git tag --sort=-v:refname | head -10`.

2. **Review commits since the last tag:** `git log <last-tag>..origin/$DEFAULT --oneline`; with no semver tag (first release), `git log origin/$DEFAULT --oneline`.

3. **Determine the semver bump and state the rationale.** Breaking = major (never patch), feature = minor, fixes and polish = patch. Proceed without confirmation: the only question is the bump PR merge. Ask about the bump only when its type is genuinely ambiguous (for example, unclear whether commits are breaking). Then `git ls-remote --tags origin refs/tags/vX.Y.Z` must print nothing. Never force-overwrite a tag that exists locally or on `origin`: ask the user.

   **Previous version.** The newest semver tag without its `v`. With no semver tag, the value all table manifests below agree on; if they disagree or none exists, ask the user (AskUserQuestion) for the first version and treat each manifest version field's value as its previous value. A first release takes X.Y.Z from the user's version, else from that agreed value, so it can release the version the manifests already hold with no bump.

4. **Land the version bump and the release-notes entry through a PR.**
   - **Resume an interrupted release first.** List bump PRs: `gh pr list --state all --search 'in:title "chore(release): bump version to"' --json number,title,state,isCrossRepository,headRefName,baseRefName,headRefOid,mergeCommit,files --limit 50`. A **candidate** meets all of: its title names a version V above the previous version (or, with no semver tag, it is merged and V equals the manifests' agreed value: an interrupted first release), and `git ls-remote --tags origin refs/tags/vV` prints nothing; open or merged, never closed unmerged; `isCrossRepository` false; `headRefName` is `<harness-prefix>/release-vV` (`cc/`, `cursor/`, or `codex/`), optionally suffixed `-<n>`; `baseRefName` is `$DEFAULT`; every path in `files` is a table manifest or the notes file, and `gh pr diff <n>` only moves those version fields from their pre-PR values to V and adds at most one notes entry. A title match that fails any check is never resumed or merged: report it and continue with the version-fields bullet. No candidate: continue with that bullet. More than one: stop and report them. One: if V differs from the version the user asked for or step 3 chose, ask the user (AskUserQuestion); never override their version yourself. X.Y.Z is then V, and step 3's tag-free check applies to V. **Open**: reuse it (edit nothing, open no second PR), record its `headRefOid` as the head the checks read, and go to the Merge bullet, which always asks about a resumed PR: no caller plan authorization covers a PR this run did not open. **Merged**: go to the Resolve bullet, which checks the invariant and manifests before step 5. Either way, reuse the worktree named for its `headRefName` if it still exists; the Resolve bullet removes it.
   - **Version fields.** Change only manifest version fields whose value equals the previous version: grep it (for example `git grep -n -F "<previous>" origin/$DEFAULT -- <manifest files>`) and check each hit against the table. Libraries, CLIs, and installers count: a `package.json` `"version"` **must** be bumped. Schema and config versions stay (for example `.github/dependabot.yml` `version: 2`), and so do native build numbers (`buildNumber`, `versionCode`, `CURRENT_PROJECT_VERSION`) unless the user asks. With a semver tag, a manifest field holding another version, with no bump PR kept by the resume bullet, is a stop: report the file and value.

     | File | Field |
     |---|---|
     | `package.json` | `"version"` |
     | `.claude-plugin/plugin.json` | `"version"` |
     | `app.json` / `app.config.js` / `app.config.ts` | `expo.version` |
     | `pubspec.yaml` | `version` |
     | `Cargo.toml` | `[package] version` |
     | `pyproject.toml` | `[project] version` or `[tool.poetry] version` |
     | iOS `*.xcodeproj/project.pbxproj` | `MARKETING_VERSION` |
     | Android `build.gradle` | `versionName` |
   - **Release-notes entry.** If the repo has a `MEMORY.md` or `CHANGELOG.md` with a Releases section, the same PR appends `**vX.Y.Z** — YYYY-MM-DD: <one-line summary>`, unless that file on `origin/$DEFAULT` already holds a `**vX.Y.Z**` entry.
   - **Publish-on-release check (every time).** Find `.github/workflows/` jobs on `release: published` (for example `npm publish`): they usually guard on the manifest version and **silently skip** while `package.json` holds the previous version, so a tag and manifest mismatch is a bug.
   - **No version field needs a change and no notes entry is due** (no manifest, or a first release whose manifests already hold X.Y.Z; and no notes file, or one already holding `**vX.Y.Z**`): skip the PR, `git fetch origin`, set `SHA=$(git rev-parse "origin/$DEFAULT")`, and go to step 5.
   - **Otherwise open the PR from a worktree off `origin/$DEFAULT`**, on a branch with the harness prefix (`cc/` Claude Code, `cursor/` Cursor, `codex/` Codex): `git worktree add .claude/worktrees/cc+release-vX.Y.Z -b cc/release-vX.Y.Z "origin/$DEFAULT"`. If that branch exists locally or on `origin` (an earlier bump PR for this version closed unmerged), never delete or reuse it: add the next free suffix to branch and worktree name (`cc/release-vX.Y.Z-2`, then `-3`). Edit there, run every git command with `-C <worktree>`, and stage changed files by name. Commit `chore(release): bump version to X.Y.Z` with the repo's commit footer (its CLAUDE.md or AGENTS.md attribution rule), push, and run `gh pr create --base "$DEFAULT"`, titled `chore(release): bump version to X.Y.Z` plus any suffix the repo's PR convention requires. The body lists the bumped files and bump rationale and follows the repo's PR body rules.
   - **Merge.** Wait with `gh pr checks <n> --watch`. A failing or pending check never merges: stop and leave the PR open. When `gh pr checks` still reports no checks about a minute after the PR opened (no `pull_request` workflow, or path filters skip the bump files), read the required checks on `$DEFAULT`: `gh api repos/{owner}/{repo}/branches/$DEFAULT --jq .protection.required_status_checks.contexts` and any `required_status_checks` rule in `gh api repos/{owner}/{repo}/rules/branches/$DEFAULT`. With none required, there is no failing check: go on to the merge question. A required check that has not reported is pending. Ask the user once to merge (AskUserQuestion), unless the caller's approved plan already authorizes this bump PR and its merge (as the `milestone-workflow` close-out does). A decline leaves the PR open and stops with no tag. Merge with a method the repo allows and pin the head: read `gh repo view --json squashMergeAllowed,mergeCommitAllowed,rebaseMergeAllowed`, take `--squash`, else `--merge`, else `--rebase`, and run `gh pr merge <n> <method> --match-head-commit <head-sha>`; a resumed PR's `<head-sha>` is the `headRefOid` its checks read. If branch protection or a required review blocks the merge, stop, leave the PR open, and report what it waits on.
   - **Resolve the tag target.** Read `gh pr view <n> --json state,mergeCommit`. If `state` is not `MERGED` (a merge queue holds it, or `gh pr merge` only enabled auto-merge), stop, report it queued or waiting with its state, and tag nothing; a rerun resumes it through the resume bullet once merged. Else `SHA` is `mergeCommit.oid`, which must be a non-empty commit SHA (empty is a stop naming the PR state); never tag the bump branch head or the checkout's `HEAD`. Then `git fetch origin`, check the invariant on `$SHA`, confirm `git show "$SHA":<manifest>` holds `X.Y.Z` for every bumped manifest, and remove the worktree if it exists (`git worktree remove <path>`).

5. **Create an annotated tag (not lightweight) on the resolved SHA.** Recheck the invariant first:
   ```bash
   git fetch origin
   git merge-base --is-ancestor "$SHA" "origin/$DEFAULT"
   git tag -a vX.Y.Z "$SHA" -m "vX.Y.Z"
   ```

6. **Push the tag:** `git push origin vX.Y.Z`.

7. **Create the release with auto-generated notes:** `gh release create vX.Y.Z --verify-tag --generate-notes --title "vX.Y.Z"`, and print the URL from its output. Never hand-write notes, and never let `gh release create` create the tag.
