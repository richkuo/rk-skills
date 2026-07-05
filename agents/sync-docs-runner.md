---
name: sync-docs-runner
description: Runs the sync-docs workflow. Use whenever the user asks to sync, update, or refresh CLAUDE.md, AGENTS.md, SKILL.md, or README.md to reflect recent commits or PRs.
---

# sync-docs

Keep CLAUDE.md, SKILL.md, and README.md accurate after new commits land. Finds the last docs-sync point, classifies every commit since then, and writes targeted updates — no rewrite, no drift. Syncing is bidirectional: as well as adding what's new, **remove or correct anything the current codebase now contradicts** — stale paths, renamed symbols, removed fields, dead defaults. A doc that lies is worse than one that's merely incomplete.

Audience split:
- **CLAUDE.md** — agent-facing dense reference (Go internals, struct/function names, file:line cues). Describes **current behavior**; not a history log.
- **AGENTS.md** *(only if the repo already has one — check `ls AGENTS.md` first)* — the Codex-facing counterpart to CLAUDE.md. Same body content (architecture, commands, conventions); only the intro line stays Codex-facing. When present, mirror every CLAUDE.md body edit into it so the two stay in lockstep — see step 5. Never create one as part of a sync if the repo doesn't already have it.
- **SKILL.md** — operator-facing imperative guide (config knobs, post-update prompts, CLI flows).
- **README.md** — public/newcomer-facing (setup, supported platforms, strategy catalog, headline config). Lowest churn — update only when public surface changes.
- **CHANGELOG.md** *(only if the repo already has one — check `ls CHANGELOG.md` first)* — per-issue/PR history, rationale, and migration archaeology. When present it is the home for the "why" and the resolved-migration detail, so CLAUDE.md stays lean. If the repo has no CHANGELOG.md, do **not** create one as part of a sync — keep the existing CLAUDE.md-only structure.

## Preconditions

```bash
git log --oneline -5        # confirm you're on the right branch
git status                  # must be clean before editing docs
```

## Steps

### 1. Find the last sync baseline

```bash
git log --oneline | grep -m1 "docs:.*sync\|docs:.*CLAUDE\|docs:.*SKILL"
```

Note the SHA. If none found, ask the user for the last-known-good tag or SHA.

### 2. Get commits since last sync

```bash
git log <last-sync-sha>..HEAD --oneline
```

Exclude pure CI / workflow / chore commits (`.github/`, `scripts/`, version bumps) unless they affect agent-facing behavior.

### 3. Classify each commit

| Category | Docs target | Action |
|----------|-------------|--------|
| New config field / flag | CLAUDE.md `config.go` bullet + SKILL.md Adjustable Settings table; README.md Configuration Reference **only if** it's a top-level/public-facing knob | Add field description + notes |
| Changed default behavior | CLAUDE.md Key Patterns + SKILL.md Post-Update reference table; README.md **only if** the documented default/example contradicts new behavior | Update description; note old vs new |
| New strategy / platform | CLAUDE.md repo structure + SKILL.md Strategy Reference table + README.md Strategies/Platforms section | Add entry to all three |
| Bug fix (behavior change) | CLAUDE.md Key Patterns (if pattern-level) | Update the relevant bullet |
| New CLI command / flag | SKILL.md Commands or Reconfiguration section; README.md Getting Started **only if** it's part of setup/operator flow (e.g. `init`, `manual-open`, `backfill`) | Add usage |
| Setup / install flow change | README.md Getting Started + SKILL.md if operator-facing | Update the relevant block |
| Internal refactor / test | Skip (no docs change needed) | — |
| New release milestone | memory/MEMORY.md Releases section | Append version entry |
| Per-issue/PR history, rationale, or migration archaeology (*if CHANGELOG.md exists*) | CHANGELOG.md | Add a keyed entry there, not into CLAUDE.md; CLAUDE.md gets only the terse current-state invariant |
| Existing doc claim contradicted by current code (stale path, renamed symbol, removed field, changed default) | Whichever doc carries the claim | Correct or delete the stale statement |

### 4. Audit existing docs against the codebase and prune outdated content

Commit-driven updates catch what changed; they miss docs that silently went stale. Before writing new content, spot-check the existing CLAUDE.md / SKILL.md / README.md against the actual code:

