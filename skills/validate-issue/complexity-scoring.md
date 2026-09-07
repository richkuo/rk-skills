# Complexity scoring procedure

The main skill's step 6 owns the formula and routing tables. This reference owns axis grading. Score the correct implementation, including required corrections to the proposal, rather than the issue's original file list.

## Grading rules

Build an evidence-backed edit list first: source, tests, contracts, migrations, configuration, parallel implementations, initialization, and documentation that must change. Include affected sites hidden from the issue's proposed diff.

At validation, grade first and compare second: derive every grade from this list before you look up the grades the issue's rationale line states for comparison. Cite one piece of evidence per grade, such as a checked file count, shared contract, persisted effect, open design question, or required test kind. Take the higher anchor when two fit; grade 2 is never a default.

Record one `Axes:` entry per grade and one `Differs:` entry per mismatch. Recompute the arithmetic from the five grades. Follow `issue-editing.md` Routing corrections for stored score changes; a prefix above the recomputed score keeps its value. Never lower routing from a validator rescore.

## Build the edit list first

Scope counts every required file, including tests and documentation. Verification reflects the proof the correct implementation needs, even if the issue omits it. Avoid forcing tests into a documentation-only edit when static inspection is sufficient.

Grade Uncertainty from unresolved choices and omitted sites. A code-grounded direction that the issue has not adopted is still an issue correction. If architecture or consistency has an unresolved design defect, Capability cannot be 0 or 1. Identify the assumption and its effect on the score; use a provisional range when helpful. When the central behavior or implementation surface cannot be established, apply the main skill's readiness gate instead of emitting a precise completed verdict.

## Axis anchors

Every axis takes one integer grade from 0 to 4. Cite the anchor that matches.

### Scope (feeds Volume)

| Grade | Anchor |
|---|---|
| 0 | One file, one localized region |
| 1 | One file in several regions, or two files in one package (for example a source file and its test) |
| 2 | Three to five files in one layer or package |
| 3 | Six to fourteen files, or files in two layers or languages |
| 4 | Fifteen or more files, or files in two or more layers plus a new abstraction, module, or contract that other code calls |

Count every file on the edit list, tests and docs included. A mechanical change that touches fifteen or more files is Scope 4 even when each edit is trivial. A new abstraction inside one layer raises Scope only by its file count.

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

**Safety class (money, data integrity, security, auto-protective logic):** Risk is never below 3. Risk is 4 on the enforcing path: the code that moves the money, writes or deletes the record, decides the permission, or fires the guard, however small the diff. A change beside that path (its config, its logging, its tests) is Risk 3.

### Uncertainty (feeds Capability)

| Grade | Anchor |
|---|---|
| 0 | Fully specified: the edit list is complete, every site is named, and the behavior is settled |
| 1 | Mechanism and sites known; small choices of value, wording, or placement remain |
| 2 | Mechanism known; the site set or the shape needs discovery (which files, which threshold, which format) |
| 3 | Two or more viable designs, and the choice changes the edit list; the issue does not settle it, or the verdict settles it with a named Optimal that the issue has not adopted |
| 4 | Open design judgment: the correct behavior itself is undetermined, or an architecture or consistency gap stays unresolved after step 5 |

Grades 0 and 1 are checkable: compare the sites the issue names with the sites the trace found. A site the trace found and the issue does not name makes Uncertainty 2 at least. A hard decision is never Uncertainty 0.

### Verification (feeds Volume)

| Grade | Anchor |
|---|---|
| 0 | Static inspection or a focused local unit check with no fixture |
| 1 | Unit tests with a small fixture or a golden file |
| 2 | Several units and fixtures, or a contract test that reads several files |
| 3 | An integration test with a subprocess, a network or service stub, or a database fixture, or a parity test across two implementations |
| 4 | End-to-end or live-service proof, hardware, timing or concurrency reproduction, or state that is hard to reproduce |

Grade the proof the correct implementation needs, including the tests the change must add or rewrite. The tests the issue happens to mention set no grade.

## Compute and report

Apply the step-6 formula and report all five grades with their evidence. The driver is the higher of Risk and Uncertainty, or the Coupling floor. The completed-verdict template in step 8 owns the output shape.

## Reachable scores

Volume is even. Capability 0 and 1 require Coupling at most 2, which caps Volume at 20. These rows show minimum and maximum values; only even Volume increments are reachable.

| Capability | Scores |
|---|---|
| 0 | 0 to 20 |
| 1 | 25 to 45 |
| 2 | 50 to 74 |
| 3 | 75 to 99 |

With the current tables, the build model follows Capability alone. Volume selects effort and can carry the score across the next band edge, changing validation, planning, or first review. Do not confuse a retained title routing floor with a new evidence-based score.

## Golden examples (consistency checklist)

| Axes (S,C,R,U,V) | Capability | Volume | Score | Score rationale |
|---|---|---|---|---|
| (4,0,0,0,0) | 0 | 8 | **8** | Scope raises Volume without raising Capability |
| (4,2,1,1,4) | 0 | 20 | **20** | The largest Capability 0 score: a mechanical change stays on Sonnet at xhigh |
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

The step-6 tables are the single source for routing boundaries. If boundaries change, a moved edge that a first-review row starts on moves that table; otherwise the review table stays unchanged. Currently bands 4 and 5 differ in validate effort and in first reviewer.

A missing title score routes as the highest band; `[C0]` is a real score. The main skill's step 8 owns the effective fableplan signal, including title floors and safety findings. A calling workflow owns model dispatch and any revalidation on a higher route; plain validation does not silently switch models or launch another agent. Report unavailable required routing to the caller. The issue-editing reference owns upward-only stamp corrections and protected harness overrides.

---
Updated with LLM: GPT-6 | high | Harness: Codex
