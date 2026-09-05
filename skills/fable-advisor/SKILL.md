---
name: fable-advisor
description: Use when the user wants a task executed by the current session model with a persistent Fable 5.1 advisor overseeing it. A read-only Fable 5.1 subagent writes the plan and answers checkpoint consults; a separate fresh Fable 5.1 reviewer issues a binding pre-commit verdict. Accepts a GitHub issue or a prose task. Trigger on "/fable-advisor", "fable-advisor <task or issue>", or "execute this with a fable advisor".
---

# fable-advisor

The main agent (the **executor**) builds. A persistent **Fable 5.1 advisor** subagent writes the plan and answers checkpoint consults. A **separate fresh Fable 5.1 reviewer** gives the binding pre-commit verdict, so the plan's author never grades its own build. Never merge the two roles. An issue task runs `work-on-issue`'s pipeline; a prose task takes a lighter path.

## Input

An issue reference (URL, `#<N>`, `<N>`, `owner/repo#N`), a prose task, or both (the issue defines the task, the prose adds constraints). With an issue, the plan and the verdict are also posted as issue comments. Ask what to execute only when none is clear. With no issue, never invent one or post anywhere.

## Model check

If the main agent already runs on Fable 5.1, say the advisor is redundant and ask whether to proceed, run the task directly, or switch to Sonnet first (`/model sonnet`).

## Steps

### 1. Resolve and gate-check the issue (only if one is referenced)

`gh issue view <N> --json number,title,body,url` (add `-R owner/repo` for another repository). If it fails, stop and tell the user; never plan from a paraphrase. Record the number, title, and URL. Then run the two gates of `work-on-issue` step 0, before any advisor is spawned. With no issue, skip steps 3 and 8.

### 2. Spawn the advisor and get the plan

The advisor owns the plan; do not plan yourself. **Load `fable-dispatch` before dispatching**; its section 7 hygiene rules also govern the step 6 reviewer. Agent-tool path: `subagent_type: Plan`, `model: fable`, `run_in_background: false`, `description: Advise on <short task name>`. The prompt briefs a standing, read-only advisor with the full task (issue title and body for a bare reference), the working directory, the user's constraints, and its charter:

- First deliverable: a concrete, ordered plan with the implementation steps numbered, each ending in a **verify point** (the check that proves it done). Plan the absolute-best solution per CLAUDE.md.
- Each consult reply carries **recommendation**, **rationale**, **confidence** (high/medium/low), and a flag: **advisory** (the executor may overrule with a stated reason) or **blocking** (must be resolved before commit).

Record the agent's name; step 5 consults go to this same agent. Save the plan verbatim to a scratchpad file at once. Check its load-bearing claims against the code and CLAUDE.md; fix small inaccuracies in the file and note them. If the plan is structurally wrong, send the advisor one correction round with the evidence; if still broken, stop and tell the user. Present the vetted plan and build; wait only for a decision that is the user's.

### 3. Post the plan to the issue (only if one was resolved)

Before building: `gh issue comment <N> --body-file <tmpfile>` (add `-R owner/repo` as needed). Heading `## Implementation plan (Fable 5.1 advisor)`, footer:

```
---
Created with LLM: Fable 5.1 | high | Harness: <harness> | fable-advisor
```

Give the user the comment URL.

### 4. Build and ship

**Issue path.** Execute `work-on-issue` steps 1 to 6. Its step 0 ran in step 1 here; its step 7 report is replaced by steps 8 and 9 here. Three injections: before writing any code, mirror the plan's steps into the task tracker per `work-on-issue` step 2 and route deviations through step 5 (no re-planning on your own); step 5 consults apply throughout its step 3; the step 6 binding review runs between its steps 4 and 5. `baseRefs` is never an input here; a `targetBranch` the user names passes through unchanged.

**Prose path.**

1. **Worktree** per `work-on-issue` step 1, named `cc/fable-advisor/<short-task-name>`, with no `baseRefs` and the user's `targetBranch` when named. Outside a git repository, ask the user how to proceed.
2. **Build** per the plan with step 5 consults. Before writing any code, mirror the plan's steps into the task tracker per `work-on-issue` step 2.
3. **Verify** per `work-on-issue` steps 3 and 4. Never request the binding review on an unverified build.
4. **Binding review**, the step 6 gate.
5. **Commit and push** per `work-on-issue` step 5, then open a PR with the step 7 markers. Never trigger an `@claude` review yourself.

### 5. Consult the advisor at fixed checkpoints

Consult by SendMessage to the step 2 agent (a fresh Agent call loses its history), only when a checkpoint fires:

- **Hard-to-reverse decision**: architecture, schema, API contract, or data migration the plan did not settle.
- **Stuck, by signal**: the same test still fails after two distinct fix attempts, or the same error message appeared verbatim twice.
- **Plan deviation**: the plan is wrong or incomplete in a way that changes the approach.

Each consult carries the question, the current diff or excerpt, and what was tried. **Advisory**: follow it, or overrule with a one-line reason for the Advisor log. **Blocking**: resolve it before step 6, or step 6 fails automatically. If the agent is gone, spawn a replacement with the plan and a recap of the consults, and tell the user.

### 6. Binding pre-commit review (fresh reviewer, never the advisor)

Spawn a new one-shot Fable 5.1 reviewer (`subagent_type: Plan`, `model: fable`, `run_in_background: false`) with the task, the final plan including deviations and overruled findings, the full diff, and the verification results. It reviews for correctness, safety, and plan conformance and returns **approve**, or **blocked** with numbered findings (file:line and a failure scenario), non-blocking suggestions kept separate.

The verdict is binding. On blocked, fix each finding or produce evidence it is wrong, then re-submit to the same reviewer via SendMessage with the new diff and per-finding dispositions. **Deadlock cap**: when the reviewer rejects the same finding's resolution twice, stop and let the user rule. Never drop a blocking finding. If the reviewer call fails twice, tell the user and ask whether to commit unreviewed.

### 7. Commit and PR markers

On both paths the PR body carries an **Advisor log** (plan source, each consult with its disposition, overruled advisory findings, the verdict trail), `Closes #<N>` when an issue was resolved, and this footer with the executor model actually in use, also on the commit:

```
---
Created with LLM: <executor model> | high | Harness: <harness> | fable-advisor
```

### 8. Post the verdict to the issue (only if one was resolved)

After the PR is open, comment with the final verdict (and the finding count if fixes were needed), any deadlocks the user ruled on, and the PR URL. Same command as step 3, heading `## Review verdict (Fable 5.1 reviewer)`, footer:

```
---
Validated with LLM: Fable 5.1 | high | Harness: <harness> | fable-advisor
```

### 9. Report to the user

What was built, verification results, the consult and review trail, the PR URL, and any issue comment URLs.
