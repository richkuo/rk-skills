import { describe, expect, test } from 'bun:test'

const root = new URL('../', import.meta.url)
const read = (path) => Bun.file(new URL(path, root)).text()

const REVIEW_CYCLE_FULL = [
  'skills/fix-pr-review-loop/SKILL.md',
  'skills/work-on-issue-loop/SKILL.md',
]
const REVIEW_CYCLE_PARAPHRASE = ['skills/fableplan-loop/SKILL.md']

const STOP_CONDITION_REGION = {
  'skills/fix-pr-review-loop/SKILL.md': ['### 3. Check the review', '### 4. Resolve the review'],
  'skills/work-on-issue-loop/SKILL.md': ['**fix-pr-review-loop step 3**', '**fix-pr-review-loop step 4**'],
}

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

const VERDICT_TEMPLATE_OWNER = 'skills/validate-issue/SKILL.md'
const VERDICT_TEMPLATE_CONSUMERS = [
  'skills/validate-issue-loop/SKILL.md',
  'skills/fable-validate-loop/SKILL.md',
  'skills/validate-fableplan-loop/SKILL.md',
  'skills/fable-validate-fableplan-loop/SKILL.md',
  'skills/fable-validate-fableplan/SKILL.md',
]

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

const PLAN_DEVIATION_OWNER = 'skills/work-on-issue/SKILL.md'
const PLAN_DEVIATION_CALLERS = [
  'skills/fableplan-work-on-issue/SKILL.md',
  'skills/fableplan-loop/SKILL.md',
  'skills/fable-validate-loop/SKILL.md',
  'skills/fable-validate-fableplan-loop/SKILL.md',
  'skills/validate-fableplan-loop/SKILL.md',
]

const EDIT_VERB_OWNER = 'skills/validate-issue/issue-editing.md'
const EDIT_VERB_CONSUMERS = [
  'skills/validate-issue-loop/SKILL.md',
  'skills/validate-fableplan-loop/SKILL.md',
  'skills/fable-validate/SKILL.md',
  'skills/fable-validate-loop/SKILL.md',
  'skills/fable-validate-fableplan/SKILL.md',
  'skills/fable-validate-fableplan-loop/SKILL.md',
]
const EDIT_VERB_FORMAT = 'skills/github-issue-format/SKILL.md'
const EDIT_VERB_WORKFLOW = 'workflows/milestone-pipeline.js'

const INVENTORY = 'docs/contract-inventory.md'

