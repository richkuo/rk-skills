---
name: fableplan
description: Use when the user wants a task planned by a Fable 5.1 planning subagent before building it. Spins up a Plan subagent running on Fable 5.1 to produce an implementation plan, relays the plan back to the main agent, and — if a GitHub issue is referenced — posts the plan as a comment on that issue and asks the user whether to continue building now before proceeding. Trigger on "/fableplan", "fableplan this", or "plan this with fable".
---

# fableplan

A **Fable 5.1** Plan subagent writes the plan. The main agent checks it, posts it, and builds from it. The subagent never builds.

## Input

A task description, with an optional GitHub issue:

- Prose, such as "fableplan adding X to Y".
- An issue reference: full URL, `#<N>`, bare `<N>`, or `owner/repo#N`. The plan is then also posted as an issue comment.
- Ask what to plan only when the task is unclear. With no issue referenced, never invent one or post anywhere.

## Steps

### 1. Resolve the GitHub issue (only if one is referenced)

Fetch the issue so the subagent plans against the real requirements:

```
gh issue view <N> --json number,title,body,url
```

Add `-R owner/repo` for another repository. Stop and tell the user if the command fails. Never plan from a paraphrase of an issue you could not fetch.

Record the number and URL for step 4. Read any **Plan effort** line in the body's `## Execution` block: planning runs at that tier when present and at `high` otherwise; a stamped `xhigh` runs at `xhigh`, since the stamp is the user's explicit choice.

### 2. Dispatch the Fable 5.1 Plan subagent

Do not plan the task yourself first. **Load the `fable-dispatch` skill before dispatching.** It owns the dispatch ladder, the CLI shim, result parsing, attribution (section 6), and the dispatch-hygiene rules every caller follows (section 7: read-only prompt, snapshot and diff, retry once then report). On the Agent-tool path, call the Agent tool with:

- `subagent_type`: `Plan`
- `model`: `fable`. This forces Fable 5.1 whatever the main agent's model.
- `run_in_background`: `false`. Every later step needs the plan, so wait for it.
- `effort`: the tier from step 1 (the stamped Plan effort, else `high`), passed explicitly, when the Agent tool's schema exposes an `effort` property. When it does not, dispatch without it. When the schema check is inconclusive and the call fails input validation on that parameter, re-dispatch once without it. Dispatching without `effort` is a degradation to report in step 5, never a step failure. On the CLI-shim path, `--effort <tier>` carries the tier directly.
- `description`: `Plan <short task name>`
- `prompt`: everything the subagent needs to plan on its own: the full task, the issue title and body when fetched, the working directory, and the user's constraints. Instruct it to:
  - Produce a concrete, ordered plan: files to create or modify, the approach, build sequence, risks and edge cases, and verification.
  - Number the implementation steps (`1.`, `2.`, …) and end each step with a **verify point**: the observable check that proves the step is done (a command, a passing test, a file state). Builders mirror these steps into their task tracker, so a step without a number or verify point loses its anchor.
  - Plan the absolute-best solution. Cost, effort, time, token spend, and code volume never narrow the option space. Only correctness and safety override "best".
  - Return the plan as its final message in clean Markdown, fit to act on directly and to post verbatim as an issue comment.
  - Make no file edits and no commits, including through Bash (the read-only rule of `fable-dispatch` section 7).

When the tool result (the plan) arrives:

- Save the plan verbatim to a scratchpad file at once. It must survive context summarization during a long build, and step 4 posts from it.
- Run the snapshot diff from `fable-dispatch` section 7.
- **Record the model and effort that actually ran.** The model is `Fable 5.1` unless the fallback ladder substituted another. The effort is the step 1 tier unless the harness accepted no `effort` parameter. In that case record that tier as the requested one, note that the tier was not honored, and do not guess the session's own tier. Step 4's footer and step 5's report use these values.

### 3. Sanity-check the plan against the code

Verify the plan's load-bearing claims against the codebase: the files it modifies exist, the symbols it names are real, and it follows repository conventions (CLAUDE.md). Fix small inaccuracies yourself, note them, and update the scratchpad file. If the plan is structurally wrong (built on a file or mechanism that does not exist), do not re-dispatch on your own. Stop, tell the user what fails, and let them decide: re-plan with Fable 5.1, adjust the task, or proceed anyway.

### 4. Post the plan to the GitHub issue (only if one was resolved in step 1)

Post the checked plan before building. Never update the comment afterwards. Build the body from the scratchpad file: a heading line `## Implementation plan (Fable 5.1)`, the plan, then the attribution footer:

```
---
Created with LLM: <model that actually ran> | <effort that actually ran> | Harness: <harness> | fableplan
```

Fill the model and effort from step 2's recorded values, never a constant. `<harness>` names the harness running the session per `fable-dispatch` section 6. A footer that names a model or tier the run did not use is a false attribution.

```
gh issue comment <N> --body-file <tmpfile>
```

Add `-R owner/repo` for another repository. Follow the repository's comment conventions (for example no bare `#N` list numbering). Give the user the comment URL.

### 5. Relay the plan to the user

Present the checked plan. Say in one line if step 2 could not honor the requested tier. Otherwise say nothing about tiers.

### 6. Ask whether to continue building (only if an issue was referenced)

The plan is safely posted, so do not assume an immediate build. Ask (for example via `AskUserQuestion`) whether to build now or stop. On stop, end the skill; the user can resume later with `work-on-issue`. With no issue, there is nothing posted to fall back to, so skip the question and build.

### 7. Set up an isolated git worktree

Never build in the user's current checkout. If the directory is not a git repository, tell the user and ask how to proceed. Create the worktree and branch per `work-on-issue` step 1 ("Create the isolated worktree on a verified base"). Deltas: the name is `<agent-prefix>/fableplan/<short-task-name>` (for example `cc/fableplan/<short-task-name>`), and there is no `baseRefs` input, so the base is the fetched `origin/<target>`: the `targetBranch` the user named, else the default branch. The PR opens against that same target.

Build inside that worktree. When done, open a PR per the repository's conventions, and remove the worktree once it is no longer needed (`git worktree remove <path>`).

### 8. Build

The main agent builds per the plan. Before writing any code, mirror the plan's numbered steps into the task tracker per `work-on-issue` step 2 (its "Mirror the plan's steps into the task tracker" paragraph). That paragraph owns the mirroring rule, both fallbacks, and the disposition of a step an override cancels. Confirm with the user first only when the plan exposes an ambiguity or a decision that is theirs to make.

## Planning-phase-only invocation

Wrapper skills (the validate chains, `fableplan-loop`, `fableplan-work-on-issue`) invoke this skill for planning only. In that mode:

- Run **steps 1 through 5 only**. Do not act on step 6's build question, and do not execute steps 7 and 8. The caller owns implementation.
- Use the caller's harness suffix in place of `fableplan` in step 4's footer, so the comment records the actual entry point.
- Keep the scratchpad file. The caller passes it to its implementation or report stage.
- On a structurally wrong plan, or a dispatch that fails after the `fable-dispatch` section 7 retry, stop and report to the caller. Never post a broken plan, and never plan the task yourself in fableplan's place.

