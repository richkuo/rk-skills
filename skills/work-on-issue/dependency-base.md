# Dependency base

Read only when `baseRefs` is supplied. These checks extend work-on-issue step 1 and run again before publication.

## Validate every pin

Reject an empty list, duplicate PR numbers or refs, non-positive PR numbers, and SHAs that are not full object IDs. Each ref must pass the step 1 target rules (regex, no `..`, no `refs/` prefix, `git check-ref-format --branch`) and must not name the target or default branch.

For each PR, read its state, base, head repository and owner, head ref, and head commit through GitHub. Require the intended repository, the recorded target as PR base, and exact `ref` and `sha` matches. A closed unmerged PR blocks. A merged PR passes only if its pinned commit is already an ancestor of the fetched target; otherwise the caller must refresh the inputs.

Fetch `refs/pull/<pr>/head` into a unique local ref and compare it with the pin, which catches a head change since the API read. A missing, ambiguous, cross-repository, changed, or unresolvable pin blocks the run. Never drop an entry or fall back to the target branch. The caller vouches that the heads were reviewed; commit existence proves nothing.

## Integrate before implementation

The first verified SHA is the initial base. In the clean worktree, merge each remaining SHA separately in caller order with `git merge --no-commit --no-ff <sha>`, committing each real merge with a dependency-integration message and the attribution footer; an already-contained SHA needs no merge. Sequential merges expose which predecessor conflicts.

On a conflict, record the conflicting paths and pin, abort the merge, and stop: no resolution, no implementation, no PR. Keep earlier integration commits and report them. A failed abort blocks; never reset or clean the worktree to hide it.

Verify `git merge-base --is-ancestor <sha> HEAD` for every pin, including a single pin, and record the resulting HEAD as the implementation base. On resume, require the same pins and base and re-verify their ancestry; never repeat completed merges or reset implementation commits.

## Publish the dependency relationship

Recheck each PR's state, repository, target, ref, and head against the pins before opening or updating the dependent PR. A changed pin needs refreshed caller input and renewed integration and verification. Keep the PR base as the recorded target, list predecessor PRs and verified heads in caller order, and state which must merge first. Check the PR diff against the target and the implementation diff against the integration base, so prerequisite changes cannot hide unrelated work.
