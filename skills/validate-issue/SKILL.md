---
name: validate-issue
description: Use when the user asks to validate, review, or check whether a GitHub issue is valid. Takes a GitHub issue URL or number (defaults to the latest open issue in the current repo). Verifies every factual claim against the actual code with file:line citations rather than trusting the author's description; for non-trivial proposals, also checks architectural feasibility and proposal self-consistency.
---

# validate-issue

Validate a GitHub issue by tracing every factual claim to the code — never trust the author's description of current behavior, even the repo owner's. Validate **everything** the issue asserts, not just "Current Behavior": a named root cause, cited `file:line`, or recommended fix are *additional* claims, not shortcuts — a confident root cause can point at the wrong path, a citation can be stale, a fix can be infeasible even when the symptom is real, so run the proposal through 5a/5c however authoritative it reads. The deliverable is one end-to-end judgment — summary, behavior, root cause, citations, fix.

## Input

The user provides one of:
- Full URL: `https://github.com/<owner>/<repo>/issues/<N>`
- Short form: `#<N>` or just `<N>` (use the current repo)
- `owner/repo#N`
- **Nothing** — default to the latest (most recently created) open issue in the current repo.

## Steps

### 0. Baseline: validate against the current default branch — NO worktree yet

**Do not create a worktree for validation or for `update issue` edits.** A worktree is created only when the user explicitly says to **work on** the issue (step 7.5) — validation and title/description edits run from the existing checkout.

So that claims trace against the repo's current default branch (`main`, `master`, or whatever the repo uses — never assume) rather than a stale or divergent local checkout, resolve it and refresh the baseline first:

```bash
DEFAULT=$(gh repo view --json defaultBranchRef --jq .defaultBranchRef.name)
git fetch origin "$DEFAULT"
git branch --show-current                                    # which branch the working tree is on
git rev-list --left-right --count "origin/$DEFAULT...HEAD"   # <behind> <ahead> vs origin
```

Read files directly only when that count is `0 0`, or when the differing commits don't touch the paths you'll inspect (`git diff --name-only HEAD "origin/$DEFAULT"`). Otherwise trace via `git show "origin/$DEFAULT":<path>` instead of the working-tree copy. **Merely *behind* counts as stale:** `git fetch` updates only the remote-tracking ref, never your checkout, so an unpulled default branch silently traces outdated code. Note in the verdict which baseline you used.

### 1. Fetch the issue

Given a number/URL, view directly (`--repo` optional — omit to use the current repo). **Always include `--comments`** — corrections, "actually already fixed by …" notes, and scope changes live in the comment thread, and depth rule 3 depends on them:

```bash
gh issue view <N> --repo <owner>/<repo> --comments
```

If no issue was provided, resolve the latest first (newest-first by creation date), then view it; state which number you resolved to:

```bash
N=$(gh issue list --limit 1 --json number --jq '.[0].number')
gh issue view "$N" --comments
```

**Then check for PRs already addressing it** — an in-flight or merged PR changes the verdict, and cross-referenced PRs do NOT appear in `--comments`:

```bash
gh api "repos/<owner>/<repo>/issues/<N>/timeline" --paginate \
  --jq '.[] | select(.event == "cross-referenced" and .source.issue.pull_request)
        | .source.issue | "PR #\(.number)  \(.state)\(if .pull_request.merged_at then " (merged)" else "" end)  \(.title)"'
```

A **merged** PR that already implements the fix usually means the "before" baseline is gone (depth rule 3) — verify the claims against post-merge code and recommend closing or repurposing the issue in the verdict. An **open** PR means overlapping in-flight work — name it under Concerns so the fix isn't duplicated.

### 2. Extract factual claims

List every concrete claim about *current* behavior — e.g.:
- "Function X is called when Y happens"
- "Only A is sent to the external system, B and C are not"
- "Field F defaults to V"
- "On crash/error, behavior B occurs"

