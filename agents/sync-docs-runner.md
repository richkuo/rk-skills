---
name: sync-docs-runner
description: Runs the sync-docs workflow. Use whenever the user asks to sync, update, or refresh CLAUDE.md, AGENTS.md, SKILL.md, or README.md to reflect recent commits or PRs.
---

# sync-docs

Keep CLAUDE.md, AGENTS.md, SKILL.md, and README.md accurate after new commits land. Finds the last docs-sync point, classifies every commit since then, and writes targeted updates — no rewrite, no drift. Syncing is bidirectional: as well as adding what's new, **remove or correct anything the current codebase now contradicts** — stale paths, renamed symbols, removed fields, dead defaults. A doc that lies is worse than one that's merely incomplete.

Adapt to the repo you're in. The doc set below is the common shape, not a requirement — a repo may have only a README, or add its own docs. Edit the files that exist; never create a new top-level doc (AGENTS.md, CHANGELOG.md, SKILL.md) as part of a sync — if one seems warranted, surface it to the user instead.

Audience split:
- **CLAUDE.md** — agent-facing dense reference (architecture, symbol/file names, `file:line` cues). Describes **current behavior**; not a history log.
- **AGENTS.md** *(only if the repo already has one — check `ls AGENTS.md` first)* — the counterpart agent doc for other tools (e.g. Codex). Same body content (architecture, commands, conventions); only the intro line stays tool-specific. When present, mirror every CLAUDE.md body edit into it so the two stay in lockstep — see step 5.
- **SKILL.md** *(only if the repo has one)* — operator-facing imperative guide (config knobs, setup prompts, CLI flows).
- **README.md** — public/newcomer-facing (setup, supported features, headline config). Lowest churn — update only when public surface changes.
- **CHANGELOG.md** *(only if the repo already has one — check `ls CHANGELOG.md` first)* — per-issue/PR history, rationale, and migration archaeology. When present it is the home for the "why" and resolved-migration detail, so CLAUDE.md stays lean. Never create one as part of a sync.

## Preconditions

```bash
git log --oneline -5        # confirm you're on the right branch
git status                  # must be clean before editing docs
```

## Steps

### 1. Find the last sync baseline

```bash
git log --oneline | grep -m1 "docs:.*sync\|docs:.*CLAUDE\|docs:.*SKILL\|sync docs"
```

Note the SHA. If none found, ask the user for the last-known-good tag or SHA (or fall back to the initial commit for a first sync).

### 2. Get commits since last sync

```bash
git log <last-sync-sha>..HEAD --oneline
```

Exclude pure CI / workflow / chore commits (`.github/`, `scripts/`, version bumps) unless they affect agent- or operator-facing behavior.

### 3. Classify each commit

| Category | Docs target | Action |
|----------|-------------|--------|
| New config field / flag / setting | CLAUDE.md config reference; SKILL.md settings table (if present); README.md **only if** it's a top-level/public-facing knob | Add field description + notes |
| Changed default behavior | CLAUDE.md patterns section; SKILL.md (if present); README.md **only if** a documented default/example now contradicts the code | Update description; note old vs new |
| New pluggable unit (plugin, command, integration, platform, strategy, theme, provider…) | CLAUDE.md structure + SKILL.md catalog (if present) + README.md feature list | Add entry to each doc that enumerates the set |
| Bug fix (behavior change) | CLAUDE.md patterns (if pattern-level) | Update the relevant bullet |
| New CLI command / flag | SKILL.md commands (if present); README.md Getting Started **only if** it's part of the setup/operator flow | Add usage |
| Setup / install flow change | README.md Getting Started + SKILL.md (if operator-facing) | Update the relevant block |
| Internal refactor / test | Skip (no docs change needed) | — |
| New release milestone | Project memory/notes file **if one exists** (see step 9) | Append version entry |
| Per-issue/PR history, rationale, or migration archaeology (*if CHANGELOG.md exists*) | CHANGELOG.md | Add a keyed entry there, not into CLAUDE.md; CLAUDE.md gets only the terse current-state invariant |
| Existing doc claim contradicted by current code (stale path, renamed symbol, removed field, changed default) | Whichever doc carries the claim | Correct or delete the stale statement |

### 4. Audit existing docs against the codebase and prune outdated content

Commit-driven updates catch what changed; they miss docs that silently went stale. Before writing new content, spot-check the existing docs against the actual code:

