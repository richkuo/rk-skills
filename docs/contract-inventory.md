# Contract inventory — loop / validate pipeline rules

Scoped to the loop/validate skill families ([#64](https://github.com/richkuo/rk-skills/issues/64)). Broader duplicated-contract tracking from superseded [#57](https://github.com/richkuo/rk-skills/issues/57) is out of scope here.

This inventory records every shared pipeline rule those families restate in prose: who owns it, who restates it, what must stay aligned, what may diverge, and how CI guards it. Guards check **required shared semantics** (key thresholds and stop conditions), not exact string equality — wording may differ by harness ("Fable subagent" vs "session model") when the numbers and decisions match. Markers must appear in the **procedure body** (after YAML frontmatter); a `description:` line that only mentions the words is not enough. Stop rules are anchored to decision-table rows that co-locate `STOP` with the rule terms.

## How to update a guarded rule

1. Edit every **consumer** listed for that row in the same change (there is no generator for `SKILL.md` prose). Keep the procedural wording in the body/decision table — do not rely on frontmatter alone.
2. If the change is an intentional divergence, record it under **Allowed divergence** / the exception section below and update the guard's exception list.
3. Run `bun test` — `tests/loop-validate-pipeline-contract.test.js` fails when a required marker is missing or contradicted.
4. Keep this inventory row in sync with the guard's consumer lists.

## Inventoried skill files

| Skill | Role in this inventory |
|---|---|
| `skills/fix-pr-review-loop/SKILL.md` | Full owner of the review-cycle stop procedure |
| `skills/work-on-issue-loop/SKILL.md` | Same review-cycle stop procedure (opens PR, then same loop) |
| `skills/fableplan-loop/SKILL.md` | Paraphrases the review-cycle threshold; always-plan (no score gate) |
| `skills/fable-validate-loop/SKILL.md` | Score-gated fableplan + validation stop conditions |
| `skills/validate-fableplan-loop/SKILL.md` | Score-gated fableplan + validation stop conditions (session-model validate) |
| `skills/fable-validate-fableplan-loop/SKILL.md` | Always-plan exception + validation stop conditions |
| `skills/fable-validate-fableplan/SKILL.md` | Same always-plan exception + validation stop conditions; ends at the posted plan (no implement stage) |
| `skills/new-issue-loop/SKILL.md` | Duplicate / convergence stop before validate-issue-loop |
| `skills/fable-new-issue-loop/SKILL.md` | Same duplicate / convergence stop (Fable front) |
| `skills/validate-issue-loop/SKILL.md` | Validation stop conditions; hands off review loop |
| `skills/validate-issue/SKILL.md` | Base validator — inventored; does **not** restate loop pipeline stop rules |
| `skills/fable-validate/SKILL.md` | Fable wrapper for validate-issue — inventored; does **not** restate loop pipeline stop rules |
| `skills/fix-pr-review/SKILL.md` | Fixer classifier — states the `**Verification limitation:**` not-a-finding carve-out |
| `skills/work-on-issue/SKILL.md` | Canonical owner of the adopted-plan deviation policy the plan-handoff chains restate |
| `skills/fableplan-work-on-issue/SKILL.md` | Plan handoff — restates the deviation policy; no loop stage |

Non-skill consumers (e.g. `templates/claude-workflow/prompts/fix-pr.md`) are not listed here; they appear only in the rule rows below that name them.

## Shared pipeline rules

| Rule | Canonical owner | Consumers that must state it | Required shared semantics | Allowed divergence | Guard |
|---|---|---|---|---|---|
| Review-cycle / LGTM stop | `fix-pr-review-loop` procedure (`review_count > 5`) | `fix-pr-review-loop`, `work-on-issue-loop` (full); `fableplan-loop` (must paraphrase the threshold); fixer classifiers (`fix-pr-review`, Action `fix-pr` prompt) must also treat `**Verification limitation:**` as not a finding | Bare `LGTM` with no remaining **finding** sections stops at any cycle count — a `**Verification limitation:**` line is not a finding and does not prevent a clean pass; after more than **5** review cycles, the first `LGTM` ends the loop even with non-blocking leftovers; `Needs Updates` alone never stops by cycle count | Full procedure vs short paraphrase ("past 5 cycles the first LGTM") is fine; who triggers the first `@claude` review differs by entry skill; fixer copies state the carve-out at classify time rather than restating the full stop table | `tests/loop-validate-pipeline-contract.test.js`; `tests/pr-review-contract.test.js` (limitation carve-out in loops + fixer consumers) |
| Fableplan score gate | Shared semantic in gated validate→plan loops | `fable-validate-loop`, `validate-fableplan-loop` | Skip fableplan when the score is **below 61** with no safety flags; safety carve-out (money, data integrity, security, auto-protective) overrides the skip | "Fable validates" vs "session model validates" wording; which skill name is the unconditional counterpart | same |
| Always-plan (no score gate) | Intentional exception set | `fable-validate-fableplan-loop`, `fable-validate-fableplan`, `fableplan-loop` | Must document that there is **no** score gate / fableplan **always** runs; must not install the skip-below-61 gate as this skill's own rule | Why the gate is absent (no validation score vs unconditional plan product) | same — exception path |
| Duplicate / convergence stop | Shared semantic in new-issue chains | `new-issue-loop`, `fable-new-issue-loop` | Stop when a duplicate open issue/PR already covers the work, or when the discussion has not converged on one issue to file | Front skill is `new-issue` vs `fable-new-issue` | same |
| Validation scope / feasibility / existing-PR stop | Shared semantic in validate→plan/implement chains | `validate-issue-loop`, `fable-validate-loop`, `validate-fableplan-loop`, `fable-validate-fableplan-loop`, `fable-validate-fableplan` | Stop instead of continuing the chain when validation flags the issue as too large, architecturally infeasible, or already addressed by an existing open PR | Whether a Fable plan step sits between update and implement; whether the chain ends at the posted plan (`fable-validate-fableplan`) or at a reviewed PR | same |
| Verdict-block template | `validate-issue` step 8 output format | `validate-issue-loop`, `fable-validate-loop`, `validate-fableplan-loop`, `fable-validate-fableplan-loop`, `fable-validate-fableplan` (each quotes the template it parses) | One template line co-locates every parsed field: `Update issue description?`, `Complexity: <…>/100`, `Capability <k>`, `Volume <v>`, `fableplan: <yes\|no>`, `Scope: <OK \| too large — split/umbrella/narrow>` | Placeholder spelling (`<score>` vs `<0-100>`, `<Yes\|No>` vs `<Yes \| No>`) | same |
| Final-report 55-word plain-simple-English cap | Shared presentation rule of the autonomous chains | `validate-issue-loop`, `fable-validate-loop`, `validate-fableplan-loop`, `fable-validate-fableplan-loop`, `fable-validate-fableplan`, `fableplan-loop`, `fableplan-work-on-issue`, `new-issue-loop`, `fable-new-issue-loop` | Bold "Cap the whole report … 55 words, plain simple English in ASD-STE100" instruction in the report step, followed on the same line by "apply the Response Style rules in CLAUDE.md/AGENTS.md" | Parenthetical scope notes ("prefix + relayed summary") and trailing phrasing | same |
| Adopted-plan deviation policy | `work-on-issue` step 2 | `fableplan-work-on-issue`, `fableplan-loop`, `fable-validate-loop`, `fable-validate-fableplan-loop`, `validate-fableplan-loop` (each hands a plan down) | A plan adopted from the issue thread is the blueprint; it is overridden only by the traced code, anything posted on the issue after the plan, then correctness and safety. Callers may restate the policy but must never narrow it back to "only when the code contradicts the plan"; every deviation is named in the PR body | Caller phrasing and whether the handoff targets `work-on-issue` or `work-on-issue-loop`; the score-gated chains add their "no plan was produced" note | same |

## Intentional exceptions

### Always-plan skills omit the score gate

`fable-validate-fableplan-loop`, `fable-validate-fableplan`, and `fableplan-loop` intentionally have **no** "skip fableplan when the score is below 61" gate. That is the product difference from `fable-validate-loop` / `validate-fableplan-loop`, not drift. For `fable-validate-fableplan` the plan is the run's only output, so a gate would leave it with nothing to deliver. The guard requires those three files to state the missing gate explicitly and does **not** require the skip-below-61 instruction as their own rule.

### Base validators are not pipeline consumers

`validate-issue` and `fable-validate` own claim-tracing and scoring. They do not restate the review-cycle threshold, score gate, or new-issue duplicate stop. The guard does not require those markers in those two files.

## Out of scope for this inventory's guard

| Surface | Why |
|---|---|
| `workflows/milestone-pipeline.js` `maxReviewCycles` (default **5**) | Configurable workflow arg, not skill prose. Same number today as the skill threshold, but changing one does not automatically change the other. |
| `skills/milestone-workflow/SKILL.md` mentions of `maxReviewCycles` | Documents the workflow arg and planning bounds; not a restatement of the fix-pr-review-loop stop procedure. |
| `tests/milestone-pipeline.test.js` | Exercises the workflow harness, not skill `SKILL.md` contracts. |

If the skill review-cycle threshold and the workflow default must stay locked together later, that is a separate contract — not covered by `tests/loop-validate-pipeline-contract.test.js`.

## Related partial coverage

`tests/complexity-score.test.js` already asserts score-gate phrasing in `fable-validate-loop` and `validate-fableplan-loop`. This inventory's guard is the pipeline-family source of truth for the full consumer sets and exceptions above.

---
Updated with LLM: Opus 5 | high | Harness: Claude Code
Updated with LLM: Fable 5 | medium | Harness: Claude Code
Updated with LLM: Fable 5 | high | Harness: Claude Code
