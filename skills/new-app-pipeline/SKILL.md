---
name: new-app-pipeline
description: Use when the user wants to take a new app from raw idea to running multi-agent implementation — "/new-app-pipeline", "let's build a new app", "run the app pipeline on this idea". Orchestrates the full sequence - idea → PRD → question refinement → GitHub issues with Execution blocks → execution-plan review → milestone pre-flight → milestone workflow — with a user checkpoint between every stage.
---

# new-app-pipeline

Each stage produces a durable artifact (PR, issues, workflow run), and those artifacts hold the pipeline state.

## Stages

| # | Stage | Skill | Artifact | Checkpoint before next stage |
|---|---|---|---|---|
| 1 | Idea → PRD | `app-prd` | `PRD.md` on a PR | User iterates on the draft, in bursts |
| 2 | Resolve questions | `prd-questions` | Updated PRD, empty Open Questions | User answered every batch |
| 3 | Review and merge the PRD PR | `fix-pr-review-loop` | PRD on main | Review loop to LGTM on the PRD PR, then explicit user go |
| 4 | Issues + milestones | `prd-to-issues` | Milestones, complete scoped issues with Execution blocks | User reviews the breakdown table |
| 5 | Execution plan | `execution-plan-review` | Revised Execution blocks | User settles the final table |
| 6 | Show the plan | `milestoneplan` | Single per-issue plan table (complexity, dependencies, models, efforts, plan, first review) | User reviews the table (recommended, not required) |
| 7 | Run a milestone | `milestone-workflow` | Workflow run → PRs → LGTMs | User approves the run plan (mandatory) |

## Rules

- **Never skip a checkpoint.** Every stage boundary stops for the user.
- Stages are re-enterable: the user can jump back ("actually keep Drizzle", "12 should be medium") at any point. Apply each revision to the artifact.
- Stages 6–7 repeat per milestone (v0, then v1, …), chaining workflow invocations where cross-phase dependencies require earlier merges.
- Stage 6 is read-only and skippable; it never edits an issue.
- Tech-stack debates during stage 1–2 (framework, ORM, hosting) are settled in chat and recorded in the PRD's Platforms & Technology table.
- The global CLAUDE.md rules apply throughout, including worktree + PR for every change, attribution footers, and `github-issue-format` before filing.

## Starting mid-pipeline

If the artifacts already exist (a PRD in the repo, issues filed), enter at the first stage whose artifact is missing or stale; never redo a finished stage. Verify from the repo and issues, without asking the user.

When a milestone already has Execution blocks, run `milestoneplan` first to check their state before treating stage 5 as finished.
