---
name: work-on-issue
description: Implement a GitHub issue in an isolated worktree, verify the change, and open a pull request. Use for "work on issue", "implement issue", or /work-on-issue, including handoffs from validation or planning. Stops at the open pull request; use work-on-issue-loop for review convergence.
---

# work-on-issue

Take the selected issue to a verified, open pull request (PR). Follow the repository's AGENTS.md/CLAUDE.md for engineering, test edits, attribution, and Response Style. Continue through authorized implementation and publication; ask only when an unresolved requirement or permission prevents safe progress. Review triggers, review cycles, merge, deployment, and follow-on issue creation belong to the caller.

## Input

Accept an issue number, URL, `owner/repo#N`, or `{ issue, targetBranch?, baseRefs?: [{ pr, ref, sha }, ...] }`. With no identifier, use the unambiguous issue from this session; otherwise ask which issue. Never select an unrelated issue from a list. `targetBranch` also accepts prose such as "target branch develop". `baseRefs` pins reviewed predecessor heads in caller order.

## Steps

### 0. Resolve the issue, gate-check it, and detect a plan

Resolve the repository and issue together. Confirm the clone and fetch/push remotes match the intended repository; use a matching clone for another repository. Scope GitHub commands to that repository. Read the full issue, all comments including pagination, and applicable repository instructions before mutations.

The issue must be open. Check linked PRs and search open PR titles/bodies for the issue reference; inspect candidates for actual fixes. A failed lookup blocks. If another PR already fixes the issue, stop with its URL. This run's own PR is resumable after step 1 verifies its repository, head, base, and worktree.

Detect a plan from a comment starting with `## Implementation plan` (optional model tag), or a plan identified by a maintainer or caller. Unless the user explicitly selects one, adopt the newest applicable posted plan; use a caller-supplied plan when none is posted. Earlier plans are superseded, never merged. Record author, URL or local source, date, and model evidence. The `fableplan` flag requires a Fable 5.1 plan that actually drove implementation. No plan is normal.

Honor an explicit build model/harness assignment. A driver dispatching a stamped Codex or Cursor build must load `cli-dispatch`; an already-dispatched builder continues here without dispatching itself again. Report unavailable or substituted models through that contract.

### 1. Create the isolated worktree on a verified base

**Target.** Resolve `targetBranch`, else the repository default branch, once. Before shell use, require `^[A-Za-z0-9][A-Za-z0-9._/@+-]*$`, no `..`, no `refs/` prefix, and `git check-ref-format --branch` success. `git ls-remote --heads origin "refs/heads/<target>"` must return exactly that ref. Fetch it into `origin/<target>` and record its commit. A missing or invalid target blocks; never substitute another branch. Keep this target through publication, even if the default later changes.

**Base.** Without `baseRefs`, use the fetched target commit. With `baseRefs`, read [dependency-base.md](dependency-base.md) and validate the entire list before creating or changing a worktree.

**Create or resume.** Inspect `git worktree list --porcelain`, branch history, status, and any existing PR. Reuse only work attributable to this run with the same issue, target, and dependency pins. A matching name alone proves nothing. Preserve existing changes; ambiguous ownership, changed pins, unrelated work, or an unfinished Git operation blocks automatic reuse. On resume, verify the recorded base is an ancestor of HEAD; implementation commits need not equal the base.

For a fresh run, use `git worktree add <path> -b <prefix>/issue-<N>-<slug> <resolved-base>` with `cc/`, `cursor/`, or `codex/` for the active harness. Derive a short alphanumeric/hyphen slug; pass paths and refs as quoted data. Use the repository's worktree location, else `.claude/worktrees/`. Confirm the new HEAD equals the resolved base. Do not reset an existing checkout or implement on the target branch or in the main checkout. Use an explicit working directory for every tool call, and `git -C <path>` for Git commands.

Keep a run record outside tracked files: repository, issue, target, base commit, ordered dependency pins, plan source, worktree, branch, verification, and published commit/PR. Update it after durable steps so retries can inspect completed work before repeating mutations.

