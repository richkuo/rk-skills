---
name: sync-docs
description: Use when the user asks to sync, update, or refresh CLAUDE.md, AGENTS.md, SKILL.md, and README.md to reflect recent commits or PRs. Triggers on phrases like "sync docs", "update CLAUDE.md", "update AGENTS.md", "update SKILL.md", "update README", "reflect recent changes", or "document the recent PRs".
---

# sync-docs

Keep CLAUDE.md, AGENTS.md, SKILL.md, and README.md accurate after new commits land: find the last docs-sync point, classify every commit since then, and write targeted edits. Syncing is bidirectional: add what is new, and **remove or correct anything the current codebase contradicts** (stale paths, renamed symbols, removed fields, dead defaults). A doc that lies is worse than one that is incomplete.

Adapt to the repo. Edit the docs that exist; never create a new top-level doc (AGENTS.md, CHANGELOG.md, SKILL.md) during a sync. If one seems warranted, surface it to the user.

Audiences: **CLAUDE.md** is the dense agent reference (architecture, symbol and file names, `file:line` cues) and describes current behavior, never history. **AGENTS.md** is the counterpart for other agent tools (step 5). **SKILL.md** is operator-facing and imperative (config keys, setup, CLI flows); symbol and field names stay out of its tables. **README.md** is the newcomer entry point and changes only when the public surface changes. **CHANGELOG.md**, when present, holds per-issue rationale and migration history so CLAUDE.md stays lean.

## Preconditions

`git log --oneline -5` to confirm the branch; `git status` must be clean.

## Steps

### 1. Find the last sync baseline

```bash
git log --oneline | grep -m1 "docs:.*sync\|docs:.*CLAUDE\|docs:.*SKILL\|sync docs"
```

If none is found, ask the user for the last-known-good tag or SHA, or use the initial commit for a first sync.

### 2. Get commits since the baseline

`git log <last-sync-sha>..HEAD --oneline`. Exclude pure CI, workflow, and chore commits unless they change agent- or operator-facing behavior.

### 3. Classify each commit

| Category | Docs target | Action |
|----------|-------------|--------|
| New config field / flag | CLAUDE.md config; SKILL.md settings table; README.md only for a public top-level knob | Add field description |
| Changed default behavior | CLAUDE.md patterns; SKILL.md; README.md only if a documented example now contradicts the code | Update; note old vs new |
| New pluggable unit (plugin, command, integration, provider, theme) | Every doc that enumerates the set | Add one entry per doc |
| Bug fix (behavior change) | CLAUDE.md patterns, if pattern-level | Update the bullet |
| New CLI command / flag | SKILL.md commands; README.md Getting Started only if part of setup | Add usage |
| Setup / install flow change | README.md Getting Started; SKILL.md if operator-facing | Update the block |
| Internal refactor / test | Skip | — |
| Release milestone | Project notes file, if one exists (step 9) | Append version entry |
| Rationale or migration history (CHANGELOG.md exists) | CHANGELOG.md | Keyed entry there; CLAUDE.md keeps only the current invariant |
| Doc claim contradicted by code | Whichever doc carries the claim | Correct or delete it |

### 4. Audit existing docs against the code

Commit-driven edits miss docs that went stale on their own. For each doc section near an in-scope commit, verify the surrounding claims: file paths exist, symbol names match, defaults and versions are current, CLI flags accept the documented args. Delete or correct what the code contradicts. Stay scoped to the in-scope areas; if the docs look broadly drifted, flag it instead of rewriting. When unsure, grep the code first; never remove a claim you haven't verified is wrong.

- **Check "current/active/default" claims against the deciding switch** (a build script's target, a feature-flag default, an active-environment key), never against the doc's own prior text.
- **Diff enumerated listings against the filesystem.** When a commit touches a directory of pluggable items, `ls` it and compare with every catalog, index, and README list that enumerates it.
- **Check promotion parity.** When an item is promoted to active and another is retired, confirm the "this is active" state (self-referencing URLs, indexing directives, flags, defaults) flipped on both. If this invariant is real but undocumented, add a short rule to the project's docs.

### 5. Edit CLAUDE.md, then mirror into AGENTS.md

Edit only the sections that changed; keep bullets terse and one behavioral change per bullet. Update any schema or config version constant a migration bumped. Translate PR descriptions into imperative phrases; never paste them. Then run `ls -l AGENTS.md`:

- **Symlink to CLAUDE.md**: skip it. Never open it for writing; the write resolves to CLAUDE.md and a tool-specific intro would land in the canonical file.
- **Real file**: apply every CLAUDE.md body edit to it verbatim, keep its own intro line, and audit it for the step 4 staleness patterns.
- **Absent**: skip it.

### 6. Edit SKILL.md (only if the repo has one)

Add new keys to the settings table and the upgrade or post-update reference so operators get prompted; update commands, reload scope, and safety-control sections when those surfaces change.

### 7. Edit README.md (only if the public surface changed)

Default to no edit. Touch it only for a new supported feature or integration, a new public unit in an enumerated list, a new top-level CLI subcommand, a setup or install change, or a public config example the code now contradicts. Skip bug fixes, refactors, renames, and migrations. Keep the tutorial tone: no `file:line` cues, code internals, or PR numbers in body text; one line per list item in the existing format. New public units are the README edit most often missed, so always check its enumerated lists.

### 8. Check CLAUDE.md size and condense if oversized

Run `wc -c CLAUDE.md`. Above **35000** bytes, condense in place to under **30000** before finishing. Never split it into multiple files; agents auto-load only the root CLAUDE.md.

Keep symbol and file names, field lists, enum values, defaults, version numbers, non-obvious gotchas, concurrency and ordering rules, and live behavior. Drop "why" prose where the rule alone is actionable, shipped-migration narrative, resolved-incident stories, duplicate statements, and examples that restate a terse rule. If a CHANGELOG.md exists, move history there keyed by issue or PR instead of deleting it. Never trim the Environment, Setup, Build & Deploy, or Testing blocks, lookup tables of IDs, paths, or prefixes, concurrency-hazard rules, or a format convention the repo defines.

Re-run `wc -c` and report old and new byte counts. If the file is still over 40000 bytes, list the largest sections and ask the user which to cut.

### 9. Update the project notes file if one exists

If the repo keeps a notes or memory file with a Releases section and the in-scope commits include a version tag or release PR, append `- **vX.Y.Z** — YYYY-MM-DD: <summary> (PRs #N, #M)`.

## Red Flags — STOP

| Situation | Action |
|-----------|--------|
| Commit touches multiple unrelated areas | Classify each area separately |
| A field was removed | Delete the row or bullet |
| Behavior reversal (fix reverted to original) | Note the revert explicitly |
