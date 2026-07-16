---
name: fable-advisor
description: Use when the user wants a task executed by the current session model (typically Sonnet 5) with a persistent Fable 5 advisor overseeing it. Spawns a long-lived read-only Fable 5 subagent that authors the plan, gets consulted at fixed checkpoints via SendMessage, and a separate fresh Fable 5 reviewer that issues a binding pre-commit verdict. When a GitHub issue is referenced, gate-checks it and runs work-on-issue's build-and-ship pipeline under the advisor, posting the plan and the review verdict as issue comments; issue-less prose tasks take a lighter standalone path. Trigger on "/fable-advisor", "fable-advisor <task>", or "execute this with a fable advisor".
---

# fable-advisor

Execute a task in the main agent (the **executor**) with a persistent **Fable 5 advisor** subagent overseeing it. The advisor plans and advises; the executor builds. A **separate fresh Fable 5 reviewer** — never the advisor — issues the binding pre-commit verdict, so the plan's author never grades its own implementation.

When the task is a **GitHub issue**, the executor runs `work-on-issue`'s build-and-ship pipeline (gates, worktree, red → green verification, staging discipline, PR conventions, guardrail table) with the advisor and reviewer layered around it — `work-on-issue` stays the single source of truth for that pipeline, so any future hardening of it applies here too. **Issue-less prose tasks** take a lighter standalone path.

## Input

The user provides a task description, and optionally a GitHub issue:
- A task in prose ("fable-advisor migrate X to Y").
- A GitHub issue reference — full URL, `#<N>`, bare `<N>`, or `owner/repo#N`. When present, the plan and the final review verdict are also posted as issue comments.
- If neither is obvious from the invocation or the conversation, ask what to execute before dispatching.

## Model check

This skill assumes the session model is NOT Fable 5 — the point is cheap execution with expensive judgment. If you (the main agent) are already running on Fable 5, tell the user the advisor would be redundant and ask whether to proceed anyway, run the task directly, or switch the session to Sonnet first (`/model sonnet`).

## Steps

Steps 1–4 are shared. **Step 5 forks**: an **issue path** that delegates the whole build-and-ship pipeline to `work-on-issue`, and a lighter **prose path** for issue-less tasks. Steps 6 (checkpoint consults) and 7 (binding review) define the advisor mechanics both paths use; steps 8–10 close out. `work-on-issue` stays the single source of truth for the pipeline — the issue path loads and executes it rather than copying its text here.

### 1. Resolve the GitHub issue (only if one is referenced)

If the user named an issue, fetch it so the advisor plans against the real requirements, not a paraphrase:

```
gh issue view <N> --json number,title,body,url
```

For the `owner/repo#N` form (or a full URL to another repo), add `-R owner/repo` — a bare `gh issue view <N>` only resolves against the current repo. If the command fails (wrong number, no auth, no repo), stop and tell the user — never proceed against a paraphrase of an issue you couldn't fetch.

Record the issue number and URL — steps 2, 4, 8, and 9 need them. If no issue is referenced, skip this and every later issue-specific step (2, 4, 9) and take the prose path at step 5.

### 2. Gate-check the issue before planning (only if one was resolved in step 1)

Run `work-on-issue`'s step 0 gates now — **before** spawning the advisor — so a closed or already-addressed issue stops the run before you pay for a Fable plan plus a build (`skills/work-on-issue/SKILL.md`, step 0). Fetch the comment thread and any open PR that references the issue:

```
gh issue view <N> --comments
gh pr list --state open --search "#<N> in:title,body"
```

Add `-R owner/repo` for a cross-repo issue. Two gates, checked while no worktree or code exists yet:

- **The issue must still be open.** If it's closed, stop and report — never plan against a resolved issue.
- **No existing PR may already address it.** Inspect any hit: a PR that merely mentions `#<N>` doesn't count, one that fixes it does. If a genuine PR exists, surface it and stop (or continue on it if it's this session's own branch).

If no issue was resolved in step 1, skip this step.

### 3. Spawn the advisor and get the plan

Do not plan the task yourself — the advisor owns the plan. Call the Agent tool with:

- `subagent_type`: `Plan` (read-only — no Edit/Write; it advises, it never touches files)
- `model`: `fable`
- `run_in_background`: `false` — the plan gates everything downstream
- `description`: `Advise on <short task name>`
- `prompt`: Brief it as a standing advisor, not a one-shot planner. Include: the full task description, the issue title/body if one was fetched in step 1, the working directory, any constraints the user stated, and its charter:
  - First deliverable: a concrete, ordered implementation plan (files to create/modify, approach, build sequence, risks/edge cases, verification steps). Plan the absolute-best solution — cost, effort, time, and token spend never narrow the option space; only correctness and safety override "best".
  - It will be consulted again mid-task via follow-up messages. Each consult reply must be structured as: **recommendation**, **rationale**, **confidence** (high/medium/low), and a flag — **advisory** (executor may overrule with a stated reason) or **blocking** (must be resolved before commit).
  - It is read-only — it must NOT make code edits, including via Bash (no writing/modifying files, no commits). It still has Bash, so state this explicitly.

