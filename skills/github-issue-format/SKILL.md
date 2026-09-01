---
name: github-issue-format
description: Required format for creating or editing any GitHub issue — [C<score>] title convention, complexity rationale line, complete-body rule, mandatory Plain simple English section, attribution footer. Load BEFORE creating or editing a GitHub issue.
---

# GitHub issue format

- **Never create a placeholder, stub, or empty-bodied issue.** Every issue gets a complete body at creation — complexity rationale line, concrete problem statement, goal, approach/acceptance criteria, `## Plain simple English` — even in a batch. If a follow-up isn't ready to spec, track it in the parent issue or notes until it is.
- Title format: `[C<score>] <title>` — a clear plain-simple-English sentence in ASD-STE100, precise about component and behavior, e.g. `[C95] Orders can be filled twice when two fills arrive at the same moment`.
- **Complexity score (0–100)** is a **model + effort routing signal**. It is not a time estimate. Load the canonical formula, axes, and routing table from `validate-issue` step 6; do not restate or approximate them here.
- First line of the body is a one-line rationale matching the title prefix, ending with an explicit **fableplan signal**:
  `**Complexity: 95/100** — Capability 3 (Risk 4 — money/data-integrity on order-fill path); Volume 20 — Opus 5, xhigh · fableplan: yes`
  (Fable 5.1 never pairs with `xhigh`; the LLM Attribution Footer section of CLAUDE.md owns the Fable effort ceiling. xhigh is legal only on Opus/Sonnet-class builds.)
- **fableplan signal:** `· fableplan: yes` **when the score is ≥ 71** (a Fable 5.1 plan is posted before the build; the builder is Opus 5 at both plan bands: high at 71–80, xhigh at 81+); scores below 71 are `· fableplan: no` (they don't need a separate plan). Always write it explicitly — absence is ambiguous, not "no".
- **Body section order:** complexity rationale line, `## Problem`, `## Goal`, `## Approach`, `## Acceptance criteria`, `## Plain simple English`, then any Execution block, then the attribution footer. `Plain simple English` is the last prose section a human reads; an Execution block is machine metadata and keeps its place between that section and the footer.
- **`## Plain simple English` is mandatory on every issue.** One short paragraph under 55 words in ASD-STE100 (Simplified Technical English) per the CLAUDE.md/AGENTS.md Response Style rules. State what is wrong or missing and why it matters, so a reader who knows the product but not the code understands the issue without reading the technical sections. Never restate the approach there, never list file paths or symbols, and never put a time or effort estimate in it. An edit that rewrites body prose adds the section when it is missing; an edit that changes only machine metadata (the Execution block, or the `[C<score>]` title prefix) leaves every prose section unchanged and does not add it.
- End the body with the **LLM Attribution Footer** — `Created` for a new issue, `Validated` when a validation pass produced the edit (`validate-issue` and its wrappers), `Updated` for any other edit. Stack the new line under the existing ones; never replace them, and never append a line that exactly duplicates one already there.
- **Project precedence:** a repo CLAUDE.md issue/footer format overrides this default.
