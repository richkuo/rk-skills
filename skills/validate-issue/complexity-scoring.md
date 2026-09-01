# Complexity scoring procedure

Read this file completely on every validation. The canonical formula and routing table live only in the main skill.

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

Judgment-heavy work must raise Uncertainty or Coupling. Grade from the traced surface, then apply the step-6 formula.

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

- Fable 5.1 has a high-effort ceiling and never runs at xhigh.
- Fable is never the default builder. A Fable build requires explicit user direction.
- Derive the first-review trigger and model from the main skill's first-review table, which owns every first-review boundary. Its scale is coarser than the band table's: each first-review row groups whole bands rather than cutting across them, and it is still a separate table, but each row must start on a band edge above, so a band change that moves an edge this table uses moves this table with it, while a band split that only adds a new edge leaves it unchanged.
- Every reviewer above the standard trigger runs one blocking cycle only — however the main skill's first-review table or a stamped `PR review:` line selected it, at any score. Each blocking re-review steps down one rung: Fable to Opus, then to the standard reviewer, where the ladder stops; Opus to the standard reviewer for every blocking re-review. The step-down keys to the reviewer that ran cycle 1. The score band does not decide it. Neither heavy reviewer repeats, and the ladder never steps down to Sonnet.
- In subagent mode, bands with the standard trigger inherit the session reviewer. Sonnet takes the main skill's cheapest first-review row, and it is also the cheaper non-blocking re-review in every band; it sits below the ladder floor and takes no rung.
- A missing score routes as the highest band because its complexity is unknown. Missing means no `[C<score>]` prefix at all; a literal `[C0]` is a real score and routes on the lowest rows. Unknown holds for every stage — validate, build and review alike — so an issue with no prefix keeps the top band on all three even after the validator returns a low score.

When validation produces a higher score band than the issue title, revalidate once on the higher route and replace all stale routing stamps. Never lower routing from a validator rescore, at any stage and with no carve-out: the rescore raises validate, build and review routing and never weakens one of them. Safety carve-outs for money, data integrity, security, and auto-protective logic always force the capable path when Risk was under-scored.

Derive the `fableplan` signal, planner, builder, and effort from the main skill's band table.