Record the agent's ID/name — every later consult goes to this same agent via SendMessage so it accumulates the full task history. If the call returns null or errors, retry once; if it fails again, report the failure to the user instead of proceeding unadvised.

Save the plan verbatim to a scratchpad file immediately, so it survives context summarization during a long build and step 4 can post it exactly as produced.

Sanity-check the plan's load-bearing claims against the actual code (files exist, symbols are real, no CLAUDE.md conflicts). Fix small inaccuracies yourself, note them to the user, and update the scratchpad file to match; if the plan is structurally wrong, send the advisor one correction round with the evidence — if the revised plan is still broken, stop and tell the user rather than looping.

Present the vetted plan to the user, then proceed to build without waiting for approval unless the plan reveals a decision only the user can make.

### 4. Post the plan to the GitHub issue (only if one was resolved in step 1)

Post the vetted plan as an issue comment before building, so it's preserved on the issue regardless of how the build goes. Use the scratchpad file (with any sanity-check corrections) as the body-file base — it avoids shell-escaping problems with Markdown:

```
gh issue comment <N> --body-file <tmpfile>
```

Add `-R owner/repo` when the issue lives in another repo. Prefix the body with the heading `## Implementation plan (Fable 5 advisor)` and end it with:

```
---
Created with LLM: Fable 5 | high | Harness: Claude Code | fable-advisor
```

Give the user the comment URL `gh` returns. Follow the repo's CLAUDE.md conventions for comment formatting if any apply.

### 5. Build and ship — pick the path

**Issue path (an issue was resolved in step 1) — delegate to `work-on-issue`.**

Load `skills/work-on-issue/SKILL.md` and execute its **steps 1–6** as the authoritative build-and-ship procedure — worktree `cc/issue-<N>-<slug>`, implement, verify, commit/push, and a PR that includes `Closes #<N>` (fully-qualified `Closes owner/repo#N` cross-repo). Its **step 0 gates already ran in step 2** above; its **step 7 report is replaced** by this skill's steps 9–10. Do not duplicate its pipeline text here. Layer in three injections, each located against work-on-issue's own step numbers:

- **Plan authorship — work-on-issue step 2.** The advisor's vetted plan from step 3 replaces the executor's own planning: build per the plan, and route deviations through the checkpoint protocol (step 6) rather than silently re-planning.
- **Checkpoint consults — throughout work-on-issue step 3.** The advisor consult triggers defined in step 6 stay active for the whole implementation — consult on a hard-to-reverse decision, a stuck signal, or a plan deviation exactly as step 6 specifies.
- **Binding pre-commit review — between work-on-issue step 4 and step 5.** After work-on-issue's verify (its step 4) and before it stages or commits (its step 5), run the fresh Fable 5 reviewer gate from step 7 here, including its two-round deadlock cap. Nothing commits while blocking findings stand.

Preserve fable-advisor's own surfaces on this path: the plan comment (step 4) and the verdict comment (step 9) on the issue, and the **Advisor log** section plus the `| fable-advisor` footer tag in the commit/PR (step 8). work-on-issue's guardrail table applies in full. Do **not** add work-on-issue's orchestration-only `baseRefs` input form to this skill's input contract.

**Prose path (no issue) — lighter standalone flow.**

For an issue-less prose task, build and ship directly:

1. **Isolated worktree.** Never build in the user's checkout. Run `git fetch origin <default-branch>` first — the staleness check below compares against the local `origin/<default-branch>` ref, so skipping the fetch makes the check pass on two equally stale copies — then create a fresh worktree/branch off `origin/<default>` named `cc/fable-advisor/<short-task-name>` (via `EnterWorktree`, name passed verbatim; verify the worktree HEAD matches `origin/<default>` with `git -C <worktree-path> rev-parse HEAD origin/<default-branch>`; if the SHAs differ on the worktree you just created, move it onto the fetched default with `git -C <worktree-path> reset --hard origin/<default-branch>` — safe only because the brand-new branch carries no commits, and always anchored with `-C <worktree-path>` so it can never touch the original checkout). If the directory isn't a git repo, ask the user how to proceed. All later prose-path work happens inside the worktree.
2. **Build** per the plan, consulting the advisor at the step 6 checkpoints.
3. **Verify** — run the repo's tests/verification relevant to the change and confirm the task's acceptance criteria are met. For a bug fix, prove the regression test is real (**red → green**): run the new test against the unfixed code first and watch it fail — a test that never failed proves nothing. Do not request the binding review on a build you haven't verified yourself; the reviewer judges correctness, it is not your test runner.
4. **Binding pre-commit review** — the step 7 gate. Nothing commits while blocking findings stand.
5. **Commit, push, PR.** On approval, **review `git status` before staging** — if it shows anything unrelated to the change, don't `git add -A`; stage the intended files by name and leave strays out — then commit and push from the worktree branch and open a PR. Match the repo's PR-title convention; the body carries the **Advisor log** and the footer per step 8. **Never trigger an `@claude` review yourself** — the skill ends with the open PR.

