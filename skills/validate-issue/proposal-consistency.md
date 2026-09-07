# Proposal self-consistency procedure

Check the issue's own promises against each other. Reuse the code evidence and consumer contracts already traced; this pass does not repeat the architecture assessment.

## Follow the proposed behavior

Trace one complete scenario from input or trigger to the acceptance result. For each state item or phase, compare where it is created, populated, read, invalidated, and persisted across all sections. Record conflicting statements with their section or comment source. If two lifetimes are intentional, require distinct layers and their connection to be explicit.

Check the following where applicable:

- The approach achieves the stated goal and each acceptance criterion tests an observable result. A solution-shaped criterion alone does not prove that the reported problem is fixed.
- Repeated names, defaults, timing, ownership, and scope agree. A correction in Approach must also reach conflicting Goal or acceptance text.
- Claimed benefits still follow from the corrected baseline and the chosen mechanism. Preserve real differences between retrieval and computation, or between consumers.
- Partial migration names its phase boundary, coexistence behavior, and compatibility requirements. A consumer excluded from this phase must still work.
- Failure and recovery promises agree with the architecture contract. Mandatory safety behavior cannot become an unspecified fallback in another section.

## Verdict

- **Consistent:** the relevant goals, mechanism, criteria, and phase contracts agree.
- **Gaps:** a necessary result, policy, or affected consumer is missing.
- **Contradicts:** sections require incompatible behavior; name both statements and the required correction.

A material Gaps or Contradicts verdict requires an issue update. If choosing the correction requires unknown product intent or unavailable evidence, keep that uncertainty explicit and apply the main skill's readiness gate.

---
Updated with LLM: GPT-6 | high | Harness: Codex
