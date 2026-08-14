---
name: validate-issue
description: Use when the user asks to validate, review, or check whether a GitHub issue is valid. Accepts an issue reference or defaults to the latest open issue, verifies every factual claim against current code, assesses non-trivial proposals, scores complexity, and returns a cited update decision.
---

# validate-issue

Validate every current-behavior claim against code. Treat cited roots, lines, fixes, and prior verdicts as claims that need independent proof. Return one decision that covers behavior, cause, evidence, proposal, scope, and fix.

## Input

Accept a full issue URL, `#N`, `N`, or `owner/repo#N`. With no input, resolve the newest open issue in the current repo and state the selected number.

### 0. Establish the default-branch baseline

Do not create a worktree for validation or issue edits. Resolve and refresh the current default branch:

```bash
DEFAULT=$(gh repo view --json defaultBranchRef --jq .defaultBranchRef.name)
git fetch origin "$DEFAULT"
git branch --show-current
git rev-list --left-right --count "origin/$DEFAULT...HEAD"
```

Read working-tree files only at `0 0`, or when `git diff --name-only HEAD "origin/$DEFAULT"` excludes every inspected path. Otherwise use `git show "origin/$DEFAULT":<path>`. State the baseline in the verdict.

### 1. Fetch the issue and linked pull requests

Always fetch the body and comments with `gh issue view <N> --comments`. For omitted input, first resolve `gh issue list --limit 1 --json number --jq '.[0].number'`. Then inspect the issue timeline for cross-referenced pull requests; comment output does not include them:

```bash
gh api "repos/<owner>/<repo>/issues/<N>/timeline" --paginate \
  --jq '.[] | select(.event == "cross-referenced" and .source.issue.pull_request) | .source.issue'
```

Verify merged fixes against current code and recommend closure or reuse. List overlapping open work under Concerns.

### 2. Extract claims and proposal assertions

List each concrete current-behavior claim, including named causes, citations, sets, negatives, and benefit premises. Separately extract proposal goals, lifetime, population timing, benefits, consumers, failure policy, deployment surface, and touched sites. Run steps 5a and 5b for a new subsystem, shared state, cross-cutting refactor, deduplication, single source of truth, multi-consumer coordination, or infrastructure analogy.

### 3. Verify every claim

Trace each scenario through its conditions and configuration. Apply every triggered depth rule:

1. **Named wrapper/helper:** read its body and delegated or short-circuit paths.
2. **Set claim:** find real call sites, establish membership, and diff the claimed set.
3. **Benefit claim:** prove the broken baseline still exists with code, comments, and relevant history.
4. **Conjunction or negative:** split atomic assertions and prove absence across all paths.
5. **Negative over a window:** trace the complete event-to-boundary dispatch and every possible producer.
6. **Superlative, method-over-set, or cited baseline:** establish the full population, actual tool coverage, and source history.
7. **Aggregate, dedupe, prorate, or shared state:** verify its partition boundary and key against the proposed scope.
8. **Missing, undocumented, or unhandled surface:** read surrounding content, find stale old copy, and diff the deliverable file list.

Evidence outranks every verdict. Reconcile evidence across all bullets and your own paired findings before finalizing.

### 4. Mark each claim

Use ✅ Verified, ❌ Refuted, ⚠️ Conditional, or ❓ Unverified. Cite `file:line` for each located path, name conditions, and retain every unresolved claim.

### 5. Assess the proposal

Lead Proposal with a ≤55-word ASD-STE100 Goal that states the outcome. Assess claims before design; a refuted premise can make the proposal unnecessary.

#### 5a. Architecture

For every non-trivial proposal identified in step 2, read [architecture.md](architecture.md) completely and apply it after claim tracing.

#### 5b. Self-consistency

Whenever step 5a runs, also read [proposal-consistency.md](proposal-consistency.md) completely and apply it to the issue text.

#### 5c. General checks

Use `git log --since=7.days` on touched paths. Check locking, migrations, reloads, idempotency, failure blast radius, parallel live/offline/admin paths, dual implementations, and regression of recent work. Put each material finding under Concerns with `file:line`; any safety, recent-work, or parity defect makes the issue require an update.

### 6. Score complexity

Read [complexity-scoring.md](complexity-scoring.md) completely on every validation. Derive axes from the traced edit and test list. The canonical formula is:

