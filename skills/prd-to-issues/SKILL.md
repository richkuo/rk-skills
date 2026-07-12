---
name: prd-to-issues
description: Use when the user wants a finished PRD broken into GitHub milestones and issues — "file the issues from the PRD", "/prd-to-issues", "break this into GitHub issues". Derives dependency-ordered milestones, files complete complexity-scored issues (github-issue-format), and stamps each with an Execution block (build model, effort, fableplan, review trigger). Stage 3 of the new-app-pipeline.
---

# prd-to-issues

Break a refined PRD into milestones and fully-specified GitHub issues that cold agents can implement one at a time. Every issue must be self-sufficient: an agent holding only the issue body and the PRD can build it correctly.

**Load the `github-issue-format` skill before filing anything — mandatory.**

## Steps

### 1. Plan the breakdown (present before filing)

- Derive **milestones** from dependency structure, not feature themes. Typical shape: `v0 — Foundation & core <surface>` (scaffold, schema, auth, core domain flows, payments happy path), `v1 — Lifecycle & delivery` (jobs, schedulers, notifications, end-of-life), `v2 — <second surface> parity`, `v3 — Post-MVP`.
- Aim for **15–25 issues** total; each independently implementable and PR-sized.
- Identify the **dependency spine** (issues everything else needs, built serially) vs **parallel waves** (dependency-free islands). Name the risk concentrators — usually the schema and the money/pricing module.
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
- **Build model:** <Fable 5 | Opus 4.8 | ...>
- **Effort:** <medium | high | xhigh>
- **fableplan first:** <Yes — Fable 5 plans, plan posted to this issue, builder implements against it | No>
- **PR review:** standard `@claude` review trigger
```

Assignment heuristics:

| Signal | Assignment |
|---|---|
| Money, pricing, payments | Fable 5; xhigh if it's a pure boundary-heavy module |
| Auth / security surface | Fable 5, high |
| The product's core promise (e.g. sealing, privacy) | Fable 5; xhigh when atomicity/enforcement is the issue |
| Foundational schema everything builds on | Fable 5, xhigh |
| Irreversible deletion paths | Fable 5, high |
| Small-but-load-bearing (privacy serializers) | Fable 5, medium — vigilance beats planning here |
| Mechanical scaffolding, config plumbing | Opus 4.8, high |
| CRUD flows, contained components on known APIs | Opus 4.8, high |
| Design-heavy but routine to code | Opus 4.8 + **fableplan: Yes** — the bridge tier |
| Design work with no correctness risk (landing pages) | Either model, medium; use the frontend-design skill |

- **fableplan is for issues where the design is the hard part and the code is routine.** Never on Fable-built issues (planning is inherent) or on issues so small the plan would just be the implementation in prose.
- Effort floor is **medium** — never low. When unsure between two tiers, take the higher (best-solution rule).
- PR review is always the standard `@claude` review trigger — no model routing in the review line.

### 5. Report

A compact table: issue number, `C`, title. Note the spine/waves ordering and which issues concentrate risk.

## Failure modes

| Situation | Do this |
|---|---|
| An issue can't be specced without a decision the PRD doesn't make | Stop; run `prd-questions` for it first — never file a stub |
| Two issues want to touch the same module in the same wave | Same track/serial order, or merge into one issue |
| A milestone exceeds ~12 issues | Split it; workflow waves get unwieldy past that |
| Tempted to skip Execution blocks "for now" | Don't — cold agents need them; that's the point |
