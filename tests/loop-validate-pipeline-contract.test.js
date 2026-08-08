import { describe, expect, test } from 'bun:test'

/**
 * Semantic guard for loop/validate skill-family pipeline rules.
 * Checks key parameters (thresholds, stop conditions), not exact prose.
 * Markers must appear in the procedure body — frontmatter `description:` alone is not enough.
 * See docs/contract-inventory.md.
 */
const root = new URL('../', import.meta.url)
const read = (path) => Bun.file(new URL(path, root)).text()

const REVIEW_CYCLE_FULL = [
  'skills/fix-pr-review-loop/SKILL.md',
  'skills/work-on-issue-loop/SKILL.md',
]
const REVIEW_CYCLE_PARAPHRASE = ['skills/fableplan-loop/SKILL.md']

const CAPABILITY_GATE = [
  'skills/fable-validate-loop/SKILL.md',
  'skills/validate-fableplan-loop/SKILL.md',
]
const ALWAYS_PLAN = [
  'skills/fable-validate-fableplan-loop/SKILL.md',
  'skills/fable-validate-fableplan/SKILL.md',
  'skills/fableplan-loop/SKILL.md',
]

const DUPLICATE_CONVERGENCE = [
  'skills/new-issue-loop/SKILL.md',
  'skills/fable-new-issue-loop/SKILL.md',
]

const VALIDATION_STOP = [
  'skills/validate-issue-loop/SKILL.md',
  'skills/fable-validate-loop/SKILL.md',
  'skills/validate-fableplan-loop/SKILL.md',
  'skills/fable-validate-fableplan-loop/SKILL.md',
  'skills/fable-validate-fableplan/SKILL.md',
]

// Loop skills that quote validate-issue's verdict block so they can parse it
// without waiting on the interactive reply. validate-issue owns the canonical
// format (placeholder spelling may differ: `<0-100>` vs `<score>`).
const VERDICT_TEMPLATE_OWNER = 'skills/validate-issue/SKILL.md'
const VERDICT_TEMPLATE_CONSUMERS = [
  'skills/validate-issue-loop/SKILL.md',
  'skills/fable-validate-loop/SKILL.md',
  'skills/validate-fableplan-loop/SKILL.md',
  'skills/fable-validate-fableplan-loop/SKILL.md',
  'skills/fable-validate-fableplan/SKILL.md',
]

// Final-report presentation rule every autonomous chain ends with.
const REPORT_CAP = [
  'skills/validate-issue-loop/SKILL.md',
  'skills/fable-validate-loop/SKILL.md',
  'skills/validate-fableplan-loop/SKILL.md',
  'skills/fable-validate-fableplan-loop/SKILL.md',
  'skills/fable-validate-fableplan/SKILL.md',
  'skills/fableplan-loop/SKILL.md',
  'skills/fableplan-work-on-issue/SKILL.md',
  'skills/new-issue-loop/SKILL.md',
  'skills/fable-new-issue-loop/SKILL.md',
]

const INVENTORY = 'docs/contract-inventory.md'

/** Strip YAML frontmatter so description: keywords cannot satisfy procedure rules. */
function procedureBody(markdown) {
  const match = markdown.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/)
  return match ? match[1] : markdown
}

/**
 * True when a markdown table row co-locates the decision-table **STOP** /
 * **STOP.** marker with every term pattern. Case-insensitive "Stop and report"
 * in Red Flags is not enough — that would keep passing after the real stop
 * rows are deleted.
 */
function hasStopTableRow(body, ...termPatterns) {
  return body.split('\n').some((line) => {
    if (!line.startsWith('|')) return false
    if (!/\*\*STOP\.?\*\*/.test(line)) return false
    return termPatterns.every((pattern) => pattern.test(line))
  })
}

const texts = Object.fromEntries(
  await Promise.all(
    [
      ...new Set([
        ...REVIEW_CYCLE_FULL,
        ...REVIEW_CYCLE_PARAPHRASE,
        ...CAPABILITY_GATE,
        ...ALWAYS_PLAN,
        ...DUPLICATE_CONVERGENCE,
        ...VALIDATION_STOP,
        VERDICT_TEMPLATE_OWNER,
        ...VERDICT_TEMPLATE_CONSUMERS,
        ...REPORT_CAP,
        INVENTORY,
      ]),
    ].map(async (path) => [path, await read(path)]),
  ),
)

