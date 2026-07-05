---
name: create-release-runner
description: Runs the create-release workflow. Use whenever the user asks to create a release, cut a release, tag a version, publish release notes, or ship a new versioned GitHub release for the current repo.
---

# create-release

Cut an annotated semver tag and publish a GitHub release with auto-generated notes.

## Preconditions — verify ALL before doing anything

```bash
git status              # must be clean — stop if dirty, surface the diff
git branch --show-current   # must be on default branch (main/master)
git fetch origin && git status  # must be up to date with origin
gh auth status          # must succeed
```

If any check fails: **stop and tell the user**. Do not proceed.

## Steps

1. **Inspect actual tags** — never rely on memory or CHANGELOG:
   ```bash
   git tag --sort=-v:refname | head -10
   ```

2. **Review commits since last tag:**
   ```bash
   git log <last-tag>..HEAD --oneline
   ```

3. **Determine semver bump and state rationale** — breaking = major, new feature = minor, fixes/polish = patch. Proceed immediately. Only pause to ask the user if the bump type is genuinely ambiguous (e.g. unclear whether commits are breaking).

4. **Bump the repo's declared version — MANDATORY whenever a version field exists.** This is the package/manifest version, not just a "user-facing app" version: a library, CLI, or installer package (e.g. one with a `package.json` `"version"`) counts and **must** be bumped. Do not skip this because the repo "isn't an app." Grep the repo for version fields and update every match to `X.Y.Z` so the tag points at a commit carrying the correct version. Common locations (check all, update every match):

   | File | Field |
   |------|-------|
   | `package.json` | `"version"` |
   | `app.json` / `app.config.js` / `app.config.ts` | `expo.version` |
   | `pubspec.yaml` | `version` |
   | `Cargo.toml` | `[package] version` |
   | `pyproject.toml` | `[project] version` or `[tool.poetry] version` |
   | iOS `*.xcodeproj/project.pbxproj` | `MARKETING_VERSION` |
   | Android `build.gradle` | `versionName` |

   - Leave native build numbers (`buildNumber`, `versionCode`, `CURRENT_PROJECT_VERSION`) alone unless the user asks.
   - If — and only if — no version field exists anywhere, skip silently and proceed to step 5.
   - **Publish-on-release check (do this every time):** inspect `.github/workflows/` for a job that runs on `release: published` (e.g. `npm publish`). These jobs are almost always idempotency-guarded on the manifest version — if `package.json` still holds the previous version, the guard sees it already published and **silently skips**, so the release ships to GitHub but never reaches the registry. If such a workflow exists, bumping the manifest version in this step is what makes the publish actually fire; a mismatch between the tag and the manifest version is a bug.
   - If a version field exists, edit it, then commit and push **before tagging**:
     ```bash
     git commit -am "chore(release): bump version to X.Y.Z"
     git push origin <default-branch>
     ```
   - The tag must point at this bump commit — create the tag only after the commit and push succeed.

5. **Create annotated tag** (not lightweight):
   ```bash
   git tag -a vX.Y.Z -m "vX.Y.Z"
   ```

6. **Push tag:**
   ```bash
   git push origin vX.Y.Z
   ```

7. **Create release with auto-generated notes:**
   ```bash
   gh release create vX.Y.Z --generate-notes --title "vX.Y.Z"
   ```
   Print the URL from `gh`'s output.

8. **Project-local hook:** if the repo has a `MEMORY.md` or `CHANGELOG.md` with a Releases section, append:
   `**vX.Y.Z** — YYYY-MM-DD: <one-line summary>`
   Skip silently if neither exists.

## Red Flags — STOP

| Situation | Action |
|-----------|--------|
| Tag already exists | Do NOT force-overwrite. Ask user. |
| `git status` dirty | Stop. Surface the diff. |
| Not on default branch | Stop. Ask user to confirm intent. |
| Breaking changes + patch bump proposed | Require major bump. |
| Manifest version (`package.json` etc.) still at previous version | Bump it (step 4) before tagging — a stale version silently no-ops any publish-on-release workflow. |

## Common Mistakes

- **Trusting memory for latest version** — always run `git tag`, tags and notes diverge.
- **Hand-writing release notes** — always use `--generate-notes`; GitHub builds them from merged PRs automatically.
- **Stalling for unnecessary confirmation** — if preconditions pass and bump type is clear, tag and release immediately.
- **Lightweight tag** — `git tag vX.Y.Z` without `-a` creates a lightweight tag; use `-a` always.
- **Letting `gh release create` implicitly create the tag** — create and push the tag explicitly first so it's traceable.
- **Tagging before the version bump commit** — if the repo has a declared version, bump and commit it first, then tag that commit. A tag pointing at a commit with the old version is wrong.
- **Treating a library/installer's `package.json` version as "not an app version" and skipping the bump** — any manifest `version` field must be bumped (step 4). Skipping it strands the release on GitHub and silently skips the npm publish, because the publish workflow keys off `package.json`'s version.
