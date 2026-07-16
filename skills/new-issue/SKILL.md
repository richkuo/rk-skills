---
name: new-issue
description: Use when the user says "new issue", "create an issue", "file an issue", "/new-issue", or asks to turn a bug, idea, or discussion into a GitHub issue. Takes an optional description of what the issue should cover; with no input, derives the issue from what was discussed in the current conversation. Verifies claims against the code before filing and produces a complete, complexity-scored issue — never a stub.
---

# new-issue

Create a fully-specified GitHub issue from the user's prompt — or, when nothing is prompted, from what was just discussed in the conversation. The deliverable is a filed issue that someone (human or agent) could pick up cold and implement correctly: concrete problem statement, goal, approach, acceptance criteria, complexity score, attribution footer. **Never file a placeholder, stub, or empty-bodied issue — no exceptions.**

**Spec the absolute-best solution — full stop.** When the issue proposes an approach, derive it from first principles as if cost, compute, time, effort, manpower, token spend, code volume, and blast radius were unlimited — none of these are factors and none may narrow the option space. The only constraints that override "best" are correctness and safety (money, data integrity, security, auto-protective mechanisms — safety-class gaps are never acceptable, however "low-risk"). Don't spec the tidier/less-code design when it leaves a correctness or safety gap, and don't scope the issue down to what seems cheap to build.

## Input

The user provides one of:
- A description of the bug/feature/task to file — use it as the source, but still ground it in code (below).
- **Nothing** — derive the issue from the current conversation: the bug just diagnosed, the design just discussed, the follow-up just named. If the conversation contains several distinct candidates, file the one the discussion converged on; name the others and offer to file them (each fully specified) rather than bundling.
- Optionally `owner/repo` or a repo path when the issue belongs somewhere other than the current checkout (`gh issue create -R owner/repo`).

## Steps

### 1. Establish the repo and check for duplicates

Confirm which repo the issue belongs to (`gh repo view --json nameWithOwner`). Then search for an existing issue or PR already covering it — filing a duplicate wastes a cycle:

```bash
gh issue list --state open --search "<keywords>"
gh pr list --state open --search "<keywords>"
```

A genuine hit → stop and surface it (offer to update/comment on the existing issue instead). A passing mention doesn't count.

### 2. Ground every claim in the code — before writing a word

The issue's factual claims about *current* behavior are claims, not notes — the same standard validate-issue holds authors to applies to you as the author. For each behavior the issue will assert, trace the code path and keep the `file:line`; a claim you can't trace is phrased as unverified ("appears to…", "needs confirmation"), never stated as fact. If the issue came from this conversation, don't transcribe from memory — re-check the load-bearing citations against the actual files; conversation recollection goes stale exactly like an author's prose does.

If the working tree is on a divergent or stale branch, trace against `origin/<default>` (`git show "origin/$DEFAULT":<path>`) so citations match what an implementer will check out.

### 3. Design the approach (non-trivial issues)

For anything beyond a localized bugfix, spec the approach the way validate-issue's architecture pass would judge it — so the issue passes its own future validation:

- **Placement and ownership** — which layer/component owns the change; for shared state name the owner, lifetime, medium, population timing, consumer contract, and failure policy.
- **Touch-set** — grep the affected symbols and name *every* site that must change (read/write/default/validate/serialize), not just the obvious one.
- **Conventions** — match the repo's existing patterns (`CLAUDE.md`, guardrails, existing helpers) over new infrastructure; respect documented invariants (single-writer, fail-closed, "X never into Y").
- **Best over cheap** — per the principle above: if the correct design is bigger than the convenient one, spec the correct design and let the complexity score say so.

Include **acceptance criteria** an implementer can verify: observable behavior, tests that must exist (regression test for a bug, red → green), parity surfaces that must match.

### 4. Score complexity

Score the work to implement the fix **correctly, including tests** using the **canonical formula in `validate-issue` step 6** (load that skill or mirror it exactly): five axes 0–4 → **Capability** (0–3 from Risk/Uncertainty + Coupling≥3 bump) and **Volume** (0–24 from Scope+Coupling+Verification) → `score = 25 × Capability + Volume`. The score is a **model + effort routing signal**, not a time estimate — never put durations in the issue. Derive axes from the concrete touch-set in step 3, not vibes; count the surface that hides from the diff (tests, parity/offline paths, migrations, docs).

### 5. Scope check — one issue or several?

If the deliverables are separable — parts that each land in their own PR, pass their own tests, and deliver value alone — don't bundle: file the core issue and tell the user which parts warrant their own issues (each fully specified before filing, or tracked as a checklist in the parent until ready — never stubs).

### 6. Compose and file

Title: `<title> [C<score>, <model>, <effort>]` (append `, fableplan` when the score is in the Capability-2 band) — the title is a clear, plain-language sentence understandable to an average 18-year-old (ELI18) — it states the bug or deliverable precisely (component + behavior) without unexplained jargon, no vague "improve X" — followed by the trailing routing-outcome bracket.

Body structure:

```
**Complexity: <score>/100** — Capability <k> (<driver>); Volume <v> — <model/effort from band>

## Problem
<Current behavior, grounded with file:line citations from step 2. What's wrong or missing and why it matters.>

## Goal
<The outcome in plain language — what's true after this lands.>

## Approach
<The optimal design from step 3: placement, touch-set, key decisions. Explicit that correctness/safety outrank diff size.>

## Acceptance criteria
- <observable behavior / test that must pass>
- <…>

---
Created with LLM: <current model> | <effort> | Harness: <harness>
```

The complexity rationale is the **first line** of the body and matches the title suffix — same Capability/Volume form as `github-issue-format` (round-trips with the `[C<score>]` band, e.g. `[C58]` → `Capability 2 (…); Volume 8`). The footer is the final lines, preceded by `---` on its own line — **Created** verb, `<effort>` one of `medium`/`high`/`xhigh` (default `high`, never low), `<harness>` = `Claude Code` for an interactive session. No `Co-authored-by`. **Project precedence:** a repo `CLAUDE.md` that defines its own issue/footer format overrides this default.

File it:

```bash
gh issue create --title "<title> [C<score>, <model>, <effort>]" --body-file <body-file>
```

Add `--label`/`--assignee` only when the repo visibly uses them (`gh label list`) and the fit is unambiguous.

### 7. Report

Terse: issue URL, number, one-line summary of what it covers, complexity score, and any candidate follow-ups you did **not** file (with why). Offer "validate issue" / "work on issue" as next steps in one line.

## Guardrails

| Situation | Action |
|-----------|--------|
| Tempted to file with a thin body "to capture it quickly" | Don't — every issue is complete at creation; if it isn't ready to spec, tell the user and track it in notes/parent instead |
| No prompt and the conversation discussed several things | File the converged one; name the rest, don't bundle |
| A claim about current behavior you haven't traced | Trace it or phrase it as unverified — never state a guess as fact |
| Issue derived from conversation memory | Re-verify load-bearing file:line citations against the actual code before filing |
| An existing open issue/PR already covers it | Stop; surface it and offer to update/comment instead |
| The cheap design and the correct design diverge | Spec the correct one; cost, effort, and blast radius are not factors — only correctness and safety constrain |
| Touches money / data integrity / security / auto-protective logic | Spec the safest correct design from first principles; surface the risk in the body and Risk axis |
| Tempted to include a time/effort estimate | Don't — complexity score only (Capability band + Volume), described via the axes |
| Repo has its own issue template or `CLAUDE.md` issue format | Follow the repo's format; it overrides this default |
