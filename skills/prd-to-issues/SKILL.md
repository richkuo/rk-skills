---
name: prd-to-issues
description: Use when the user wants a finished PRD broken into GitHub milestones and issues — "file the issues from the PRD", "/prd-to-issues", "break this into GitHub issues". Derives dependency-ordered milestones, files complete complexity-scored issues (github-issue-format), and stamps each with an Execution block (typed predecessors, build model, effort, fableplan, plan effort, review trigger). Stage 4 of the new-app-pipeline.
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
- **Build model:** <Fable 5 | Opus 5 | ...>
- **Effort:** <low (Fable-only, discretionary — below the formula floor) | medium (Fable-only) | high | xhigh (never on Fable 5 — Fable caps at high)>
- **fableplan first:** <Yes — Fable 5 plans, plan posted to this issue, builder implements against it | No>
- **Plan effort:** <low | medium | high>   (optional — omit for the default, high; never xhigh — the planner is Fable 5 and Fable caps at high; only meaningful when fableplan first is Yes)
- **PR review:** standard `@claude` review trigger
```

Ordering-field rules:

- Stamp both fields from the approved spine/wave graph after final issue numbers are known. Record direct predecessor edges only, use comma-separated issue numbers, and write `none` when there is no edge of that kind.
- **Depends on** means the issue needs the predecessor's code or product result to be correct; for example, an API issue that requires a schema introduced by another issue.
- **Runs after** means the issues must not overlap but the later issue does not need the earlier issue's code; for example, two otherwise-independent issues editing the same package.
- A same-package exclusion is `Runs after`, not `Depends on`. If an edge is genuinely hard, record it only in `Depends on`; never list one predecessor in both fields.

Assignment — **derive from the complexity score band** (canonical formula in `validate-issue` step 6: `score = 25 × Capability + Volume`). Score each issue with that formula first, then stamp Execution from the band:

| Capability | Score band | Build model | fableplan first | Effort |
|---|---|---|---|---|
| 0 | 0–24 | Sonnet 5 (or the repo's cheap/fast builder) | No | xhigh |
| 1 | 25–49 | Opus 5 | No | xhigh |
| 2 | 50–74 | Opus 5 | **Yes** | high |
| 3 | 75–99 | Fable 5 | **Yes** | high (or discretionary medium/low — **Fable never runs at xhigh**) |

Axes already encode the old parallel heuristics (money/security → high Risk; design-heavy → high Uncertainty; mechanical grind → high Scope/Volume at Capability 0). Do **not** override the band with a separate signal table unless a safety carve-out is explicit in the PRD and Risk was under-scored — then raise Risk and re-score, don't bypass the formula.

- **fableplan first: Yes** means Capability ≥ 2 (score ≥ 50): a Fable 5 plan is posted before the build, whether Opus 5 builds (band 2) or Fable 5 builds (band 3). Never on Capability 0–1.
- **Validation is fully derived from the score — model and effort, never stamped**: bands 0–1 validate on **Opus 5** (medium at 0–24, high at 25–49); bands 2–3 validate on **Fable 5 at high**. A missing `[C..]` prefix is unknown, not small, so it routes as band 3. Never add a `Validate model:` or `Validate effort:` line to an Execution block — nothing reads either; a legacy `Validate effort:` line on an older issue is ignored.
- **Plan effort** (the fableplan stage): stamp it only on `fableplan first: Yes` issues — it is ignored everywhere else. The planner is always Fable 5, so the legal tiers are **low, medium, and high — never xhigh** (Fable never runs at xhigh; high is Fable's ceiling) — this line sets effort only, never a model. Default (and ceiling) high; drop to **medium** when Capability 2 came from the Coupling bump rather than Risk/Uncertainty, so the plan is mostly sequencing known work. Reserve **low** for an issue whose approach is already settled in the issue body and only needs ordering.
- Effort floor is **medium** — never low, and medium is Fable-only: **Opus/Sonnet builds run at high or xhigh, never medium or low.** Fable builds may drop one tier further to **low**, a discretionary Fable-only tier below the formula's own floor, for issues judged lighter than Volume 0–7 warrants. **Fable's ceiling is high — never assign or run Fable 5 at xhigh, on any stage (build, plan, validate, review, or fix).** When unsure between two tiers, take the higher (best-solution rule) — capped at high on Fable.
- PR review: the line stays the standard `@claude` review trigger. The pipeline derives the first-review default from the band (Sonnet 5 · high at 0–24, Opus 5 · high at 25–74, Fable 5 · high at 75+); stamp an explicit `@claude <model> review effort:<tier>` trigger only to override that default.
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
