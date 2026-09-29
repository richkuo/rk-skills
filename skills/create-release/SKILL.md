---
name: create-release
description: Use when the user asks to "create a release", "cut a release", "tag a version", "publish release notes", or ship a new versioned GitHub release for the current repo.
---

# create-release

Cut an annotated semver tag on a commit of the default branch on `origin` and publish a GitHub release with auto-generated notes. A release can trigger an irreversible publish (an npm version number cannot be reused), so the tag target is always a SHA that is on `origin/<default>`. The local branch never decides what ships, and nothing is pushed to the default branch directly: a version bump and a release-notes entry land through a pull request (PR).

## Preconditions: verify ALL before doing anything

```bash
gh auth status                                                     # must succeed
git status --porcelain -- . ':(exclude).claude/worktrees'          # must print nothing: stop if dirty, surface the diff
DEFAULT=$(gh repo view --json defaultBranchRef -q .defaultBranchRef.name)
git fetch origin --tags                                            # every later read uses origin/$DEFAULT
```

If any check fails: **stop and tell the user**. Do not proceed. The clean-tree check skips `.claude/worktrees/`, where this repo family keeps its worktrees: git lists each one as an untracked directory, and none of them feeds the release, which reads only `origin/$DEFAULT`.

**Tag-target invariant.** The commit you tag must pass `git merge-base --is-ancestor <sha> "origin/$DEFAULT"` right after a fresh `git fetch origin`. No confirmation, flag, or caller instruction overrides this. When it fails, stop and report the SHA and `origin/$DEFAULT`.

## Steps

1. **Inspect actual tags.** Never rely on memory or CHANGELOG:
   ```bash
   git tag --sort=-v:refname | head -10
   ```

2. **Review commits since the last tag:**
   ```bash
   git log <last-tag>..origin/$DEFAULT --oneline
   ```

3. **Determine the semver bump and state the rationale.** Breaking = major, new feature = minor, fixes and polish = patch. Proceed immediately. Pause to ask the user only if the bump type is genuinely ambiguous (for example, unclear whether commits are breaking). Then confirm the tag is free: `git ls-remote --tags origin refs/tags/vX.Y.Z` must print nothing.

4. **Land the version bump and the release-notes entry through a PR.**
   - **Resume an interrupted release first.** List earlier bump PRs: `gh pr list --state all --search 'in:title "chore(release): bump version to"' --json number,title,state,headRefOid,mergeCommit --limit 50`. Keep each PR whose title names a version V that is greater than the previous version and has no tag (`git ls-remote --tags origin refs/tags/vV` prints nothing); ignore a closed PR that never merged. None kept: continue with the version-fields bullet below. More than one kept: stop and report them. One kept: X.Y.Z is V, whatever step 3 decided, and step 3's tag-free check applies to V. If it is **open**, reuse it: edit nothing, open no second PR, and go to the Merge bullet. If it is **merged**, set `SHA` to its merge commit and go to the Resolve bullet, which checks the tag-target invariant and the manifests before step 5. In both cases, reuse its worktree when `.claude/worktrees/cc+release-vV` still exists, and remove it in the Resolve bullet.
   - **Version fields.** The previous version is the newest tag without its `v`. Update only manifest version fields whose current value equals that previous version: grep for the previous version string (for example `git grep -n -F "<previous>" origin/$DEFAULT -- <manifest files>`), then check each hit against the table. A library, CLI, or installer package counts: a `package.json` `"version"` **must** be bumped. Schema and config versions stay unchanged, for example `.github/dependabot.yml` `version: 2`. A manifest field that holds a different version than the previous one, with no bump PR kept by the resume bullet, is a stop: report it.

     | File | Field |
     |------|-------|
     | `package.json` | `"version"` |
     | `.claude-plugin/plugin.json` | `"version"` |
     | `app.json` / `app.config.js` / `app.config.ts` | `expo.version` |
     | `pubspec.yaml` | `version` |
     | `Cargo.toml` | `[package] version` |
     | `pyproject.toml` | `[project] version` or `[tool.poetry] version` |
     | iOS `*.xcodeproj/project.pbxproj` | `MARKETING_VERSION` |
     | Android `build.gradle` | `versionName` |

     Leave native build numbers (`buildNumber`, `versionCode`, `CURRENT_PROJECT_VERSION`) alone unless the user asks.
   - **Release-notes entry.** If the repo has a `MEMORY.md` or `CHANGELOG.md` with a Releases section, the same PR appends `**vX.Y.Z** — YYYY-MM-DD: <one-line summary>` to it.
   - **Publish-on-release check (every time).** Inspect `.github/workflows/` for a job that runs on `release: published` (for example `npm publish`). These jobs are usually guarded on the manifest version: if `package.json` still holds the previous version, the guard sees it as already published and **silently skips**. A mismatch between the tag and the manifest version is a bug.
   - **When neither a version field nor a notes file exists**, skip the PR: after `git fetch origin`, `SHA=$(git rev-parse "origin/$DEFAULT")`, and go to step 5.
   - **Otherwise open the PR from a worktree off `origin/$DEFAULT`.** The branch carries the harness prefix (`cc/` on Claude Code, `cursor/` on Cursor, `codex/` on Codex):
     ```bash
     git worktree add .claude/worktrees/cc+release-vX.Y.Z -b cc/release-vX.Y.Z "origin/$DEFAULT"
     ```
     Edit the version fields and the notes entry there, and run every git command with `-C <worktree>`. Stage the changed files by name. Commit `chore(release): bump version to X.Y.Z` with the repo's commit footer (its CLAUDE.md or AGENTS.md attribution rule), push the branch, and open the PR against `$DEFAULT` with `gh pr create --base "$DEFAULT"`, titled `chore(release): bump version to X.Y.Z` plus any title suffix the repo's PR convention requires. The body lists the bumped files and the bump rationale, and follows the repo's PR body rules.
   - **Merge.** Wait for checks with `gh pr checks <n> --watch`. A failing or pending check never merges: stop and leave the PR open. Ask the user once to merge (AskUserQuestion), unless the caller's approved plan already authorizes this bump PR and its merge (as the `milestone-workflow` close-out does). A decline leaves the PR open and stops with no tag. Merge with the repo's merge method and pin the head: `gh pr merge <n> --squash --match-head-commit <head-sha>`.
   - **Resolve the tag target.** `SHA=$(gh pr view <n> --json mergeCommit -q .mergeCommit.oid)`, then `git fetch origin`. Check the tag-target invariant on `$SHA`, and confirm that `git show "$SHA":<manifest>` holds `X.Y.Z` for every bumped manifest. Then remove the worktree when it exists (`git worktree remove <path>`).