describe('loop/validate pipeline contract', () => {
  test('review-cycle owners encode threshold 5 and LGTM-first-wins past the cap', () => {
    for (const path of REVIEW_CYCLE_FULL) {
      const body = procedureBody(texts[path])
      expect(body, path).toMatch(/review_count\s*>\s*5/)
      expect(body, path).toMatch(/bare LGTM|no sections at all|nothing left to fix/i)
      expect(body, path).toMatch(
        /Needs Updates.*never stops|never force-stops a `Needs Updates`|never stops the loop by cycle count/is,
      )
      // Cap rule: past threshold, first LGTM ends the loop (not a bare keyword hit).
      expect(body, path).toMatch(/review_count\s*>\s*5[\s\S]{0,120}LGTM/i)
    }
  })

  test('fableplan-loop paraphrases the past-5 first-LGTM stop', () => {
    for (const path of REVIEW_CYCLE_PARAPHRASE) {
      const body = procedureBody(texts[path])
      expect(body, path).toMatch(/past 5[\s\S]{0,80}(?:first )?LGTM|LGTM it sees/i)
    }
  })

  test('gated validate→plan loops state the below-61 score gate plus safety carve-out', () => {
    for (const path of CAPABILITY_GATE) {
      const body = procedureBody(texts[path])
      expect(body, path).toMatch(/\*\*Score gate:\*\*/)
      expect(body, path).toMatch(/below 61|score\s*<\s*61/)
      // Four carve-out terms must sit with the safety carve-out, not as stray keywords.
      expect(body, path).toMatch(
        /safety carve-out[\s\S]{0,300}money[\s\S]{0,120}data integrity[\s\S]{0,120}security[\s\S]{0,120}auto-protective/i,
      )
    }
  })

  test('always-plan skills document the missing score gate as intentional', () => {
    for (const path of ALWAYS_PLAN) {
      const body = procedureBody(texts[path])
      expect(body, path).toMatch(/no score gate|score gate removed/i)
      expect(body, path).toMatch(/always runs|for EVERY issue/i)
      // Must not install the skip gate as this skill's own procedure heading.
      expect(body, path).not.toMatch(
        /\*\*Score gate:\*\*[^\n]*below 61[^\n]*skip fableplan/i,
      )
    }
  })

  test('new-issue loops stop on duplicate or non-convergence', () => {
    for (const path of DUPLICATE_CONVERGENCE) {
      const body = procedureBody(texts[path])
      // Decision-table rows must co-locate STOP with the rule — frontmatter alone fails.
      expect(hasStopTableRow(body, /duplicate/i), `${path}: STOP+duplicate row`).toBe(true)
      expect(hasStopTableRow(body, /converg/i), `${path}: STOP+converg row`).toBe(true)
    }
  })

  test('validate→plan/implement chains stop on too-large, infeasible, or existing PR', () => {
    for (const path of VALIDATION_STOP) {
      const body = procedureBody(texts[path])
      expect(hasStopTableRow(body, /too large/i), `${path}: STOP+too large row`).toBe(true)
      expect(hasStopTableRow(body, /infeasible/i), `${path}: STOP+infeasible row`).toBe(true)
      expect(
        hasStopTableRow(body, /existing PR|already addressing|already implements/i),
        `${path}: STOP+existing-PR row`,
      ).toBe(true)
    }
  })

  test('verdict-block template stays parseable in every loop that quotes it', () => {
    // One template line must co-locate every field the loops parse. Placeholder
    // spelling may vary (`<score>` vs `<0-100>`, `<Yes|No>` vs `<Yes | No>`);
    // a missing or renamed field breaks the loops' verdict parsing.
    const fieldPatterns = [
      /Update issue description\? <Yes ?\| ?No>/,
      /Complexity: <[^>]+>\/100/,
      /Capability <k>/,
      /Volume <v>/,
      /fableplan: <yes\|no>/,
      /Scope: <OK \| too large — split\/umbrella\/narrow>/,
    ]
    for (const path of [VERDICT_TEMPLATE_OWNER, ...VERDICT_TEMPLATE_CONSUMERS]) {
      const body = procedureBody(texts[path])
      const templateLine = body
        .split('\n')
        .find((line) => /Update issue description\?/.test(line) && /Complexity:/.test(line))
      expect(templateLine, `${path}: verdict template line`).toBeDefined()
      for (const pattern of fieldPatterns) {
        expect(templateLine, `${path}: ${pattern}`).toMatch(pattern)
      }
    }
  })

  test('every autonomous chain caps its final report at 55 words plain simple English in ASD-STE100', () => {
    for (const path of REPORT_CAP) {
      const body = procedureBody(texts[path])
      expect(body, path).toMatch(
        /\*\*Cap the whole report[^\n]*55 words, plain simple English in ASD-STE100\*\*[^\n]*apply the Response Style rules in CLAUDE\.md\/AGENTS\.md/,
      )
    }
  })

  test('inventory documents always-plan exceptions and maxReviewCycles out of scope', () => {
    const inventory = texts[INVENTORY]
    expect(inventory).toContain('fable-validate-fableplan-loop')
    expect(inventory).toContain('fableplan-loop')
    expect(inventory).toMatch(/no score gate|score gate removed/i)
    expect(inventory).toContain('maxReviewCycles')
    expect(inventory).toMatch(/Out of scope/i)
    expect(inventory).toContain('tests/loop-validate-pipeline-contract.test.js')
    expect(inventory).toMatch(/procedure body|frontmatter/i)
  })
})
