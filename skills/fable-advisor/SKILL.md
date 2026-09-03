---
name: fable-advisor
description: Use when the user wants a task executed by the current session model with a persistent Fable 5.1 advisor overseeing it. A read-only Fable 5.1 subagent writes the plan and answers checkpoint consults; a separate fresh Fable 5.1 reviewer issues a binding pre-commit verdict. Accepts a GitHub issue or a prose task. Trigger on "/fable-advisor", "fable-advisor <task or issue>", or "execute this with a fable advisor".
---

# fable-advisor

The main agent (the **executor**) builds. A persistent **Fable 5.1 advisor** subagent writes the plan and answers checkpoint consults. A **separate fresh Fable 5.1 reviewer** issues the binding pre-commit verdict, so the plan's author never grades its own build. Never merge the two roles. An issue task runs `work-on-issue`'s pipeline, which that skill owns; a prose task takes a lighter path.

## Input

One of:

- An issue reference alone: URL, `#<N>`, `<N>`, or `owner/repo#N`. The issue title and body are the task; the plan and the verdict are also posted as issue comments.
- A prose task ("fable-advisor migrate X to Y").
- Both: the issue defines the task, the prose adds constraints.

Ask what to execute only when none is clear. With no issue, never invent one or post anywhere.

## Model check

This skill pairs a cheap session model with expensive judgment. If the main agent already runs on Fable 5.1, say the advisor is redundant and ask whether to proceed, run the task directly, or switch to Sonnet first (`/model sonnet`).

## Steps

### 1. Resolve the issue (only if one is referenced)

Fetch it with `gh issue view <N> --json number,title,body,url` (add `-R owner/repo` for another repository). If the command fails, stop and tell the user; never plan from a paraphrase. Record the number, title, and URL for later steps. With no issue, skip steps 2, 4, and 9.

### 2. Gate-check the issue (only if one was resolved)

Run the two gates of `work-on-issue` step 0 now, before the advisor is spawned, so a closed or already-fixed issue costs no plan and no build.

### 3. Spawn the advisor and get the plan

Do not plan yourself; the advisor owns the plan. **Load `fable-dispatch` before dispatching.** Its section 7 hygiene rules govern the step 7 reviewer too. On the Agent-tool path:

- `subagent_type`: `Plan`, `model`: `fable`, `run_in_background`: `false`
- `description`: `Advise on <short task name>`
- `prompt`: brief it as a standing advisor: the full task (for a bare issue reference, the issue title and body), the working directory, the user's constraints, the read-only rule, and its charter:
  - First deliverable: a concrete, ordered plan with the implementation steps numbered and each step ending in a **verify point** (the check that proves it done). Plan the absolute-best solution per CLAUDE.md.
  - Each later consult reply carries **recommendation**, **rationale**, **confidence** (high/medium/low), and a flag: **advisory** (the executor may overrule with a stated reason) or **blocking** (must be resolved before commit).

Record the agent's name; step 6 consults go to this same agent so it holds the full task history.

Save the plan verbatim to a scratchpad file at once, so it survives context summarization. Check its load-bearing claims against the code and CLAUDE.md; fix small inaccuracies in the file and note them. If the plan is structurally wrong, send the advisor one correction round with the evidence; if it is still broken, stop and tell the user.

Present the vetted plan and build; wait only when it exposes a decision that is the user's.

### 4. Post the plan to the issue (only if one was resolved)

Post the vetted plan from the scratchpad file before building:

```
gh issue comment <N> --body-file <tmpfile>
```

Add `-R owner/repo` for another repository. Heading `## Implementation plan (Fable 5.1 advisor)`, footer:

```
---
Created with LLM: Fable 5.1 | high | Harness: <harness> | fable-advisor
```

Give the user the comment URL.

### 5. Build and ship

**Issue path.** Load `skills/work-on-issue/SKILL.md` and execute its steps 1–6. Its step 0 already ran in step 2; its step 7 report is replaced by steps 9–10 here. Three injections:

- **Plan authorship, its step 2.** Before writing any code, mirror the plan's steps into the task tracker per `work-on-issue` step 2. Route deviations through step 6; do not re-plan on your own.
- **Checkpoint consults, throughout its step 3.** Step 6 applies for the whole implementation.
- **Binding review, between its steps 4 and 5.** Run step 7 after verify and before staging.

Steps 4, 8, and 9 still apply; `baseRefs` is never an input here, and a `targetBranch` the user names passes through to `work-on-issue` unchanged.

**Prose path.**

1. **Worktree.** Create it per `work-on-issue` step 1, named `cc/fable-advisor/<short-task-name>`, with no `baseRefs` and with the user's `targetBranch` when one was named. Outside a git repository, ask the user how to proceed.
2. **Build** per the plan with step 6 consults. Before writing any code, mirror the plan's steps into the task tracker per `work-on-issue` step 2.
3. **Verify** per `work-on-issue` steps 3 and 4. Never request the binding review on an unverified build.
4. **Binding review**, the step 7 gate.
5. **Commit and push** per `work-on-issue` step 5, then open a PR with the step 8 markers. Never trigger an `@claude` review yourself.

### 6. Consult the advisor at fixed checkpoints

Consult only when a checkpoint fires, by SendMessage to the step 3 agent; a fresh Agent call loses its history.

- **Hard-to-reverse decision**: architecture, schema, API contract, or data migration the plan did not settle.
- **Stuck, by signal**: the same test still fails after two distinct fix attempts, or the same error message appeared verbatim twice.
- **Plan deviation**: the plan is wrong or incomplete in a way that changes the approach.

Each consult carries the question, the current diff or excerpt, and what was tried. **Advisory** reply: follow it, or overrule with a one-line reason for the Advisor log. **Blocking** reply: resolve it before step 7, or step 7 fails automatically.

If the agent is gone, spawn a replacement advisor with the plan and a recap of the consults so far, and tell the user.

### 7. Binding pre-commit review (fresh reviewer, never the advisor)

Spawn a new one-shot Fable 5.1 reviewer (`subagent_type`: `Plan`, `model`: `fable`, `run_in_background`: `false`) with the task, the final plan including deviations and overruled findings, the full diff, and the verification results. It reviews for correctness, safety, and plan conformance and returns **approve**, or **blocked** with numbered findings (file:line and a failure scenario), non-blocking suggestions kept separate.

The verdict is binding. On blocked, fix each finding or produce evidence it is wrong, then re-submit to the same reviewer via SendMessage with the new diff and per-finding dispositions. **Deadlock cap**: when the reviewer rejects the same finding's resolution twice, stop and let the user rule on both positions. Never drop a blocking finding. If the reviewer call fails twice, tell the user and ask whether to commit unreviewed.

### 8. Commit and PR markers

On both paths the PR body carries an **Advisor log** (plan source, each consult with its disposition, overruled advisory findings, the verdict trail), `Closes #<N>` when an issue was resolved, and this footer with the executor model actually in use, also on the commit:

```
---
Created with LLM: <executor model> | high | Harness: <harness> | fable-advisor
```

### 9. Post the verdict to the issue (only if one was resolved)

After the PR is open, comment on the issue with the final verdict (and the finding count if fixes were needed), any deadlocks the user ruled on, and the PR URL. Same command as step 4, heading `## Review verdict (Fable 5.1 reviewer)`, footer:

```
---
Validated with LLM: Fable 5.1 | high | Harness: <harness> | fable-advisor
```

### 10. Report to the user

What was built, verification results, the consult and review trail, the PR URL, and any issue comment URLs.
