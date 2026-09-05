---
name: validate-issue
description: Use when the user asks to validate, review, or check a GitHub issue against the code. Returns a cited update decision with a complexity score.
---

# validate-issue

Validate every current-behavior claim against code. Input: a full issue URL, `#N`, `N`, or `owner/repo#N`; with none, take the newest open issue and state its number. The orchestration form `{ issue: <N>, targetBranch?: "<branch>" }` (or a prose "target branch <name>") names the branch the fix will merge into; it replaces the default branch as the baseline in step 0.

### 0. Baseline branch

No worktree for validation or issue edits. Resolve `DEFAULT=$(gh repo view --json defaultBranchRef --jq .defaultBranchRef.name)`; with a `targetBranch`, validate it per `work-on-issue` step 1 ("Target") and set `DEFAULT` to it instead, naming it as the target in the verdict. Run `git fetch origin "$DEFAULT"`, and state `git rev-parse --short "origin/$DEFAULT"` as the baseline in the verdict. Read a working-tree path only when it is tracked and `git diff --quiet "origin/$DEFAULT" -- <path>` exits 0; otherwise read `git show "origin/$DEFAULT":<path>`.

### 1. Fetch the issue and linked PRs

Run `gh issue view <N> --comments`, then list the cross-referenced PRs that comments omit (`owner/repo#N` input names the repo):

```sh
gh api --paginate repos/{owner}/{repo}/issues/<N>/timeline --jq '.[] | select(.event=="cross-referenced") | .source.issue | select(.pull_request) | "\(.number) \(.state)"'
```

Verify a merged fix against current code and recommend closure or reuse; list open overlapping PRs under Concerns.

### 2. Extract claims and assertions

List each current-behavior claim (causes, citations, sets, negatives, benefit premises) and proposal assertion (goals, lifetime, population timing, benefits, consumers, failure policy, deployment surface, touched sites). Steps 5a and 5b run for a new subsystem, shared state, cross-cutting refactor, deduplication, single source of truth, multi-consumer coordination, or infrastructure analogy.

### 3. Verify claims

Trace each scenario through its conditions and config. When code contradicts prose, trust the code. Verify independently even for the repo owner, recent code, or runtime state machines. Apply every triggered depth rule:

1. Named wrapper or helper: read its body and delegated or short-circuit paths.
2. Set claim: find real call sites, establish membership, diff the claimed set.
3. Benefit claim: prove the broken baseline exists in code, comments, or history.
4. Conjunction or negative: split atomic assertions; prove absence on all paths.
5. Negative over a window: trace the event-to-boundary dispatch and every producer.
6. Superlative, method-over-set, or cited baseline: establish population, tool coverage, source history.
7. Aggregate, dedupe, prorate, or shared state: verify the partition boundary and key against the scope.
8. Missing, undocumented, or unhandled surface: read surrounding content, find stale copy, diff deliverables.

Evidence outranks every verdict; reconcile it across bullets and paired findings.

### 4. Mark claims

Mark ✅ Verified, ❌ Refuted (name the real symbol), ⚠️ Conditional (name the config), or ❓ Unverified. Cite `file:line` and retain every unresolved claim.

### 5. Assess the proposal

Lead Proposal with a ≤55-word ASD-STE100 Goal stating the outcome. A refuted premise can make the proposal unnecessary.

#### 5a. Architecture

For every proposal step 2 flagged, read [architecture.md](architecture.md) completely and apply it after claim tracing.

#### 5b. Self-consistency

Whenever 5a runs, read [proposal-consistency.md](proposal-consistency.md) completely and apply it to the issue text.

#### 5c. General checks

Run `git log --since=7.days` on touched paths. Check locking, migrations, reloads, idempotency, failure blast radius, parallel live/offline/admin paths, dual implementations, and recent-work regression. Material findings go under Concerns with `file:line`; any safety, recent-work, or parity defect requires an update.

### 6. Score complexity

Read [complexity-scoring.md](complexity-scoring.md) completely. Grade every axis against its anchors from the traced edit list and write its `Axes:` line with one piece of evidence per grade before you look up the grade the issue's rationale line states; then compare grade by grade and report all five grades. The canonical formula is:

1. Capability maps `max(Risk, Uncertainty)` as `0–1 → 0`, `2 → 1`, `3 → 2`, `4 → 3`. If **Coupling ≥ 3**, use at least Capability 2.
2. Volume is `(Scope + Coupling + Verification) × 2`.
3. Score is `25 × Capability + Volume`.

| Band | Score | Validate | fableplan | Build |
|---|---|---|---|---|
| 0 | 0–9 | Opus 5 · medium | No | Sonnet 5 · high |
| 1 | 10–20 | Opus 5 · high | No | Sonnet 5 · xhigh |
| 2 | 21–49 | Opus 5 · high | No | Opus 5 · high |
| 3 | 50–70 | Opus 5 · xhigh | No | Opus 5 · xhigh |
| 4 | 71–80 | Fable 5.1 · medium | **Yes** | Opus 5 · xhigh |
| 5 | 81–99 | Fable 5.1 · high | **Yes** | Opus 5 · xhigh |

