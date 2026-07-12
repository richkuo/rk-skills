---
name: app-prd
description: Use when the user wants an app idea turned into a Product Requirements Document (PRD) committed to a repo — "create a PRD", "/app-prd", "turn this idea into a PRD", or a raw idea dump ending with "save it to this repo". Produces a complete, section-numbered PRD.md landed via worktree + PR, bootstrapping an empty repo if needed. Stage 1 of the new-app-pipeline.
---

# app-prd

Turn a raw idea dump into a complete, implementable PRD committed to the target repo. The PRD is the single source of truth every later stage (question refinement, issue filing, workflow execution) builds on — write it so a cold agent could implement from it plus nothing else.

## Input

- An idea dump: features, pricing, constraints, platform choices — usually messy prose. Optionally a target repo (defaults to the current checkout).
- If no repo exists yet and the user named one, offer `gh repo create <name> --private` before proceeding.

## Steps

### 1. Check repo state

`git status`, `git log --oneline -3`, `git remote -v`, `git ls-remote origin`. Three cases:

- **Normal repo**: proceed with the standard worktree + PR flow.
- **Empty repo with remote** (no commits anywhere): bootstrap first — create `main`, one **empty** initial commit (`git commit --allow-empty -m "Initial commit"` + attribution footer), push. A PR needs a base branch to exist; never put the PRD itself in the bootstrap commit.
- **No repo/remote**: confirm repo creation with the user.

### 2. Draft `PRD.md`

Structure (adapt section names to the product, keep the skeleton):

1. Header table — product name, repo, platforms, status (**mark the MVP scope explicitly**, e.g. "Draft v0.1 — MVP scope"), last-updated date.
2. **Product Overview** — what it does, for whom, the emotional/business core in plain language.
3. **Goals** — 3-5 bullets.
4. **Platforms & Technology** — a table: each app surface, domains, payments, database, storage, email, auth. Record deferred infrastructure explicitly ("to be provisioned later; design compatible from day one").
5. Feature sections — accounts, core domain objects, creation flows, privacy rules. **Number every section** (§4.2 style); later stages and issues cite these numbers.
6. **Pricing** — exact rates in tables, worked examples labeled *illustrative*, discount rules with the user's own example numbers preserved.
7. Lifecycle/operations sections — storage tiers, scheduling windows with computed buffers (show the arithmetic: base time + buffer = trigger point).
8. **Notifications** — every trigger, plus the implied supporting set (invites, receipts, warnings) marked as implied.
9. Per-platform parity section when there are multiple surfaces.
10. **Open Questions** — numbered; see rule below.
11. **Out of Scope (MVP)**.
12. **Post-MVP Roadmap** — everything the user flagged as later.

### 3. Faithfulness rules (integrity-critical)

- Transcribe every stated number, rate, duration, and rule **exactly** — pricing tables and lifecycle windows are contract text, not paraphrase.
- Garbled or ambiguous input: make the best-effort interpretation in place **and** file the ambiguity in Open Questions. Never silently guess; never ask about things a sensible default covers.
- Anything you inferred rather than were told (e.g. an implied App Store policy, an implied email type) — say so inline.

### 4. Land it

Worktree off latest `origin/main`, branch `cc/prd`, commit `PRD.md`, push, open a PR. Attribution footer on the PRD file itself, the commit, and the PR body (`Created`).

### 5. Iterate on the same PR

The user will refine in bursts ("change X", "add Y", "rename call date to unseal date"). For each revision:

- Edit, commit, push to the **same branch** — one PR accumulates the whole draft history.
- Rename sweeps: `grep -c` first, replace all occurrences and casing variants, fix grammar fallout (a/an).
- Flip the PRD file's footer verb to `Updated` on first revision; commits use `Updated` thereafter.
- Reply with what changed in one or two sentences, not a recap of the document.

## Output

PR URL plus a one-line summary of coverage and where the open questions are listed. The PR merges when the user says so — typically after the `prd-questions` stage empties the Open Questions section.

## Failure modes

| Situation | Do this |
|---|---|
| Empty repo, no base branch | Bootstrap `main` with an empty commit first — never commit the PRD directly to main |
| User's numbers seem inconsistent (e.g. discount examples) | Record them verbatim, add an Open Question showing the inferred rule |
| User states requirements mid-iteration contradicting earlier ones | Latest wins; update every section it touches, not just the nearest one |
| Tempted to fill a spec gap with a plausible invention | Open Question instead |
