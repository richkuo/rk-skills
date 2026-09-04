---
name: prd-to-issues
description: Use when the user wants a finished PRD broken into GitHub milestones and issues — "file the issues from the PRD", "/prd-to-issues", "break this into GitHub issues". Derives dependency-ordered milestones, files complete complexity-scored issues (github-issue-format), and stamps each with an Execution block (typed predecessors, build model, effort, fableplan, review trigger). Stage 4 of the new-app-pipeline.
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

Per `github-issue-format`: `[C<score>]` plain-language title, complexity rationale first line, then **Problem** (with PRD § references), **Goal**, **Approach**, **Acceptance criteria**, **`## Plain simple English`** (mandatory, under 55 words, ASD-STE100), attribution footer. The step 4 Execution block is appended between that last section and the footer.

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
- **Build model:** <Fable 5.1 | Opus 5 | ... | <Name> (Codex CLI[, <model-id>]) | <Name> (Cursor CLI[, <model-id>])>
- **Effort:** <low (Fable-only, discretionary — below the formula floor) | medium (Fable-only) | high | xhigh | max (Codex CLI-only)>
- **fableplan first:** <Yes — Fable 5.1 plans, plan posted to this issue, builder implements against it | No>
- **PR review:** standard `@claude` review trigger
- **Validate effort:** <low | medium | high | xhigh>   (optional — omit to use the band default)
- **Plan effort:** <low | medium | high>   (optional — omit to plan at high; only read when fableplan first is Yes)
```

Ordering-field rules:

- Stamp both fields from the approved spine/wave graph after final issue numbers are known. Record direct predecessor edges only, use comma-separated issue numbers, and write `none` when there is no edge of that kind.
- **Depends on** means the issue needs the predecessor's code or product result to be correct; for example, an API issue that requires a schema introduced by another issue.
- **Runs after** means the issues must not overlap but the later issue does not need the earlier issue's code; for example, two otherwise-independent issues editing the same package.
- A same-package exclusion is `Runs after`, not `Depends on`. If an edge is genuinely hard, record it only in `Depends on`; never list one predecessor in both fields.

Assignment — **derive from the complexity score band**. Load the canonical formula and band table from `validate-issue` step 6, score each issue there, then stamp Execution from that band:

| Band | Score band | Build model | fableplan first | Effort |
|---|---|---|---|---|
| 0 | 0–9 | Sonnet 5 (or the repo's cheap/fast builder) | No | high |
| 1 | 10–20 | Sonnet 5 (or the repo's cheap/fast builder) | No | xhigh |
| 2 | 21–49 | Opus 5 | No | high |
| 3 | 50–70 | Opus 5 | No | xhigh |
| 4 | 71–80 | Opus 5 | **Yes** | xhigh |
| 5 | 81–99 | Opus 5 | **Yes** | xhigh |

**Never stamp Fable 5.1 as the Build model** — no band defaults to a Fable build, and this skill never assigns one; a Fable build exists only when the user explicitly directs it on a specific issue.

**Never stamp an external CLI harness as the Build model** — no band defaults to a Codex CLI or Cursor CLI build, and this skill never assigns one. A CLI build exists only when the user directs it on a specific issue; `execution-plan-review` writes the form `<Name> (Codex CLI)` or `<Name> (Cursor CLI)`, with an optional model id after a comma inside the parenthetical, and the `cli-dispatch` skill owns how the pipeline reaches that CLI.

Axes already encode the old parallel heuristics (money/security → high Risk; design-heavy → high Uncertainty; mechanical grind → high Scope/Volume at Capability 0). Do **not** override the band with a separate signal table unless a safety carve-out is explicit in the PRD and Risk was under-scored — then raise Risk and re-score, don't bypass the formula.

- **fableplan first: Yes** means score ≥ 71 (bands 4–5): a Fable 5.1 plan is posted before the build; the builder is Opus 5 at xhigh in both plan bands. Never below 71.
- **Validate model is derived from the score and never stamped**: the `validate-issue` step 6 band table owns the Validate mapping, and a missing `[C..]` prefix is unknown, not small, so it routes as band 5. Never add a `Validate model:` line — nothing reads it. **Validate effort defaults to the band value and is stampable per issue** through the optional `Validate effort:` line; this skill omits the line at filing time so the band default applies, and `execution-plan-review` adds it when the user wants a different tier. A stamped tier on a Fable validate (bands 4–5) runs as stamped, with `xhigh` clamped to `high`; a stamped `low` or `medium` on an Opus validate (bands 0–3) is raised to `high`, because those tiers are Fable-only.
- **Plan effort** (the fableplan stage): defaults to **high** and is stampable per issue through the optional `Plan effort:` line, read only when `fableplan first` is Yes. This skill omits the line at filing time; `execution-plan-review` adds it when the user wants the plan at `low` or `medium`. The planner is always Fable 5.1, so a stamped `xhigh` runs at `high` (the LLM Attribution Footer section of CLAUDE.md owns this ceiling).
- Effort floor is **medium** — never low, and medium is Fable-only: **Opus/Sonnet builds run at high or xhigh, never medium or low.** Fable builds may drop one tier further to **low**, a discretionary Fable-only tier below the formula's own floor, for a band-5 issue (score 81+) judged lighter than its Volume warrants. **Fable's ceiling is high — never assign or run Fable 5.1 at xhigh, on any stage (build, plan, validate, review, or fix); the LLM Attribution Footer section of CLAUDE.md owns this ceiling.** When unsure between two tiers, take the higher (best-solution rule) — capped at high on Fable.
- PR review: the pipeline derives the first-review trigger from the score on the first-review scale, which is coarser than the build bands above and is owned by the `validate-issue` step 6 first-review table — load that table for the rows and triggers; this file states no first-review boundary of its own. Every reviewer above the standard trigger is first-review-only, and each blocking re-review steps down one rung: a fable cycle 1 posts `@claude opus review effort:high` then `@claude review`, and an opus cycle 1 posts `@claude review` for every blocking re-review. Both ladders stop at `@claude review` rather than dropping to sonnet. Stamp an explicit `@claude <model> review effort:<tier>` line only to override that default, and only with a model the Action admits — `sonnet`, `opus` or `fable`. `claude.yml` resolves no other shorthand, and it reads an unresolved one as the route keyword, which sends the "review" to its write-capable fix-pr job. Stamp `sonnet` where you mean the cheapest reviewer; never stamp `haiku`.
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
