# Disposition comment

Reference for SKILL.md step 9: the template, section slotting rules, inline-thread replies, and posting mechanics.

## Template

Write the comment as direct, scannable status:

```
Addressed review feedback (<reviewer(s)> · <timestamp(s)>) in <commit-sha>.

### Fixed
1. **<finding title>** — <what changed> (`file:line`).

### Corrected scope (partial)
1. **<finding title>** — <what was real and fixed vs. what wasn't> (`file:line`).

### Not changed (refuted)
1. **<finding title>** — <code-grounded reason the suggestion doesn't apply> (`file:line`).

### Resolved judgment calls (was Requires Human Review)
1. **<finding title>** — implemented <the absolute-best solution and why, `file:line`>. Alternatives rejected: <one line each>. Override if you'd prefer one of these.

### Deferred to follow-up
1. **<finding title>** — <why it's out of scope; issue link filed>.
```

## Slotting rules

- Omit any empty section. Keep each item one line with a `file:line` anchor.
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