- For each doc section in the area of an in-scope commit, verify the surrounding claims still hold — file paths exist, function/struct names match, defaults and version numbers are current, CLI flags still accept the documented args.
- Delete or correct any statement the codebase contradicts: removed fields, renamed symbols, dead file paths, stale defaults, deprecated flows, examples that no longer run.
- Removing wrong content is as important as adding new content — treat a prune as a first-class edit, not an afterthought.
- Stay scoped: audit the areas related to the in-scope commits, not the entire doc. If the docs look broadly drifted beyond that scope, flag it to the user rather than silently doing a full rewrite.
- When unsure whether something is outdated, grep the code to confirm before deleting — never remove a claim you haven't verified is wrong.
- **Cross-check "current/live/active/default" claims against the deciding variable, not the doc's own prior text.** Any doc that names which version/mode/config is currently in effect (a build script's target, a feature flag default, an active-environment pointer) can go stale silently — the doc reads as self-consistent even after the underlying switch moved. Find the actual switch (grep for the assignment — `MAIN=`, `ACTIVE_*`, a default-branch config key, etc.) and confirm it still matches what the doc claims.
- **Diff enumerable generated listings against the filesystem.** When an in-scope commit touches a directory holding a versioned or pluggable set of items (variants, strategies, integrations, plugins, themes), list the actual directory entries (`ls`, `find`) and compare against every place that's supposed to enumerate them (index/chooser pages, catalog tables, README lists). A missing or orphaned entry is a silent drift that the commit diff alone won't surface, because the commit that broke it may be several syncs back.
- **Check promotion/demotion parity.** If the codebase has a "promote item to active, retire the previous one" pattern (a new default version, a new production config, a newly-active integration), verify that state encoding "this is the active one" — self-referencing URLs, indexing/discoverability directives, feature flags, config defaults — was flipped on BOTH the newly-promoted item and the newly-demoted item. A promotion is a two-sided edit; half-applied swaps (new item correct, old item still claiming to be active) are a common source of live bugs, not just doc drift, and won't show up in a diff of the promoting commit alone. If you find this pattern is real but undocumented as an explicit invariant, add a short rule for it to the project's own docs (e.g. CLAUDE.md Key Patterns) so future promotions don't repeat the same half-applied swap.

### 5. Edit CLAUDE.md

- Stay surgical: edit only the sections that changed.
- Add new fields to the appropriate `config.go` or Key Patterns bullet.
- Keep bullets concise — CLAUDE.md is dense reference, not narrative.
- Update `CurrentConfigVersion` if the migration version bumped.
- If a new opt-in field was added, add it to the "Post-Update Agent Protocol" reference table rows in SKILL.md (see step 6).
- **Mirror into AGENTS.md if it exists.** Run `ls AGENTS.md`; if present, apply every body edit you just made to CLAUDE.md to AGENTS.md verbatim (architecture, commands, conventions, schema — same content). The only thing that differs is the intro/header line, which stays Codex-facing — do not overwrite it with CLAUDE.md's Claude-facing line. Also audit AGENTS.md for the same staleness patterns as step 4 (stale paths, pre-reorg command layouts, outdated episode/example lists, removed fields): it drifts silently because commit-driven edits target CLAUDE.md by name. If AGENTS.md doesn't exist, skip it — never create one during a sync.

### 6. Edit SKILL.md

Common targets:
- **Adjustable Settings table** — add per-strategy or global key rows.
- **Post-Update Agent Protocol → Reference: known categories table** — add the PR as a Runtime default, Opt-in, or Auto-migration row.
- **Strategy Reference → short-name conventions** — if new strategy flags or constraints were added.
- **Reconfiguration section** — if hot-reload scope changed.
- **Operator-Required Circuit Breakers** — if CB behavior changed.

Keep SKILL.md operator-facing and imperative; avoid Go internals.

### 7. Edit README.md (only if public surface changed)

README is the entry point for newcomers and the public face of the project. Default to **no edit** — only touch when one of these is true:

- **New supported platform** → add to `## Platforms` table and (if it has its own strategy set) `## Strategies` subsection.
- **New strategy** → add to the relevant `## Strategies` category list (spot / options / perps / futures / etc.).
- **New top-level CLI subcommand** that operators run by hand (`init`, `manual-open`, `manual-close`, `backfill`, `export`, …) → add to the appropriate `## Getting Started` block or a dedicated section.
- **Setup / install / build flow change** → update `### Manual Setup`, `### Interactive Setup`, or `### Running multiple instances`.
- **Public-facing config knob change** that contradicts a documented example → update `## Configuration Reference` (and only the affected sub-block).
- **Auto-update / DM-upgrade flow change** → update `### Auto-Update & DM Upgrades`.

Skip README for: bug fixes, internal refactors, per-strategy parameter tweaks, struct/function renames, schema migrations (those go in SKILL.md Post-Update Protocol), and Discord/Telegram cosmetic changes.

When editing:
- Keep the tone marketing-clean and tutorial-style — no `file:line` cues, no Go internals, no PR numbers in body text (PR numbers in changelog-style sections only if they already exist).
- Don't grow the strategy lists into prose — each strategy gets one line / one bullet matching the existing format.
- If a section already has version/PR references, follow the same convention; otherwise omit them.

### 8. Check CLAUDE.md size and condense if oversized

Claude Code warns when CLAUDE.md exceeds 40k chars ("Large CLAUDE.md will impact performance"). Run after step 5:

```bash
wc -c CLAUDE.md
```

