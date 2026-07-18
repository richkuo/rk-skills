# Contract inventory

Parent tracking: [#57](https://github.com/richkuo/rk-skills/issues/57).

This inventory records every duplicated repository contract: who owns it, who restates it, what must stay aligned, what may diverge, how it is guarded, and what to do next. Full-file equality is the wrong guard when wording intentionally differs by runtime; guards check **required shared semantics**.

## How to update a guarded contract

1. Edit the **canonical owner** (or every consumer when the owner is a shared semantic set with no generator).
2. Update every **consumer** listed for that row in the same change.
3. Run `bun test` — semantic guards fail when required markers drift.
4. For `templates/claude-workflow/prompts/*.md`, also satisfy shell safety: no `"`, backticks, or `$` (`tests/prompt-shell-safety.test.js`).
5. If you rename or delete a guard test, update every inventory/README citation — `tests/inventory-guard-citations.test.js` fails on dangling `tests/*.test.js` paths.

## Inventory

| Family | Canonical owner | Consumers | Required shared semantics | Allowed divergence | Guard | Disposition |
|---|---|---|---|---|---|---|
| PR review format | Semantic set across three paraphrased copies (no single generated source yet) | `skills/pr-review-format/SKILL.md`; `templates/claude-workflow/prompts/pr-review-format.md`; `templates/claude-review.yml` (inline prompt) | Verdicts `LGTM` / `Needs Updates`; four H3 sections; blocking = Needs Fixing + Requires Human Review; materiality filter; safety carve-out overrides materiality; per-finding **Plain simple English:** (≤55 words); **Invariant:** + **Must survive:** on Needs Fixing / Recommended Optional; **Recommended proposed solution:** on Requires Human Review; follow-up and human-review as last-resort dispositions; field order Plain → (Invariant/Must survive or Recommended proposed solution) | Interactive skill may gate LGTM on CI inspection; CI copies must forbid executing project code and must not wait on CI; safety trigger lists may be project-flavored | `tests/pr-review-format-contract.test.js` (`bun test`) | **Guarded in parent PR** (non-negotiable for #57) |
| Release version rules | `agents/create-release-runner.md` step 4 (manifest bump when version fields exist) | `skills/create-release/SKILL.md`; `templates/claude-workflow/prompts/sync-docs-release.md` (CI sync-release / publish modes); `.github/workflows/publish.yml` | When `package.json` / `.claude-plugin/plugin.json` (or other manifests) declare a version and publish keys off it, release paths must bump those versions before tagging/publishing so publish is not silently skipped | CI checkout may lack push to main; branch-shaped `docs-release/vX.Y.Z` publish path differs from interactive tag-on-main | Child issue (no guard yet) | **Child issue** — correct CI “no version file” claim, then guard |
| Global guidelines body | Shared body of `CLAUDE.md` / `AGENTS.md` (tool-specific harness names and examples only) | `agents/sync-docs-runner.md` step 5 (mirror rule); skills that quote PR-body lead / footer | Integrity, response style, engineering, attribution footer shape, PR title convention, PR review format load rule, GitHub issue format load rule, worktree+PR workflow | Harness names (`Claude Code` vs `Codex`); `#` memory target file; worktree prefix examples; project-precedence filename | Child issue (no guard yet) | **Child issue** — add missing PR-body lead to `AGENTS.md`, then semantic guard |
| LLM attribution footer | Global verb-based footer in `CLAUDE.md` / `AGENTS.md` | Skills (`work-on-issue`, `pr-review-format`, issue format, etc.); workflow comment composer (`templates/claude-workflow/scripts/compose_claude_comment.py` and related) | Durable artifacts end with `---` + verb/`LLM` attribution; verbs Created / Updated / Validated; effort never `low` | CI composer may emit `LLM: <model> \| <effort> \| Harness: …` without the `Created with LLM:` verb prefix when rewriting Action comments — document as intentional exception | Child issue | **Child issue** — one contract + explicit exceptions |
| Fix-PR procedure | Shared goals across interactive + CI | `skills/fix-pr-review/SKILL.md` (+ loop); `templates/claude-workflow/prompts/fix-pr.md` | Fetch all unaddressed channels; re-validate before fixing; disposition comment; re-review trigger | Fork handling; test execution (interactive runs tests; CI must not); permissions; `@claude` vs `@claude sonnet` trigger rules | None yet | **Parent checklist** — inventory shared core before child |
| Live vs template `claude.yml` | Template intended as vendored source: `templates/claude-workflow/workflows/claude.yml` | Live: `.github/workflows/claude.yml`; routing tests in `templates/claude-workflow/scripts/test_workflow_logic.py` | Fail-closed route classifier behavior; route → prompt mapping | Runner settings / timeouts / repo-local wiring | Partial: Python template tests | **Parent checklist** — classify shared core; decide live coverage |
| Sync-docs procedure | Interactive: `agents/sync-docs-runner.md` + `skills/sync-docs/SKILL.md` | CI: `templates/claude-workflow/prompts/sync-docs-release.md` sync mode | Commit classification; mirror CLAUDE↔AGENTS when both exist; no inventing top-level docs | CI shallow clone / tag fetch; write permissions; release coupling in sync-release | None yet | **Parent checklist** |
| Loop / validate skill families | Each base skill is owner of its step contract | `*-loop` wrappers; Fable variants | Pipeline handoffs named in base skill; Complexity band gates (Capability ≥ 2 / score ≥ 50) where documented | Model/harness routing; unconditional vs gated fableplan | Partial: `tests/complexity-score.test.js` phrase checks | **Parent checklist** — guard only identical contracts |
| Capability bands | `skills/validate-issue/SKILL.md` step 6 formula + golden table | `new-issue`, `github-issue-format`, `prd-to-issues`, loop skills, README | Formula `25 × Capability + Volume`; Coupling ≥ 3 bump; golden examples | Consumer-specific prose around the formula | `tests/complexity-score.test.js` | **Guarded for formula/phrases**; extend only truly shared table rows later |
| Package / plugin version parity | `package.json` `"version"` | `.claude-plugin/plugin.json` `"version"` | Exact string equality | Installer behavior: `install.sh` symlinks vs `bin/install.mjs` copy | None yet | **Parent checklist** — guard parity; document installer divergence |
| Prompt shell safety | `templates/claude-workflow/prompts/*.md` | `.github/workflows/claude-run.yml` runtime reject | No `"`, backtick, or `$` in shared prompts | N/A | `tests/prompt-shell-safety.test.js` | **Guarded** |
| Execution block ordering | `skills/prd-to-issues/SKILL.md` | `execution-plan-review`, `milestone-workflow`, README | `Depends on` / `Runs after` fields and graph rules | Presentation-only wording | `tests/execution-block-contract.test.js` | **Guarded** |

## Child issues filed from ready rows

| Row | Child |
|---|---|
| Release version rules | [#58](https://github.com/richkuo/rk-skills/issues/58) |
| Global guidelines body | [#59](https://github.com/richkuo/rk-skills/issues/59) |
| LLM attribution footer | [#60](https://github.com/richkuo/rk-skills/issues/60) |

## Deferred (need more evidence before complete child specs)

- Fix-PR shared core vs intentional divergence
- Live vs template workflow + routing-shell coverage for live
- Sync-docs interactive vs CI
- Loop/validate identical-only contracts
- Capability-band full table rows beyond formula/phrases
- Version/install parity + installer docs
- Any additional family found in a later audit

---
Created with LLM: Cursor Grok 4.5 | high | Harness: Cursor
