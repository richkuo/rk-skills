# Complexity scoring procedure

The canonical formula and both routing tables live only in the main skill. This file owns the axis anchors, the grading rules, the reachable-score lattice, and the golden examples.

## Build the edit list first

List the concrete files, functions, references, migrations, tests, and documentation that the correct implementation must change. Count parallel live/offline paths, schema or config versions, initialization surfaces, startup probes, command-line contracts, and invalidated documentation. Count the files on this list: Scope and Verification are graded from it.

If architecture or consistency remains Conditional or Refuted after step 5, grade Uncertainty from that gap and report a score-band range. Name the one unknown that drives the range. A design defect cannot route through Capability 0 or 1.

## Grade the axes

Every axis takes one integer grade from 0 to 4, and each grade has one anchor below. Grade from the traced edit list and cite the anchor that matches. When two anchors fit, take the higher one. Grade 2 needs its anchor like every other grade; it is never a default.

### Scope (feeds Volume)

| Grade | Anchor |
|---|---|
| 0 | One file, one localized region |
| 1 | One file in several regions, or two files in one package (for example a source file and its test) |
| 2 | Three to five files in one layer or package |
| 3 | Six or more files, or files in two layers or languages, with no new abstraction |
| 4 | Many files across layers plus a new abstraction, module, or contract that other code calls |

Count every file on the edit list, tests and docs included. A mechanical change that touches thirty files is Scope 4 even when each edit is trivial.

### Coupling (feeds Volume and the Capability floor)

| Grade | Anchor |
|---|---|
| 0 | No shared mechanism; the change stays inside its own module |
| 1 | Calls or reads a shared helper or contract and leaves that contract unchanged |
| 2 | Changes the behavior or contract of one shared mechanism; its callers or copies must follow |
| 3 | Two or more shared mechanisms, one contract mirrored in several copies that must stay consistent, or a schema, config-version, or migration step |
| 4 | Coordination across a process, machine, or service boundary; locking, ordering, or concurrency; live/offline or dual-language parity; hot reload |

### Risk (feeds Capability)

| Grade | Anchor |
|---|---|
| 0 | Read-only, docs, tests, or offline tooling; no runtime behavior changes |
| 1 | Additive runtime behavior that no existing path depends on; a wrong result is visible, and a revert restores it |
| 2 | Changes existing runtime behavior; reversible, with a contained blast radius; no persisted data and no external side effect |
| 3 | Writes persisted or shared state, causes a recoverable external side effect, touches a permission or auth surface, or changes an auto-protective mechanism (limit, guard, kill switch, review gate); a wrong result needs cleanup |
| 4 | Money moves, a write or delete is irreversible, stored records can lose integrity, secrets or credentials are handled, authorization is enforced, or code executes against a live production system |

**Safety class (money, data integrity, security, auto-protective logic):** Risk is never below 3. Risk is 4 when the change is on the enforcing path: the code that moves the money, writes or deletes the record, decides the permission, or fires the guard. A change beside that path (its config, its logging, its tests) is Risk 3. A tiny diff on the enforcing path is still Risk 4.

### Uncertainty (feeds Capability)

| Grade | Anchor |
|---|---|
| 0 | Fully specified: the edit list is complete, every site is named, and the behavior is settled |
| 1 | Mechanism and sites known; small choices of value, wording, or placement remain |
| 2 | Mechanism known; the site set or the shape needs discovery (which files, which threshold, which format) |
| 3 | Two or more viable designs, and the choice changes the edit list; the issue does not settle it, or the verdict settles it with a named Optimal that the issue has not adopted |
| 4 | Open design judgment: the correct behavior itself is undetermined, or an architecture or consistency gap stays unresolved after step 5 |

Judgment-heavy work raises Uncertainty or Coupling. A hard decision is never Uncertainty 0.

### Verification (feeds Volume)

| Grade | Anchor |
|---|---|
| 0 | A pure helper with a unit test and no fixture |
| 1 | Unit tests with a small fixture or a golden file |
| 2 | Several units and fixtures, or a contract test that reads several files |
| 3 | An integration test with a subprocess, a network or service stub, or a database fixture, or a parity test across two implementations |
| 4 | End-to-end or live-service proof, hardware, timing or concurrency reproduction, or state that is hard to reproduce |

