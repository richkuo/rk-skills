---
name: github-issue-format
description: Required format for creating or editing any GitHub issue — [C<score>] title convention, complexity rationale line, complete-body rule, mandatory Plain simple English section, attribution footer. Load BEFORE creating or editing a GitHub issue.
---

# GitHub issue format

## Title

- `[C<score>] <title>`: a plain-simple-English sentence in ASD-STE100, precise about component and behavior, e.g. `[C95] Orders can be filled twice when two fills arrive at the same moment`.
- The **complexity score (0–100)** is a model and effort routing signal. `validate-issue` step 6 owns the formula, axes, and routing table; never restate or approximate them here.

## Body

- **Never create a placeholder, stub, or empty-bodied issue.** Every issue gets a complete body at creation, even in a batch. If a follow-up is not ready to spec, track it in the parent issue or notes until it is.
- **Section order:** complexity rationale line, `## Problem`, `## Goal`, `## Approach`, `## Acceptance criteria`, `## Plain simple English`, then any Execution block, then the attribution footer.
- **Complexity rationale line** (first line of the body): matches the title prefix and ends with an explicit plan signal:
  `**Complexity: 95/100** — Capability 3 (Risk 4, Uncertainty 2 — money/data-integrity on order-fill path); Volume 20 (Scope 4, Coupling 3, Verification 3) — Opus 5.5, high · plan: yes`. The line always carries all five axis grades; the `validate-issue` scoring reference owns the axes and their anchors.
- **plan signal:** `· plan: yes` when the score is ≥ 75 (a plan is posted before the build, by Opus 5.5 unless a `Plan model: Fable 5.1` stamp asks for Fable; the builder is Opus 5.5 at high); `· plan: no` below 75. Always write it. **Compatibility (owned here):** the signal and the Execution block key were once spelled `· fableplan: yes|no` and `**fableplan first:**`, and the PR-title suffix `, fableplan`. Every reader accepts both spellings, every writer emits only `plan`, and a restamp rewrites an old spelling to the new one. Fable 5.1 effort tiers follow the LLM Attribution Footer section of CLAUDE.md.
- **`## Plain simple English` is mandatory on every issue,** per the CLAUDE.md/AGENTS.md Response Style definition, for a reader who knows the product but not the code. Never restate the approach or list symbols there. An edit that rewrites body prose adds the section when it is missing; an edit that changes only machine metadata (the Execution block, the `[C<score>]` title prefix, or the complexity rationale line, as a rescore-only edit does) leaves every prose section unchanged and does not add it.
- **LLM Attribution Footer** ends the body: `Created` for a new issue, `Validated` when a validation pass produced the edit (`validate-issue` and its wrappers), `Updated` for any other edit. Stack the new line under the existing ones; never replace them, and never append an exact duplicate of a line already there.
- **Project precedence:** a repo CLAUDE.md issue or footer format overrides this default.
