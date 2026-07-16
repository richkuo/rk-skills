---
name: github-issue-format
description: Required format for creating or editing any GitHub issue — [C<score>] title convention, complexity rationale line, complete-body rule, attribution footer. Load BEFORE creating or editing a GitHub issue.
---

# GitHub issue format

- **Never create a placeholder, stub, or empty-bodied issue.** Every issue gets a complete body at creation — complexity rationale line, concrete problem statement, goal, approach/acceptance criteria — even in a batch. If a follow-up isn't ready to spec, track it in the parent issue or notes until it is.
- Title format: `[C<score>] <title>` — a plain-language sentence understandable to an average 18-year-old, precise about component and behavior, e.g. `[C95] Orders can be filled twice when two fills arrive at the same moment`.
- **Complexity score (0–100)** is a **model + effort routing signal**, not a time estimate. Canonical formula lives in `validate-issue` step 6: five axes → **Capability** band (which LLM / whether fableplan) + **Volume** (effort inside the band) → `score = 25 × Capability + Volume`. Axes: Scope, Coupling, Risk, Uncertainty, Verification.
- First line of the body is a one-line rationale matching the title prefix:
  `**Complexity: 95/100** — Capability 3 (Risk 4 — money/data-integrity on order-fill path); Volume 20 — Fable 5, xhigh`
- End the body with the **LLM Attribution Footer** — `Created` (or `Updated` when editing).
- **Project precedence:** a repo CLAUDE.md issue/footer format overrides this default.
