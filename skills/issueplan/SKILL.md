---
name: issueplan
description: >-
  Plan a task or GitHub issue with the current session model, then build when authorized. Use for "/issueplan", "issueplan this", "issue-plan", or requests to plan an issue in this session. Supports planning only; uses no subagents.
---

# issueplan

The current session's large language model (LLM) owns planning and implementation. Do not delegate or launch another coding agent. Follow the repository's Response Style, engineering, Git workflow, and attribution rules without duplicating them here.

## Determine the requested outcome

Accept a task description or an issue URL, `#<N>`, bare issue number, or `owner/repo#N`; also accept a target branch. Resolve an omitted task from clear session context. Ask only when the task or repository remains ambiguous.

- A planning-only request or planning-phase caller ends after the checked plan is delivered. It never starts implementation.
- Explicit authorization to plan and build, including authorization already given in this session, continues through an open pull request (PR) without another approval question.
- A bare `issueplan` invocation with an issue posts and presents the plan, then asks whether to build. With a task description and no issue, it presents the plan and builds by default.

User limits on posting, implementation, or publishing override these defaults. Without an issue, do not create an issue or issue comment; the build may still open a PR. Planning-only use does not require a worktree.

## 1. Establish the source of truth

Read the repository instructions and check its identity, current branch, commit, and working-tree status. For a referenced issue, fetch its title, full body, state, URL, update time, and comments with `gh issue view <issue> --json number,title,body,state,url,updatedAt,comments`. Use an explicit `--repo owner/repo` when needed and preserve that identity for later GitHub commands.

Confirm that the code checkout belongs to the issue's repository. Use the correct local clone when available; otherwise stop issue-based planning and report the missing repository. A failed issue fetch blocks issue-based planning. Never substitute a paraphrase or another issue.

Read acceptance criteria, maintainer corrections, prior plans, and any Execution block. A current-session request selects this session's model and effort; retain the block's scope, dependency, and target constraints. Do not dispatch a stamped model through another harness. Report any routing conflict that the user's request does not resolve before implementation.

## 2. Write and check the plan

Trace the requested behavior through the relevant code, callers, and tests with read-only inspection. Distinguish existing mechanisms from proposed additions. Correct false assumptions yourself when the intended outcome remains clear; ask only for a missing product decision or a scope change that requires the user.

Write a plan sized to the task:

- State the intended behavior and scope, tied to the acceptance criteria.
- Identify the affected files and approach, including dependencies and material correctness or safety risks.
- Number the implementation steps (`1.`, `2.`, ...) and end each with a **verify point**: an observable check of the intended behavior or result.
- Cover relevant regression cases and required project checks. Separate proposed checks from checks already run, and identify any blocker to verification.

Check the plan against the code before delivery: existing paths and symbols must be real, proposed additions must be labeled, and verification commands must match the project's tools. Every acceptance criterion needs an implementation step and a check, or an explicit unresolved dependency. Do not present a blocked plan as ready to build.

Save the checked plan in a scratchpad file outside the working tree. Include the task or issue URL, inspected commit, target branch, unresolved decisions, and implementation authorization so the work can resume after context summarization.

## 3. Preserve and present the plan

For an issue, unless the user limits posting, post the checked plan before implementation. Use `## Implementation plan (current session)` as the heading so `work-on-issue` can find it. Apply the repository's attribution footer; absent a repository format, use a final `---` line followed by `Created with LLM: <current session model> | <current session effort> | Harness: issueplan`. Use observed model and effort values or the repository's explicit fallback; report unknown values instead of inventing them.

Post from the saved body with `gh issue comment <issue> --body-file <plan-file>`, using the resolved repository. Record the returned comment URL. After an uncertain posting result, inspect the issue comments before retrying to avoid duplicate plans. If required posting fails, preserve the local plan and report the blocker before building.

Give the user the plan's main decisions and a link to its full text, using the comment URL or local scratchpad path. Follow the requested outcome above: stop for planning only, continue when authorized, or ask the one remaining build question. Keep the saved plan for a later continuation.

## 4. Build and deliver

Load [work-on-issue](../work-on-issue/SKILL.md) for the shared build procedures below. Apply those procedures in this session; do not invoke its issue-selection fallback or a delegated workflow.

On a resumed run, identify the task's existing worktree and PR first so the duplicate check can recognize its own branch. Before building, refresh issue state and comments and apply `work-on-issue` step 0 for issue-state, duplicate-PR, and plan-selection rules. Use the saved plan when no posted plan exists. For tasks without an issue, skip issue-specific commands and gates.

If no Git repository is available, preserve the plan and report that implementation needs one. Otherwise, create or reuse the isolated worktree per `work-on-issue` step 1. Resolve the target from user and repository instructions, otherwise the repository default branch. Use `<agent-prefix>/issueplan/<short-task-name>` for a new branch. This skill supplies no `baseRefs`; new work starts from the fetched target branch. The PR uses that same target. Confirm a reused worktree belongs to this task and target; preserve its existing work.

Recheck affected code against the saved plan after entering the worktree, especially when the base or issue changed. Before writing any code, apply `work-on-issue` step 2 for plan deviations and mirroring numbered steps into the task tracker, including its scratchpad fallback and overridden-step rules. Update the saved plan and record material changes; ask again only when a change exceeds existing authorization.

Apply its implementation, verification, commit, push, and PR procedures in steps 3 through 6, within user limits. For tasks without an issue, omit issue references and closing keywords. Preserve the plan and deviations in the PR body; include locally saved plan text only when publishing it is permitted.

Report the PR URL, verification result, and any remaining blocker. If stopped, include the saved plan and worktree paths needed to resume. Retain worktrees with unfinished or unpushed work; clean up completed work only when repository rules permit. This skill ends at delivery; merging or an automated review loop needs separate authorization.

---
Updated with LLM: GPT-6 | high | Harness: skill-creator
