# Complexity scoring procedure

The canonical formula and both routing tables live only in the main skill.

## Build the edit list first

List the concrete files, functions, references, migrations, tests, and documentation that the correct implementation must change. Count parallel live/offline paths, schema or config versions, initialization surfaces, startup probes, command-line contracts, and invalidated documentation.

If architecture or consistency remains ⚠️ or ❌, raise Uncertainty and report a score-band range. Name the one unknown that drives the range. A design defect cannot route through Capability 0 or 1.

## Grade the axes

| Axis | 0 | 2 | 4 |
|---|---|---|---|
| Scope | One localized file | A few files in one layer | Many files across layers plus a new abstraction |
| Coupling | Pure local change | One shared mechanism | Multiple systems or cross-boundary coordination |
| Risk | Read-only or offline | Reversible writes with contained impact | Money, security, data integrity, or irreversible effects |
| Uncertainty | Fully specified | Mechanism known; shape needs discovery | Open design judgment |
| Verification | Pure helper unit test | Several units and fixtures | Integration, parity, subprocess, or difficult state |

Judgment-heavy work raises Uncertainty or Coupling. Grade from the traced surface, then apply the step-6 formula.

#### Golden examples (consistency checklist)

| Axes (S,C,R,U,V) | Capability | Volume | Score | Score rationale |
|---|---|---|---|---|
| (4,0,0,0,0) | 0 | 8 | **8** | Scope raises Volume without raising Capability |
| (0,0,0,4,0) | 3 | 0 | **75** | Uncertainty 4 maps to Capability 3 |
| (0,4,1,1,0) | 2 | 8 | **58** | Coupling 4 forces Capability 2 |
| (0,3,0,0,0) | 2 | 6 | **56** | Coupling 3 is the floor boundary and forces Capability 2 |
| (0,2,0,0,0) | 0 | 4 | **4** | Coupling 2 sits below the floor and forces nothing |
| (0,0,4,0,0) | 3 | 0 | **75** | Risk 4 maps to Capability 3 |
| (0,0,3,0,0) | 2 | 0 | **50** | Risk 3 maps to Capability 2 |

## Routing details

- Fable 5.1 never runs at xhigh; high is its ceiling. Fable is never the default builder, and a Fable build requires explicit user direction.
- The main skill's band table owns the `fableplan` signal, planner, builder, and effort. Its first-review table owns every first-review boundary; each row starts on a band edge, so a moved band edge moves that table, and a new edge alone leaves it unchanged.
- Re-review step-down is owned by `skills/fix-pr-review/rereview-routing.md`. In subagent mode the standard-trigger rows inherit the session reviewer, and Sonnet serves the cheapest first-review row plus every non-blocking re-review; it takes no rung on the ladder.
- A missing score routes as the highest band at every stage: validate, build, and review. Missing means no `[C<score>]` prefix at all; a literal `[C0]` is a real score and routes on the lowest rows. An issue with no prefix keeps the top band on all three stages even after the validator returns a low score.
- When validation produces a higher band than the issue title, revalidate once on the higher route and replace all stale routing stamps. Never lower routing from a validator rescore at any stage: the rescore raises validate, build, and review routing and weakens none of them. The safety carve-out for money, data integrity, security, and auto-protective logic forces the capable path when Risk was under-scored.
