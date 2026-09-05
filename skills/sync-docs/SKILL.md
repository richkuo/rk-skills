---
name: sync-docs
description: Use when the user asks to sync, update, or refresh CLAUDE.md, AGENTS.md, SKILL.md, and README.md to reflect recent commits or PRs. Triggers on phrases like "sync docs", "update CLAUDE.md", "update AGENTS.md", "update SKILL.md", "update README", "reflect recent changes", or "document the recent PRs".
---

# sync-docs

Keep CLAUDE.md, AGENTS.md, SKILL.md, and README.md accurate after new commits land: find the last docs-sync point, classify every commit since then, and write targeted edits. Syncing is bidirectional: add what is new, and **remove or correct anything the current codebase contradicts**. A doc that lies is worse than one that is incomplete.

Edit the docs that exist; never create a new top-level doc (AGENTS.md, CHANGELOG.md, SKILL.md) during a sync. If one seems warranted, tell the user.

Audiences: **CLAUDE.md** is the dense agent reference (architecture, symbol and file names, `file:line` cues) and describes current behavior, never history. **AGENTS.md** mirrors it for other agent tools (step 5). **SKILL.md** is operator-facing and imperative (config keys, setup, CLI flows); no symbol or field names in its tables. **README.md** is the newcomer entry point and changes only when the public surface changes. **CHANGELOG.md**, when present, holds per-issue rationale and migration history.

Preconditions: `git log --oneline -5` to confirm the branch; `git status` must be clean.

## Steps

1. **Baseline.** `git log --oneline | grep -m1 "docs:.*sync\|docs:.*CLAUDE\|docs:.*SKILL\|sync docs"`. If none, ask the user for the last-known-good tag or SHA, or use the initial commit for a first sync.
2. **Range.** `git log <last-sync-sha>..HEAD --oneline`. Skip pure CI, workflow, and chore commits unless they change agent- or operator-facing behavior.
3. **Classify each commit** (an unrelated-areas commit is classified per area):

| Category | Docs target | Action |
|----------|-------------|--------|
| New config field / flag | CLAUDE.md config; SKILL.md settings table; README.md only for a public top-level setting | Add field description |
| Changed default behavior | CLAUDE.md patterns; SKILL.md; README.md only if a documented example now contradicts the code | Update; note old vs new |
| New pluggable unit (plugin, command, integration, provider, theme) | Every doc that enumerates the set | Add one entry per doc |
| Bug fix (behavior change) | CLAUDE.md patterns, if pattern-level | Update the bullet |
| New CLI command / flag | SKILL.md commands; README.md Getting Started only if part of setup | Add usage |
| Setup / install flow change | README.md Getting Started; SKILL.md if operator-facing | Update the block |
| Removed field | Whichever doc lists it | Delete the row or bullet |
| Behavior reversal (fix reverted) | Whichever doc carries it | Note the revert explicitly |
| Internal refactor / test | Skip | none |
| Release milestone | Project notes file, if one exists (step 9) | Append version entry |
| Rationale or migration history (CHANGELOG.md exists) | CHANGELOG.md | Keyed entry there; CLAUDE.md keeps only the current invariant |
| Doc claim contradicted by code | Whichever doc carries the claim | Correct or delete it |

4. **Audit docs near in-scope commits.** Verify surrounding claims: paths exist, symbol names match, defaults and versions are current, CLI flags accept the documented args. Delete or correct what the code contradicts; grep first, and never remove a claim you haven't verified is wrong. Stay scoped; if the docs look broadly drifted, flag it instead of rewriting. Check "current/active/default" claims against the deciding switch (build target, feature-flag default, active-environment key), never against the doc's own prior text. When a commit touches a directory of pluggable items, `ls` it and diff against every catalog, index, and README list. When one item is promoted and another retired, confirm the active state (self-referencing URLs, indexing directives, flags, defaults) flipped on both; if that invariant is real but undocumented, add a short rule.
5. **Edit CLAUDE.md, then mirror into AGENTS.md.** Edit only changed sections; terse bullets, one behavioral change each; update any schema or config version constant a migration bumped; rewrite PR descriptions as imperative phrases. Then `ls -l AGENTS.md`: symlink to CLAUDE.md, skip it and never open it for writing (the write lands in the canonical file); real file, apply every CLAUDE.md body edit verbatim, keep its own intro line, and audit it per step 4; absent, skip.
6. **Edit SKILL.md** (only if the repo has one). Add new keys to the settings table and the upgrade or post-update reference; update commands, reload scope, and safety-control sections when those surfaces change.
7. **Edit README.md** (only if the public surface changed). Default to no edit. Touch it only for a new supported feature or integration, a new public unit in an enumerated list, a new top-level CLI subcommand, a setup or install change, or a public config example the code now contradicts. Tutorial tone: no `file:line` cues, internals, or PR numbers; one line per list item in the existing format. Always check its enumerated lists; new public units are the edit most often missed.
8. **Size check.** `wc -c CLAUDE.md`. Above **35000** bytes, condense in place to under **30000**; never split it (agents auto-load only the root CLAUDE.md). Keep symbol and file names, field lists, enum values, defaults, version numbers, gotchas, concurrency and ordering rules, live behavior, the Environment, Setup, Build & Deploy, and Testing blocks, lookup tables of IDs, paths, or prefixes, and repo-defined format conventions. Drop "why" prose where the rule alone is actionable, shipped-migration narrative, resolved-incident stories, duplicates, and examples that restate a rule; move history to CHANGELOG.md when it exists. Re-run `wc -c` and report old and new counts. Still over 40000, list the largest sections and ask the user which to cut.
9. **Project notes file**, if the repo keeps one with a Releases section and the range includes a version tag or release PR: append `- **vX.Y.Z** — YYYY-MM-DD: <summary> (PRs #N, #M)`.