If the byte count exceeds **40000**, condense in-place before finishing the sync. Target: bring the file back under 38000 chars (leaves headroom for the next sync). Do NOT split into multiple files — agents only auto-load the root CLAUDE.md.

**If a CHANGELOG.md exists, relocate rather than delete.** Before dropping completed-migration prose, resolved-incident narrative, or per-issue "why" detail (passes 2 and 5 below), move it into CHANGELOG.md keyed by issue/PR instead of discarding it — the history stays available without loading into agent context every turn. Only outright-delete history when the repo has no CHANGELOG.md to receive it. Never create a CHANGELOG.md solely to offload bytes during a sync; if CLAUDE.md is oversized and no CHANGELOG.md exists, surface that to the user as an option rather than introducing the file unilaterally.

**Condensation rules — preserve agent-critical signal, drop narrative:**

| Keep | Trim / drop |
|------|-------------|
| Struct / function / file names and `file:line` cues | Prose explaining *why* a pattern exists when the rule alone is actionable |
| Field-name lists, enum values, default values, version numbers (`CurrentConfigVersion`, thresholds, timeouts) | Historical migration notes once the migration has shipped and stabilized (>2 versions old) |
| Non-obvious gotchas, race conditions, mutex order, ordering constraints | Restated information that's already in another bullet |
| Active "new X requires Y" instructions | Examples that duplicate a rule already stated tersely |
| Currently-live behavior | Deprecated behavior, legacy field aliases that no caller uses |

**Mechanical passes — apply in order, stop when under target:**

1. **Collapse duplicated phrasing** — same fact stated twice in different bullets → merge into one bullet.
2. **Drop completed-migration prose** — if a migration version is ≥2 behind `CurrentConfigVersion` AND the legacy field is no longer read, delete the migration narrative; keep the field rename only if code still references the old name.
3. **Compress example-laden bullets** — `e.g.` lists with 3+ items → keep the first 1–2 + `…` if the pattern is obvious.
4. **Inline single-line sub-bullets** — `- foo:\n  - bar` where bar is one short clause → `- foo: bar`.
5. **Remove resolved-incident narrative** — "fixed because X happened in prod" becomes "X — see <symbol>" or is dropped if the rule stands on its own.
6. **Shorten Reference table cells** — multi-clause descriptions → one clause + symbol name; agents resolve details from code.

**Forbidden — never trim these even if oversized:**
- The `## Environment`, `## Setup`, `## Build & Deploy`, `## Testing` blocks (operator-load-bearing).
- Lists of platform IDs, strategy types, ID prefixes, file paths (lookup tables — losing one row corrupts dispatch).
- "Skip-reason guards" / "live exec guard" / state-locking / mutex-order rules (concurrency hazards).
- The Pull Requests footer/format rules.

After condensing, re-run `wc -c CLAUDE.md` and report old → new byte counts. If still over 40k after all six passes, surface to the user with a list of the largest sections and ask which to cut further — don't unilaterally remove load-bearing content.

### 9. Update memory if this is a go-trader session

If a `memory/MEMORY.md` exists with a Releases section, append:

```
- **vX.Y.Z** — YYYY-MM-DD: <one-line summary> (PRs #N, #M)
```

Only append if the commits include a version tag or release PR.

## Red Flags — STOP

| Situation | Action |
|-----------|--------|
| `git status` is dirty before you start | Stash or commit pending work first |
| Commit touches multiple unrelated areas | Split classification carefully; don't conflate |
| A field was *removed* | Delete the row/bullet — don't leave stale docs |
| Behavior reversal (bug was fixed back to original) | Note the revert explicitly, don't just silently restore |

## Common Mistakes

- **Over-documenting internals** — CLAUDE.md is for agent-relevant patterns; SKILL.md is for operators. Go struct field names belong in CLAUDE.md, not SKILL.md config tables.
- **Under-documenting opt-in fields** — every new per-strategy field needs a row in SKILL.md's Adjustable Settings table and a SKILL.md Post-Update Protocol entry so operators get prompted on upgrade.
- **Forgetting the Post-Update reference table** — this table in SKILL.md is the main place agents learn what to prompt operators about; missing rows mean silent behavior changes.
- **Copying PR descriptions verbatim** — translate to concise imperative phrases the operator can act on.
- **Bundling multiple unrelated changes into one bullet** — one bullet per behavioral change.
- **Treating README like CLAUDE.md** — don't dump Go internals, struct names, or PR-by-PR changelog entries into README. README is for newcomers; if a change doesn't affect what they need to know to install/run/configure, it doesn't belong there.
- **Forgetting README on new platforms/strategies** — these are the highest-signal README updates and the easiest to miss because CLAUDE.md and SKILL.md updates feel "complete." Always check the platform/strategy lists.
- **Trusting a doc's own history instead of re-deriving current state from code** — a "currently active" claim is only correct as of when it was written. Always re-check it against the actual deciding switch (config default, build-script variable, feature flag) rather than assuming a prior sync got it right and nothing has moved since.
