---
name: validate-issue
description: Use when the user asks to validate, review, or check a GitHub issue against the code. Returns a cited update decision with a complexity score.
---

# validate-issue

Validate every current-behavior claim against code. Input: a full issue URL, `#N`, `N`, or `owner/repo#N`; with none, take the newest open issue and state its number.

### 0. Default-branch baseline

No worktree for validation or issue edits. Resolve `DEFAULT=$(gh repo view --json defaultBranchRef --jq .defaultBranchRef.name)`, run `git fetch origin "$DEFAULT"`, and state `git rev-parse --short "origin/$DEFAULT"` as the baseline in the verdict. Read a working-tree path only when it is tracked and `git diff --quiet "origin/$DEFAULT" -- <path>` exits 0; otherwise read `git show "origin/$DEFAULT":<path>`.

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

Read [complexity-scoring.md](complexity-scoring.md) completely; grade axes from the traced edit list. The canonical formula is:

1. Capability maps `max(Risk, Uncertainty)` as `0–1 → 0`, `2 → 1`, `3 → 2`, `4 → 3`. If **Coupling ≥ 3**, use at least Capability 2.
2. Volume is `(Scope + Coupling + Verification) × 2`.
3. Score is `25 × Capability + Volume`.

| Band | Score | Validate | fableplan | Build |
|---|---|---|---|---|
| 0 | 0–9 | Opus 5 · medium | No | Sonnet 5 · high |
| 1 | 10–20 | Opus 5 · high | No | Sonnet 5 · xhigh |
| 2 | 21–50 | Opus 5 · high | No | Opus 5 · high |
| 3 | 51–70 | Opus 5 · xhigh | No | Opus 5 · xhigh |
| 4 | 71–80 | Fable 5.1 · medium | **Yes** | Opus 5 · high |
| 5 | 81–99 | Fable 5.1 · high | **Yes** | Opus 5 · xhigh |

fableplan is yes when the score is 71 or higher. The **first review** uses the coarser table below; each row starts on a band edge.

| Score | First review | Claude | Codex |
|---|---|---|---|
| 0–20 | Sonnet 5 · high | `@claude sonnet review` | `@codex luna review` |
| 21–70 | reviewer default | `@claude review` | `@codex review` |
| 71–80 | Opus 5 · high | `@claude opus review` | `@codex review` |
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
**#<N>: Update issue description? <Yes | No>** · Complexity: <score>/100 — Capability <k> (<driver>); Volume <v> · fableplan: <yes|no> · Scope: <OK | too large — split/umbrella/narrow>
<specific edits when Yes>
<next-step line>
```

Yes for a material ❌/⚠️ claim, architecture or consistency gap, material concern, missing scope, or required restructure; No only when accurate, feasible, consistent, and complete.

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