function procedureBody(markdown) {
  const match = markdown.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/)
  return match ? match[1] : markdown
}

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
        PLAN_DEVIATION_OWNER,
        ...PLAN_DEVIATION_CALLERS,
        EDIT_VERB_OWNER,
        ...EDIT_VERB_CONSUMERS,
        EDIT_VERB_FORMAT,
        EDIT_VERB_WORKFLOW,
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
      expect(body, path).toMatch(/review_count\s*>\s*5[\s\S]{0,120}LGTM/i)
    }
  })

  test('review-cycle owners brake on divergence, and only with the self-inflicted condition', () => {
    for (const path of REVIEW_CYCLE_FULL) {
      const body = procedureBody(texts[path])
      const [open_, close] = STOP_CONDITION_REGION[path]
      const from = body.indexOf(open_)
      expect(from, path).toBeGreaterThan(-1)
      const end = body.indexOf(close, from + open_.length)
      expect(end, path).toBeGreaterThan(from)
      const region = body.slice(from, end)

      const at = region.search(/pr_cycle_count\s*>=\s*(\d+)/)
      expect(at, path).toBeGreaterThan(-1)
      expect(region, path).toMatch(/(?:not|never) the in-memory `?review_count`?/i)
      const threshold = Number(region.match(/pr_cycle_count\s*>=\s*(\d+)/)[1])
      expect(threshold, path).toBeLessThan(5)
      const rule = region.slice(at, at + 300)
      expect(rule, path).toMatch(/Needs Updates/i)
      expect(rule, path).toMatch(/an earlier cycle[\s\S]{0,40}added/i)
      expect(region, path).toMatch(/Diverging/)

      expect(region, path).toMatch(
        /never stops the loop by cycle count|no cycle count alone stops a/is,
      )

      expect(region, path).toMatch(/base merge|base-branch work|origin\/<baseRefName>/i)
      expect(region, path).toMatch(/cannot be attributed|defeats/i)
    }
  })

  test('fableplan-loop paraphrases the past-5 first-LGTM stop', () => {
    for (const path of REVIEW_CYCLE_PARAPHRASE) {
      const body = procedureBody(texts[path])
      expect(body, path).toMatch(/past 5[\s\S]{0,80}(?:first )?LGTM|LGTM it sees/i)
    }
  })

  test('gated validate→plan loops state the below-71 score gate plus safety carve-out', () => {
    for (const path of CAPABILITY_GATE) {
      const body = procedureBody(texts[path])
      expect(body, path).toMatch(/\*\*Score gate:\*\*/)
      expect(body, path).toMatch(/below 71|score\s*<\s*71/)
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
      expect(body, path).not.toMatch(
        /\*\*Score gate:\*\*[^\n]*below 71[^\n]*skip fableplan/i,
      )
    }
  })

  test('new-issue loops stop on duplicate or non-convergence', () => {
    for (const path of DUPLICATE_CONVERGENCE) {
      const body = procedureBody(texts[path])
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

  test('work-on-issue stays under 200 lines with whole-number step headings', () => {
    const text = texts[PLAN_DEVIATION_OWNER]
    expect(text.split('\n').length - 1, PLAN_DEVIATION_OWNER).toBeLessThan(200)
    expect(procedureBody(text), PLAN_DEVIATION_OWNER).not.toMatch(/^#+ \d+\.\d+/m)
  })

  test('work-on-issue owns one plan-deviation policy and no caller narrows it', () => {
    const owner = procedureBody(texts[PLAN_DEVIATION_OWNER])
    expect(owner, PLAN_DEVIATION_OWNER).toMatch(
      /adopted plan is the blueprint[\s\S]{0,900}traced code[\s\S]{0,400}newer on the issue[\s\S]{0,400}[Cc]orrectness and safety/,
    )
    expect(owner, PLAN_DEVIATION_OWNER).toMatch(/single plan-deviation policy/i)
    expect(owner, PLAN_DEVIATION_OWNER).toMatch(/never narrows it|does not remove the other two/i)
    expect(owner, PLAN_DEVIATION_OWNER).toMatch(/Fable-authored/)
    expect(owner, PLAN_DEVIATION_OWNER).not.toMatch(
      /adopted from the issue thread in step 0\.1, which counts the same as one produced this session/,
    )

    for (const path of PLAN_DEVIATION_CALLERS) {
      const body = procedureBody(texts[path])
      expect(body, `${path}: narrowed deviation rule`).not.toMatch(
        /deviations?[^.\n]{0,80}only when the code contradicts the plan/i,
      )
      expect(body, `${path}: defers to work-on-issue step 2`).toMatch(
        /deviations[^.\n]{0,120}step 2's plan-deviation policy/i,
      )
    }
  })

  test('validation-driven issue edits stamp Validated, never Updated', () => {
    const owner = procedureBody(texts[EDIT_VERB_OWNER])
    expect(owner, `${EDIT_VERB_OWNER}: appended Validated line`).toMatch(
      /^Validated with LLM: <current model> \| <effort> \| Harness: <harness>$/m,
    )
    expect(owner, `${EDIT_VERB_OWNER}: Updated stamp`).not.toMatch(/^Updated with LLM:/m)
    expect(owner, `${EDIT_VERB_OWNER}: append the current Updated line`).not.toMatch(
      /append the current `Updated` line/,
    )
    expect(owner, `${EDIT_VERB_OWNER}: stack never replace`).toMatch(
      /Preserve prior attribution lines/,
    )
    expect(owner, `${EDIT_VERB_OWNER}: duplicate collapse`).toMatch(
      /Collapse exact duplicates only/,
    )

    for (const path of EDIT_VERB_CONSUMERS) {
      const body = procedureBody(texts[path])
      expect(body, `${path}: Validated attribution line`).toMatch(/Validated with LLM/)
      expect(body, `${path}: Updated attribution line`).not.toMatch(/Updated with LLM/)
    }

    const format = procedureBody(texts[EDIT_VERB_FORMAT])
    expect(format, EDIT_VERB_FORMAT).toMatch(
      /`Created`[\s\S]{0,200}`Validated`[\s\S]{0,200}`Updated`/,
    )
    expect(format, `${EDIT_VERB_FORMAT}: duplicate handling`).toMatch(/duplicate/i)

    const workflowLines = texts[EDIT_VERB_WORKFLOW].split('\n')
    const correctionLine = workflowLines.find((line) =>
      line.includes('apply these validation corrections'),
    )
    expect(correctionLine, `${EDIT_VERB_WORKFLOW}: issue-correction prompt`).toBeDefined()
    expect(correctionLine, `${EDIT_VERB_WORKFLOW}: Validated footer`).toContain(
      'Validated with LLM',
    )
    expect(correctionLine, `${EDIT_VERB_WORKFLOW}: Updated footer`).not.toContain(
      'Updated with LLM',
    )
    expect(
      workflowLines.some(
        (line) => line.includes('fix-pr-review') && line.includes('Updated with LLM'),
      ),
      `${EDIT_VERB_WORKFLOW}: PR-fix commits keep Updated`,
    ).toBe(true)
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
    expect(inventory).toContain('skills/validate-issue/issue-editing.md')
    expect(inventory).toContain('Validated with LLM')
    for (const path of EDIT_VERB_CONSUMERS) {
      expect(inventory, `${path}: inventory consumer row`).toContain(
        path.replace(/^skills\/|\/SKILL\.md$/g, ''),
      )
    }
  })
})
