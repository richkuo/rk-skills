---
name: validate-issue
description: Use when the user asks to validate, review, or check a GitHub issue against the code. Returns a cited update decision with a complexity score.
---

# validate-issue

Validate every current-behavior claim against code. Input: an issue URL, `#N`, `N`, or `owner/repo#N`; with none, take the newest open issue and state its number. `{ issue: <N>, targetBranch?: "<branch>" }` (or prose "target branch <name>") names the merge target, which replaces the default branch in step 0.

### 0. Baseline branch

No worktree for validation or issue edits. The issue's repository `REPO` is the one a URL or `owner/repo#N` names, else the checkout's `origin`. Pass `--repo "$REPO"` to every `gh` call, linked PRs included. When `origin` is a different repository, trace `REPO` from a temporary clone outside this checkout; never cite another repository's code. Resolve `DEFAULT=$(gh repo view "$REPO" --json defaultBranchRef --jq .defaultBranchRef.name)`; with a `targetBranch`, validate it per `work-on-issue` step 1 ("Target"), set `DEFAULT` to it, and name it as the target in the verdict. In a sandbox with no network, where `gh` and remote checks fail, take the baseline branch the caller supplies (the target branch, else the default branch it resolved), else `git symbolic-ref --short refs/remotes/origin/HEAD` without its `origin/` part. Accept it when `git rev-parse --verify "origin/$DEFAULT"` succeeds, and name each skipped network check as a verification limitation; a branch with no local `origin` ref still blocks. Run `git fetch origin "$DEFAULT"`, then pin `BASE=$(git rev-parse "origin/$DEFAULT")` once; a failed fetch keeps the last fetched ref and names that as a verification limitation. Every read, search, and history check uses `BASE` (`git show "$BASE":<path>`, `git grep -n <pattern> "$BASE" -- <paths>`, `git log "$BASE" -- <paths>`), so local edits, untracked files, and a moving branch cannot change the evidence. When the caller pins other evidence commits (such as the milestone pipeline's hard-dependency base refs), trace a claim about code that exists only there at that commit and cite the SHA; a pinned commit missing locally is a verification limitation. Claims about code at `BASE` are traced there as usual, and a claim about code that exists only at the missing commit stays ❓. The verdict states `git rev-parse --short "$BASE"` as the baseline. Issue data the caller embeds counts as a read issue. When the issue cannot be read or no `BASE` resolves, stop with `Validation blocked` (step 8).

### 1. Fetch the issue and linked PRs

Run `gh issue view <N> --repo "$REPO" --comments` and record its `updatedAt` (`--json updatedAt`) for the step-11 freshness check. Then list the cross-referenced PRs that comments omit:

```sh
gh api --paginate "repos/$REPO/issues/<N>/timeline" --jq '.[] | select(.event=="cross-referenced") | .source.issue | select(.pull_request) | "\(.repository_url) \(.number) \(.state) merged=\(.pull_request.merged_at // "no")"'
```

A closed PR is a fix only when `merged` is set and its change is present at `BASE`; verify it against that code and recommend closure or reuse. List open overlapping PRs under Concerns. When the timeline lookup fails, say so under Concerns; never report that no overlapping PR exists.

### 2. Extract claims and assertions

List each current-behavior claim (causes, citations, sets, negatives, benefit premises) and proposal assertion (goals, lifetime, population timing, benefits, consumers, failure policy, deployment surface, touched sites). Flag for 5a and 5b: a new subsystem, shared state, cross-cutting refactor, deduplication, single source of truth, multi-consumer coordination, or infrastructure analogy.

### 3. Verify claims

Trace each scenario through its conditions and config. Code outranks prose. Verify independently even for the repo owner, recent code, or runtime state machines. Apply every triggered depth rule:

1. Wrapper or helper: read its body and delegated or short-circuit paths.
2. Set claim: find real call sites, establish membership, diff the claimed set.
3. Benefit claim: prove the broken baseline exists in code, comments, or history.
4. Conjunction or negative: split atomic assertions; prove absence on all paths.
5. Negative over a window: trace the event-to-boundary dispatch and every producer.
6. Superlative, method-over-set, or cited baseline: establish population, tool coverage, source history.
7. Aggregate, dedupe, prorate, or shared state: verify the partition boundary and key against the scope.
8. Missing, undocumented, or unhandled surface: read surrounding content, find stale copy, diff deliverables.

Evidence outranks every verdict; reconcile it across bullets and paired findings.

### 4. Mark claims

✅ Verified, ❌ Refuted (name the real symbol), ⚠️ Conditional (name the config), or ❓ Unverified. Cite `file:line`; keep every unresolved claim.

### 5. Assess the proposal

Lead Proposal with a ≤55-word ASD-STE100 Goal stating the outcome. A refuted premise can make the proposal unnecessary.

#### 5a. Architecture

For every proposal step 2 flagged, read [architecture.md](architecture.md) completely and apply it after claim tracing.

#### 5b. Self-consistency

Whenever 5a runs, read [proposal-consistency.md](proposal-consistency.md) completely and apply it to the issue text.

#### 5c. General checks

Run `git log --since=7.days "$BASE" -- <touched paths>`. Check locking, migrations, reloads, idempotency, failure blast radius, parallel live/offline/admin paths, dual implementations, and recent-work regression. Material findings go under Concerns with `file:line`; a safety, recent-work, or parity defect requires an update.

### 6. Score complexity

Read [complexity-scoring.md](complexity-scoring.md) completely. Grade every axis against its anchors from the traced edit list and write its `Axes:` line with one piece of evidence per grade before you look up the grade the issue's rationale line states; then compare grade by grade and report all five grades. The canonical formula is:

