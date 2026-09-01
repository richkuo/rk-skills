# Architecture procedure

## Runtime topology

Trace the hot path from its entrypoint. Identify processes, threads, containers, or requests; who spawns or dispatches them; and each lifetime. Cite the spawn or dispatch site.

## Concern decomposition

Separate fetch/cache, compute/derive, authoritative storage, and consume/route concerns. An existing cache can deduplicate input/output without owning derived business results.

## Ownership checklist

For each shared or authoritative state item, require or derive:

| Question | Required answer |
|---|---|
| Owner | Component that sees all consumers or writes the record |
| Lifetime | Request, cycle, process, or persisted restart lifetime |
| Medium | Heap, database, file, queue, or remote procedure call |
| Population | Writer, timing, invalidation, and reload behavior |
| Consumer contract | Inject, pull, subscribe, or explicit recompute fallback |
| Failure policy | Miss, stale value, timeout, and error behavior |

Mark the design ⚠️ when a required answer is absent, and supply the code-grounded answer when possible.

## Isolation boundaries

- Worker heap state is invisible to peer workers without an inter-process contract.
- Disk, database, or shared services can coordinate across workers; heap-only state cannot.
- A leaf-worker global has only that worker's scope.
- Local recomputation on a miss can defeat deduplication or authoritative-store goals; require it to be explicit.

## Layer placement

Place fan-in, deduplication, cycle state, and routing in the orchestrator. Place per-job handling in workers, pure shared logic in one library, and restart-safe authority in persistence. Prefer existing inject or precompute paths over new infrastructure. When the proposed owner cannot see all consumers, cite the parent or service that can.

## Touch-set completeness

Treat every proposed site list as a set claim. Search each affected field or symbol across its package. Enumerate all readers, writers, defaults, validators, serializers, reload copies, and tests. Diff that set against the issue.

Read the complete load/apply sequence around each proposed edit. Check for an earlier normalization that pre-empts an unset guard and for a later copy/apply site that the issue omitted. An unnamed required site makes architecture ⚠️ or ❌.

For aggregates or shared state, also confirm that the enclosing partition boundary and key match the scope that feeds the facility.

## Verdict

- ✅ **Viable:** topology, owner, medium, timing, consumer contract, and failure policy match the repo.
- ⚠️ **Underspecified:** the problem is valid, but placement or an ownership contract is missing.
- ❌ **Infeasible:** the proposal violates isolation, duplicates authority without synchronization, or conflicts with established architecture.

For ⚠️ or ❌, add `Optimal direction (this repo):` with the concrete placement and contract supported by cited code.
