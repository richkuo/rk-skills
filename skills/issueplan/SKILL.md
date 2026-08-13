---
name: issueplan
description: >-
  Use when the user wants the current large language model to plan and build a task in the same session without a subagent. When an issue is referenced, it posts the plan and asks whether to build. Without an issue, it builds and opens a pull request after presenting the plan. Trigger on "/issueplan", "issueplan this", or "plan this issue in this session".
---

# issueplan

Plan with the current large language model (LLM) in the current session. Keep planning and building in this session.

Do not create or use a subagent during this workflow. The current agent owns every step.

## Input

Accept a task description and an optional GitHub issue:

- Accept prose, such as "issueplan adding X to Y."
- Accept a full issue URL, `#<N>`, bare `<N>`, or `owner/repo#N`.
- Ask what to plan only when the task is unclear.

## Steps

### 1. Resolve the GitHub issue when one is referenced

Fetch the issue before planning:

```
gh issue view <N> --json number,title,body,url
```

Add `-R owner/repo` for another repository. A bare command resolves against the current repository.

Stop if the command fails. Do not plan from a paraphrase when the referenced issue is unavailable.

Record the issue number, URL, title, and full body. Skip issue posting in step 4 when the user gave no issue.

Read any `## Execution` block as a task constraint. Keep the current session model and effort for planning.

### 2. Produce the plan in the current session

Do not call the Agent tool, Task tool, workflow delegation, or any subagent mechanism.

Inspect the repository with read-only commands. Read its instruction files and the code that controls the requested behavior.

Produce a concrete, ordered implementation plan. Include:

- Files to create or modify.
- The implementation approach and build sequence.
- Correctness risks, safety risks, and edge cases.
- Tests and other verification.

Select the best solution for correctness and safety. Ignore cost, time, token use, and code volume during solution selection.

Keep the plan in clean Markdown. Make it suitable for direct use and for a GitHub issue comment.

Save the plan to a temporary scratchpad immediately. Preserve its exact text for step 4 and the later build.

Use the current session model and effort in attribution. Use a repository-defined fallback only when its instructions require one.

Never infer unavailable attribution values. State the limitation before posting when repository instructions provide no fallback.

### 3. Check the plan against the code

Verify each load-bearing claim against the repository. Confirm that named files, symbols, commands, and conventions exist.

Correct small errors and update the scratchpad. Tell the user what changed.

Stop when the plan depends on a missing mechanism or a major false assumption. Ask the user whether to revise the task or plan.

### 4. Post the plan when an issue was resolved

Add this heading before the checked plan:

```
## Implementation plan (current session)
```

End the comment with the repository's required attribution footer. Use this form when the repository has no stronger rule:

```
---
Created with LLM: <current session model> | <current session effort> | Harness: issueplan
```

Post the prepared file:

```
gh issue comment <N> --body-file <tmpfile>
```

Add `-R owner/repo` for another repository. Give the returned comment URL to the user.

Skip this step when the user gave no issue. Do not create or select an issue on the user's behalf.

### 5. Present the plan

Show the checked plan to the user. Include the issue comment URL when step 4 posted it.

State any attribution limitation or repository constraint that affects the plan.

### 6. Confirm issue builds or continue prose tasks

Ask whether to continue building or stop after the posted plan. Use the harness question tool when one is available.

End the workflow when the user stops. They can resume later with `work-on-issue`.

For a task with no issue, continue directly into worktree creation, implementation, and pull request creation after presenting the checked plan.

Ask first only when the plan exposes a required product decision or unsafe ambiguity.

### 7. Create an isolated git worktree

Keep all changes out of the user's current checkout. Stop and ask how to proceed when the directory is not a git repository.

Fetch the remote default branch. Create a worktree and branch from the fetched commit.

Prefix both names with the current coding agent identifier. Use `cc/`, `cursor/`, or `codex/` before `issueplan/<short-task-name>`.

Use the harness worktree tool when available. On Codex or Cursor, use:

```
git fetch origin <default-branch>
git worktree add ../<repo>-issueplan-<agent>-<short-task-name> -b <agent>/issueplan/<short-task-name> origin/<default-branch>
```

Verify that the new worktree starts at `origin/<default-branch>`. Verify the working directory before every later write.

### 8. Build from the plan

Implement the checked plan in the worktree with the current session LLM. Do not delegate implementation to a subagent.

Follow repository test, commit, push, and pull request rules. Record any plan deviation in the pull request.

Remove the worktree only after repository rules permit removal.

## Rules

- Keep the same session and current LLM for planning and building.
- Use no subagent at any point.
- Post only to an issue the user referenced.
- Preserve the checked plan for the build.
- Follow repository instructions for attribution and git workflow.
