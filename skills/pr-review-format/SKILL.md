---
name: pr-review-format
description: Required format and rules for writing any pull request (PR) review comment — verdict line, section structure, materiality filter, safety carve-out. Load BEFORE composing or posting a PR review.
---

# PR review format

Review comments contain **nothing outside this structure** — no preamble, header, or emoji — except the footer:
- First line: exactly `LGTM` or `Needs Updates`.
- **Materiality filter:** drop trivia only — style/naming nits, subjective preferences, micro-optimizations, edge cases with no realistic trigger, anything you'd prefix "minor"/"nit". Never mention dropped trivia. Don't drop substantive non-blocking findings — route them to `### Recommended Optional` or `### Create Follow-up Issue`.
- **Safety carve-out (overrides materiality and confidence):** anything touching money, data integrity, security, or auto-protective mechanisms is always surfaced; if unconfirmable, put it under `### Requires Human Review`.
- **Verdict keys off blocking sections only:** `### Needs Fixing` and `### Requires Human Review` block; `### Recommended Optional` and `### Create Follow-up Issue` don't. `Needs Updates` iff ≥1 blocking item; otherwise `LGTM` (even when non-blocking findings follow the LGTM line).
- `LGTM` means the reading agent may merge and close. With no findings at all, `LGTM` stands alone above the footer.
- **LGTM precondition:** inspect every changed file and check CI status first. If you couldn't, emit `Needs Updates` and record the gap under `### Requires Human Review`.
- Every finding goes under exactly one H3 section (omit empty ones). Sections are numbered lists; each item: **bold one-sentence title**, newline, description with critical details (`file:line` + why).
- `### Needs Fixing` and `### Recommended Optional` items add **Invariant:** (the general property violated) and **Must survive:** (1–3 adversarial cases any fix must handle).
- `### Create Follow-up Issue` is the disposition of last resort — prefer keeping work in the PR. Requires **both**: genuinely separate from PR scope, **and** can't reasonably fold into this PR (substantial independent scope, own design decision, or would bloat/destabilize the diff). A different file/subsystem alone doesn't qualify; trivially-fixable instances of the same bug class get fixed here. When in doubt, route elsewhere.
- `### Requires Human Review` is the escalation of last resort — default to recommending. Use only when you genuinely can't: a real tradeoff only the human can resolve, provably missing context, an unconfirmable safety finding, or an LGTM-precondition gap. Uncertainty or investigation effort alone is NOT a reason — recommend with assumptions stated instead. Technical description: keep under 50 words; end by stating what the human must decide and why you can't. Then each item **must** add two labeled blocks in this order:
  - **Plain simple English:** the decision in plain simple English under 55 words — no jargon, no unexplained acronyms. Prefer a concrete A/B question the human can answer without reading the technical paragraph (e.g. "When the server leaves field X out, should the phone: **A)** keep its copy, or **B)** treat that as a delete and clear it?").
  - **Recommended proposed solution:** one short plain-simple-English paragraph stating what you recommend they choose or do (the action, not a restatement of the tradeoff).
- Write the comment as direct instructions for an agent that will act on it.
- End with the **LLM Attribution Footer**, verb **Validated**.
