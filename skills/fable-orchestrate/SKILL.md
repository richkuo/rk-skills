---
name: fable-orchestrate
description: Use when the user wants a task decomposed and driven by a Fable 5 orchestrator delegating implementation to Sonnet 5 workers. The Fable session decomposes into self-contained worker specs, dispatches Sonnet subagents (plain Agents for 1–2 pieces, a Workflow for genuine fan-out), reviews each result inline against its spec, merges into one task branch, and gets a binding final verdict from a fresh Fable reviewer. Trigger on "/fable-orchestrate", "fable-orchestrate <task>", or "orchestrate this with fable".
---

# fable-orchestrate

Run a task with **Fable 5 as orchestrator** and **Sonnet 5 workers**. The main agent (you, on Fable) owns decomposition, specs, every accept/reject decision, integration, and the PR; workers own only the mechanical implementation of their piece. Principle: mechanical volume on Sonnet, every judgment call on Fable.

## Input

The user provides a task description in prose. If no task is obvious from the invocation or the conversation, ask what to orchestrate before decomposing.

## Model check

This skill assumes the session model IS Fable 5 — the orchestrator's judgment is the point. If you are not running on Fable 5, tell the user and ask whether to switch (`/model fable`) or proceed with the current model as orchestrator anyway.

## Steps

### 1. Decompose — biased against fan-out

Read the relevant code first, then split the task into worker pieces. Decomposition is the highest-leverage failure point of this whole skill — a bad split wastes everything downstream — so:

- **Default to fewer, larger, sequential pieces.** Parallelize only when pieces touch disjoint files; parallelism is an optimization, never the goal. One worker doing the whole task is a valid decomposition.
- **Pin the interfaces between pieces upfront.** Where two pieces meet (a function signature, a schema, an event shape, a route contract), the spec states the exact interface both sides build against — workers must never invent their side of a seam.
- **Each spec must be fully self-contained.** Workers arrive with zero conversation context. A spec carries: scope, exact files to create/modify, acceptance criteria, explicit non-goals, the pinned interfaces it touches, relevant repo conventions (CLAUDE.md constraints, package manager, style), and the exact verification command(s) the worker must run and pass before returning.

Present the decomposition to the user briefly (pieces, ordering, what runs in parallel), then proceed — pause for input only if the split reveals a decision only the user can make.

### 2. Set up the task worktree

Never build in the user's checkout. Run `git fetch origin <default-branch>` first — the staleness check below compares against the local `origin/<default-branch>` ref, so skipping the fetch makes the check pass on two equally stale copies — then create the task branch/worktree `cc/fable-orchestrate/<short-task-name>` off `origin/<default>` (via `EnterWorktree`, name passed verbatim; verify the worktree HEAD matches `origin/<default-branch>` with `git -C <worktree-path> rev-parse HEAD origin/<default-branch>`; if the SHAs differ on the worktree you just created, move it onto the fetched default with `git -C <worktree-path> reset --hard origin/<default-branch>` — safe only because the brand-new branch carries no commits, and always anchored with `-C <worktree-path>` so it can never touch the original checkout). If the directory isn't a git repo, ask the user how to proceed. Everything lands on this one branch — a single PR is the deliverable regardless of worker count.

### 3. Dispatch workers

- **1–2 sequential pieces**: plain Agent calls — `subagent_type`: `general-purpose`, `model`: `sonnet`, `run_in_background`: `false` when the next piece depends on it. Sequential workers build directly in the task worktree (state the worktree path in the spec). **Commit each accepted piece to the task branch before dispatching the next** — an uncommitted accepted piece is indistinguishable from the next attempt's residue, and the committed HEAD is what step 4's clean-slate reset restores to.
- **Genuine fan-out (3+ parallel pieces on disjoint files)**: author a Workflow script. Implementation `agent()` calls pass `model: 'sonnet'` and `isolation: 'worktree'` (parallel workers must not share a tree); any judgment stage inside the script omits the model override so it inherits Fable. Invoking this skill is the user's opt-in to the Workflow tool. Isolated worktrees are auto-cleaned when unchanged, so each fan-out worker's spec must additionally instruct it to **commit its changes on the exact branch named in its spec** — `cc/fable-orchestrate/<short-task-name>/worker-<n>-r<round>`, where you assign a fresh `-r<round>` suffix per dispatch attempt (`-r0` initially; each step 4 re-dispatch increments it) so a retry never collides with a failed attempt's existing branch — and **return that branch name** (or explicitly "no changes") in its final message; the script surfaces the branch names back to you for step 5. A worker result without a committed, named branch (and not declared "no changes") is a failed result — re-dispatch under the step 4 cap rather than hunting for its worktree.

Each worker prompt is its spec from step 1, verbatim, plus: it must run its verification command(s) and report the actual output; its final message must state what it changed (files + summary), verification results, and anything it could not do — never silent partial completion.

