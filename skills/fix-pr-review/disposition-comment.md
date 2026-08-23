# Disposition comment

Reference for SKILL.md step 9: the template, section slotting rules, inline-thread replies, and posting mechanics.

## Template

Write the comment as direct, scannable status:

```
Addressed review feedback (<reviewer(s)> · <timestamp(s)>) in <commit-sha>.

Growth check: diff <lines> lines vs <lines> at first push (<ratio>x); cycle <N>.

### Fixed
1. **<finding title>** — <what changed> (`file:line`).

### Corrected scope (partial)
1. **<finding title>** — <what was real and fixed vs. what wasn't> (`file:line`).

### Not changed (refuted)
1. **<finding title>** — <code-grounded reason the suggestion doesn't apply> (`file:line`).

### Resolved judgment calls (was Requires Human Review)
1. **<finding title>** — implemented <the absolute-best solution and why, `file:line`>. Alternatives rejected: <one line each>. Override if you'd prefer one of these.

### Deferred to follow-up
1. **<finding title>** — out of scope under scope rule <N>: <the mechanism the remedy needs that this PR lacks, and the yardstick that does not ask for it>; filed as #<issue>.
```

## Slotting rules

- **Copy `<finding title>` verbatim from the review comment** — the reviewer's own bold one-sentence title, word for word, with no paraphrase or shortening. The next reviewer matches its findings to these dispositions by claim (`pr-review` requires that read before it drafts), and a reworded title breaks that match, so a settled finding comes back.
- Every **Not changed (refuted)** and **Corrected scope (partial)** item states the verdict through its section heading and carries a code-grounded rebuttal with its `file:line` — that rebuttal is the evidence a later reviewer must answer before it re-raises the finding, so make it stand on its own without the thread around it.
- Omit any empty section. Keep each item one line with a `file:line` anchor.
- The `Growth check:` line appears only when SKILL.md step 4's growth check fired (diff past ~3x the first push, or cycle 4+); omit it otherwise. It is the one place in this comment those numbers live — never fold them into a finding item.
- **Every Deferred to follow-up item names both the scope rule it applied and the issue number.** That pair is the deferral's rationale, and `pr-review` settles the finding on it exactly as it settles a code-grounded rebuttal — the next reviewer re-raises it only by naming the deferral and showing from current code why it fails. A deferral missing either half settles nothing, so the same blocking finding returns next cycle.
- A **Deferred to follow-up** item that matched an issue an earlier cycle already filed cites that existing issue rather than a new one.
- CI Failure findings slot into the same sections — fixed ones under **Fixed**, pre-existing/flaky ones under **Not changed (refuted)** with the base-branch or flake evidence in place of a code citation.

## Inline-thread replies

For findings that came from inline diff threads, also post a one-line reply in the thread itself — use the root comment's `databaseId` from the thread query in [fetch-recipes.md](fetch-recipes.md): `gh api repos/{owner}/{repo}/pulls/<N>/comments/<databaseId>/replies -f body=...` — that's where the reviewer is watching.

## Posting

Post the main comment via:

```bash
gh pr comment <N> --body-file <file>
```

Footer on the comment uses the **Created** verb (it's a new comment):

```
---
Created with LLM: <current model> | <effort> | Harness: Claude Code
```