1. Capability maps `max(Risk, Uncertainty)` as `0–1 → 0`, `2 → 1`, `3 → 2`, `4 → 3`. If **Coupling ≥ 3**, use at least Capability 2.
2. Volume is `(Scope + Coupling + Verification) × 2`.
3. Score is `25 × Capability + Volume`.

| Band | Score | Validate | fableplan | Build |
|---|---|---|---|---|
| 0 | 0–9 | Opus 5.5 · medium | No | Sonnet 5 · high |
| 1 | 10–20 | Opus 5.5 · high | No | Sonnet 5 · xhigh |
| 2 | 21–49 | Opus 5.5 · high | No | Opus 5.5 · high |
| 3 | 50–70 | Opus 5.5 · xhigh | No | Opus 5.5 · xhigh |
| 4 | 71–80 | Fable 5.1 · medium | **Yes** | Opus 5.5 · xhigh |
| 5 | 81–99 | Fable 5.1 · high | **Yes** | Opus 5.5 · xhigh |

fableplan is yes when the score is 71 or higher. The Build column is the Claude default; an Execution block stamped `<Name> (Codex CLI)` or `<Name> (Cursor CLI)` overrides it through the `cli-dispatch` shim. The Validate column is the band default; an `## Execution` block may stamp `Validate model:` (`Fable 5.1`, `Opus 5.5`, or `<Name> (Codex CLI[, <model-id>])`, which runs this skill through the `cli-dispatch` read-only validate shim) and `Validate effort:` to override it, and `Plan effort:` to override the fableplan stage's `high` default. A stamped model wins over the band; the effort clamp follows the effective model, so an Opus validate at `low` or `medium` runs at `high` (Fable-only tiers), a Fable validate runs every tier as stamped, and a Codex CLI validate runs `low` to `max` as stamped. The **first review** uses the coarser table below; each row starts on a band edge.

| Score | First review | Claude | Codex |
|---|---|---|---|
| 0–20 | Sonnet 5 · high | `@claude sonnet review` | `@codex luna review` |
| 21–80 | Opus 5.5 · high | `@claude review` | `@codex review` |
| 81–99, or no score | Fable 5.1 · high | `@claude fable review effort:high` | `@codex review` |

The bare `@claude review` is the standard review: it runs Opus 5.5 at high, the same reviewer as `@claude opus review effort:high`. Blocking re-reviews are keyed to the reviewer that actually ran cycle 1: a heavier cycle-1 reviewer steps down to `@claude review` on the first blocking re-review and stays there (`skills/fix-pr-review/rereview-routing.md`).

### 7. Scope disposition

A high score alone is acceptable. Split and Umbrella need all three gates:

1. Each part ships, passes tests, and delivers value in its own PR.
2. Fold each part below C41 into the parent; at least two parts of C41 or higher remain. A folded part forces Umbrella. With fewer than two, keep one issue, emit `OK — restructure as in-body checklist`, and require an update when the body lacks that checklist.
3. The combined diff is roughly above 500 changed lines, parts route to different bands, or a part carries money, data-integrity, or security risk.

Keep one issue when a gate fails or one root cause needs one diff. **Split** = independent parts, none folded. **Umbrella** = coordinated or folded parts. **Narrow** is always available: keep the core, move extras to a Future note. Each child needs its own scored title, problem, and acceptance criteria. Scope and update decisions are independent.

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

Yes for a material ❌/⚠️ claim, architecture or consistency gap, material concern, missing scope, required restructure, or a rescore: a title with no `[C<score>]` prefix in a repository that follows that convention, a title prefix that differs from the recomputed score in either direction, or a rationale line whose grades differ from the traced ones. The rescore edits restamp the title prefix and the rationale line (grades, score, model and effort, fableplan signal) to the recomputed values per [issue-editing.md](issue-editing.md), and add both when the issue has none; its Edit the title section owns the `## Execution` block restamp. A lower recomputed score restamps down only on evidence: every lowered grade the rationale line states has its `Differs:` line, and the `Axes:` evidence names what the issue over-scored. The verdict's `Complexity:` value is always the recomputed score. The verdict's `fableplan:` field is a routing signal: `yes` when the title score or the recomputed score is 71 or higher. It keeps the title floor for this run's plan decision. A downward restamp takes effect when the edit lands, so a loop that applies it before the build routes its later stages, such as the first review, on the lower score. No only when accurate, feasible, consistent, and complete, with no rescore edit due.

**Validation blocked.** When the issue cannot be read, no `BASE` resolves, or the central claim (the behavior the issue exists to change) stays ❓ after step 3, output `**#<N>: Validation blocked** — <missing input>` with the evidence gathered so far, and no completed-verdict line, score, or next-step line. A loop treats it as STOP. A caller with a fixed verdict vocabulary maps it to its failing value (INVALID, with the missing input as the reason and complexity 0), never to a passing value.

**Next-step line.** Post the first matching string verbatim. With fableplan no, drop that option and its connective; in case 3 the `or` moves before `"update issue"`:

1. Split/umbrella scope: `→ Recommend "split issue" to restructure; or "update issue" to edit, "work on issue" to build as-is, "fableplan" to plan first.`
2. Update is Yes: `→ Recommend "update issue" to apply the edits above; or "work on issue" to build as-is, "fableplan" to plan first.`
3. Otherwise: `→ Reply "work on issue" to proceed, "update issue" to edit, or "fableplan" to plan first.`

### 9. Handle "work on issue"

Invoke `work-on-issue` with the issue number; surface any step-7 disposition first.

### 10. Handle "fableplan"

Invoke `fableplan` with the issue number; honor an explicit request even at signal no.

### 11. Handle "update issue"

Read [issue-editing.md](issue-editing.md) completely and apply it from the checkout, with no worktree. Pass the `REPO` and `updatedAt` from steps 0 and 1.
