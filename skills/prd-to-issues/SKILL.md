---
name: prd-to-issues
description: Use when the user wants a finished PRD broken into GitHub milestones and issues — "file the issues from the PRD", "/prd-to-issues", "break this into GitHub issues". Derives dependency-ordered milestones, files complete complexity-scored issues (github-issue-format), and stamps each with an Execution block (typed predecessors, build model, effort, fableplan, review trigger). Stage 4 of the new-app-pipeline.
---

# prd-to-issues

Break a refined PRD into milestones and fully specified GitHub issues that cold agents implement one at a time. An agent holding only the issue body and the PRD must be able to build it correctly.

**Load the `github-issue-format` skill before filing anything (mandatory).**

## Steps

### 1. Plan the breakdown (present before filing)

- Derive **milestones** from dependency structure, never from feature themes. Typical shape: `v0` foundation and core surface (scaffold, schema, auth, core flows, payments happy path), `v1` lifecycle and delivery (jobs, schedulers, notifications), `v2` second-surface parity, `v3` post-MVP.
- Aim for **15–25 issues**, each independently implementable and PR-sized.
- Separate the **dependency spine** (built serially) from **parallel waves**. For each issue record its direct hard prerequisites apart from ordering-only predecessors. Name the risk concentrators, usually the schema and the money module.
- Show the plan (titles, milestones, order) in chat before filing and adjust on feedback.

### 2. Create milestones

`gh api repos/<owner>/<repo>/milestones -f title='...' -f description='...'`, one per phase, the description listing the member issues' themes.

### 3. Write the issues

Per `github-issue-format`: `[C<score>]` plain-language title, complexity rationale first line, then **Problem** (with PRD § references), **Goal**, **Approach**, **Acceptance criteria**, **`## Plain simple English`** (mandatory, under 55 words, ASD-STE100), the step 4 Execution block, then the attribution footer.

- Cite PRD section numbers everywhere; they are the cold agent's index.
- Acceptance criteria are testable behaviors, including negative ones ("no endpoint can return a signed URL for sealed media, for any role").
- Money, privacy, and irreversible-deletion invariants go in the acceptance criteria.
- Pure logic (pricing engines) embeds the PRD's worked examples as required test cases.
- File via one batch script (heredoc bodies, `gh issue create --milestone`), sequentially so numbering is stable.

### 4. Stamp Execution blocks

Append to every issue body, before the footer:

```
## Execution
- **Depends on:** #<n>[, #<n>…] | none
- **Runs after:** #<n>[, #<n>…] | none
- **Build model:** <Fable 5.1 | Opus 5 | ... | <Name> (Codex CLI[, <model-id>]) | <Name> (Cursor CLI[, <model-id>])>
- **Effort:** <low (Fable-only, discretionary, below the formula floor) | medium (Fable-only) | high | xhigh | max (Codex CLI-only)>
- **fableplan first:** <Yes (Fable 5.1 plans, plan posted to this issue, builder implements against it) | No>
- **PR review:** standard `@claude` review trigger
- **Validate effort:** <low | medium | high | xhigh>   (optional; omit for the band default)
- **Plan effort:** <low | medium | high>   (optional; omit to plan at high; read only when fableplan first is Yes)
```

Ordering fields, stamped from the approved spine/wave graph once final numbers are known:

- Record direct predecessor edges only, comma-separated; write `none` when there is no edge of that kind.
- **Depends on**: the issue needs the predecessor's code or product result (an API issue that needs another issue's schema).
- **Runs after**: the issues must not overlap but the later one needs none of the earlier one's code (two independent issues editing the same package). A same-package exclusion is always `Runs after`. Never list one predecessor in both fields.

Routing fields derive from the complexity score band. Score each issue with the `validate-issue` step 6 formula and stamp from that band:

| Band | Score band | Build model | fableplan first | Effort |
|---|---|---|---|---|
| 0 | 0–9 | Sonnet 5 (or the repo's cheap/fast builder) | No | high |
| 1 | 10–20 | Sonnet 5 (or the repo's cheap/fast builder) | No | xhigh |
| 2 | 21–49 | Opus 5 | No | high |
| 3 | 50–70 | Opus 5 | No | xhigh |
| 4 | 71–80 | Opus 5 | **Yes** | xhigh |
| 5 | 81–99 | Opus 5 | **Yes** | xhigh |

- **Never stamp Fable 5.1 as the Build model.** No band defaults to a Fable build; one exists only when the user directs it on a specific issue.
- **Never stamp an external CLI harness as the Build model.** `execution-plan-review` writes `<Name> (Codex CLI)` or `<Name> (Cursor CLI)` (optional model id after a comma) on the user's instruction, and `cli-dispatch` owns how the pipeline reaches that CLI.
- The axes already encode the old heuristics (money/security raises Risk; design-heavy raises Uncertainty; mechanical grind raises Scope/Volume at Capability 0). Never override the band with a separate signal table; if the PRD states a safety carve-out and Risk was under-scored, raise Risk and re-score.
- **fableplan first: Yes** means score 71 or higher (bands 4–5). Never below 71.
- **Validate model** is derived from the score by the `validate-issue` step 6 band table and is never stamped; a missing `[C..]` prefix routes as band 5. **Validate effort** and **Plan effort** default to the band value and `high`; this skill omits both lines at filing time, and `execution-plan-review` adds them and owns the clamp rules (an Opus validate stamped `low` or `medium` runs at `high`).
- Effort floor is **medium** and medium is Fable-only: Opus and Sonnet builds run at high or xhigh. A Fable build may drop to **low** only on a band-5 issue judged lighter than its Volume warrants. Fable 5.1 defaults to high on every stage and runs at xhigh only when the user asks for it or stamps it (the LLM Attribution Footer section of CLAUDE.md owns this rule). When unsure between two tiers, take the higher.
- **PR review**: the pipeline derives the first-review trigger from the `validate-issue` step 6 first-review table; this file states no boundary of its own. `skills/fix-pr-review/rereview-routing.md` owns the blocking re-review step-down ladder and the shorthand `claude.yml` resolves (`sonnet`, `opus`, `fable`; never stamp `haiku`). Stamp an explicit `@claude <model> review effort:<tier>` line only to override the default.
- Scores filed before the band-encoding change are not comparable; re-score if routing matters.

### 5. Report

A compact table: issue number, `C`, title. Note the spine/wave ordering and which issues concentrate risk.

## Failure modes

| Situation | Do this |
|---|---|
| An issue cannot be specced without a decision the PRD does not make | Stop; run `prd-questions` for it first. Never file a stub |
| Two issues touch the same module in the same wave | List the earlier issue in the later issue's `Runs after`, or merge them if they are not independently implementable |
| A milestone exceeds about 12 issues | Split it; workflow waves get unwieldy past that |
| Tempted to skip Execution blocks "for now" | Never; cold agents need them |
