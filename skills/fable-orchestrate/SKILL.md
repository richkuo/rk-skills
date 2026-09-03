---
name: fable-orchestrate
description: Use when the user wants a task decomposed and driven by a Fable 5.1 orchestrator delegating implementation to Sonnet 5 workers. Fable decomposes into self-contained specs, dispatches Sonnet workers (Agents for 1–2 pieces, a Workflow for fan-out), reviews each result, merges into one branch, and takes a binding verdict from a fresh Fable reviewer. Trigger on "/fable-orchestrate", "fable-orchestrate <task>", or "orchestrate this with fable".
---

# fable-orchestrate

Run an ad-hoc task with **Fable 5.1 as orchestrator** and **Sonnet 5 workers**. You own decomposition, specs, every accept/reject decision, integration, and the PR; workers own only the mechanical implementation of their piece. For issue-based milestone work with Execution blocks, use `milestone-workflow` instead.

## Input

A task description in prose. If none is obvious from the invocation or conversation, ask what to orchestrate before decomposing.

## Model check

This skill assumes the session model is Fable 5.1. If it is not, tell the user and ask whether to switch (`/model fable`) or proceed with the current model as orchestrator.

## Steps

### 1. Decompose, biased against fan-out

Read the relevant code first, then split the task. A bad split wastes everything downstream, so:

- **Default to fewer, larger, sequential pieces.** Parallelize only when pieces touch disjoint files. One worker doing the whole task is a valid decomposition.
- **Pin the interfaces between pieces upfront.** Where two pieces meet (signature, schema, event shape, route contract), the spec states the exact interface both sides build against. Workers never invent their side of a seam.
- **Each spec is fully self-contained.** Workers arrive with zero context. A spec carries: scope, exact files to create/modify, acceptance criteria, explicit non-goals, the pinned interfaces it touches, relevant repo conventions (CLAUDE.md constraints, package manager, style), and the exact verification command(s) the worker must run and pass before returning.

Present the decomposition briefly, then proceed; pause only for a decision only the user can make.

### 2. Set up the task worktree

Create the worktree per `work-on-issue` step 1, named `cc/fable-orchestrate/<short-task-name>`, with no `baseRefs` and with the user's `targetBranch` when one was named; the single PR opens against that target. Everything lands on this one branch; a single PR is the deliverable regardless of worker count.

### 3. Dispatch workers

- **1–2 sequential pieces**: plain Agent calls with `subagent_type: general-purpose`, `model: sonnet`, `run_in_background: false` when the next piece depends on it. Sequential workers build in the task worktree (state its path in the spec). **Commit each accepted piece before dispatching the next**: step 4's clean-slate reset restores to the committed HEAD.
- **Genuine fan-out (3+ parallel pieces on disjoint files)**: author a Workflow script. Implementation `agent()` calls pass `model: 'sonnet'` and `isolation: 'worktree'`; any judgment stage omits the model override so it inherits Fable. Invoking this skill is the user's opt-in to the Workflow tool. Isolated worktrees are auto-cleaned when unchanged, so each fan-out spec must instruct the worker to **commit on the exact branch named in its spec**, `cc/fable-orchestrate/<short-task-name>/worker-<n>-r<round>` (`-r0` initially; each step 4 re-dispatch increments it so a retry never collides with a failed attempt's branch), and **return that branch name** (or explicitly "no changes") in its final message. A result with neither a committed, named branch nor a "no changes" declaration has failed; re-dispatch under the step 4 cap.

Each worker prompt is its spec verbatim, plus: run the verification command(s) and report the actual output; the final message states what changed, verification results, and anything it could not do.

If the `sonnet` id errors, use the closest available tier for workers and name it in the footer and report.

### 4. Review each result inline, re-dispatch cap of 2

Review every result yourself against its spec: files match scope, acceptance criteria met, verification output real and passing, pinned interfaces honored, non-goals untouched. Read the diff; never accept a self-report alone.

On failure, two corrective rounds per piece, each a different move:

- **Round 1: fix the spec.** Diagnose what the spec failed to say (missing constraint, unstated convention, ambiguous interface), revise it, and re-dispatch with the revised spec plus what was wrong with the previous attempt.
- **Round 2: corrective instructions.** The spec was sufficient; the worker missed. Re-dispatch with the specific defects, file:line, and the expected behavior.
- **After round 2: take the piece over.** Implement it yourself in the task worktree and note the takeover for the report.

**Clean slate before every sequential re-dispatch or takeover.** Fan-out retries get a fresh isolated worktree automatically. Sequential retries share the task worktree, so first discard the rejected attempt, including gitignored residue, with `git -C <task-worktree> reset --hard HEAD && git -C <task-worktree> clean -fdx` (safe because every accepted piece is committed per step 3; `-x` also removes installed dependencies, so re-run the repo's install step if the retry's verification needs one). Every attempt starts from the base its spec was written against.

### 5. Integrate and verify the whole

Integration is your job; the final reviewer judges a verified whole:

- For fan-out runs, merge each piece's **latest accepted attempt's branch** (highest round per piece) into the task branch with `git -C <task-worktree> merge <worker-branch>` and resolve conflicts yourself. Never merge stale branches from rejected attempts or from a piece you took over. A "no changes" worker has nothing to merge. Two workers touching the same file despite disjoint specs is a seam defect: resolve it yourself, never re-dispatch it.
- Run the repo's full verification on the merged result and fix integration failures yourself; seams are orchestrator-owned.

### 6. Binding final review by a fresh reviewer

You wrote the specs, so you do not grade your own decomposition. **Load the `fable-dispatch` skill before dispatching the reviewer**; it owns the dispatch path and the dispatch-hygiene rules in its section 7. Spawn a **new one-shot** Fable 5.1 reviewer; on the Agent-tool path use `subagent_type: Plan`, `model: fable`, `run_in_background: false`. The prompt carries the original task, **the spec map** (spec → files → worker result → disposition: accepted / re-dispatched / taken over), the pinned interfaces, the full merged diff, the integration verification results, and the read-only rule. It returns **approve**, or **blocked** with numbered blocking findings (each with file:line and a concrete failure scenario), with non-blocking suggestions kept separate.

The verdict is **binding**: nothing commits while blocking findings stand. Fix each finding (or produce evidence it is wrong) and re-submit to the same reviewer via SendMessage with the new diff and per-finding dispositions. The two-round deadlock cap and the reviewer-failure rule (retry once, then ask before committing unreviewed) are owned by `fable-advisor` step 7 and apply here unchanged.

### 7. Commit, push, PR

On approval, commit and push the task branch and open one PR per the repo's conventions. The PR body includes an **Orchestration log**: the decomposition (pieces → workers), per-piece disposition (accepted round 0/1/2 or taken over), integration fixes, and the review verdict trail. If takeovers dominate, say the task was a poor fit for delegation. Footer per convention, naming the session model and the harness actually in use (`<harness>` per `fable-dispatch` section 6):

```
---
Created with LLM: <session model> | high | Harness: <harness> | fable-orchestrate
```

### 8. Report to the user

What was built, per-piece dispositions, verification results, the review trail, and the PR URL.
