---
name: prd-to-issues
description: Turn a finished Product Requirements Document (PRD) into GitHub milestones and complete, scored issues with typed dependencies and Execution blocks. Use for "file the issues from the PRD", "/prd-to-issues", or "break this into GitHub issues". Stage 4 of the new-app-pipeline.
---

# prd-to-issues

Produce a complete, dependency-ordered backlog that an agent can implement from each issue and its cited PRD. The deliverable ends at verified GitHub issues; implementation and workflow dispatch require their own instruction.

Follow the target repository's CLAUDE.md/AGENTS.md Response Style and attribution rules. Read [github-issue-format](../github-issue-format/SKILL.md) before composing issue bodies. Read [validate-issue step 6](../validate-issue/SKILL.md#6-score-complexity) and its [complexity-scoring reference](../validate-issue/complexity-scoring.md) for scoring and routing; those sources own the formula, grades, and band tables. Use those sections without starting the validation workflow.

## 1. Establish the source and existing work

Identify the target repository, PRD revision, and requested release scope from the request and repository state. Read the full PRD, relevant repository instructions, implementation, and tests. Distinguish implemented behavior from planned work; an empty repository needs proposed implementation boundaries, clearly marked as proposed.

Fetch all relevant open and closed issues and milestones, with pagination. Compare bodies, acceptance criteria, and implementation evidence before reusing an issue; a matching title or closed state alone does not prove coverage. Preserve existing work and deliberate execution overrides. Resolve an ambiguous repository or conflicting source revision before any write.

Use a stable PRD link and its verified section heading or identifier in each issue. Prefer a commit-pinned source when available. If the source is local or uncommitted, identify its revision in the drafts and establish a durable source accessible to future agents before filing. Do not invent section numbers or publish source material outside the user's authorized destination.

## 2. Map requirements and dependencies

Hold the requirement-to-issue map, the complete draft bodies, the dependency graph, and the intended create/reuse/update action for each issue while you work.

- Map every in-scope requirement to a draft key, an existing issue, or verified implementation. Record exclusions and deferred requirements with their reason. Give shared invariants an owning issue and identify the consumers that must enforce them.
- Size issues around a coherent result that can be implemented and verified in one pull request (PR) after its prerequisites. Set no fixed issue count or milestone size. Keep inseparable changes together; use the scope-disposition criteria in `validate-issue` step 7 when splitting a large candidate.
- Derive milestones from prerequisite order and a verifiable completion outcome. Reuse suitable milestones and keep the user's release names and boundaries unless a conflict requires a decision. Do not move deferred roadmap features into the requested release.
- Assign stable local keys while drafting. **Depends on** records direct prerequisites whose code or product result the successor requires. **Runs after** records a direct ordering constraint when no result is required, such as independent changes to the same package that must not overlap. Shared location alone is insufficient; identify the actual conflict. When the successor needs the result, use Depends on.
- Preserve edge types and their reasons. Reject missing references, self-references, duplicate edges, a predecessor in both fields, and cycles across the combined graph. Recursively inspect referenced existing issues, including those outside the milestone. Milestone order must permit every prerequisite to finish before its successor; milestone membership alone supplies no edge. Identify serial prerequisites, concurrent work, and safety-critical issues.

If a missing product decision prevents a complete specification, hold that issue and its affected successors. Use [prd-questions](../prd-questions/SKILL.md) only for the blocking decision and the affected source sections; do not start a whole-roadmap sweep. Continue independent drafts and file complete independent issues within existing scope authorization, unless the user required the whole backlog to be settled first. Record the held requirements and report partial completion; never file a stub or treat the subset as full coverage.

## 3. Draft complete issues and execution metadata

Use `github-issue-format` for the title, rationale, body order, mandatory `## Plain simple English` section, and footer. Embed the issue's relevant requirements and acceptance criteria so that the PRD supplies context without becoming a substitute for the specification.