Claims about *desired* behavior (the proposal) aren't factual claims — skip them for step 3, but extract them for **5 and 5c**. Also extract **proposal design assertions** (mandatory for 5c):
- **Lifetime** — per request, per cycle, process lifetime, on load/reload, persisted across restarts
- **Population timing** — "on add", "on load", "on first access", "each cycle", "on demand"
- **Benefits** — dedup, SSoT, latency, fewer fetches (each implies a *current* baseline — rule 3)
- **Deploy surface** — new subprocess/service, argv/CLI/env contract, startup checks, migration

Flag the proposal for **5a + 5c** when it's more than a localized bugfix — new subsystem, cross-cutting refactor, dedup/SSoT, new layer/service, shared/global state, multi-consumer coordination, or analogies to existing infra ("like the X cache", "central calculator"). Keywords aren't enough; judge from scope.

### 3. Verify each claim

For each claim, find the code path that confirms or refutes it; cite `file:line`.

**Critical:** "Function X exists" ≠ "X fires for the scenario discussed." Trace conditionals fully — if X is gated on `flag > 0`, find what sets `flag` for the issue's case. If behavior depends on config, identify which config produces it and which doesn't.

**Depth rules (this is where validation actually fails — each rule opens with its trigger; apply every rule that fires):**

1. **Trigger: a claim names a wrapper/helper by its intent.** Read into the body, not the call site — a name states intent, not behavior. A wrapper named for one concern often delegates elsewhere or short-circuits (early-return, flag off, other branch) in a state the claim ignores; trace each named symbol one level deeper than feels necessary.

2. **Trigger: a claim covers a set ("all N of X", "every consumer", "each dispatch").** The grouping is itself a claim. Grep the real call sites, establish true membership from code, and **diff against the claimed set**. Usual failure: a listed member that's actually a separate path (never calls the function), or a missing one.

3. **Trigger: a benefit claim ("eliminates the lag", "removes duplicate work", "unifies the two paths").** A benefit asserts a *current* broken state as premise — itself a factual claim. Confirm the "before" still exists: a recent commit may have already fixed it (`git log`/comments), or it was never broken as described. If the baseline is gone, mark the benefit ❌/⚠️ and narrow the payoff.

4. **Trigger: a claim joins clauses ("and"/"but", "not X, just Y") or asserts a negative.** Split every conjunction and negation into atomic assertions, verify each against its own `file:line`, and grade by the weakest part. Negations are especially trap-prone: prove the absence on **all** paths — the value may be produced another way (direct assignment, fallback, sibling path), not via the one mechanism you checked.

5. **Trigger: the issue's headline conclusion is a negative over a window ("naked until next cycle", "deferred", "value is lost").** The conclusion is its own claim — about *everything that executes between event A and boundary B*, not just the mechanisms the issue names — so each cited fact can be ✅ while it's false. Read the dispatch A→B top-to-bottom and enumerate every call that could produce the effect; the producer is often a sibling step the issue never names.

6. **Trigger: a superlative ("closest / most / only"), a method-over-a-set, or a cited report/baseline.** Establish the full population yourself — never trust the subject's own row: compute the extremum across every member (near-ties → ⚠️, reword to the narrowest true scope); diff what the method NAMES against what the executing tooling actually COVERS (a named-but-unreached member silently never runs); `git log` a cited snapshot against the source it summarizes. Cite both the named set and the actual set, mark ⚠️, name the gap.

7. **Trigger: a claim — or your own proposed fix — leans on a prorate/dedupe/aggregate/shared-state facility.** Confirming the aggregation *happens* isn't enough: find the **partition boundary and key** it runs within (per-row, per-tenant, per-process) and check it against the scope the fix feeds it — a mismatched key over- or under-counts the moment it's fed rows spanning partitions. The boundary lives in the enclosing function's signature and scoping comments, not the formula. Applies doubly to the Optimal direction you propose in 5a.

