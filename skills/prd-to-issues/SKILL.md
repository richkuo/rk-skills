---
name: prd-to-issues
description: Turn a finished Product Requirements Document (PRD) into GitHub milestones and complete, scored issues with typed dependencies and Execution blocks. Use for "file the issues from the PRD", "/prd-to-issues", or "break this into GitHub issues". Stage 4 of the new-app-pipeline.
---

# prd-to-issues

Produce a complete, dependency-ordered backlog an agent can implement from each issue plus its cited PRD. The deliverable ends at verified GitHub issues; building and dispatch need their own instruction.

Follow the target repo's CLAUDE.md/AGENTS.md Response Style and attribution rules. Read [github-issue-format](../github-issue-format/SKILL.md) before composing bodies. Read [validate-issue step 6](../validate-issue/SKILL.md#6-score-complexity) and its [complexity-scoring reference](../validate-issue/complexity-scoring.md) for scoring and routing; they own the formula and band tables. Do not start the validation workflow.

## 1. Establish the source and existing work

- Identify the target repo, PRD revision, and release scope. Read the full PRD, repo instructions, code, and tests; separate implemented from planned work. In an empty repo, mark proposed boundaries as proposed.
- Fetch all open and closed issues and milestones, with pagination. Reuse an issue only after comparing body, acceptance criteria, and implementation evidence; a matching title or closed state proves nothing. Preserve existing work and deliberate execution overrides.
- Cite a stable PRD link with its verified section heading; prefer a commit-pinned source. A local or uncommitted source gets a durable, accessible home before filing. Never invent section numbers or publish source material outside the authorized destination.
- Resolve an ambiguous repo or conflicting source revision before any write.

## 2. Map requirements and dependencies

Hold the requirement-to-issue map, draft bodies, dependency graph, and each issue's create/reuse/update action while you work.

- Map every in-scope requirement to a draft key, an existing issue, or verified implementation. Record exclusions and deferrals with reasons. Give each shared invariant an owning issue and name the consumers that enforce it.
- Size each issue as one coherent result, implementable and verifiable in one pull request (PR) after its prerequisites. No fixed issue count or milestone size. Keep inseparable changes together; split large candidates by `validate-issue` step 7.
- Derive milestones from prerequisite order plus a verifiable completion outcome. Reuse suitable milestones and the user's release names; never pull deferred roadmap features into the requested release.
- **Depends on**: the successor needs the predecessor's code or product result. **Runs after**: ordering only, such as independent edits to one package that must not overlap; name the actual conflict, since a shared location alone is not enough.
- Reject missing references, self-references, duplicate edges, a predecessor in both fields, and cycles across the combined graph, recursing into referenced existing issues outside the milestone. Milestone order must let every prerequisite finish first; membership alone is no edge. Mark serial prerequisites, concurrent work, and safety-critical issues.

If a missing product decision blocks a complete spec, hold that issue and its successors. Run [prd-questions](../prd-questions/SKILL.md) for that decision only. Keep drafting and filing independent issues within existing authorization unless the user wants the whole backlog settled first. Report the held requirements as partial completion; never file a stub.

## 3. Draft complete issues and execution metadata

Use `github-issue-format` for title, rationale, body order, the mandatory `## Plain simple English` section, and footer. Embed the issue's requirements and acceptance criteria; the PRD gives context, never the spec.

State the result, scope boundaries, contracts, prerequisite outputs, and verification method. Include failure paths and money, privacy, authorization, data-integrity, and irreversible-deletion invariants. Carry the PRD's worked examples into acceptance tests after checking them against the stated rules; resolve contradictions before filing.

Grade all five axes from the proposed edit list and required proof, recording evidence per grade and marking proposed versus inspected sites. Re-score title, rationale, and execution defaults together after any scope change.

Append exactly one Execution block before the footer; local keys appear only in unpublished drafts:

- **Depends on:** issue references, comma-separated, or `none`
- **Runs after:** issue references, comma-separated, or `none`
- **Build model:** the band's Build model
- **Effort:** the band's Build effort
- **fableplan first:** the band's `Yes` or `No`
- **PR review:** standard `@claude` review trigger

First-review routing belongs to the pipeline and the `validate-issue` step 6 table; copy no review rules here. Omit **Validate effort:** and **Plan effort:** unless requested. Never stamp a validate model. Never stamp Fable 5.1 as the Build model without a specific user instruction. Never stamp an external CLI harness as the Build model without one either; CLI overrides use `<Name> (Codex CLI[, <model-id>])` or `<Name> (Cursor CLI[, <model-id>])`. For user-directed overrides, apply the validation and clamp rules in [execution-plan-review](../execution-plan-review/SKILL.md) without running its workflow.

## 4. Review the filing plan

Before any write, present the drafts and coverage map with a table of draft key, title, milestone, score, typed predecessors, and action. Confirm every requirement is covered, every criterion is verifiable, the graph is acyclic, routing matches scores or overrides, and each milestone has a completion outcome.

Honor existing authorization. If the user asked to review first or has not authorized filing, stop here and ask; do not ask again when the session already covers this scope. Under `new-app-pipeline`, keep its stage checkpoints. A material scope or dependency change after approval needs reconciliation first.

## 5. File in dependency order and verify

- Recheck GitHub for concurrent changes. Reuse matching milestones; create missing ones with their completion outcome. Name the target repo on every GitHub call. Pass bodies as data via `gh issue create --body-file`; never interpolate PRD text into shell code.
- Create issues one at a time in topological order over both edge types, resolving each predecessor to its verified GitHub number first so every body and Execution block is final at creation. Use the numbers GitHub returns; never predict them. Read back each issue before continuing.
- For approved updates, re-fetch the body and apply only the intended delta, preserving unrelated content and valid overrides. Never close, reopen, delete, or move existing work to make the backlog fit.
- On a failed or uncertain write, stop dependent writes. Search GitHub for the source reference, title, and milestone before retrying so nothing is filed twice. Never rerun the batch blindly or roll back by closing or deleting filed work. Report what was filed, what remains, and the blocker.
- Read back the full set, reused items included. Check titles, bodies, source references, milestones, scores, routing fields, and dependency targets against the plan; rerun the graph and coverage checks and fix mismatches before reporting. Cross-milestone prerequisites stay explicit; [milestone-workflow run planning](../milestone-workflow/run-plan.md) owns their execution.

## 6. Report

Return milestone and issue links, a compact score/title table, and any unresolved or deferred scope. Separate reused and already-implemented work from new filings. When blocked, report partial completion and the next decision. Claim readiness only after the saved bodies and graph pass verification.
