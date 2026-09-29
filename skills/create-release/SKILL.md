---
name: create-release
description: Use when the user asks to "create a release", "cut a release", "tag a version", "publish release notes", or ship a new versioned GitHub release for the current repo.
---

# create-release

Cut an annotated semver tag on a commit of the default branch on `origin` and publish a GitHub release with auto-generated notes. A release can trigger an irreversible publish, so the tag target is always a SHA on `origin/<default>`, and the local branch never decides what ships. Nothing is pushed to the default branch directly: a version bump and a release-notes entry land through a pull request (PR).

## Preconditions: verify ALL before doing anything

```bash
gh auth status # must succeed
git status --porcelain -- . ':(exclude).claude/worktrees' # must print nothing: stop if dirty, surface the diff
DEFAULT=$(gh repo view --json defaultBranchRef -q .defaultBranchRef.name)
git fetch origin --tags # every later read uses origin/$DEFAULT
```

If any check fails, **stop and tell the user**. The clean-tree check skips `.claude/worktrees/`, since the release reads only `origin/$DEFAULT`.

**Tag-target invariant.** The commit you tag must pass `git merge-base --is-ancestor <sha> "origin/$DEFAULT"` right after a fresh `git fetch origin`. No confirmation, flag, or caller instruction overrides this. When it fails, stop and report the SHA and `origin/$DEFAULT`.

## Steps

1. **Inspect actual tags.** Never rely on memory or CHANGELOG: `git tag --sort=-v:refname | head -10`.

2. **Review commits since the last tag:** `git log <last-tag>..origin/$DEFAULT --oneline`. With no semver tag yet (a first release), read `git log origin/$DEFAULT --oneline`.

3. **Determine the semver bump and state the rationale.** Breaking = major (never patch), new feature = minor, fixes and polish = patch. Proceed immediately; ask the user only if the bump type is genuinely ambiguous (for example, unclear whether commits are breaking). Then confirm the tag is free: `git ls-remote --tags origin refs/tags/vX.Y.Z` must print nothing.

   **Previous version.** The newest semver tag without its `v`. With no semver tag, it is the value every table manifest below agrees on; when they disagree, or none exists, ask the user (AskUserQuestion) for the first version and treat each manifest version field's value as its previous value. A first release takes X.Y.Z from the user's version, else from that agreed value, so it can release the version the manifests already hold with no bump.

