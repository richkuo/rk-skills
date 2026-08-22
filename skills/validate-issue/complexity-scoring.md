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
| (0,0,4,0,0) | 3 | 0 | **75** | Risk 4 maps to Capability 3 |
| (0,0,3,0,0) | 2 | 0 | **50** | Risk 3 maps to Capability 2 |

## Routing details

- Fable 5 has a high-effort ceiling and never runs at xhigh.
- Fable is never the default builder. A Fable build requires explicit user direction.
- Derive the first-review trigger and model from the main skill's first-review table, whose boundaries (10, 40 and 80) differ from the band table's.
- After a Fable first review, the blocking re-reviews step down one rung each — Opus first, then the standard reviewer. Fable does not repeat.
- In subagent mode, bands with the standard trigger inherit the session reviewer; Sonnet appears only for a cheaper non-blocking re-review.
- A missing score routes as the highest band because its complexity is unknown.

When validation produces a higher score band than the issue title, revalidate once on the higher route and replace all stale routing stamps. Never lower routing from a validator rescore. Safety carve-outs for money, data integrity, security, and auto-protective logic always force the capable path when Risk was under-scored.

Derive the `fableplan` signal, planner, builder, and effort from the main skill's band table.