5. **Create an annotated tag (not lightweight) on the resolved SHA.** Check the tag-target invariant on `$SHA` again first:
   ```bash
   git fetch origin
   git merge-base --is-ancestor "$SHA" "origin/$DEFAULT"
   git tag -a vX.Y.Z "$SHA" -m "vX.Y.Z"
   ```

6. **Push the tag:**
   ```bash
   git push origin vX.Y.Z
   ```

7. **Create the release with auto-generated notes:**
   ```bash
   gh release create vX.Y.Z --verify-tag --generate-notes --title "vX.Y.Z"
   ```
   Print the URL from `gh`'s output.

## Red Flags: STOP

| Situation | Action |
|-----------|--------|
| Tag target not on `origin/<default>` (`merge-base --is-ancestor` fails after a fresh fetch) | Stop. Report the SHA. No confirmation overrides this. |
| Tag already exists (locally or on `origin`) | Do NOT force-overwrite. Ask user. |
| `git status` dirty | Stop. Surface the diff. |
| Bump PR checks failing or pending | Stop. Leave the PR open. Never merge past a failing check. |
| Manifest version not equal to the previous tag's version, and no untagged bump PR to resume | Stop. Report the file and value. |
| More than one untagged bump PR | Stop. Report the PRs. |
| Branch protection or required review blocks the bump PR merge | Stop. Leave the PR open and report what it waits on. |
| Breaking changes + patch bump proposed | Require major bump. |

## Common Mistakes

- **Trusting memory for latest version**: always run `git tag` after the fetch; tags and notes diverge.
- **Hand-writing release notes**: always use `--generate-notes`; GitHub builds them from merged PRs.
- **Stalling for unnecessary confirmation**: the only question is the bump PR merge; with a clear bump type and passing checks, proceed.
- **Lightweight tag**: `git tag vX.Y.Z` without `-a` creates a lightweight tag; use `-a` always.
- **Letting `gh release create` implicitly create the tag**: create and push the tag explicitly first, then pass `--verify-tag`.
- **Pushing the bump to the default branch**: every bump and notes entry lands through the PR in step 4.
- **Tagging the PR head or a local commit**: a squash merge makes a new commit; tag the PR's merge commit SHA, never the head of the bump branch or `HEAD` of the checkout.
- **Bumping every `version:` a grep finds**: only manifest fields that hold the previous version change; config schema versions stay.
- **Skipping the bump for a library or installer**: any manifest `version` field must be bumped; a stale version silently skips a publish-on-release workflow.
