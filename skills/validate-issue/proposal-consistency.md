# Proposal self-consistency procedure

Apply this after claim tracing and alongside Architecture.

## Lifetime and population

List every issue statement that says when proposed state is created, populated, read, cleared, or persisted:

| Source section | When | Medium | Survives restart |
|---|---|---|---|

Decide whether one store can satisfy every row. Mark ❌ when statements require incompatible lifetimes, such as load-time registration and cycle-only memory. Cite the existing load, validation, or cycle hook that supports the correction.

## Verb audit

Search the issue for `on add`, `on load`, `register`, `first access`, `each cycle`, `ephemeral`, `persist`, `cache`, `global`, and `shared`. Mark ❌ when one proposed noun uses incompatible timing verbs and the issue does not define separate layers.

## Benefits and existing facilities

Verify each deduplication, latency, or single-source benefit against the current baseline. Name existing facilities at their actual layer. Mark ⚠️ when a cache already deduplicates input/output but the issue claims all work is duplicated.

## Consumer completeness

Find all orchestrator, worker, subprocess, offline, and administrative consumers. Mark ⚠️ when the proposal migrates only part of the set and does not define a phase boundary.

## Failure policy

For each new fetch, process, or shared read, require miss, timeout, stale-value, startup, and error behavior. Compare it with the current inline path. A missing policy is ⚠️.

## Verdict

- ✅ **Consistent:** lifetime, population, benefits, consumer scope, and failure behavior agree.
- ⚠️ **Gaps:** statements do not conflict, but a required policy or deploy/consumer surface is missing.
- ❌ **Contradicts:** two sections require incompatible ownership, timing, or scope; state the required rewrite.

Any material ⚠️ or ❌ requires an issue-description update.