8. **Trigger: a "missing / undocumented / not handled" claim (docs, copy, UI).** A two-part claim — keyword-absence proves neither part. Read the surrounding prose/copy/code, not just the grep hits. Two misses: (a) the content partly exists under different wording, so the deliverable is smaller than claimed; (b) existing copy describing the OLD behavior is now actively WRONG — invisible to a presence grep, a ❌ that *widens scope* and **flips Update → Yes** even when the "needs docs" claim is technically ✅. Also diff the issue's scope file-list against the surfaces its deliverables must edit — an omitted surface → ⚠️.

**Evidence outranks verdicts — whoever produced them.** A subagent's ✅/❌, a reviewer's or another model's findings, and your own earlier outputs all get the same treatment: re-derive each mark from code with your own `file:line`. An agent that cites contradicting code while marking ✅ has refuted itself — its evidence outranks its verdict. Endorsement is a verification act, not a relay; the failure mode is tracing one load-bearing claim hard, then transcribing the rest — every bullet gets traced, including the obvious ones. Also reconcile pairs of your **own** results before finalizing: two outputs that don't individually refute a ✅ can expose the gap in combination.

### 4. Mark each claim

| Status | Meaning |
|--------|---------|
| ✅ Verified | Code path confirms the claim, cite file:line |
| ❌ Refuted | Code does the opposite, cite file:line |
| ⚠️ Conditional | True for some configs/paths, false for others — name them |
| ❓ Unverified | Couldn't locate the code path; flag for the user |

Mark **every** claim. A path you couldn't locate is ❓, never silently dropped — it appears in the verdict. Verify claims **before** the proposal: if the claims are wrong, the proposal is moot.

### 5. Assess the proposal (if any)

Only after all factual claims are marked, evaluate the proposed fix. Split into **architecture** (right shape for *this* codebase?) and **general** (conflicts, safety, regressions).

First, write a one-shot **Goal** summary — what the issue is ultimately trying to accomplish (the outcome, not the mechanism), in plain language anyone could follow (ELI23), **≤55 words**. It is the lead line of the **Proposal** section in the output (step 7), shown even when the rest of that section is omitted, and independent of whether the proposal is sound.

#### 5a. Architectural feasibility & optimization (REQUIRED for non-trivial proposals)

The problem statement can be 100% correct while the **implementation sketch is wrong or suboptimal**. Validate architecture like behavior: trace the repo, cite `file:line`, name what's missing. **Goal:** does the proposal place each concern in the **right layer** with a **viable ownership model** — and when underspecified, what's the optimal pattern *for this repo* (not a generic lecture)?

**Workflow (in order):**

1. **Runtime topology** — draw the hot path from the entrypoint: processes/threads/containers/serverless, who spawns whom, what's long-lived vs per-request. Cite the spawn/dispatch site (`main`, worker pool, HTTP handler, `exec`, queue consumer).

2. **Concern decomposition** — separate **fetch/cache**, **compute/derive**, **store/SSoT**, **consume/route**; analogies often confuse these ("cached like X" when X only dedupes I/O, not derived results).

3. **Ownership checklist** — for each shared/authoritative piece of state the issue must make these explicit (else ⚠️, fill from the codebase):

   | Question | Why it matters |
   |----------|----------------|
   | **Owner** | Which component has all consumers in scope, or which service is the writer of record? |
   | **Lifetime** | Per request, per tick/cycle, process lifetime, persisted across restarts? |
   | **Medium** | In-heap, DB, file, queue, RPC — must match topology |
   | **Population** | When is it written? Who invalidates? |
   | **Consumer contract** | Read-only inject, pull API, subscribe, recompute fallback? |
   | **Failure policy** | Miss/stale/error → fail open, closed, retry, degrade? |

4. **Boundary rules** (when topology crosses isolation — process, machine, runtime, deploy unit):
   - **In-memory in worker A is invisible to worker B** unless the issue defines IPC (file, DB, pipe, bus, parent inject).
   - **On-disk / DB / shared service** coordinates across workers; **heap-only** cannot.
   - **"Global" inside a leaf worker** is global only to that instance, not peers.
   - **Silent fallback** (recompute locally on miss) often negates dedup/SSoT goals — ⚠️ unless intentional.

