import { describe, expect, test } from 'bun:test'

const root = new URL('../', import.meta.url)
const read = (path) => Bun.file(new URL(path, root)).text()

const REVIEW_CYCLE_FULL = ['skills/fix-pr-review-loop/SKILL.md', 'skills/work-on-issue-loop/SKILL.md']
const REVIEW_CYCLE_PARAPHRASE = ['skills/fableplan-loop/SKILL.md']

const STOP_CONDITION_REGION = {
  'skills/fix-pr-review-loop/SKILL.md': ['### 3. Check the review', '### 4. Resolve the review'],
  'skills/work-on-issue-loop/SKILL.md': ['**fix-pr-review-loop step 3**', '**fix-pr-review-loop step 4**'],
}

const CAPABILITY_GATE = ['skills/fable-validate-loop/SKILL.md', 'skills/validate-fableplan-loop/SKILL.md']
const ALWAYS_PLAN = [
  'skills/fable-validate-fableplan-loop/SKILL.md',
  'skills/fable-validate-fableplan/SKILL.md',
  'skills/fableplan-loop/SKILL.md',
]

const DUPLICATE_CONVERGENCE = ['skills/new-issue-loop/SKILL.md', 'skills/fable-new-issue-loop/SKILL.md']

const VALIDATION_STOP = [
  'skills/validate-issue-loop/SKILL.md',
  'skills/fable-validate-loop/SKILL.md',
  'skills/validate-fableplan-loop/SKILL.md',
  'skills/fable-validate-fableplan-loop/SKILL.md',
  'skills/fable-validate-fableplan/SKILL.md',
]

const VERDICT_TEMPLATE_OWNER = 'skills/validate-issue/SKILL.md'
const VERDICT_TEMPLATE_CONSUMERS = VALIDATION_STOP

const REPORT_CAP = [
  ...VALIDATION_STOP,
  'skills/fableplan-loop/SKILL.md',
  'skills/fableplan-work-on-issue/SKILL.md',
  ...DUPLICATE_CONVERGENCE,
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
        ...REPORT_CAP,
        PLAN_DEVIATION_OWNER,
        ...PLAN_DEVIATION_CALLERS,
        EDIT_VERB_OWNER,
        ...EDIT_VERB_CONSUMERS,
        EDIT_VERB_FORMAT,
        EDIT_VERB_WORKFLOW,
      ]),
    ].map(async (path) => [path, await read(path)]),
  ),
)
const bodies = Object.fromEntries(Object.entries(texts).map(([path, source]) => [path, procedureBody(source)]))