### 6. Consult the advisor at fixed checkpoints

On the **issue path** these checkpoints run throughout work-on-issue step 3; on the **prose path** they run during the step 5 build. Either way, the executor (you) builds per the plan, working uninterrupted between checkpoints. Consult the advisor — SendMessage to the step-3 agent, never a new Agent call — only when a checkpoint fires:

- **Hard-to-reverse decision**: any architecture, schema, API-contract, or data-migration choice not already settled by the plan.
- **Stuck (signal-based, not self-assessed)**: the same test is still failing after two distinct fix attempts, or the same error message has appeared verbatim twice. Do not wait until you "feel" stuck — the signals are the trigger.
- **Plan deviation**: the plan turns out to be wrong or incomplete in a way that changes the approach (not mere detail-filling).

Each consult message must carry: the specific question, the current diff (or the relevant excerpt), and what you already tried. Handle the reply by its flag:

- **advisory** — follow it, or overrule it with a one-line stated reason recorded for the final report.
- **blocking** — resolve it before the pre-commit review; an unresolved blocking consult finding fails step 7 automatically.

Between checkpoints, do not consult — the advisor is for judgment calls, not pair programming.

### 7. Binding pre-commit review (fresh reviewer, never the advisor)

On the **issue path** this runs between work-on-issue step 4 (verify) and step 5 (commit); on the **prose path** it runs after the step 5 verify. Spawn a **new one-shot** Fable 5 reviewer — fresh context so it isn't anchored on the plan it would otherwise have authored:

- `subagent_type`: `Plan`, `model`: `fable`, `run_in_background`: `false`
- `prompt`: the original task, the final plan (including approved deviations and any overruled advisory findings with their reasons), the full diff, the verification results, and instructions to review for correctness, safety, and plan conformance. It must return a verdict — **approve**, or **blocked** with a numbered list of blocking findings (each with file:line and a concrete failure scenario) — plus any non-blocking suggestions kept separate.

The verdict is **binding**: do not commit while blocking findings stand.

- **Blocked** → fix each finding (or produce evidence it's wrong), then re-submit to the same reviewer via SendMessage with the new diff and per-finding dispositions.
- **Deadlock cap**: if the reviewer rejects the same finding's resolution twice — two full disagreement rounds on one finding — stop, present both positions and the evidence to the user, and let them rule. Never loop past two rounds and never silently drop a blocking finding.
- If the reviewer call fails, retry once; if it fails again, tell the user the binding review could not run and ask whether to commit unreviewed — never commit silently without it.

### 8. Commit and PR markers — Advisor log and footer

Whichever path built the change, its commit and PR carry fable-advisor's markers. On the **issue path** apply them inside work-on-issue's steps 5–6 (its commit message and PR body); on the **prose path** apply them in that path's commit/PR step (step 5, item 5).

- **Advisor log** in the PR body: the plan source, each checkpoint consult (question → recommendation → disposition), any overruled advisory findings, and the review verdict trail.
- When an issue was resolved in step 1, the PR body includes `Closes #<N>` (fully-qualified `Closes owner/repo#N` for cross-repo issues) so merging resolves it.
- **Footer** naming the executor model actually in use, with the `| fable-advisor` tag:

```
---
Created with LLM: <executor model> | high | Harness: Claude Code | fable-advisor
```

### 9. Post the review verdict to the GitHub issue (only if one was resolved in step 1)

After the PR is open, post a short closing comment on the issue recording the binding-review outcome: the final verdict (approve, or approve-after-fixes with the finding count), any deadlocks the user ruled on, and the PR URL. Use `gh issue comment <N> --body-file <tmpfile>` (with `-R owner/repo` for cross-repo issues), heading `## Review verdict (Fable 5 reviewer)`, ending with:

```
---
Validated with LLM: Fable 5 | high | Harness: Claude Code | fable-advisor
```

### 10. Report to the user

Final message: what was built, verification results, the consult/review trail in brief, the PR URL, and the issue comment URLs when an issue was involved.

## Notes

- The advisor and reviewer run on Fable 5 regardless of the session model — `model: fable` forces it. **If `fable` is unavailable** (the Agent call errors on the model id), fall back to the most capable model available, name the model that actually ran in the footer and report, never "Fable 5".
- The advisor persists for the whole task; the reviewer is fresh by design. Never merge the two roles — anchoring is the failure mode this split exists to prevent.
- If SendMessage to the advisor fails because the agent is gone (context expired, session summarized), spawn a replacement advisor with the plan and a recap of consults so far, and tell the user the advisor was restarted.
- Cost shape: the executor burns the bulk tokens; Fable fires only on the plan, checkpoint consults, and the review.
- If the user did not reference an issue, never invent one or post anywhere — just plan, build, review, and open the PR.