- For each doc section in the area of an in-scope commit, verify the surrounding claims still hold — file paths exist, symbol names match, defaults and version numbers are current, CLI flags still accept the documented args.
- Delete or correct any statement the codebase contradicts: removed fields, renamed symbols, dead file paths, stale defaults, deprecated flows, examples that no longer run.
- Removing wrong content is as important as adding new content — treat a prune as a first-class edit, not an afterthought.
- Stay scoped: audit the areas related to the in-scope commits, not the entire doc. If the docs look broadly drifted beyond that scope, flag it to the user rather than silently doing a full rewrite.
- When unsure whether something is outdated, grep the code to confirm before deleting — never remove a claim you haven't verified is wrong.
- **Cross-check "current/live/active/default" claims against the deciding variable, not the doc's own prior text.** Any doc that names which version/mode/config is currently in effect (a build script's target, a feature-flag default, an active-environment pointer) can go stale silently — the doc reads as self-consistent even after the underlying switch moved. Find the actual switch (grep for the assignment — `MAIN=`, `ACTIVE_*`, a default-branch config key, etc.) and confirm it still matches what the doc claims.
- **Diff enumerable generated listings against the filesystem.** When an in-scope commit touches a directory holding a versioned or pluggable set of items (plugins, commands, integrations, themes, providers), list the actual directory entries (`ls`, `find`) and compare against every place that's supposed to enumerate them (index/chooser pages, catalog tables, README lists). A missing or orphaned entry is a silent drift the commit diff alone won't surface, because the commit that broke it may be several syncs back.
- **Check promotion/demotion parity.** If the codebase has a "promote item to active, retire the previous one" pattern (a new default version, a new production config, a newly-active integration), verify that state encoding "this is the active one" — self-referencing URLs, indexing/discoverability directives, feature flags, config defaults — was flipped on BOTH the newly-promoted item and the newly-demoted item. A promotion is a two-sided edit; half-applied swaps (new item correct, old item still claiming to be active) are a common source of live bugs, not just doc drift, and won't show up in a diff of the promoting commit alone. If you find this pattern is real but undocumented as an explicit invariant, add a short rule for it to the project's own docs (e.g. CLAUDE.md patterns) so future promotions don't repeat the same half-applied swap.

### 5. Edit CLAUDE.md

- Stay surgical: edit only the sections that changed.
- Add new fields to the appropriate config or patterns section.
- Keep bullets concise — CLAUDE.md is dense reference, not narrative.
- Update any config/schema version constant the project maintains if a migration bumped it.
- If a new opt-in field was added and the repo has a SKILL.md, add it to the relevant operator table there (see step 6).
- **Mirror into AGENTS.md if it exists.** Run `ls AGENTS.md`; if present, apply every body edit you just made to CLAUDE.md to AGENTS.md verbatim (architecture, commands, conventions, schema — same content). The only thing that differs is the intro/header line, which stays tool-specific — do not overwrite it with CLAUDE.md's Claude-facing line. Also audit AGENTS.md for the same staleness patterns as step 4: it drifts silently because commit-driven edits target CLAUDE.md by name. If AGENTS.md doesn't exist, skip it — never create one during a sync.

### 6. Edit SKILL.md (only if the repo has one)

Keep SKILL.md operator-facing and imperative; avoid code internals. Common targets, depending on what the repo's SKILL.md documents:
- **Settings / configuration table** — add new global or per-unit keys.
- **Post-update / upgrade reference** — add the change as a default, opt-in, or auto-migration row so operators get prompted on upgrade.
- **Commands / reconfiguration section** — if a CLI surface or reload scope changed.
- **Operator safety controls** — if guard/circuit-breaker/limit behavior changed.

### 7. Edit README.md (only if public surface changed)

README is the entry point for newcomers and the public face of the project. Default to **no edit** — only touch when one of these is true:

- **New supported feature/platform/integration** → add to the relevant feature or catalog section.
- **New public-facing unit** (plugin, command, provider, theme) → add to the list that enumerates them, one line each, matching the existing format.
- **New top-level CLI subcommand** that users run by hand → add to the appropriate Getting Started block or a dedicated section.
- **Setup / install / build flow change** → update the relevant setup block.
- **Public-facing config knob change** that contradicts a documented example → update the affected config sub-block only.

Skip README for: bug fixes, internal refactors, parameter tweaks, symbol renames, schema migrations (those go in SKILL.md if present), and cosmetic changes.

When editing:
- Keep the tone tutorial-clean — no `file:line` cues, no code internals, no PR numbers in body text (PR numbers only in changelog-style sections that already use them).
- Don't grow lists into prose — each item gets one line / one bullet matching the existing format.
- If a section already has version/PR references, follow the same convention; otherwise omit them.

### 8. Check CLAUDE.md size and condense if oversized

Claude Code warns when CLAUDE.md exceeds 40k chars ("Large CLAUDE.md will impact performance"). Run after step 5:

```bash
wc -c CLAUDE.md
```

If the byte count exceeds **35000**, condense in-place before finishing the sync. Target: bring the file back under 30000 chars (leaves headroom for the next sync). Do NOT split into multiple files — agents only auto-load the root CLAUDE.md.

