---
name: new-app-pipeline
description: Use when the user wants to take a new app from raw idea to running multi-agent implementation — "/new-app-pipeline", "let's build a new app", "run the app pipeline on this idea". Orchestrates the full sequence - idea → PRD → question refinement → GitHub issues with Execution blocks → execution-plan review → milestone workflow — with a user checkpoint between every stage.
---

# new-app-pipeline

The end-to-end process for starting a new app: capture the idea as a PRD, refine it by resolving every open question, break it into execution-ready GitHub issues, review the model/effort assignments, then run the milestone workflow. Each stage produces a durable artifact (PR, issues, workflow run) so the pipeline survives context resets — the conversation is never the state.

## Stages

| # | Stage | Skill | Artifact | Checkpoint before next stage |
|---|---|---|---|---|
| 1 | Idea → PRD | `app-prd` | `PRD.md` on a PR | User iterates on the draft, in bursts |
| 2 | Resolve questions | `prd-questions` | Updated PRD, empty Open Questions | User answered every batch |
| 3 | Merge the PRD PR | — | PRD on main | Explicit user go |
| 4 | Issues + milestones | `prd-to-issues` | Milestones, 15–25 issues with Execution blocks | User reviews the breakdown table |
| 5 | Execution plan | `execution-plan-review` | Revised Execution blocks | User settles the final table |
| 6 | Run a milestone | `milestone-workflow` | Workflow run → PRs → LGTMs | User approves the run plan (mandatory) |

## Rules

- **Never skip a checkpoint.** Every stage boundary stops for the user; the pipeline is collaborative at the joints and autonomous inside them.
- Stages are re-enterable: the user can jump back ("actually keep Drizzle", "12 should be medium") at any point — apply the revision to the artifact, not just the chat.
- Stage 6 repeats per milestone (v0, then v1, …), chaining workflow invocations where cross-phase dependencies require earlier merges.
- Tech-stack debates during stage 1–2 (framework, ORM, hosting) are settled in chat and recorded in the PRD's Platforms & Technology table — the PRD carries the decision, the chat carries the reasoning.
- All the standing rules apply throughout: worktree + PR for every change, attribution footers, `github-issue-format` before filing, best-solution over cheap-solution.

## Starting mid-pipeline

If the artifacts already exist (a PRD in the repo, issues filed), enter at the first stage whose artifact is missing or stale — never redo a finished stage. Verify by looking at the repo and issues, not by asking.