State the result, scope boundaries, implementation contracts, prerequisite outputs, and verification method. Include applicable failure paths and money, privacy, authorization, data-integrity, and irreversible-deletion invariants. Carry the PRD's worked examples into acceptance tests, checking their inputs and expected results against the stated rules. Resolve contradictions before filing; do not silently choose a rule.

Grade all five complexity axes from the proposed edit list and the proof required. Distinguish proposed sites from inspected sites, and record the evidence for each grade. Recompute the title score, rationale, and execution defaults together after scope changes.

Append exactly one Execution block before the footer. Use these field names with concrete values; local keys are permitted only in unpublished drafts:

- **Depends on:** comma-separated actual issue references, or `none`
- **Runs after:** comma-separated actual issue references, or `none`
- **Build model:** the score band's Build model
- **Effort:** the score band's Build effort
- **fableplan first:** the score band's `Yes` or `No`
- **PR review:** standard `@claude` review trigger

The standard PR review line leaves first-review routing to the pipeline and the `validate-issue` step 6 first-review table. Do not copy review boundaries or re-review rules here.

Omit **Validate effort:** and **Plan effort:** at initial filing unless explicitly requested; the owners supply the defaults. Never stamp a validate model. Never stamp Fable 5.1 as the Build model without a specific user instruction. Never stamp an external CLI harness as the Build model without a specific user instruction. Command-line interface (CLI) overrides use `<Name> (Codex CLI[, <model-id>])` or `<Name> (Cursor CLI[, <model-id>])`.

For user-directed model, effort, planner, or review overrides, read [execution-plan-review](../execution-plan-review/SKILL.md) and apply its validation and clamp rules to the draft. Preserve valid overrides. Do not execute the referenced build or review workflow.

## 4. Review the complete filing plan

Before writing to GitHub, make the complete drafts and coverage map available with a compact table of draft key, title, milestone, score, typed predecessors, and create/reuse/update action. Check that each in-scope requirement is covered, every criterion is verifiable, the combined graph is acyclic, routing matches scores or explicit overrides, and each milestone has a completion outcome.

Honor existing authorization to file. If the user requested review first or has not authorized filing, stop at this concrete plan and ask for the required approval. Do not ask again when the session already authorizes the proposed scope. When invoked through `new-app-pipeline`, preserve its stage checkpoints. A material scope or dependency change after approval needs reconciliation before filing.

## 5. File in dependency order and verify

Recheck GitHub for concurrent changes before writes. Reuse matching milestones; create only missing ones with their completion outcome in the description. Use an explicit target repository on every GitHub operation. Pass issue bodies as data through `gh issue create --body-file` or a structured tool argument; never interpolate PRD text into executable shell code.

Create issues sequentially in topological order across both edge types. Resolve each predecessor key to its verified GitHub number before creating the successor, so every new issue has its complete body and final Execution block at creation. Use the identifiers returned by GitHub; never predict numbering. Read back each created issue and confirm its number before proceeding.

For approved updates to existing issues, re-fetch the body and apply only the intended changes, preserving unrelated content and valid overrides. Revalidate the combined graph after any concurrent change. Do not close, reopen, delete, or move existing work merely to make the backlog fit.

If a create or update fails or returns an uncertain result, stop dependent writes. After an uncertain create, search GitHub for the source reference, title, and milestone before retrying, so the same issue is not filed twice. Never rerun the whole batch blindly, and never close or delete successful work as rollback. Report what was filed, what remains, and the blocker.

Read back the full filed set, including reused issues and milestones. Check saved titles, bodies, source references, milestone assignments, scores, routing fields, and actual dependency targets against the plan; rerun the combined graph and coverage checks. Resolve mismatches before reporting completion. Cross-milestone prerequisites remain explicit; [milestone-workflow run planning](../milestone-workflow/run-plan.md) owns their execution treatment.

## 6. Report the result

Return links to the milestones and created or updated issues, a compact score/title table, and any unresolved or deferred scope. Distinguish reused and already implemented work from new filings. Report partial completion and the next required decision when blocked. Do not claim the backlog is ready until the saved bodies and graph pass verification.

---
Updated with LLM: GPT-6 | high | Harness: Codex
