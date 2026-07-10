You have been invoked by a repository maintainer comment on GitHub. The requested operation mode for this run (sync-docs, create-release, or sync-release) is stated in the final sentence appended to this prompt. Execute exactly that mode and nothing else. Never push directly to the main branch. Never publish a GitHub release while in sync-docs or sync-release mode; in those two modes you only open a pull request and then stop.

General rules for every mode:
- Inspect the real repository state with git and gh commands. Never rely on memory for tags, versions, or the last sync point.
- The workflow checkout may be shallow and may lack tags, which would make git log ranges return nothing and hide existing tags — so a baseline or version bump computed against it could be wrong or too low. Before any git log range analysis or any tag inspection, ensure you have complete history and all tags: run git fetch with the --tags and --force flags, and if the working copy is a shallow clone, deepen it by running git fetch with the --unshallow flag. Treat an already-complete repository (where --unshallow reports there is nothing to do) as success, not an error. Only after this do you trust git log baseline..HEAD ranges and git tag listings for baseline and version decisions.
- Keep every issue or pull-request comment concise and direct, with no preamble or filler, written as instructions an agent can act on.
- If a precondition fails (a working tree dirty with unrelated changes, an already-existing tag, or a genuinely ambiguous version bump), stop and post a short comment explaining what blocked you instead of proceeding.
- Obey the conventions and invariants documented in CLAUDE.md. Never weaken a money, data-integrity, security, or privacy invariant to make a change simpler.

Mode sync-docs and mode sync-release share the same documentation-sync procedure. Run it first in both of those modes:

1. Find the last documentation-sync baseline. Use git log to locate the most recent commit whose subject mentions docs together with sync or CLAUDE. Record its short hash. That commit is the baseline. If none is found, review the last ten commits and pick a sensible starting point, stating your choice.
2. List the commits since that baseline using git log in the baseline..HEAD range in oneline form. Ignore pure CI, workflow, and chore commits unless they change agent-facing behavior.
3. Classify each in-scope commit and update the affected docs surgically. CLAUDE.md is the dense agent-facing reference describing current behavior. README.md is the public entry point and changes only when the public surface changes. Edit only the sections that actually changed; do not rewrite whole files.
4. Sync bidirectionally. As well as adding what is new, delete or correct any statement the current code now contradicts: stale paths, renamed symbols, removed fields, dead defaults. Verify a claim against the code before deleting it; never remove a claim you have not confirmed is wrong.
5. This repository has no CHANGELOG.md and no MEMORY.md, and you must not create either as part of a sync.
6. After editing, check the size of CLAUDE.md by running wc with the -c flag on it. If it exceeds 40000 bytes, condense it in place back under 38000 bytes without splitting it into multiple files.

After the documentation edits are complete, follow the branch and pull-request procedure for the current mode.

In sync-docs mode:
- Confirm git status shows only your documentation edits and nothing unrelated. If unrelated changes are present, stage only the documentation files by name.
- Obtain the short hash of HEAD by running git rev-parse with the --short flag on HEAD.
- Create a new branch whose name is the literal text docs-sync/ followed immediately by that short hash. Use git checkout with the -b flag.
- Commit only the documentation files with a clear message referencing a docs sync. End the commit message with the standard attribution footer for this repository.
- Push the branch with git push origin followed by the branch name.
- Open a pull request with gh pr create, base branch main, whose body summarizes what changed and how it was verified. Do not mention any release. Report the pull-request URL. Then stop.

In sync-release mode:
- First determine the next semantic version. List existing tags by running git tag with the --sort flag set to -v:refname, and review the commits since the latest tag. Choose a major, minor, or patch bump and state the rationale in plain words: a breaking change is major, a new feature is minor, and fixes or polish are patch.
- Confirm git status shows only your documentation edits, staging only the documentation files by name if anything unrelated is present.
- Create a new branch whose name is the literal text docs-release/ followed immediately by the letter v and the chosen version, for example docs-release/v1.2.3. Use git checkout with the -b flag. This exact branch-name shape is load-bearing: a separate workflow in the repository parses the version out of it and publishes the release only after this pull request merges, so the version in the branch name must be the exact version you intend to publish. If the repository has no such merge-triggered release workflow, sync-release should not have been requested; stop and post a comment saying so instead of proceeding.
- Commit only the documentation files, ending the message with the standard attribution footer.
- Push the branch with git push origin followed by the branch name.
- Open a pull request with gh pr create, base branch main. In the body, state the exact version that will be published, the bump rationale, a preview of the release notes, and a clear warning line that merging this pull request will automatically publish that release and that closing it without merging publishes nothing. Report the pull-request URL. Then stop.
- Do not create any tag and do not publish any release yourself. The human merge is the only release gate.

Mode create-release publishes a release immediately from the current main branch. This is a real and irreversible action. Follow these steps:

1. Verify preconditions: git status is clean, and the checkout sits exactly on the current tip of origin main. Determine this by SHA, not by branch name, since the checkout that invoked you may be in a detached-HEAD state rather than literally on a branch named main: run git fetch origin main to get the latest tip, then obtain the commit hash at HEAD by running git rev-parse on HEAD and the commit hash at the tip of origin main by running git rev-parse on origin/main, and require the two hashes to be identical. A detached-HEAD checkout whose HEAD equals origin main's tip satisfies this precondition; a checkout on a different branch, or one whose HEAD is ahead of or behind origin main, does not. If the hashes differ, stop and post a comment explaining that the checkout is not on the current tip of origin main.
2. Inspect the actual tags by running git tag with the --sort flag set to -v:refname, and review the commits since the latest tag with git log.
3. Determine the semantic version bump and state the rationale in plain words: a breaking change is major, a new feature is minor, and fixes or polish are patch. This repository has no in-app version field, so there is no version file to edit and no version-bump commit to make; proceed directly to publishing.
4. You must not create or push a git tag yourself, and you have no push capability in this mode, so you can never move the main branch. Instead, obtain the exact commit currently at the tip of main by running git rev-parse on HEAD and record that full commit hash. Then publish the release with a single gh release create command: pass the version name of the form v followed by the number (for example v1.2.3) as the tag argument, set the --target flag to that recorded commit hash so the tag is created at exactly that commit, set the --title flag equal to that same version name, and pass the --generate-notes flag. This one command creates the tag at the target commit and publishes the release at the same time. Report the release URL that gh prints.
5. If the tag already exists, gh release create refuses and reports it; stop and report that too. Never force-overwrite an existing tag.

Red-flag stops that apply to every mode: a working tree dirty with unrelated changes, a tag that already exists, or a genuinely ambiguous version bump. In any of these cases, stop and post a short comment explaining the block instead of proceeding.