### 2. Understand the issue and the code

Trace affected paths and map all acceptance criteria, including negative requirements, to observable checks. Resolve implementation details from code and validation evidence while preserving the requested outcome. If the issue is already satisfied, report evidence without an empty PR; if its goal is ambiguous or infeasible, report the blocking decision.

**An adopted plan is the blueprint.** Deviations can follow **the traced code**, **anything newer on the issue** from a maintainer, or **correctness and safety**. Existing behavior informs implementation; it does not cancel a requested behavior change. Record each deviation and its reason in the PR body. This shared plan-deviation policy applies to every caller; a restatement never narrows it. Explicit user requirements remain authoritative.

**Mirror the plan's steps into the task tracker** before writing code; mark an item complete only when its verify point passes. Derive missing numbering or checks. Without a tracker, use the run record. An overridden step closes as a recorded deviation with a replacement check or superseding requirement and a matching PR-body entry. A borrowed verify point re-homes to a runnable replacement or the item's own check; apply this through dependent items, or close them as deviations too. Leave no item waiting on a canceled check. Without a plan, track acceptance checks directly.

### 3. Implement the fix

Implement the scoped change and necessary documentation. Add meaningful tests for behavior that can regress. For bug fixes, run the regression check against the unchanged base and the fix; isolate the base check to preserve current work. If reproduction is unavailable, state the limitation. Documentation-only changes need relevant validation rather than artificial runtime tests.

Apply repository test-edit rules. When a test breaks in another location, classify it as Outdated, Wrong, or Obsolete with the required independent ground before editing; none of the three means the change broke real behavior, so fix the code. Disclose every test edit and its ground in the commit and PR. An unresolved correct expectation blocks completion.

### 4. Verify before claiming anything

Run required tests, build, and linters plus relevant acceptance checks. Review the complete diff against the recorded base for omissions, unrelated changes, and unintended generated files. Close every plan item with evidence or a recorded deviation.

Fix failures caused by this change. Check an alleged pre-existing failure against the unchanged base before labeling it. Required checks that fail or cannot run block the normal commit/PR path unless the user or caller explicitly authorizes publication with that limitation. Record commands, results, and tested state; rerun affected checks after subsequent edits. Local success does not establish continuous integration (CI) success.

### 5. Commit and push

Inspect status and the staged diff; stage only intended files. Follow repository commit and attribution conventions using the actual builder and applicable caller attribution. Confirm the final commit contains the verified changes. Push the issue branch with an explicit remote and upstream, then confirm its remote head equals local HEAD. Never force-push to repair a mismatch. After an uncertain push, inspect remote state before retrying.

### 6. Open the PR

Recheck issue state, duplicate PRs, the exact target's existence, and dependency pins. If a gate changed, preserve the branch and report it. Use the recorded target with `--base`. Verify and update this run's existing PR; after an uncertain create response, find the exact head/base PR before retrying.

Follow repository title/body conventions: `Closes #<N>`, `## Summary` and verification first, test-edit disclosures, adopted plan source and deviations (or "none"), then `## Plain simple English` before attribution. Include `Target branch:` for a non-default target and ordered predecessor PRs/pins when present. Append `, fableplan` only for the step-0 flag. Send multiline text through a structured tool argument or `--body-file`. Leave issue closure to the merge workflow.

Read back the PR and verify its repository, open state, head branch/commit, base, and body. Return success only when the remote head matches the verified local commit and the requested change is present in the PR diff.

### 7. Report to the user

Report the outcome, verification, commit, PR URL, and worktree/branch; include a non-default target. On a blocker, state the stage, evidence, preserved work, and which commit, push, or PR already exists. Check before claiming no commit exists: dependency integration or an earlier attempt may have committed. Name follow-on work as unfiled. Preserve the worktree for review or recovery. Return caller-required structured fields from verified state.

Cap the report at 55 words in ASD-STE100, per the Response Style rules.

---
Updated with LLM: GPT-6 | high | Harness: Claude Code