Grade the proof the correct implementation needs, including the tests the change must add or rewrite. The tests the issue happens to mention set no grade.

## Compute and report

Apply the step-6 formula to the five grades. Write all five grades in the rationale line and in the verdict line, in this shape:

`Capability 2 (Risk 3, Uncertainty 2 — <driver reason>); Volume 12 (Scope 2, Coupling 2, Verification 2)`

The driver is the axis and grade that set Capability: the higher of Risk and Uncertainty, or the Coupling floor. Recompute the score from the five grades before you post it. A score that the grades do not produce is an arithmetic slip, so fix the score. A title prefix that differs from the recomputed score is an update.

## Reachable scores

Volume is always even. Capability 0 and 1 need Coupling 2 or lower, so their Volume is at most 20.

| Capability | Scores |
|---|---|
| 0 | 0 to 20 |
| 1 | 25 to 45 |
| 2 | 50 to 74 |
| 3 | 75 to 99 |

Scores 21 to 24 and 46 to 49 cannot occur. Band 2 therefore holds exactly Capability 1. Band 3 holds Capability 2 up to Volume 20. Band 4 holds Capability 2 at Volume 22 or 24 together with Capability 3 up to Volume 4. Band 5 holds Capability 3 from Volume 6.

## Golden examples (consistency checklist)

| Axes (S,C,R,U,V) | Capability | Volume | Score | Score rationale |
|---|---|---|---|---|
| (4,0,0,0,0) | 0 | 8 | **8** | Scope raises Volume without raising Capability |
| (4,2,1,1,4) | 0 | 20 | **20** | The largest Capability 0 score: a mechanical grind stays on Sonnet at xhigh |
| (0,0,2,0,0) | 1 | 0 | **25** | Risk 2 alone moves the build to Opus |
| (0,0,0,4,0) | 3 | 0 | **75** | Uncertainty 4 maps to Capability 3 |
| (0,4,1,1,0) | 2 | 8 | **58** | Coupling 4 forces Capability 2 |
| (0,3,0,0,0) | 2 | 6 | **56** | Coupling 3 is the floor boundary and forces Capability 2 |
| (0,2,0,0,0) | 0 | 4 | **4** | Coupling 2 sits below the floor and forces nothing |
| (0,0,4,0,0) | 3 | 0 | **75** | Risk 4 maps to Capability 3 |
| (0,0,3,0,0) | 2 | 0 | **50** | Risk 3 maps to Capability 2, so score 50 opens band 3 |
| (2,2,3,2,2) | 2 | 12 | **62** | The common shape: one persisted write with a known mechanism |
| (2,2,4,3,3) | 3 | 14 | **89** | A money path at Risk 4 with an open design choice; fableplan yes |

## Routing details

- Fable 5.1 never runs at xhigh; high is its ceiling. Fable is never the default builder, and a Fable build requires explicit user direction.
- The main skill's band table owns the `fableplan` signal, planner, builder, and effort. Its first-review table owns every first-review boundary; each row starts on a band edge, so a moved band edge moves that table, and a new edge alone leaves it unchanged.
- Build effort never decreases as the band rises. Bands 3, 4, and 5 all build on Opus 5 at xhigh; bands 4 and 5 differ in validate effort only.
- Re-review step-down is owned by `skills/fix-pr-review/rereview-routing.md`. In subagent mode the standard-trigger rows inherit the session reviewer, and Sonnet serves the cheapest first-review row plus every non-blocking re-review; it takes no rung on the ladder.
- A missing score routes as the highest band at every stage: validate, build, and review. Missing means no `[C<score>]` prefix at all; a literal `[C0]` is a real score and routes on the lowest rows. An issue with no prefix keeps the top band on all three stages even after the validator returns a low score.
- When validation produces a higher band than the issue title, revalidate once on the higher route and replace all stale routing stamps. Never lower routing from a validator rescore at any stage: the rescore raises validate, build, and review routing and weakens none of them. The safety carve-out for money, data integrity, security, and auto-protective logic forces the capable path when Risk was under-scored.
