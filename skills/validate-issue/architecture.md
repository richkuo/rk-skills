# Architecture procedure

Use the traced runtime and repository invariants to assess placement and ownership. Inspect the actual entrypoint, dispatch or spawn site, process boundaries, and relevant lifetimes. A name such as "global", "cache", or "shared" does not establish visibility or authority.

## State and consumer contracts

Separate input retrieval, derived computation, authoritative storage, and consumption. An existing input cache may remove repeated reads while leaving repeated computation intact.

For each changed state item, establish the contract needed by the goal:

| Dimension | Evidence to establish |
|---|---|
| Owner and readers | Who can write, which consumers need it, and how they reach it |
| Lifetime and medium | Request, cycle, process, or restart lifetime; memory, storage, or service |
| Population | Writer, creation point, initialization order, invalidation, and reload |
| Consistency | Partition and key, concurrent access, ordering, and synchronization |
| Failure | Miss, stale value, timeout, startup, partial write, and recovery where applicable |

A worker's heap is local to that worker. Cross-process coordination needs an explicit communication or storage contract. Local recomputation on a miss must agree with the stated authority and deduplication goal. Require durability only when restart behavior requires it.

## Placement and affected sites

Compare the proposed owner with the component that can enforce the required visibility, lifetime, and consistency. Prefer an existing mechanism when it meets those requirements. Derive placement from the repository; an orchestrator is not automatically the owner of all shared state. Distinguish an architectural impossibility from a feasible change to an existing convention.

For each changed field or contract, find affected readers, writers, defaults, validators, serialization, reload copies, and tests at the baseline. Compare this set with the proposed edits and stated phase boundary. Read the complete load/apply sequence: early normalization can make a later unset guard ineffective, and later copies can discard a value. Cross-check this set with the claim evidence from step 3 rather than repeating the search.

## Verdict

- **Viable:** the relevant ownership, isolation, lifetime, consistency, and consumer contracts support the goal.
- **Underspecified:** a necessary contract or affected site is missing; supply a code-grounded correction where possible.
- **Infeasible:** the proposed mechanism cannot meet a required invariant, such as cross-process visibility or a single synchronized authority.

For a material defect, cite the baseline evidence and add `Optimal direction (this repo):` with the required placement and contract. Use Unverified when evidence is insufficient to decide viability. A finding must explain the consequence for the stated goal; optional design preferences do not require an issue update.

---
Updated with LLM: GPT-6 | high | Harness: Codex
