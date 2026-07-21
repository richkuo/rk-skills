---
name: fableplan
description: Use when the user wants a task planned by a Fable 5 planning subagent before building it. Spins up a Plan subagent running on Fable 5 to produce an implementation plan, relays the plan back to the main agent, and — if a GitHub issue is referenced — posts the plan as a comment on that issue and asks the user whether to continue building now before proceeding. Trigger on "/fableplan", "fableplan this", or "plan this with fable".
---

# fableplan

Delegate planning to a **Fable 5** Plan subagent, then build from its plan in the main agent. The main agent does the building — the subagent only plans.

## Input

The user provides a task description, and optionally a GitHub issue:
- A task in prose ("fableplan adding X to Y").
- A GitHub issue reference — full URL, `#<N>`, bare `<N>`, or `owner/repo#N`. When present, the plan is also posted as an issue comment.
- If neither is obvious, ask the user what to plan before dispatching.

## Steps

### 1. Resolve the GitHub issue (only if one is referenced)

If the user named an issue, fetch it so the subagent plans against the real requirements, not a paraphrase:

```
gh issue view <N> --json number,title,body,url
```

For the `owner/repo#N` form (or a full URL to another repo), add `-R owner/repo` — a bare `gh issue view <N>` only resolves against the current repo.

If the command fails (wrong number, no auth, no repo), stop and tell the user — never proceed by planning against your paraphrase of an issue you couldn't fetch.

Record the issue number and URL — you'll need them in step 4. If no issue is referenced, skip this and step 4's posting.

### 2. Dispatch the Fable 5 Plan subagent

Do not re-plan the task yourself first — the subagent owns the plan. Snapshot `git status --porcelain` before dispatching (the tree may already be dirty), then call the Agent tool with:

- `subagent_type`: `Plan`
- `model`: `fable` (this is the whole point of the skill — the plan must come from Fable 5)
- `run_in_background`: `false` — every later step depends on the plan, so wait for it synchronously instead of doing other work first
- `description`: `Plan <short task name>`
- `prompt`: Hand the subagent everything it needs to plan independently — the full task description, the issue title/body if one was fetched, the working directory, and any constraints the user stated. Tell it explicitly:
  - Produce a concrete, ordered implementation plan (files to create/modify, the approach, build sequence, risks/edge cases, and how to verify).
  - Plan the absolute-best solution the task calls for, evaluated as if cost, effort, time, token spend, and code volume were unlimited — they are not factors and must never narrow the option space. The only constraints that override "best" are correctness and safety.
  - Return the plan as its final message in clean Markdown suitable to (a) act on directly and (b) post verbatim as a GitHub issue comment.
  - It is planning only — it must NOT make code edits, including via Bash (no writing/modifying files, no commits). The subagent lacks Edit/Write, but still has Bash, so this must be stated explicitly.

The Plan subagent's final message is returned to you as the tool result; it is not shown to the user.

If the call returns null or errors (user skip, terminal API failure), retry once; if it fails again, report the failure to the user instead of planning yourself.

When the result arrives:
- Run `git status --porcelain` and compare against the pre-dispatch snapshot to confirm the subagent made no file changes despite the no-edit instruction. If it did, tell the user and ask whether to revert before continuing.
- Save the plan verbatim to a scratchpad file immediately, so it survives context summarization during a long build and step 4 can post it exactly as produced.

### 3. Sanity-check the plan against the code

