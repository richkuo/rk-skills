---
name: fable-orchestrate
description: Use when the user wants a task decomposed and driven by a Fable 5.1 orchestrator delegating implementation to Sonnet 5 workers. Fable decomposes into self-contained specs, dispatches Sonnet workers (Agents for 1–2 pieces, a Workflow for fan-out), reviews each result, merges into one branch, and takes a binding verdict from a fresh Fable reviewer. Trigger on "/fable-orchestrate", "fable-orchestrate <task>", or "orchestrate this with fable".
---

# fable-orchestrate

Run an ad-hoc task with **Fable 5.1 as orchestrator** and **Sonnet 5 workers**. You own decomposition, specs, every accept/reject decision, integration, and the PR; workers own only the mechanical implementation of their piece. Issue-based milestone work with Execution blocks uses `milestone-workflow`.

**Input:** a task description in prose; if none is obvious, ask what to orchestrate.

**Model check:** if the session model is not Fable 5.1, tell the user and ask whether to switch (`/model fable`) or proceed with the current model as orchestrator.

## Steps

### 1. Decompose, biased against fan-out

Read the relevant code first, then split:

- **Fewer, larger, sequential pieces by default.** Parallelize only when pieces touch disjoint files. One worker doing the whole task is valid.
- **Pin every interface between pieces upfront** (signature, schema, event shape, route contract). Workers never invent their side of a seam.
- **Each spec is self-contained** for a worker with zero context: scope, exact files, acceptance criteria, non-goals, pinned interfaces, relevant repo conventions, and the exact verification command(s) the worker must run and pass before returning.

Present the decomposition briefly, then proceed; pause only for a decision only the user can make.

### 2. Set up the task worktree

Create the worktree per `work-on-issue` step 1, named `cc/fable-orchestrate/<short-task-name>`, with no `baseRefs` and with the user's `targetBranch` when one was named. Everything lands on this one branch; one PR is the deliverable regardless of worker count.

### 3. Dispatch workers

| Shape | Dispatch |
|---|---|
| 1–2 sequential pieces | Agent calls, `subagent_type: general-purpose`, `model: sonnet`, `run_in_background: false` when the next piece depends on it. Workers build in the task worktree (path stated in the spec). **Commit each accepted piece before dispatching the next**; step 4's reset restores to committed HEAD. |
| Fan-out (3+ parallel pieces, disjoint files) | A Workflow script (invoking this skill is the user's opt-in). Implementation `agent()` calls pass `model: 'sonnet'` and `isolation: 'worktree'`; judgment stages omit the model override to inherit Fable. Isolated worktrees are auto-cleaned when unchanged, so each spec instructs the worker to **commit on the branch** `cc/fable-orchestrate/<short-task-name>/worker-<n>-r<round>` (`-r0` first; each step 4 re-dispatch increments it) and **return that branch name** or an explicit "no changes". A result with neither has failed; re-dispatch under the step 4 cap. |

Each worker prompt is its spec verbatim, plus: run the verification command(s) and report actual output; the final message states what changed, verification results, and anything it could not do. If the `sonnet` id errors, use the closest available tier and name it in the footer and report.

### 4. Review each result inline, re-dispatch cap of 2

Review every result against its spec: files in scope, acceptance criteria met, verification output real and passing, pinned interfaces honored, non-goals untouched. Read the diff; never accept a self-report alone.

On failure, two corrective rounds per piece, each a different move:

- **Round 1: fix the spec.** Diagnose what the spec failed to say, revise it, re-dispatch with the revised spec plus what was wrong before.
- **Round 2: corrective instructions.** The spec sufficed; the worker missed. Re-dispatch with the specific defects, file:line, and expected behavior.
- **After round 2: take the piece over** yourself in the task worktree and note it for the report.

**Clean slate before every sequential re-dispatch or takeover:** `git -C <task-worktree> reset --hard HEAD && git -C <task-worktree> clean -fdx` (safe because accepted pieces are committed; `-x` removes installed dependencies, so re-run the install step if the retry's verification needs it). Fan-out retries get a fresh isolated worktree automatically.

### 5. Integrate and verify the whole

- Fan-out: merge each piece's **latest accepted attempt's branch** into the task branch with `git -C <task-worktree> merge <worker-branch>` and resolve conflicts yourself. Never merge branches from rejected attempts or from a piece you took over; a "no changes" worker has nothing to merge. Two workers touching the same file despite disjoint specs is a seam defect: resolve it yourself, never re-dispatch it.
- Run the repo's full verification on the merged result and fix integration failures yourself.

### 6. Binding final review by a fresh reviewer

**Load the `fable-dispatch` skill first**; it owns the dispatch path and the hygiene rules in its section 7. Spawn a **new one-shot** Fable 5.1 reviewer (Agent path: `subagent_type: Plan`, `model: fable`, `run_in_background: false`) with the original task, **the spec map** (spec, files, worker result, disposition: accepted / re-dispatched / taken over), the pinned interfaces, the full merged diff, the integration verification results, and the read-only rule. It returns **approve**, or **blocked** with numbered findings (file:line and a concrete failure scenario), non-blocking suggestions kept separate.

The verdict is **binding**: nothing commits while blocking findings stand. Fix each finding (or produce evidence it is wrong) and re-submit to the same reviewer via SendMessage with the new diff and per-finding dispositions. The deadlock cap and the reviewer-failure rule are owned by `fable-advisor` step 7 and apply unchanged.

### 7. Commit, push, PR

On approval, commit, push, and open one PR per the repo's conventions. The PR body carries an **Orchestration log**: decomposition (pieces to workers), per-piece disposition (accepted round 0/1/2 or taken over), integration fixes, and the verdict trail. If takeovers dominate, say the task was a poor fit for delegation. Footer per convention, with `<harness>` per `fable-dispatch` section 6:

```
---
Created with LLM: <session model> | high | Harness: <harness> | fable-orchestrate
```

### 8. Report

What was built, per-piece dispositions, verification results, the review trail, and the PR URL.
