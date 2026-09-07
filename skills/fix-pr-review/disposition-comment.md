# Disposition comment

Read for step 9. Follow the CLAUDE.md/AGENTS.md Response Style and attribution rules. This is a repair record; it does not issue a review verdict.

## Contents

Start with the PR head SHA, source review links or IDs, and whether the pass is complete or blocked. Say when no new commit was needed. For a blocked pass, distinguish local work from pushed work and identify unresolved findings explicitly.

Copy each original finding title **verbatim from the review comment** so the next review can match by claim. For compound or duplicate feedback, retain the original titles and source links, then identify the subclaim being disposed. Each item carries current `file:line` evidence or a log/issue link when that is the evidence.

Use only sections with content:

| Section | Required evidence |
|---|---|
| `### Fixed` | What changed and where. Name scope rule 1 when it overrode reviewer follow-up routing or rule 2; identify what this PR adds, changes, or endangers. |
| `### Corrected scope (partial)` | What holds and what fails, with a code-grounded correction. |
| `### Not changed (refuted)` | A self-contained code-grounded rebuttal, or evidence of a fix already present. A pre-existing CI failure uses base-run evidence. |
| `### Resolved judgment calls` | Implemented decision, evidence, and material rejected alternatives. |
| `### Resolved merge conflicts` | The hand-resolved set, how both intents survive, and the behavior decision that controls re-review. |
| `### Deferred to follow-up` | Scope rule 2 and the missing mechanism outside the PR scope, or the reviewer's follow-up routing, plus the covering issue URL. |
| `### Blocked` | Unresolved claim, confirmed evidence, work completed, and the missing fact, access, or decision. This section settles nothing. |
| `### Verification` | Checks run and results, checks not run, and remaining limitations. |
| `### Test edits` | Test and anchor; Outdated, Wrong, or Obsolete; independent checkable ground; replacement assertions or removal ground. Name the surviving test for a redundancy removal. |

A finding whose stated Reachability precondition is refuted records that routing change under **Corrected scope (partial), and nowhere else**. Name the trigger, the code that refutes it, whether the defect stands, and its new section. A remedy implemented in this push also gets a Fixed item; the partial item records the routing decision.

Every deferral **names both its basis and the issue number**; a deferral missing either half settles nothing. Rule 1 never permits deferral of a PR-caused defect. Preserve material deferred hazards in the explanation. If issue creation failed, use Blocked instead of claiming a deferral was filed.

Include the `Growth check:` values when step 4's threshold fired, and label uncertain inputs. End the prose with `## Plain simple English` under the shared definition, then the required Created attribution footer with the actual model and applicable harness.

## Publish and resume

Write the complete body to a file and use `gh pr comment <N> --repo <owner/repo> --body-file <file>`. Keep existing dispositions intact. If a write response is uncertain, fetch comments and match the head, sources, and body before retrying.

For each affected inline thread, reply to its root review comment with `gh api repos/{owner}/{repo}/pulls/<N>/comments/<root-comment-id>/replies -F body=@<reply-file>`. State the outcome and link the disposition, including the attribution footer. Cover all subclaims in that thread; leave thread resolution to the reviewer unless the user authorized it.

On resume, publish only missing replies or a missing trigger when the existing disposition still covers the current head and source set. A partially published pass never justifies duplicating every comment or advancing past unresolved work.

---
Updated with LLM: GPT-6 | high | Harness: skill-creator