5. **Layer placement / optimization** — is work in the best place given existing conventions?
   - **Orchestrator** (fan-in, dedup, cycle state, routing) vs **worker** (per-job handler, subprocess) vs **shared library** (pure logic, one impl) vs **persistence**.
   - Prefer **one SSOT for business logic** (a library both live and offline paths import) + thin orchestration over duplicating rules in two languages or N workers.
   - Prefer **existing inject/precompute patterns** (flags, stdin JSON, shared pre-fan-out phase) over new infrastructure unless justified.
   - Name a **better placement** when the issue puts state/compute in a leaf that can't see all consumers — cite the component that can (parent loop, API server, scheduler).

6. **Touch-set completeness (REQUIRED — the proposal's site-list is an implicit set claim).** When the proposal adds or modifies a config field, flag, or any shared/persisted state, the issue's Approach names *which* sites it will touch — that named list is a claim, and the usual failure is a site it never names. So **grep the field/symbol across the package**, enumerate **every** site that reads / writes / defaults / validates / serializes / reload-copies it, classify each, and **diff the actual set against the Approach's named set**. Any unnamed site that mutates the same state — or that *must* change for the fix to work but isn't listed — is a finding (⚠️/❌), before architecture can be ✅. Verify ordering and completeness by reading the **whole load/apply sequence around the proposed edit point**, not just the neighbors the issue names: the recurring misses are an earlier step that pre-empts the proposed site (a default-injection/normalization pass that stamps the field first, so an "only when unset" guard never fires), and a second required site the issue never cites (a guard verified but the apply/copy step missing, so the change lands as a silent half-implementation). Cite every required site or mark ⚠️.

7. **Mark architecture:**

| Status | Meaning |
|--------|---------|
| ✅ **Viable** | Topology, owner, medium, timing, and consumer contract are explicit and match the repo |
| ⚠️ **Underspecified** | Right problem, wrong/missing placement or IPC — state the concrete edit |
| ❌ **Infeasible** | Violates isolation, duplicates SSOT with no sync story, or contradicts established patterns |

When ⚠️/❌, add one line: **Optimal direction (this repo):** `<pattern>` — derived from the workflow, not issue text.

#### 5c. Proposal self-consistency (REQUIRED whenever 5a runs)

The problem can be 100% code-accurate while the **proposal contradicts itself** or reuses words that mean different things across sections. Run **after** step 3, **in parallel with** 5a — don't wait for the user to spot it.

**Workflow (all required):**

1. **Lifetime × population matrix** — list every place the issue names *when* state is created or read:

   | Source (quote or section) | When? | Medium | Survives restart? |
   |---------------------------|-------|--------|-------------------|

   Can one store satisfy every row? ❌ when two rows are incompatible (e.g. **"on add / loaded / register"** vs **"in-memory, recomputed each cycle"** — a load-time registry isn't an ephemeral per-cycle map). Cite the **existing** hook to use instead (config-load/validation vs main-loop/per-cycle — grep the repo).

2. **Verb audit** — search the text for `on add`, `on load`, `register`, `first access`, `each cycle`, `ephemeral`, `persist`, `cache`, `global`, `shared`. Same noun ("store", "calculator", "bundle") tied to two different verbs → ❌ unless the issue explicitly defines two layers with different lifetimes.

3. **Benefit vs existing facility** — rule 3 + 5a rule 2 applied to dedup: name what already dedupes that layer; "N fetches → 1" when a cache dedupes the I/O but not the derived compute is a ⚠️ overclaim.

4. **Consumer completeness** — if the issue says "the orchestrator reads it" or "no inline compute", grep **all** consumers (orchestrator *and* leaf workers/subprocesses). Partial migration (orchestrator updated, a leaf still computes the old way) is ⚠️ unless phased scope is explicit.

5. **Failure policy** — new fetch/subprocess without stated miss/timeout/error behavior → ⚠️; compare to today's inline path (fail open, reuse last value, skip the unit, hard error).

6. **Mark proposal consistency:**

| Status | Meaning |
|--------|---------|
| ✅ **Consistent** | Lifetime, population, benefits, and consumer story align across sections |
| ⚠️ **Gaps** | No internal contradiction, but missing failure policy, deploy/startup checks, or phased scope |
| ❌ **Contradicts** | Two sections describe incompatible ownership or timing — state the rewrite |

Any **❌** or material **⚠️** → **Update issue description? Yes** (same as bad architecture), edits phrased in step 7.

#### 5b. General proposal checks

- Does it conflict with recent work? (`git log --since=7.days` on touched paths)
- Safety: locking, migrations, hot-reload, idempotency, blast radius of failure
- Parity: are there parallel paths (simulation/offline, a secondary client, an admin/CLI surface) that must share the same SSOT?
- **Dual implementation risk** — same rule in two languages/runtimes without a single library or generated source
- Does it regress something just fixed?

5b findings route to the **Concerns** section of the output (`file:line` each). A material finding — safety gap, conflict with or regression of recent work, missing parity surface — means the proposal as written shouldn't be implemented, and flips **Update issue description? → Yes** just like 5a/5c.

### 6. Score complexity

Rate the work to implement the fix **correctly, including tests** — not the happy-path diff, not the author's estimate. The `[C0]`–`[C100]` score is a **model + effort routing signal**: the **band** selects which LLM (and whether fableplan runs first); **depth inside the band** selects effort. Do **not** sum the axes into one mushy difficulty number.

**Derive the axes from the change surface you traced, not the issue's prose.** List the concrete edits steps 3–5 imply — files/functions, configs/migrations, tests to add or rewrite — and size the axes from that list; a score not backed by it is a vibe. If a path is unresolved (5a/5c ⚠️/❌), raise **Uncertainty**, give a Capability-band range (e.g. 50–74) not a point, and name the single unknown driving the spread.

**Count the surface that hides from the diff.** The usual undercount is Scope and Verification — account for tests to add/rewrite, parity/offline paths that must match, migrations or schema/config-version bumps, init/wizard/generate surfaces, probe/startup argv, and docs the change invalidates. A "one-file" fix often drags three of these.

**Cross-check against your own step-5 verdicts.** If architecture is ❌ (5a) or several checks are ⚠️ (5c), the work includes redesign and can't land in Capability 0–1 — a low band next to an ❌ verdict is self-contradiction.

| Axis (0–4) | 0 | 2 | 4 |
|---|---|---|---|
| **Scope** — files/layers/languages; new abstraction vs localized | one file, localized | a few files, one layer/language | many files across layers + a new abstraction |
| **Coupling** — state/locking, migration, hot-reload, config↔runtime parity, dual-language SSoT, IPC across process/machine | none; pure/local | one shared mechanism touched | multiple interacting subsystems / cross-boundary coordination |
| **Risk** — money, data integrity, security, irreversible or live side effects; regression on recently-changed code | read-only / offline | reversible writes, contained blast radius | live-exec / money / data-integrity / irreversible |
| **Uncertainty** — is the approach known? | spec'd; approach known end-to-end | mechanism known, params/shape to be found | needs design; open judgment; step 5a ⚠️/❌ |
| **Verification** — test/repro surface to prove it | pure helper, unit-testable | several units + fixtures | integration/parity/subprocess, or hard-to-reproduce state |

Judgment-heavy work must raise **Uncertainty** or **Coupling** — never score a hard decision as Uncertainty 0.

#### Formula (canonical — every scorer/consumer must match)

1. **Capability** (0–3): map `max(Risk, Uncertainty)` with `0–1 → 0`, `2 → 1`, `3 → 2`, `4 → 3`. If **Coupling ≥ 3**, set Capability = `max(Capability, 2)`. Coupling does **not** bump to band 3 by itself.
2. **Volume** (0–24): `(Scope + Coupling + Verification) × 2`.
3. **Final score** = `25 × Capability + Volume` (0–99 under current axis bounds: Capability ≤ 3, Volume ≤ 24). No Risk/Uncertainty floors and no hard ceilings — the band *is* the floor.

#### Band → model / effort

| Capability | Score band | Model / planning | Effort from Volume tertiles (0–7 / 8–15 / 16–24) |
|---|---|---|---|
| 0 | 0–24 | Cheap/fast (Sonnet-class) | high / high / xhigh |
| 1 | 25–49 | Opus-class | high / high / xhigh (never medium on Opus) |
| 2 | 50–74 | Opus-class **+ fableplan first** | high / high / xhigh |
| 3 | 75–99 | Fable 5 | medium / high / xhigh (medium is Fable-only) |

Safety carve-outs (money, data integrity, security, auto-protective) remain absolute overrides in consumers that already have them — they force the capable path when flagged even if Risk was under-scored.

#### Golden examples (consistency checklist)

| Axes (S,C,R,U,V) | Capability | Volume | Score | Band meaning |
|---|---|---|---|---|
| (4,0,0,0,0) | 0 | 8 | **8** | Large mechanical grind → Sonnet-class, high |
| (0,0,0,4,0) | 3 | 0 | **75** | Hard design, tiny surface → Fable 5 |
| (0,4,1,1,0) | 2 (Coupling bump) | 8 | **58** | Heavy coordination, low R/U → Opus + fableplan |
| (0,0,4,0,0) | 3 | 0 | **75** | Tiny money/security path → Fable 5 |
| (0,0,3,0,0) | 2 | 0 | **50** | Elevated blast radius → Opus + fableplan |

Work the axes in scratch; **report only** `N/100 — Capability <k> (<driver>); Volume <v>` with the traced edit list.

### 6.5. Scope disposition — is the issue too large to be ONE issue?

A high complexity score is not automatically a defect — a single hard change can be correctly scoped. The defect is when one issue **bundles work that should be tracked as several**. Decide from the traced edit list (step 6), not the prose: an issue is too large when **the deliverables are separable** — two or more parts each land in their own PR, pass their own tests, and deliver value alone — **or** it reads as an "and also" laundry list spanning unrelated subsystems with no single root cause tying them.

A genuinely-large-but-atomic change (one root cause, one inseparable diff) is **not** too large — the high score already tells the story; only flag when the parts are independently landable.

When it IS too large, recommend exactly one disposition (state which and why in the output):

| Disposition | Use when | Action to recommend |
|-------------|----------|---------------------|
| **Split into N issues** | Parts are independent — no shared design, no ordering dependency, each separately landable | File each as its own fully-specified issue, then close/repurpose this one. List the proposed splits with a one-line scope each. |
| **Umbrella / tracking issue** | Parts are related and need coordinated design or a shared sequence, but are still individually shippable | Keep THIS issue as the parent; convert its body to a checklist of child issues (`- [ ] #…`), move per-part detail into the children. List the proposed children. |
| **Narrow scope** | Much of the issue is speculative/optional/"nice to have" around one real core | Cut to the core deliverable; move the rest to a "Future / out of scope" note or a single follow-up. Name the core vs what's cut. |

**Each proposed split/child is itself fully specified — never recommend filing a stub.** Per the repo's issue rules, every spun-off issue needs its own complexity-prefixed ELI18 title (a clear, plain-language sentence understandable to an average 18-year-old), problem statement, and acceptance criteria before it's filed. If a part isn't ready to spec, recommend tracking it as a checklist line in the parent, not a separate issue yet. Don't actually file the children during validation — propose them; filing happens only if the user says to act on the disposition.

This decision is **independent of "Update issue description?"** — an issue can be factually accurate (verdict: No update) yet still need to be split. Surface both.

### 7. Output verdict

Be terse. No preamble, no closing remarks. The deliverable is the **decision** about whether the original issue description needs to be updated — it lands at the **end**, as the conclusion the findings build to, not a loose summary.

Format:

```
Claims:
- ✅ <claim> — <file:line>
- ⚠️ <claim> — <condition> (<file:line>)
- ❌ <claim> — <what code actually does> (<file:line>)
- ❓ <claim> — <where you looked; what's needed to verify>

Architecture: (omit if trivial proposal / no step 5a)
- <✅|⚠️|❌> <one-line verdict: placement + owner + medium> (<file:line> dispatch/spawn path)
- Optimal: <only when ⚠️/❌ — one line, repo-specific>

Concerns: (omit section if none)
- <concern> (<file:line>)

Proposal:
- Goal (ELI23, ≤55 words): <plain-language summary of what the issue is trying to accomplish — outcome, not mechanism>
- <✅|⚠️|❌> <lifetime/population/benefit/consumer/failure — one line each only when not ✅> (omit this verdict line if no step 5c / trivial fix)

Scope: (omit unless the issue is too large per step 6.5)
- <Split | Umbrella | Narrow> — <one-line why> · proposed parts:
  - <part 1 — one-line scope>
  - <part 2 — one-line scope>

**#<N>: Update issue description? <Yes | No>**  ·  Complexity: <0-100>/100 — Capability <k> (<driver>); Volume <v>  ·  Scope: <OK | too large — split/umbrella/narrow>

<If Yes: a short bulleted list of specific edits the author should make to the title and/or description — wrong file:line, incorrect behavior, missing repro, ambiguous scope, a title that misstates the bug or scope, etc. One line each, phrased as edits ("Change X to Y", "Add Z", "Remove claim about W", "Retitle to …").>

→ Reply "work on issue" to proceed, "update issue" to apply the edits first<, or "split issue" / "decompose" to file the proposed parts — only when step 6.5 flagged it>.
```

### 7.5. When the user replies "work on issue" — hand off to the work-on-issue skill

When the user opts to **work on** the issue (not merely validate or update it), **invoke the `work-on-issue` skill** — that is the default follow-on. It owns the full implementation flow: create and switch into a fresh isolated worktree off the latest default branch, implement the fix to the codebase's conventions, verify, commit and push, and open a PR that `Closes #<N>` (it ends with the open PR — requesting review is the caller's job).

Pass the issue number through; the skill is idempotent about the worktree (reuses an existing one for this issue). Don't start editing code or creating a worktree here yourself — delegate so the implement → PR → review chain stays consistent.

**If step 6.5 flagged the issue as too large, surface the disposition before handing off** — implementing an oversized, multi-part issue as one PR reproduces the scope problem in the diff. Recommend splitting/decomposing first; proceed to work-on-issue only on the user's say-so, or scope the implementation to the single core part if they want to start there.

### 8. When the user replies "update issue"

This can mean editing the issue title and/or editing the issue body (apply the suggested edits) — both from the current checkout, per step 0. Do both as appropriate.

**Your own rewrite is claim-verified too — gate before you write.** The corrected description, fix plan, "Optimal direction", and suggested edits aren't exempt from steps 3–5 just because they're your prose: every **verb** (write, split, stamp, record) and **value** (which field a number lands in, zero vs derived-nonzero, lifetime, owner) is a code-grounded claim — trace each to `file:line`. Two traps:
- **Narrative compression erases a verified distinction.** If step 3 proved two paths differ (one writes a derived non-zero value, the other zero; one records, the other skips), don't flatten both under one tidy label; a tidier sentence that's now wrong is a regression.
- **A fix plan can propose violating a documented invariant.** Before recommending a fix that writes/derives a value, grep `CLAUDE.md`/guardrails and nearby comments for an invariant governing it ("only writer is Z", "fail closed", "never write X into field Y") — route the value to its authorized path, not the convenient one.

**MANDATORY final consistency pass — re-read the WHOLE assembled body before every `gh issue edit`, not just the section you changed.** Section-by-section edits drift: the early summary and the later detailed sections silently disagree, and since the correct fact is already *in your own document*, only an end-to-end read catches it. List every **value/distinction restated in more than one place** (zero in one section, non-zero in another; a path that writes vs skips; a benefit exists vs not) and confirm the summary says the *same thing* as the detailed buckets. Required after any edit pass touching ≥2 sections or spanning ≥2 turns.

**Editing the title** (`gh issue edit <N> --title "<new title>"`): update it whenever the validated findings make the current one wrong or misleading — it misstates the bug, names the wrong component or root cause, or its scope no longer matches what you traced, or it isn't a clear, plain-language sentence understandable to an average 18-year-old (ELI18) — precise about component and behavior, no unexplained jargon. Hold the corrected title to the same claim-verification gate as the body. If the repo follows the `<title> [C<score>, <model>, <effort>]` trailing-suffix convention, set or correct the bracket from step 6 (append `, fableplan` for the Capability-2 band). Leave an accurate title untouched; combinable with the body edit in one call.

**Editing the issue body** (`gh issue edit <N> --body-file <file>`): apply the edits, then end the body with the **LLM Attribution Footer** — **stack, never replace**: keep the original `Created with LLM: …` line and add an `Updated with LLM: …` line directly below it (each later edit appends another `Updated …` if model/effort/harness differ; collapse exact duplicates). Preserve provenance, don't overwrite. The footer is the final lines of the body, preceded by a `---` separator on its own line:

```
---
Created with LLM: <model> | <effort> | Harness: <harness>
Updated with LLM: <current model> | <effort> | Harness: <harness>
```

Verb tracks the action: `Created` for the original body, `Updated` for title/description edits; when the body has no footer yet, append just the `Updated …` line. Fill in `<current model>` (e.g. `Fable 5`, `Opus 4.8`) and `<effort>` (`medium` / `high` / `xhigh` — default `high`, never low). `<harness>` is whatever produced the edit — `Claude Code` for an interactive session, the GitHub Action identifier when running in CI (e.g. `anthropics/claude-code-action@v1`; the workflow states this identifier in your system prompt — use that value, and treat its absence as an interactive session), or the specific tool (`Cursor`, `Codex`, `OpenClaw`, `Hermes`). When the repo's `CLAUDE.md` defines its own footer format, it overrides this default.

Rules:
- Close with the update-or-not decision, placed after the findings that justify it. That is the deliverable; the complexity score sits on the same line, after a `·` separator.
- Always include the complexity score, even when the verdict is **No** — it is the model + effort routing signal for the fix.
- No restatement of the issue title or body.
- Each claim/concern fits on one line. If you need more, the claim is too broad — split it.
- Drop the Concerns section entirely when there are none. Don't write "None."
- **Yes** when any ❌/⚠️ **claim** affects the fix, the description states wrong behavior, repro/scope is missing, **step 5a is ⚠️/❌**, **step 5c is ⚠️/❌** (proposal contradicts itself or omits failure/deploy/consumer scope), or a **material 5b finding** (safety gap, conflict/regression with recent work, missing parity surface) means the proposal as written shouldn't be implemented. **No** when claims are ✅, architecture, proposal consistency, and general checks are clean (or trivial/local), the problem statement is accurate, and there's enough context to start work.
- Keep claim descriptions short — verb phrase only, no full sentences.

## Red Flags — STOP

Depth-rule and section triggers live on the rules/sections themselves (steps 3, 5a, 5c, 6.5, 8) — these are the remaining checks with no home there:

| Situation | Action |
|-----------|--------|
| Claim cites a function that doesn't exist | Mark ❌; note the actual function name if you find it |
| Claim is true *only* for one config branch | Mark ⚠️ — don't simplify to ✅ |
| Issue author is the repo owner | **Still verify.** Repo owners write from memory and get details wrong too — never anchor on "Current Behavior" |
| Code recently changed (last 7 days) | `git log --since=7.days <file>` to confirm current behavior |
| Claim depends on runtime state ("after N cycles") | Trace the state machine; don't approximate |
| Your own grep/read contradicts the issue's prose | Trust the code, not the author's grouping |
| "Shared / global / central" with no owner named | 5a — require owner, medium, timing, consumer contract |
| All claims ✅ but the proposal is cross-cutting | Run **5a + 5c** before scoring — accurate problem ≠ sound design |