Before posting or presenting it, verify the plan's load-bearing claims against the actual codebase: the files it says to modify exist, the functions/symbols it references are real, and it doesn't contradict repo conventions (CLAUDE.md). Fix small inaccuracies yourself and note them; if the plan is structurally wrong (built on a file or mechanism that doesn't exist), do NOT automatically re-dispatch the Plan subagent — stop and tell the user what's failing, and let them decide whether to re-plan with Fable 5, adjust the task, or proceed anyway. If you fixed small inaccuracies, update the scratchpad file from step 2 so it reflects the corrected plan before step 4 posts it.

### 4. Post the plan to the GitHub issue (only if one was resolved in step 1)

Now that the plan has passed the sanity-check, save it to the issue as a comment before building, so the vetted plan is preserved on the issue regardless of how the build goes. This comment is not updated after the build.

```
gh issue comment <N> --body-file <tmpfile>
```

Add `-R owner/repo` when the issue lives in another repo (as in step 1). Use the scratchpad file from step 2 (with any step-3 corrections) as the body-file base — it avoids shell-escaping problems with Markdown. Prefix the comment so its origin is clear with a heading line `## Implementation plan (Fable 5)` above the plan body, and end the body with the standard metadata footer:

```
---
Created with LLM: Fable 5 | high | Harness: Claude Code | fableplan
```

After posting, give the user the comment URL `gh` returns. Follow the repo's CLAUDE.md conventions for comment formatting if any apply (e.g. avoid `#N` auto-links in list items). If no issue is referenced, skip this step.

### 5. Relay the plan to the user

Present the vetted plan to the user (the main agent).

### 6. Ask whether to continue building (only if an issue was referenced)

The plan is now safely posted to the issue regardless of what happens next — don't assume the user wants an immediate build. Ask (e.g. via `AskUserQuestion`) whether to continue building this now or stop here. If they stop, end the skill; they can resume later with `work-on-issue` on the same issue. If no issue was referenced in step 1, there's nothing posted to fall back to, so skip the question and proceed straight to building.

### 7. Set up an isolated git worktree

Before making any code changes, move the build into its own git worktree so it never touches the user's current workspace. If the directory isn't a git repository, tell the user and ask how to proceed rather than building in place. Otherwise create a fresh branch and worktree for the task, prefixed with the coding-agent identifier — `cc/` for Claude Code, `cursor/` for Cursor, `codex/` for Codex — ahead of the `fableplan/` segment.

**On Claude Code**, use the native `EnterWorktree` tool (it creates under `.claude/worktrees/` and switches the tracked cwd; it uses the name verbatim, adding no prefix itself). It branches from `origin/<default>` only when the `worktree.baseRef` setting is `fresh` (its default) — set to `head` it branches from the local HEAD, which may be stale — so fetch first and verify the base after:

```
git fetch origin <default-branch>
EnterWorktree(name: "cc/fableplan/<short-task-name>")
git -C .claude/worktrees/cc/fableplan/<short-task-name> rev-parse HEAD origin/<default-branch>   # the two SHAs must match
```

Anchor the check (and any reset) with `-C <worktree-path>` — cwd doesn't reliably persist between Bash calls, and an unanchored command in the original checkout would misreport or, worse, destroy uncommitted work there. If the SHAs differ on the worktree you **just created**, move it onto the fetched default with `git -C <worktree-path> reset --hard origin/<default-branch>` — safe only because the brand-new branch carries no commits; never reset a worktree that already has work on it.

**On Cursor or Codex** (no `EnterWorktree` tool), create it by hand — the coding-agent prefix goes on both the directory and the branch so concurrent agents on the same task name never collide:

```
git fetch origin <default-branch>
git worktree add ../<repo>-fableplan-cursor-<short-task-name> -b cursor/fableplan/<short-task-name> origin/<default-branch>
```

(swap `cursor` for `codex` on Codex), then `cd` into it and re-verify `pwd` before later steps — shell state doesn't persist between Bash calls.

Do all of step 8's building inside that worktree. When the build is done, follow the repo's usual conventions for merging or opening a PR from the branch, and remove the worktree once it's no longer needed (`git worktree remove <path>`).

### 8. Build

In the worktree from step 6, the main agent builds the task per the plan. Confirm with the user first only if the plan reveals ambiguity or a decision the user must make; otherwise proceed.

## Notes

- The Plan subagent runs on Fable 5 regardless of the main agent's model — `model: fable` on the Agent call forces it.
- **If the `fable` model is unavailable in this harness** (the Agent call errors on the model id), fall back to the most capable model available and proceed — the isolation pattern (Plan subagent plans, main agent builds) is what matters. Name the model that actually ran in the footer and report, never "Fable 5".
- If the user did not reference an issue, never invent one or post anywhere — just plan and build.