fableplan is yes when the score is 71 or higher. The Build column is the Claude default; an Execution block that stamps `<Name> (Codex CLI)` or `<Name> (Cursor CLI)` overrides it, and the pipeline runs that build through the `cli-dispatch` shim. The Validate effort column is the band default; an issue's `## Execution` block can stamp a `Validate effort:` line that overrides it, and a `Plan effort:` line that overrides the fableplan stage's `high` default. The validate model is never stampable. An Opus validate stamped `low` or `medium` runs at `high`, because those tiers are Fable-only. The **first review** uses the coarser table below; each row starts on a band edge.

| Score | First review | Claude | Codex |
|---|---|---|---|
| 0–20 | Sonnet 5 · high | `@claude sonnet review` | `@codex luna review` |
| 21–70 | reviewer default | `@claude review` | `@codex review` |
| 71–80 | Opus 5 · high | `@claude opus review effort:high` | `@codex review` |
| 81–99, or no score | Fable 5.1 · high | `@claude fable review effort:high` | `@codex review` |

Blocking re-reviews step down one rung per cycle, keyed to the reviewer that actually ran cycle 1 (`skills/fix-pr-review/rereview-routing.md`).

### 7. Scope disposition

A high score alone is acceptable. Split and Umbrella need all three gates:

1. Each part ships, passes tests, and delivers value in its own PR.
2. Fold each part below C41 into the parent; at least two parts of C41 or higher remain. A folded part forces Umbrella. With fewer than two, keep one issue, emit `OK — restructure as in-body checklist`, and require an update when the body lacks that checklist.
3. The combined diff is roughly above 500 changed lines, parts route to different bands, or a part carries money, data-integrity, or security risk.

Keep one issue when a gate fails or one root cause needs one diff. **Split** = independent parts, none folded. **Umbrella** = coordinated or folded parts. **Narrow** is always available: keep the core, move extras to a Future note. Each child needs its own scored title, problem, and acceptance criteria. Scope and update decisions stay independent.

### 8. Output the verdict

Omit empty optional sections:

```text
Claims:
- <status> <claim> — <evidence>
Architecture:  # only when 5a ran
- <status> <placement/owner/medium> (<dispatch file:line>)
- Optimal: <required for ⚠️/❌>
Concerns:  # only when present
- <concern> (<file:line>)
Proposal:
- Goal: <plain simple English, ≤55 words>
- <status> <consistency gap>  # only when 5b is not ✅
Scope:  # only for a disposition
- <disposition> — <reason and parts>
Axes:
- Scope <s> — <evidence>
- Coupling <c> — <evidence>
- Risk <r> — <evidence>
- Uncertainty <u> — <evidence>
- Verification <x> — <evidence>
- Differs: <axis> <issue grade> → <traced grade>  # only when the issue states a different grade
**#<N>: Update issue description? <Yes | No>** · Complexity: <score>/100 — Capability <k> (Risk <r>, Uncertainty <u> — <driver>); Volume <v> (Scope <s>, Coupling <c>, Verification <x>) · fableplan: <yes|no> · Scope: <OK | too large — split/umbrella/narrow>
<specific edits when Yes>
<next-step line>
```

Yes for a material ❌/⚠️ claim, architecture or consistency gap, material concern, missing scope, required restructure, or a rescore: a title prefix below the recomputed score, or a rationale line whose grades differ from the traced ones at a recomputed score that is not lower. The rescore edits restamp the title prefix, the rationale line, and the fableplan signal to the recomputed values per [issue-editing.md](issue-editing.md), and when the body carries an `## Execution` block they also restamp its `Build model:`, `Effort:`, and `fableplan first:` lines to the recomputed band's defaults, upward only: a stamp on Fable 5.1 or on a Codex CLI or Cursor CLI harness keeps its model and effort and gains only `fableplan first: Yes`. The pipeline routes the build on those stamps and re-routes only when the validator's score outranks the title, so a title restamped over a stale block would build on the stale stamp. A recomputed score below the title score restamps nothing, and the verdict carries the `Differs:` lines only; a title with no prefix gets none from a rescore. The verdict's `Complexity:` value is always the recomputed score, so the grades on the line produce it. The verdict's `fableplan:` field is a routing signal: `yes` when the title score or the recomputed score is 71 or higher, so a recomputed score below the title never turns it to `no`. A rescore never lowers routing (complexity-scoring.md, Routing details). No only when accurate, feasible, consistent, and complete, with no rescore edit due.

**Next-step line.** Post the first matching string verbatim. With fableplan no, drop that option and its connective; in case 3 the `or` moves before `"update issue"`:

1. Split/umbrella scope: `→ Recommend "split issue" to restructure; or "update issue" to edit, "work on issue" to build as-is, "fableplan" to plan first.`
2. Update is Yes: `→ Recommend "update issue" to apply the edits above; or "work on issue" to build as-is, "fableplan" to plan first.`
3. Otherwise: `→ Reply "work on issue" to proceed, "update issue" to edit, or "fableplan" to plan first.`

### 9. Handle "work on issue"

Invoke `work-on-issue` with the issue number; surface any step-7 disposition first.

### 10. Handle "fableplan"

Invoke `fableplan` with the issue number; honor an explicit request even at signal no.

### 11. Handle "update issue"

Read [issue-editing.md](issue-editing.md) completely and apply it from the checkout, with no worktree.
