# Dependency base

Read this only when `baseRefs` is supplied. These checks supplement work-on-issue step 1 and run again before publication. Follow the repository's shared engineering, attribution, and Response Style rules.

## Validate every pin

Reject an empty list, duplicate PR numbers or refs, non-positive PR numbers, and malformed SHAs. A SHA must be a full object ID in the repository's object format. Validate refs before shell use with `^[A-Za-z0-9][A-Za-z0-9._/@+-]*$`, no `..`, no `refs/` prefix, and `git check-ref-format --branch`; reject the target and default branch names.

For each PR, inspect its state, base, head repository including owner, head ref, and head commit through GitHub. Require the intended repository, the recorded target as PR base, and exact `ref` and `sha` matches. Closed, unmerged PRs block. A merged PR is acceptable only if its pinned commit is already an ancestor of the fetched target; squash/rebase merges that lack this ancestry require the caller to refresh the dependency inputs.

Fetch `refs/pull/<pr>/head` into a unique local ref for this run and compare its resolved commit with the pin. This catches a head change between the API read and fetch. A missing, ambiguous, cross-repository, changed, or unresolvable pin blocks the run. Never omit an entry or fall back to the target branch. The caller supplies evidence that the heads were reviewed; do not infer review approval from commit existence.

## Integrate before implementation

Use the first verified SHA as the initial base. In the clean new worktree, merge each remaining SHA separately in caller order with `git merge --no-commit --no-ff <sha>`, committing each actual merge with a dependency-integration message and the required attribution. An already-contained SHA needs no merge commit. Sequential merges make the supplied order explicit and identify the conflicting predecessor.

On a conflict, record the conflicting paths and pin, abort the active merge, and stop without resolving conflicts, implementing, or opening a PR. Preserve any earlier integration commits and report them. A failed abort is a blocker; never reset or clean the worktree to hide it.

Verify `git merge-base --is-ancestor <sha> HEAD` for every pin, including the single-pin case. Record the resulting HEAD as the implementation base. On resume, require the same recorded pins and integration base, and verify their ancestry; do not repeat completed merges or reset implementation commits.

## Publish the dependency relationship

Recheck each PR's state, repository, target, ref, and head against the pins before opening or updating the dependent PR. A changed pin requires refreshed caller input and renewed integration/verification; do not silently adopt it. Keep the dependent PR base as the recorded target and list predecessor PRs and verified heads in caller order. State which predecessors must merge first. Check the PR diff against its target as well as the implementation diff against the recorded integration base, so prerequisite changes cannot hide unrelated work.

---
Created with LLM: GPT-6 | high | Harness: Claude Code
