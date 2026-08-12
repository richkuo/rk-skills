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

| Axes (S,C,R,U,V) | Capability | Volume | Score | Routing meaning |
|---|---|---|---|---|
| (4,0,0,0,0) | 0 | 8 | **8** | Large mechanical work uses Sonnet 5 at high effort |
| (0,0,0,4,0) | 3 | 0 | **75** | Small hard design uses a Fable plan and Opus 5 build |
| (0,4,1,1,0) | 2 | 8 | **58** | Heavy coordination uses Opus 5 at xhigh effort |
| (0,0,4,0,0) | 3 | 0 | **75** | Small safety work uses a Fable plan and Opus 5 build |
| (0,0,3,0,0) | 2 | 0 | **50** | Elevated impact uses Opus 5 at xhigh effort |

## Routing details

- Fable 5 has a high-effort ceiling and never runs at xhigh.
- Fable is never the default builder. A Fable build requires explicit user direction.
- The first review uses the standard trigger at scores 0–20, Opus 5 at 21–80, and Fable 5 high at 81–99.
- After a Fable first review, all blocking re-reviews use the standard reviewer. Fable does not repeat.
- In subagent mode, scores 0–20 inherit the session reviewer; Sonnet appears only for a cheaper non-blocking re-review.
- A missing score routes as the highest band because its complexity is unknown.

When validation produces a higher score band than the issue title, revalidate once on the higher route and replace all stale routing stamps. Never lower routing from a validator rescore. Safety carve-outs for money, data integrity, security, and auto-protective logic always force the capable path when Risk was under-scored.

Set `fableplan: yes` for scores 61 or higher. The planner is Fable 5; the builder remains Opus 5 at high effort through 80 and xhigh from 81. Set `no` below 61.