### 4. Review each result inline — re-dispatch cap of 2

You review every worker result yourself, in the main loop, against its spec: files match scope, acceptance criteria demonstrably met, verification output real and passing, pinned interfaces honored, non-goals untouched. Read the actual diff — never accept a worker's self-report alone.

On failure, the cap is two corrective rounds per piece, and the rounds are not the same move twice:

- **Round 1 — fix the spec, not the worker.** Most worker failures are underspecified specs. Diagnose what the spec failed to say (missing constraint, unstated convention, ambiguous interface), revise the spec with it, and re-dispatch with the revised spec plus what was wrong with the previous attempt.
- **Round 2 — corrective instructions.** Spec was sufficient; the worker missed. Re-dispatch with the specific defects, file:line, and the expected behavior.
- **After round 2 — take the piece over.** Implement it yourself inline in the task worktree. Note the takeover for the final report; never loop a non-converging worker.

**Clean slate before every sequential re-dispatch or takeover.** Fan-out retries get a fresh isolated worktree automatically; sequential retries share the task worktree, so first discard the rejected attempt entirely — half-edits *and* stray files it created — with `git -C <task-worktree> reset --hard HEAD && git -C <task-worktree> clean -fd` (safe because every accepted piece is already committed per step 3, and `-C`-anchored so it can never touch anything outside the task worktree). Every attempt must start from the same base its spec was written against, never on top of a prior rejected attempt's residue.

### 5. Integrate and verify the whole

Integration is your job — the merge proving clean is not the same as the pieces working together, and the final reviewer judges a verified whole rather than discovering integration breaks:

- For fan-out runs, merge each piece's **latest accepted attempt's branch** collected in step 3 (`cc/fable-orchestrate/<short-task-name>/worker-<n>-r<round>`, highest round per piece) into the task branch yourself — `git -C <task-worktree> merge <worker-branch>` — and resolve conflicts (you pinned the interfaces; you own the seams). Stale branches from rejected earlier attempts (including a piece you took over after round 2) are never merged — ignore them, or delete them for hygiene. A worker that returned "no changes" has nothing to merge; skip it without error. Two workers touching the same file despite disjoint specs is a seam defect: resolve the conflict yourself, never re-dispatch it.
- Run the repo's full test suite / verification on the merged result — not just the per-piece commands. Fix integration failures yourself; they are seam defects, which are orchestrator-owned, not worker re-dispatches.

### 6. Binding final review (fresh reviewer — you don't grade your own decomposition)

You wrote the specs, so you are anchored on them. Spawn a **new one-shot** Fable 5 reviewer:

- `subagent_type`: `Plan`, `model`: `fable`, `run_in_background`: `false`
- `prompt`: the original task, **the spec map** — the full decomposition as spec → files → worker result → disposition (accepted / re-dispatched / taken over), so it can review piece-by-piece plus the seams rather than one unreviewable blob — the pinned interfaces, the full merged diff, and the integration verification results. It must return a verdict — **approve**, or **blocked** with numbered blocking findings (each with file:line and a concrete failure scenario) — plus non-blocking suggestions kept separate.

The verdict is **binding**: do not commit while blocking findings stand.

- **Blocked** → fix each finding (or produce evidence it's wrong), re-submit to the same reviewer via SendMessage with the new diff and per-finding dispositions.
- **Deadlock cap**: two full disagreement rounds on one finding → stop, present both positions and the evidence to the user, and let them rule. Never loop past two rounds, never silently drop a blocking finding.
- If the reviewer call fails, retry once; then tell the user the binding review could not run and ask whether to commit unreviewed — never commit silently without it.

### 7. Commit, push, PR

On approval, commit and push the task branch and open one PR per the repo's conventions. The PR body includes an **Orchestration log**: the decomposition (pieces → workers), per-piece disposition (accepted round 0/1/2 or taken over), integration fixes, and the review verdict trail. Footer per convention, naming the session model actually in use:

```
---
Created with LLM: <session model> | high | Harness: Claude Code | fable-orchestrate
```

### 8. Report to the user

Final message: what was built, the decomposition and per-piece dispositions in brief, integration/verification results, the review trail, and the PR URL.

## Notes

- Workers run on Sonnet 5 via `model: 'sonnet'` regardless of defaults; the final reviewer on Fable via `model: fable`. **If a model id is unavailable** (the call errors on it), fall back to the closest available tier, and name the models that actually ran in the footer and report.
- Companion to `fable-advisor`, inverted: there the cheap model executes and Fable advises; here Fable directs and the cheap model executes. Both end with the same fresh-reviewer binding gate — an author never grades its own work.
- Cost shape: Sonnet burns the bulk implementation tokens; Fable spends on decomposition, per-piece review, integration, and takeovers. If takeovers dominate, the task was a poor fit for delegation — say so in the report.
- For issue-based milestone work with Execution blocks, use `milestone-workflow` instead — this skill is for ad-hoc tasks.
