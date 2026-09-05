---
name: new-issue
description: Use when the user says "new issue", "create an issue", "file an issue", "/new-issue", or asks to turn a bug, idea, or discussion into a GitHub issue. Takes an optional description of what the issue should cover; with no input, derives the issue from what was discussed in the current conversation. Verifies claims against the code before filing and produces a complete, complexity-scored issue, never a stub.
---

# new-issue

File a GitHub issue that a human or agent can pick up cold and implement correctly: grounded problem, goal, approach, acceptance criteria, complexity score, plain-language summary, attribution footer. Never file a placeholder, stub, or thin body; if it is not ready to spec, say so and track it in notes or a parent issue instead.

Spec the best solution per the CLAUDE.md Engineering rules: cost, effort, and diff size never narrow the option space; only correctness and safety override "best". When the cheap design and the correct design diverge, spec the correct one and let the score say so.

## Input

- A description of the bug, feature, or task; still ground it in code (step 2).
- Nothing: derive the issue from the current conversation. When several candidates were discussed, file the one the discussion converged on; name the others and offer to file each fully specified. Never bundle.
- Optionally `owner/repo` or a repo path when the issue belongs elsewhere (`gh issue create -R owner/repo`).

## Steps

### 1. Repo and duplicate check

Confirm the repo (`gh repo view --json nameWithOwner`). Run `gh issue list --state open --search "<keywords>"` and `gh pr list --state open --search "<keywords>"`. A genuine hit stops the run: surface it and offer to update or comment on it instead. A passing mention does not count.

### 2. Ground every claim

Each claim about current behavior is held to the `validate-issue` standard: trace the code path and keep the `file:line`. A claim you cannot trace is phrased as unverified ("appears to", "needs confirmation"). An issue derived from conversation is re-checked against the actual files; recollection goes stale. On a divergent or stale branch, trace against `origin/<default>` (`git show "origin/$DEFAULT":<path>`).

### 3. Design the approach

For anything beyond a localized bug fix, spec the approach so it passes the `validate-issue` architecture pass:

- Placement and ownership: the owning layer or component; for shared state, the owner, lifetime, medium, population timing, consumer contract, and failure policy.
- Touch-set: grep the affected symbols and name every site that must change (read, write, default, validate, serialize).
- Conventions: match `CLAUDE.md`, guardrails, and existing helpers over new infrastructure; respect documented invariants.
- Acceptance criteria an implementer can verify: observable behavior, required tests (a regression test for a bug, red then green), parity surfaces.

### 4. Score complexity

Apply the formula and routing table in `validate-issue` step 6; do not restate them. Grade from the touch-set in step 3, and count surface hidden from the diff (tests, parity or offline paths, migrations, docs). The score routes model and effort; never write a duration. Set the fableplan signal per `github-issue-format` (`yes` when the score is ≥ 71).

### 5. Scope check

If the deliverables are separable, apply the split gates in `validate-issue` step 7, the single owner of the split policy. When every gate passes, file the core issue, fold sub-floor satellites into it as checklist lines, and tell the user which substantial parts warrant their own fully specified issues. Otherwise keep one issue with the parts as checklist lines.

### 6. Compose and file

`github-issue-format` owns the title, rationale line, section order, plain-language section rule, and footer (verb `Created`). A repo issue template or `CLAUDE.md` issue format overrides it. Fill the body from the steps above:

```
**Complexity: <score>/100** — Capability <k> (Risk <r>, Uncertainty <u> — <driver>); Volume <v> (Scope <s>, Coupling <c>, Verification <x>) — <model/effort from band> · fableplan: <yes|no>

## Problem
<Current behavior with the file:line citations from step 2; what is wrong or missing and why it matters.>

## Goal
<What is true after this lands.>

## Approach
<The design from step 3: placement, touch-set, key decisions. State that correctness and safety outrank diff size.>

## Acceptance criteria
- <observable behavior or test that must pass>

## Plain simple English
<One short paragraph under 55 words, per `github-issue-format`.>

---
Created with LLM: <current model> | <effort> | Harness: <harness>
```

File with `gh issue create --title "[C<score>] <title>" --body-file <body-file>`. Add `--label` or `--assignee` only when the repo visibly uses them (`gh label list`) and the fit is unambiguous.

### 7. Report

Terse: issue URL, number, one-line summary, complexity score, and any follow-ups you did not file, with why. Offer "validate issue" / "work on issue" as next steps in one line. When the signal is `fableplan: yes`, also ask in one line whether to post a Fable 5.1 plan before building; never launch fableplan unprompted. Autonomous loop skills that wrap this one parse the signal and apply their own gates instead of asking.
