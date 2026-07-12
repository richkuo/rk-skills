---
name: prd-questions
description: Use when the user wants every open question in a PRD resolved interactively — "ask me all questions", "/prd-questions", "let's resolve the open questions". Sweeps the PRD for open questions and ambiguities, asks them in batched multiple-choice form with recommendations, folds every answer back into the owning spec section, and empties the Open Questions section. Stage 2 of the new-app-pipeline.
---

# prd-questions

Resolve every open decision in the PRD by asking the user directly, then fold the answers into the spec so no reader ever needs the Q&A transcript. The deliverable is a PRD whose Open Questions section is empty because the answers live in the sections they govern.

## Input

A repo containing `PRD.md` (or a named PRD file). No other input needed.

## Steps

### 1. Sweep for questions

Collect, in order:

1. Every item in the **Open Questions** section.
2. Inline ambiguities elsewhere ("TBD", "confirm", "assumed", hedged examples).
3. Decisions embedded in **Post-MVP / roadmap** sections that were deferred without being decided.

"All questions" means all three groups — not just the numbered list.

### 2. Ask in batches

Use the AskUserQuestion tool, **max 4 questions per call**, sequential calls until done:

- Each question: 2–4 concrete options with real tradeoff descriptions — not "yes/no" but the actual competing designs.
- Put your recommended option **first**, labeled `(Recommended)`, and make the recommendation genuinely reasoned (privacy-preserving, simplest-correct, matches the PRD's stated priorities).
- One question per decision. Never bundle two decisions into one option.
- Post-MVP questions are fair game but mark them as such in the question text, and offer "Defer to scoping" as a legitimate recommended option when deciding now has no benefit.

### 3. Fold answers into the spec

For every answer:

- Edit the **owning section** — pricing answers into the pricing tables/rules, privacy answers into the privacy section, failure-handling into billing/lifecycle. The spec text states the decision plainly; no "per user decision on <date>" hedging inside the rule itself.
- Update worked examples to match (and remove "unverified" hedges once confirmed).
- Cross-reference where a rule spans sections (§-refs).

### 4. Close out

- Replace the Open Questions list with a one-paragraph note: "None — all prior open questions resolved <date> and folded into the spec:" followed by a decision → section map.
- Commit and push (same PRD PR if still open; footer verb `Updated`).

## Output

One reply listing each decision in a compact sentence series, plus where it landed. Note the PRD PR is ready to merge if this was the last blocker.

## Failure modes

| Situation | Do this |
|---|---|
| User picks "Other" with free text | Treat as the answer; fold it in verbatim, ask one follow-up only if it's internally contradictory |
| An answer contradicts existing spec text elsewhere | Update every affected section; call out the ripple in your reply |
| More than ~12 questions found | Still ask them all — batch by theme (pricing, privacy, lifecycle) so each AskUserQuestion call is coherent |
| A "question" is really a research task, not a user decision | Don't ask it; note it as a scoping task in the roadmap section |