4. **Land the version bump and the release-notes entry through a PR.**
   - **Resume an interrupted release first.** List earlier bump PRs: `gh pr list --state all --search 'in:title "chore(release): bump version to"' --json number,title,state,isCrossRepository,headRefName,baseRefName,headRefOid,mergeCommit,files --limit 50`. A PR is a **candidate** only when all hold: its title names a version V greater than the previous version (or, with no semver tag, a merged PR whose V equals the value the manifests agree on: an interrupted first release), and `git ls-remote --tags origin refs/tags/vV` prints nothing; it is open or merged, never closed unmerged; `isCrossRepository` is false; `headRefName` is `<harness-prefix>/release-vV` (`cc/`, `cursor/`, or `codex/`), optionally with a `-<n>` suffix; `baseRefName` is `$DEFAULT`; and every path in `files` is a table manifest or the notes file, with `gh pr diff <n>` changing only those version fields, each from its pre-PR value to V, and adding at most one notes entry. A title-matching PR that fails any check is never resumed or merged: report it and continue with the version-fields bullet. No candidate: continue with that bullet. More than one: stop and report them. One candidate: when V differs from the version the user asked for or step 3 chose, ask the user (AskUserQuestion) and never override their version on your own. Then X.Y.Z is V, and step 3's tag-free check applies to V. If it is **open**, reuse it: edit nothing, open no second PR, record its `headRefOid` as the head the checks read, and go to the Merge bullet, where a resumed PR always gets the merge question (no caller plan authorization covers a PR this run did not open). If it is **merged**, go to the Resolve bullet, which checks the tag-target invariant and the manifests before step 5. Either way, reuse the worktree named for its `headRefName` when it still exists; the Resolve bullet removes it.
   - **Version fields.** Update only manifest version fields whose current value equals the previous version (step 3): grep for it (for example `git grep -n -F "<previous>" origin/$DEFAULT -- <manifest files>`), then check each hit against the table. A library, CLI, or installer package counts: a `package.json` `"version"` **must** be bumped, since a stale version silently skips a publish-on-release workflow. Schema and config versions stay unchanged, for example `.github/dependabot.yml` `version: 2`. When the repo has a semver tag, a manifest field holding a different version than the previous one, with no bump PR kept by the resume bullet, is a stop: report the file and value.

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

     Leave native build numbers (`buildNumber`, `versionCode`, `CURRENT_PROJECT_VERSION`) alone unless the user asks.
   - **Release-notes entry.** If the repo has a `MEMORY.md` or `CHANGELOG.md` with a Releases section, the same PR appends `**vX.Y.Z** — YYYY-MM-DD: <one-line summary>` to it, unless that file on `origin/$DEFAULT` already holds a `**vX.Y.Z**` entry.
   - **Publish-on-release check (every time).** Inspect `.github/workflows/` for a job that runs on `release: published` (for example `npm publish`). Such jobs usually guard on the manifest version, so a `package.json` still at the previous version makes them **silently skip**. A mismatch between the tag and the manifest version is a bug.
   - **When no version field needs a change and no notes entry is due** (no manifest, or a first release whose manifests already hold X.Y.Z; and no notes file, or one that already holds `**vX.Y.Z**`), skip the PR: after `git fetch origin`, `SHA=$(git rev-parse "origin/$DEFAULT")`, and go to step 5.
   - **Otherwise open the PR from a worktree off `origin/$DEFAULT`.** The branch carries the harness prefix (`cc/` on Claude Code, `cursor/` on Cursor, `codex/` on Codex):
     ```bash
     git worktree add .claude/worktrees/cc+release-vX.Y.Z -b cc/release-vX.Y.Z "origin/$DEFAULT"
     ```
     When that branch already exists locally or on `origin` (an earlier bump PR for this version was closed unmerged), never delete or reuse it: add the next free suffix to the branch and the worktree name (`cc/release-vX.Y.Z-2`, then `-3`).
     Edit the version fields and the notes entry there, and run every git command with `-C <worktree>`. Stage the changed files by name. Commit `chore(release): bump version to X.Y.Z` with the repo's commit footer (its CLAUDE.md or AGENTS.md attribution rule), push the branch, and open the PR with `gh pr create --base "$DEFAULT"`, titled `chore(release): bump version to X.Y.Z` plus any title suffix the repo's PR convention requires. The body lists the bumped files and the bump rationale, and follows the repo's PR body rules.
   - **Merge.** Wait for checks with `gh pr checks <n> --watch`. A failing or pending check never merges: stop and leave the PR open. When `gh pr checks` still reports no checks about a minute after the PR opened (no workflow runs on `pull_request`, or path filters skip the bump files), read the required checks on `$DEFAULT`: `gh api repos/{owner}/{repo}/branches/$DEFAULT --jq .protection.required_status_checks.contexts` and any `required_status_checks` rule in `gh api repos/{owner}/{repo}/rules/branches/$DEFAULT`. With none required, there is no failing check: go on to the merge question. A required check that has not reported is pending. Ask the user once to merge (AskUserQuestion), unless the caller's approved plan already authorizes this bump PR and its merge (as the `milestone-workflow` close-out does). A decline leaves the PR open and stops with no tag. Merge with a method the repo allows and pin the head: read `gh repo view --json squashMergeAllowed,mergeCommitAllowed,rebaseMergeAllowed`, take `--squash`, else `--merge`, else `--rebase`, and run `gh pr merge <n> <method> --match-head-commit <head-sha>`, where a resumed PR's `<head-sha>` is the `headRefOid` its checks read.
   - **Resolve the tag target.** Read `gh pr view <n> --json state,mergeCommit`. When `state` is not `MERGED` (a merge queue holds the PR, or `gh pr merge` only enabled auto-merge), stop, report that the PR is queued or waiting with its state, and tag nothing; a rerun resumes it through the resume bullet once it merges. Otherwise `SHA` is `mergeCommit.oid`, which must be a non-empty commit SHA (an empty value is a stop that names the PR state); never tag the bump branch head or the checkout's `HEAD`, since every merge method puts a new commit on the default branch. Then `git fetch origin`, check the tag-target invariant on `$SHA`, and confirm that `git show "$SHA":<manifest>` holds `X.Y.Z` for every bumped manifest. Then remove the worktree when it exists (`git worktree remove <path>`).

5. **Create an annotated tag (not lightweight) on the resolved SHA.** Check the tag-target invariant on `$SHA` again first:
   ```bash
   git fetch origin
   git merge-base --is-ancestor "$SHA" "origin/$DEFAULT"
   git tag -a vX.Y.Z "$SHA" -m "vX.Y.Z"
   ```

6. **Push the tag:** `git push origin vX.Y.Z`.

7. **Create the release with auto-generated notes:** `gh release create vX.Y.Z --verify-tag --generate-notes --title "vX.Y.Z"`. Print the URL from `gh`'s output. Never hand-write the notes, and never let `gh release create` create the tag: steps 5 and 6 create and push it first.

## Red Flags: STOP

| Situation | Action |
|---|---|
| Tag already exists (locally or on `origin`) | Do NOT force-overwrite. Ask user. |
| Branch protection or required review blocks the bump PR merge | Stop. Leave the PR open and report what it waits on. |

## Common Mistakes

- **Stalling for unnecessary confirmation**: the only question is the bump PR merge; with a clear bump type and passing checks, proceed.
