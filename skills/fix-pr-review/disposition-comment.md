# Disposition comment

Reference for SKILL.md step 9.

## Template

```
Addressed review feedback (<reviewer(s)> · <timestamp(s)>) in <commit-sha>.

Growth check: diff <lines> lines vs <lines> at first push (<ratio>x); cycle <N>.

### Fixed
1. **<finding title>** — <what changed> (`file:line`). <Scope rule 1 note when required — see below.>

### Corrected scope (partial)
1. **<finding title>** — <what was real and fixed vs. what wasn't | blocking status refuted: the stated Reachability precondition <trigger>, refuted by <what the code does>; the defect <stands | does not stand>; re-routed to `### Recommended Optional`> (`file:line`).

### Not changed (refuted)
1. **<finding title>** — <code-grounded reason the suggestion doesn't apply> (`file:line`).

### Resolved judgment calls (was Requires Human Review)
1. **<finding title>** — implemented <the best solution and why, `file:line`>. Alternatives rejected: <one line each>.

### Deferred to follow-up
1. **<finding title>** — out of scope, basis <scope rule <N>: the mechanism the remedy needs and the yardstick that does not ask for it | reviewer-routed to `### Create Follow-up Issue`>; filed as #<issue>.

### Test edits
1. **<test name>** (`file:line`) — <Outdated | Wrong | Obsolete>; ground: <the finding, issue, contract, or instruction that authorizes it>; now asserts <what the replacement asserts, or the ground alone for a removal, naming the surviving test for the redundancy case>.
```

## Slotting rules

- **Copy `<finding title>` verbatim from the review comment** — the reviewer's bold one-sentence title, word for word. The next reviewer matches findings to these dispositions by claim; a reworded title brings a settled finding back.
- Every **Not changed (refuted)** and **Corrected scope (partial)** item carries a code-grounded rebuttal with its `file:line` that stands on its own — what a later reviewer must answer before re-raising.
- **A blocking finding whose stated `**Reachability:**` precondition the code refutes goes under `### Corrected scope (partial)`, and nowhere else** — `pr-review`'s prior-cycle rule settles findings only on the dispositions it names, so a re-route recorded elsewhere settles nothing. The item names the stated precondition, the `file:line` that refutes it, whether the defect still stands, and the section the finding moves to. When the re-routed remedy is fixed in this same push, it also gets its own **Fixed** item; this item records the routing change alone.
- Omit any empty section. Keep each item one line with a `file:line` anchor.
- **Every test edit appears under `### Test edits`** with its case, ground, and replacement assertion (a removal gives the ground instead); an edit missing from it reads as undisclosed.
- The `Growth check:` line appears only when step 4's growth check fired; it is the one place those numbers live.
- **Every Deferred to follow-up item names both its basis and the issue number.** The basis has exactly two admissible values: the fixer scope rule applied (rule 2, with the mechanism the remedy needs and the yardstick that does not ask for it), or the reviewer's own `### Create Follow-up Issue` routing, where step 4's exclusion filed the item without running one. Rule 1 never appears here — it keeps the finding in the PR, under **Fixed** with the rule-1 note. `pr-review` settles the finding on that pair as on a rebuttal; a deferral missing either half settles nothing, so the finding returns next cycle. An item matching an issue an earlier cycle filed cites that existing issue.
- **A Fixed item that kept a finding in the PR against something that would have filed it carries a scope rule 1 note** — required exactly when the reviewer routed it to `### Create Follow-up Issue` and the exclusion-exception pulled it back, or when rule 2 would have filed it and rule 1 matched first. The note names rule 1 and states, from code, what this PR adds or changes that causes the defect (or the hazard it creates). Other Fixed items carry no note.
- CI Failure findings slot into the same sections — fixed under **Fixed**, pre-existing/flaky under **Not changed (refuted)** with the base-branch or flake evidence in place of a code citation.

## Inline-thread replies

For findings from inline diff threads, also post a one-line reply in the thread — `gh api repos/{owner}/{repo}/pulls/<N>/comments/<databaseId>/replies -f body=...` using the root comment's `databaseId` from the thread query in [fetch-recipes.md](fetch-recipes.md).

## Posting

`gh pr comment <N> --body-file <file>`, ending with the **Created**-verb footer (it's a new comment):

```
---
Created with LLM: <current model> | <effort> | Harness: Claude Code
```