**If a CHANGELOG.md exists, relocate rather than delete.** Before dropping completed-migration prose, resolved-incident narrative, or per-issue "why" detail (passes 2 and 5 below), move it into CHANGELOG.md keyed by issue/PR instead of discarding it — the history stays available without loading into agent context every turn. Only outright-delete history when the repo has no CHANGELOG.md to receive it. Never create a CHANGELOG.md solely to offload bytes during a sync; if CLAUDE.md is oversized and no CHANGELOG.md exists, surface that to the user as an option rather than introducing the file unilaterally.

**Condensation rules — preserve agent-critical signal, drop narrative:**

| Keep | Trim / drop |
|------|-------------|
| Symbol / file names and `file:line` cues | Prose explaining *why* a pattern exists when the rule alone is actionable |
| Field-name lists, enum values, default values, version numbers (thresholds, timeouts, schema versions) | Historical migration notes once the migration has shipped and stabilized (>2 versions old) |
| Non-obvious gotchas, race conditions, lock order, ordering constraints | Restated information that's already in another bullet |
| Active "new X requires Y" instructions | Examples that duplicate a rule already stated tersely |
| Currently-live behavior | Deprecated behavior, legacy field aliases that no caller uses |

**Mechanical passes — apply in order, stop when under target:**

1. **Collapse duplicated phrasing** — same fact stated twice in different bullets → merge into one bullet.
2. **Drop completed-migration prose** — if a migration is ≥2 versions behind the current schema/config version AND the legacy field is no longer read, delete the migration narrative; keep the field rename only if code still references the old name.
3. **Compress example-laden bullets** — `e.g.` lists with 3+ items → keep the first 1–2 + `…` if the pattern is obvious.
4. **Inline single-line sub-bullets** — `- foo:\n  - bar` where bar is one short clause → `- foo: bar`.
5. **Remove resolved-incident narrative** — "fixed because X happened in prod" becomes "X — see <symbol>" or is dropped if the rule stands on its own.
6. **Shorten reference-table cells** — multi-clause descriptions → one clause + symbol name; agents resolve details from code.

**Forbidden — never trim these even if oversized:**
- The `## Environment`, `## Setup`, `## Build & Deploy`, `## Testing` blocks (operator-load-bearing).
- Lookup tables — lists of IDs, type names, prefixes, file paths (losing one row corrupts dispatch).
- Concurrency-hazard rules (state-locking, lock-order, skip-reason/live-exec guards).
- Any PR/commit footer or format convention the repo's own CLAUDE.md defines.

After condensing, re-run `wc -c CLAUDE.md` and report old → new byte counts. If still over 40k after all six passes, surface to the user with a list of the largest sections and ask which to cut further — don't unilaterally remove load-bearing content.

### 9. Update the project memory/notes file if one exists

Some repos keep a running notes or memory file (e.g. `MEMORY.md`, `NOTES.md`, `docs/CHANGELOG`-style log) with a Releases section. If one exists **and** the in-scope commits include a version tag or release PR, append:

```
- **vX.Y.Z** — YYYY-MM-DD: <one-line summary> (PRs #N, #M)
```

Only append if such a file already exists — never create one during a sync.

## Red Flags — STOP

| Situation | Action |
|-----------|--------|
| `git status` is dirty before you start | Stash or commit pending work first |
| Commit touches multiple unrelated areas | Split classification carefully; don't conflate |
| A field was *removed* | Delete the row/bullet — don't leave stale docs |
| Behavior reversal (bug was fixed back to original) | Note the revert explicitly, don't just silently restore |
| A sync seems to warrant a brand-new top-level doc (AGENTS.md, CHANGELOG.md, SKILL.md) | Surface it to the user — never create one as part of a sync |

## Common Mistakes

- **Over-documenting internals** — CLAUDE.md is for agent-relevant patterns; SKILL.md is for operators. Symbol/field names belong in CLAUDE.md, not SKILL.md operator tables.
- **Under-documenting opt-in fields** — when the repo has a SKILL.md, every new opt-in field needs a row in its settings table and its upgrade reference so operators get prompted on upgrade.
- **Copying PR descriptions verbatim** — translate to concise imperative phrases the reader can act on.
- **Bundling multiple unrelated changes into one bullet** — one bullet per behavioral change.
- **Treating README like CLAUDE.md** — don't dump code internals, symbol names, or PR-by-PR changelog entries into README. If a change doesn't affect what a newcomer needs to install/run/configure, it doesn't belong there.
- **Forgetting README on new public units** — new features/plugins/integrations are the highest-signal README updates and the easiest to miss because CLAUDE.md and SKILL.md updates feel "complete." Always check the enumerated lists.
- **Trusting a doc's own history instead of re-deriving current state from code** — a "currently active" claim is only correct as of when it was written. Always re-check it against the actual deciding switch (config default, build-script variable, feature flag) rather than assuming a prior sync got it right.
- **Creating a new top-level doc during a sync** — AGENTS.md, CHANGELOG.md, and SKILL.md are only edited when they already exist; introducing one is a user decision, not a sync side effect.
