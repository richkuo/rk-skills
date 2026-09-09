# Validate claims and remedies

Read for step 4. The main skill owns scope and completion; this reference owns evidence.

- Read the complete function or instruction and trace callers, guards, cleanup, and error paths. For a negative claim, check every path that could provide the allegedly missing behavior.
- Map stale citations to current code. A shifted line or an outdated thread does not prove a fix. Record current `file:line` and the verified head commit; use source links when the evidence is a log or review event.
- Verify the proposed remedy separately. Preserve each valid invariant and test the review's adversarial cases. If the remedy is wrong but the defect exists, derive a correct remedy.
- **Safety carve-out:** money, data integrity, security, and auto-protective mechanisms need a fix or explicit escalation even at low confidence. Refutation or downgrade requires code proof that removes the safety concern. Scope may require a follow-up, but the disposition must state any hazard that remains.
- **Requires Human Review:** investigate the missing fact or tradeoff and verify any `Recommended proposed solution`. Implement a supported decision and record its reason and material rejected alternatives. When a necessary fact or authority is unavailable, mark Blocked and identify the exact decision required; do not invent it.
- **CI failures:** inspect the actual failing step. Attribute to the PR only when the diff causes it. Evidence of a pre-existing failure requires a matching base run or reproduction on the relevant base. A passing retry alone does not prove an infrastructure failure; intermittent product defects remain possible. Use a separate clean worktree for a base reproduction when execution is permitted.

Keep claim validity and work status separate. A confirmed issue can be Blocked or Deferred; access failure, test failure, or inability to implement never makes it Refuted. Check every original source against the final dispositions before publication so deduplication cannot drop part of a claim.

---
Updated with LLM: GPT-6 | high | Harness: skill-creator
