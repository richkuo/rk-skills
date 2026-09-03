---
name: issueplan
description: >-
  Use when the user wants the current large language model to plan and build a task in the same session without a subagent. When an issue is referenced, it posts the plan and asks whether to build. Without an issue, it builds and opens a pull request after presenting the plan. Trigger on "/issueplan", "issueplan this", or "plan this issue in this session".
---

# issueplan

The current session's large language model (LLM) plans and builds. Never call the Agent tool, Task tool, workflow delegation, or any subagent mechanism at any step.

## Input

A task description, with an optional GitHub issue:

- Prose, such as "issueplan adding X to Y".
- An issue reference: full URL, `#<N>`, bare `<N>`, or `owner/repo#N`. The plan is then also posted as an issue comment.
- Ask what to plan only when the task is unclear. With no issue referenced, never invent one or post anywhere.

## Steps

### 1. Resolve the GitHub issue (only if one is referenced)

Fetch the issue before planning:

```
gh issue view <N> --json number,title,body,url
```

Add `-R owner/repo` for another repository. Stop and tell the user if the command fails. Never plan from a paraphrase of an issue you could not fetch.

Record the number, URL, title, and full body for steps 2 and 4. Read any `## Execution` block as a task constraint. Planning still runs on the current session model and effort.

### 2. Produce the plan in the current session

Inspect the repository with read-only commands. Read its instruction files and the code that controls the requested behavior.

Produce a concrete, ordered plan: files to create or modify, the approach, build sequence, correctness and safety risks, edge cases, and verification. Number the implementation steps (`1.`, `2.`, …) and end each step with a **verify point**: the observable check that proves the step is done (a command, a passing test, a file state).

Plan the absolute-best solution. Cost, time, token use, and code volume never narrow the option space. Only correctness and safety override "best".

Write the plan in clean Markdown, fit to act on directly and to post verbatim as an issue comment. Save it to a scratchpad file at once. It must survive context summarization during a long build, and step 4 posts from it.

### 3. Check the plan against the code

Verify each load-bearing claim: the files, symbols, commands, and conventions the plan names exist. Fix small errors yourself, note them, and update the scratchpad file. If the plan depends on a missing mechanism or a major false assumption, stop and ask the user whether to revise the task or the plan.

### 4. Post the plan to the GitHub issue (only if one was resolved in step 1)

Post the checked plan before building, so it is preserved whatever happens to the build. Build the body from the scratchpad file: a heading line `## Implementation plan (current session)`, the plan, then the repository's required attribution footer. Use this form when the repository has no stronger rule:

```
---
Created with LLM: <current session model> | <current session effort> | Harness: issueplan
```

Fill the model and effort from the current session. Never guess a value the session cannot observe; when the repository gives no fallback, tell the user the limitation before posting.

```
gh issue comment <N> --body-file <tmpfile>
```

Add `-R owner/repo` for another repository. Follow the repository's comment conventions (for example no bare `#N` list numbering). Give the user the comment URL.

### 5. Present the plan

Show the checked plan, with the comment URL when step 4 posted it. State any attribution limitation or repository constraint that affects the plan.

### 6. Ask whether to continue building (only if an issue was referenced)

The plan is safely posted, so do not assume an immediate build. Ask (for example via `AskUserQuestion`) whether to build now or stop. On stop, end the skill; the user can resume later with `work-on-issue`. With no issue, there is nothing posted to fall back to, so skip the question and build.

### 7. Set up an isolated git worktree

Never build in the user's current checkout. If the directory is not a git repository, tell the user and ask how to proceed. Create the worktree and branch per `work-on-issue` step 1 ("Create the isolated worktree on a verified base"). Deltas: the name is `<agent-prefix>/issueplan/<short-task-name>`, and there is no `baseRefs` input, so the base is the fetched `origin/<target>`: the `targetBranch` the user named, else the default branch. The PR opens against that same target.

### 8. Build

Build per the plan in the worktree with the current session LLM. Before writing any code, mirror the plan's numbered steps into the task tracker per `work-on-issue` step 2 (its "Mirror the plan's steps into the task tracker" paragraph). That paragraph owns the mirroring rule, both fallbacks, and the disposition of a step an override cancels. Confirm with the user first only when the plan exposes a product decision or an unsafe ambiguity.

Follow the repository's test, commit, push, and pull request rules. Record every plan deviation in the pull request body. Remove the worktree once it is no longer needed and repository rules permit.