describe('loop/validate pipeline contract', () => {
  test('review-cycle owners encode threshold 5 and LGTM-first-wins past the cap', () => {
    for (const path of REVIEW_CYCLE_FULL) {
      const body = bodies[path]
      expect(body, path).toMatch(/review_count\s*>\s*5/)
      expect(body, path).toMatch(/bare LGTM|no sections at all|nothing left to fix/i)
      expect(body, path).toMatch(/review_count\s*>\s*5[\s\S]{0,120}LGTM/i)
    }
    for (const path of REVIEW_CYCLE_PARAPHRASE) {
      expect(bodies[path], path).toMatch(/past 5[\s\S]{0,80}(?:first )?LGTM|LGTM it sees/i)
    }
  })

  test('review-cycle owners brake on divergence, and only with the self-inflicted condition', () => {
    for (const path of REVIEW_CYCLE_FULL) {
      const body = bodies[path]
      const [open_, close] = STOP_CONDITION_REGION[path]
      const from = body.indexOf(open_)
      expect(from, path).toBeGreaterThan(-1)
      const end = body.indexOf(close, from + open_.length)
      expect(end, path).toBeGreaterThan(from)
      const region = body.slice(from, end)

      const at = region.search(/pr_cycle_count\s*>=\s*(\d+)/)
      expect(at, path).toBeGreaterThan(-1)
      expect(region, path).toMatch(/(?:not|never) the in-memory `?review_count`?/i)
      expect(Number(region.match(/pr_cycle_count\s*>=\s*(\d+)/)[1]), path).toBeLessThan(5)
      const rule = region.slice(at, at + 300)
      expect(rule, path).toMatch(/Needs Updates/i)
      expect(rule, path).toMatch(/an earlier cycle[\s\S]{0,40}added/i)
      expect(region, path).toMatch(/never stops the loop by cycle count|no cycle count alone stops a/is)
      expect(region, path).toMatch(/base merge|base-branch work|origin\/<baseRefName>/i)
      expect(region, path).toMatch(/cannot be attributed|defeats/i)
    }
  })

  test('gated validate→plan loops state the below-71 score gate plus safety carve-out', () => {
    for (const path of CAPABILITY_GATE) {
      const body = bodies[path]
      expect(body, path).toMatch(/\*\*Score gate:\*\*/)
      expect(body, path).toMatch(/below 71|score\s*<\s*71/)
      expect(body, path).toMatch(
        /safety carve-out[\s\S]{0,300}money[\s\S]{0,120}data integrity[\s\S]{0,120}security[\s\S]{0,120}auto-protective/i,
      )
    }
  })

  test('always-plan skills document the missing score gate as intentional', () => {
    for (const path of ALWAYS_PLAN) {
      const body = bodies[path]
      expect(body, path).toMatch(/no score gate|score gate removed/i)
      expect(body, path).toMatch(/always runs|for EVERY issue/i)
      expect(body, path).not.toMatch(/\*\*Score gate:\*\*[^\n]*below 71[^\n]*skip fableplan/i)
    }
  })

  test('new-issue loops stop on duplicate or non-convergence', () => {
    for (const path of DUPLICATE_CONVERGENCE) {
      const body = bodies[path]
      expect(hasStopTableRow(body, /duplicate/i), `${path}: STOP+duplicate row`).toBe(true)
      expect(hasStopTableRow(body, /converg/i), `${path}: STOP+converg row`).toBe(true)
    }
  })

  test('validate→plan/implement chains stop on too-large, infeasible, or existing PR', () => {
    for (const path of VALIDATION_STOP) {
      const body = bodies[path]
      expect(hasStopTableRow(body, /too large/i), `${path}: STOP+too large row`).toBe(true)
      expect(hasStopTableRow(body, /infeasible/i), `${path}: STOP+infeasible row`).toBe(true)
      expect(hasStopTableRow(body, /existing PR|already addressing|already implements/i), `${path}: STOP+existing-PR row`).toBe(true)
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
      const templateLine = bodies[path]
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
      expect(bodies[path], path).toMatch(/Cap the whole report[^\n]*55 words[^\n]*ASD-STE100[^\n]*Response Style rules/)
    }
  })

  test('work-on-issue owns one plan-deviation policy and no caller narrows it', () => {
    const owner = bodies[PLAN_DEVIATION_OWNER]
    expect(owner, PLAN_DEVIATION_OWNER).toMatch(
      /adopted plan is the blueprint[\s\S]{0,900}traced code[\s\S]{0,400}newer on the issue[\s\S]{0,400}[Cc]orrectness and safety/,
    )
    expect(owner, PLAN_DEVIATION_OWNER).toMatch(/never narrows it|does not remove the other two/i)

    for (const path of PLAN_DEVIATION_CALLERS) {
      const body = bodies[path]
      expect(body, `${path}: narrowed deviation rule`).not.toMatch(/deviations?[^.\n]{0,80}only when the code contradicts the plan/i)
      expect(body, `${path}: defers to work-on-issue step 2`).toMatch(/deviations[^.\n]{0,120}step 2's plan-deviation policy/i)
    }
  })

  test('validation-driven issue edits stamp Validated, never Updated', () => {
    const owner = bodies[EDIT_VERB_OWNER]
    expect(owner, `${EDIT_VERB_OWNER}: appended Validated line`).toMatch(/^Validated with LLM: <current model> \| <effort> \| Harness: <harness>$/m)
    expect(owner, `${EDIT_VERB_OWNER}: Updated stamp`).not.toMatch(/^Updated with LLM:/m)
    expect(owner, `${EDIT_VERB_OWNER}: stack never replace`).toMatch(/Preserve prior attribution lines/)
    expect(owner, `${EDIT_VERB_OWNER}: duplicate collapse`).toMatch(/Collapse exact duplicates only/)

    for (const path of EDIT_VERB_CONSUMERS) {
      const body = bodies[path]
      expect(body, `${path}: Validated attribution line`).toMatch(/Validated with LLM/)
      expect(body, `${path}: Updated attribution line`).not.toMatch(/Updated with LLM/)
    }

    const format = bodies[EDIT_VERB_FORMAT]
    expect(format, EDIT_VERB_FORMAT).toMatch(/`Created`[\s\S]{0,200}`Validated`[\s\S]{0,200}`Updated`/)
    expect(format, `${EDIT_VERB_FORMAT}: duplicate handling`).toMatch(/duplicate/i)

    const workflowLines = texts[EDIT_VERB_WORKFLOW].split('\n')
    const correctionLine = workflowLines.find((line) => line.includes('apply these validation corrections'))
    expect(correctionLine, `${EDIT_VERB_WORKFLOW}: issue-correction prompt`).toBeDefined()
    expect(correctionLine, `${EDIT_VERB_WORKFLOW}: Validated footer`).toContain('Validated with LLM')
    expect(correctionLine, `${EDIT_VERB_WORKFLOW}: Updated footer`).not.toContain('Updated with LLM')
    expect(
      workflowLines.some((line) => line.includes('fix-pr-review') && line.includes('Updated with LLM')),
      `${EDIT_VERB_WORKFLOW}: PR-fix commits keep Updated`,
    ).toBe(true)
  })
})