1. Capability maps `max(Risk, Uncertainty)` as `0–1 → 0`, `2 → 1`, `3 → 2`, `4 → 3`. If **Coupling ≥ 3**, use at least Capability 2.
2. Volume is `(Scope + Coupling + Verification) × 2`.
3. Score is `25 × Capability + Volume` (0–99 under current axis bounds).

| Band | Score band | Validate | fableplan first | Build | First review |
|---|---|---|---|---|---|
| 0 | 0–9 | Opus 5 · medium | No | Sonnet 5 · high | `@claude` (standard trigger, no pinned model) |
| 1 | 10–20 | Opus 5 · high | No | Sonnet 5 · xhigh | `@claude` (standard trigger, no pinned model) |
| 2 | 21–40 | Opus 5 · high | No | Opus 5 · high | Opus 5 · high |
| 3 | 41–60 | Opus 5 · xhigh | No | Opus 5 · xhigh | Opus 5 · high |
| 4 | 61–80 | Fable 5 · medium | **Yes** | Opus 5 · high | Opus 5 · high |
| 5 | 81–99 | Fable 5 · high | **Yes** | Opus 5 · xhigh | Fable 5 · high |

The fableplan signal is yes when the score is 61 or higher. It is no below 61.

Report only `N/100 — Capability <k> (<driver>); Volume <v> · fableplan: <yes|no>` plus the traced edit list.

### 7. Decide scope disposition

A high score alone is acceptable. Narrow speculative scope whenever needed. Split and Umbrella candidates must pass all three gates:

1. Each part can ship, pass tests, and deliver value in its own pull request.
2. Fold each part below C41 into the parent. At least two remaining parts must each score C41 or higher. Any folded part forces Umbrella. If fewer than two remain, keep one issue; emit `OK — restructure as in-body checklist` and require an update when its body lacks that checklist.
3. The combined diff is roughly above 500 changed lines, the parts route to different score bands, or one part has money, data-integrity, or security risk.

Keep one issue when any gate fails or one root cause requires one diff. Use **Split** for independent parts with no folded work and **Umbrella** for coordinated parts or any folded work. **Narrow** remains available regardless of these gates; cut to the core and move optional work to a Future note. Every proposed child needs its own scored title, problem, and acceptance criteria. Scope and description-update decisions remain independent.

### 8. Output the verdict

Use this structure and omit empty optional sections:

```text
Claims:
- <status> <claim> — <evidence>
Architecture:                         # only when 5a ran
- <status> <placement/owner/medium> (<dispatch file:line>)
- Optimal: <required for ⚠️/❌>
Concerns:                             # only when present
- <concern> (<file:line>)
Proposal:
- Goal: <plain simple English, ≤55 words>
- <status> <consistency gap>          # only when 5b is not ✅
Scope:                                # only when too large or checklist restructure applies
- <disposition> — <reason and parts>
**#<N>: Update issue description? <Yes | No>** · Complexity: <score>/100 — Capability <k> (<driver>); Volume <v> · fableplan: <yes|no> · Scope: <OK | too large — split/umbrella/narrow>
<specific edits when Yes>
→ Reply "work on issue" to proceed, "update issue" to edit, "fableplan" when offered, or "split issue" when flagged.
```

Set Yes for a material ❌/⚠️ claim, architecture or consistency gap, material concern, missing scope, or required checklist restructure. Set No only when the issue is accurate, feasible, consistent, complete, and ready. Always offer `fableplan` when its signal is yes; if the user chooses work first, ask once whether to plan or build directly.

### 9. Handle "work on issue"

Invoke `work-on-issue` with the issue number. It owns worktree creation through the open closing pull request. Surface any step-7 scope disposition before handoff.

### 10. Handle "fableplan"

Invoke `fableplan` with the issue number. It owns planning, posting the issue comment, and asking whether to build. Honor an explicit request even when the signal is no.

### 11. Handle "update issue"

Read [issue-editing.md](issue-editing.md) completely, then apply its verified title/body procedure from the current checkout without a worktree.

## Red flags

| Situation | Action |
|---|---|
| Named function does not exist | Mark ❌ and name the actual symbol if found. |
| Claim holds for one configuration | Mark ⚠️ and name that configuration. |
| Author owns the repo | Verify every claim independently. |
| Code changed recently | Inspect relevant history. |
| Claim depends on runtime cycles | Trace the state machine. |
| Code contradicts issue prose | Trust the code. |
| Shared/global/central state has no owner | Require step 5a ownership details. |
| Cross-cutting proposal has verified claims | Still run steps 5a and 5b. |
