---
name: prd-to-issues
description: Use when the user wants a finished PRD broken into GitHub milestones and issues — "file the issues from the PRD", "/prd-to-issues", "break this into GitHub issues". Derives dependency-ordered milestones, files complete complexity-scored issues (github-issue-format), and stamps each with an Execution block (typed predecessors, build model, effort, fableplan, review trigger). Stage 3 of the new-app-pipeline.
---

# prd-to-issues

Break a refined PRD into milestones and fully-specified GitHub issues that cold agents can implement one at a time. Every issue must be self-sufficient: an agent holding only the issue body and the PRD can build it correctly.

**Load the `github-issue-format` skill before filing anything — mandatory.**

## Steps

### 1. Plan the breakdown (present before filing)

- Derive **milestones** from dependency structure, not feature themes. Typical shape: `v0 — Foundation & core <surface>` (scaffold, schema, auth, core domain flows, payments happy path), `v1 — Lifecycle & delivery` (jobs, schedulers, notifications, end-of-life), `v2 — <second surface> parity`, `v3 — Post-MVP`.
- Aim for **15–25 issues** total; each independently implementable and PR-sized.
- Identify the **dependency spine** (issues everything else needs, built serially) vs **parallel waves** (dependency-free islands). For each planned issue, record its direct hard prerequisites separately from ordering-only predecessors. Name the risk concentrators — usually the schema and the money/pricing module.
- Show the user the plan (titles, milestones, order) in chat before filing. Adjust on feedback.

### 2. Create milestones

`gh api repos/<owner>/<repo>/milestones -f title='...' -f description='...'` — one per phase, descriptions listing the member issues' themes.

### 3. Write the issues

Per `github-issue-format`: `[C<score>]` plain-language title, complexity rationale first line, then **Problem** (with PRD § references), **Goal**, **Approach**, **Acceptance criteria**, attribution footer.

Issue-quality rules learned the hard way:

- Cite PRD section numbers everywhere — they're the cold agent's index.
- Acceptance criteria are testable behaviors, including the negative ones ("no endpoint can return a signed URL for sealed media, for any role").
- Money, privacy, and irreversible-deletion issues get their invariants stated as acceptance criteria, not prose.
- Pure logic (pricing engines) gets the PRD's worked examples embedded as required test cases.
- File via one batch script (heredoc bodies, `gh issue create --milestone`), sequentially so numbering is stable.

### 4. Stamp Execution blocks

Append to every issue body, before the footer:

```
## Execution
- **Depends on:** #<n>[, #<n>…] | none
- **Runs after:** #<n>[, #<n>…] | none
- **Build model:** <Fable 5 | Opus 4.8 | ...>
- **Effort:** <low (Fable-only, discretionary — below the formula floor) | medium (Fable-only) | high | xhigh>
- **Validate effort:** <medium | high>   (optional — omit for the default, high; never xhigh)
- **fableplan first:** <Yes — Fable 5 plans, plan posted to this issue, builder implements against it | No>
- **PR review:** standard `@claude` review trigger
```

Ordering-field rules:

- Stamp both fields from the approved spine/wave graph after final issue numbers are known. Record direct predecessor edges only, use comma-separated issue numbers, and write `none` when there is no edge of that kind.
- **Depends on** means the issue needs the predecessor's code or product result to be correct; for example, an API issue that requires a schema introduced by another issue.
- **Runs after** means the issues must not overlap but the later issue does not need the earlier issue's code; for example, two otherwise-independent issues editing the same package.
- A same-package exclusion is `Runs after`, not `Depends on`. If an edge is genuinely hard, record it only in `Depends on`; never list one predecessor in both fields.

Assignment — **derive from the complexity score band** (canonical formula in `validate-issue` step 6: `score = 25 × Capability + Volume`). Score each issue with that formula first, then stamp Execution from the band:

| Capability | Score band | Build model | fableplan first | Effort from Volume (0–7 / 8–15 / 16–24) |
|---|---|---|---|---|
| 0 | 0–24 | Sonnet (or the repo's cheap/fast builder) | No | high / high / xhigh |
| 1 | 25–49 | Opus 4.8 | No | high / high / xhigh |
| 2 | 50–74 | Opus 4.8 | **Yes** | high / high / xhigh |
| 3 | 75–99 | Fable 5 | No (planning is inherent) | medium / high / xhigh (or discretionary low) |

Axes already encode the old parallel heuristics (money/security → high Risk; design-heavy → high Uncertainty; mechanical grind → high Scope/Volume at Capability 0). Do **not** override the band with a separate signal table unless a safety carve-out is explicit in the PRD and Risk was under-scored — then raise Risk and re-score, don't bypass the formula.

- **fableplan first: Yes** means Capability 2 (Opus builds against a posted Fable plan). Never on Fable-built issues (Capability 3 — planning is inherent) and never on Capability 0–1.
- **Validate effort** (the pre-build Fable validation pass): **only ever medium or high — never xhigh.** Default high; drop to medium for Capability 0 issues with Volume ≤ 7.
- Effort floor is **medium** — never low, and medium is Fable-only: **Opus/Sonnet builds run at high or xhigh, never medium or low.** Fable builds may drop one tier further to **low**, a discretionary Fable-only tier below the formula's own floor, for issues judged lighter than Volume 0–7 warrants. When unsure between two tiers, take the higher (best-solution rule).
- PR review is always the standard `@claude` review trigger — no model routing in the review line.
- Scores filed before the band-encoding change are **not comparable** — re-score if routing matters.

### 5. Report

A compact table: issue number, `C`, title. Note the spine/waves ordering and which issues concentrate risk.

## Failure modes

| Situation | Do this |
|---|---|
| An issue can't be specced without a decision the PRD doesn't make | Stop; run `prd-questions` for it first — never file a stub |
| Two issues want to touch the same module in the same wave | In the later issue's `Runs after`, list the earlier issue, or merge them if they are not independently implementable |
| A milestone exceeds ~12 issues | Split it; workflow waves get unwieldy past that |
| Tempted to skip Execution blocks "for now" | Don't — cold agents need them; that's the point |
