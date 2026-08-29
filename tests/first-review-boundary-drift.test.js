import { describe, expect, test } from 'bun:test'
import { $ } from 'bun'

const OWNER = 'skills/validate-issue/SKILL.md'
const RUNTIME = 'workflows/milestone-pipeline.js'

const CLAUDE_PROMPTS = [
  'templates/claude-workflow/prompts/issue-workflow.md',
  'templates/claude-workflow/prompts/fix-pr.md',
]
const CODEX_PROMPTS = [
  'templates/codex-workflow/prompts/issue-workflow.md',
  'templates/codex-workflow/prompts/fix-pr.md',
]
const CLAUDE_FIX_PR_PROMPT = 'templates/claude-workflow/prompts/fix-pr.md'
const ACTION_PROMPTS = [...CLAUDE_PROMPTS, ...CODEX_PROMPTS]
const DOCS = ['README.md', 'docs/contract-inventory.md', 'templates/codex-workflow/README.md']

const RESTATING_SITES = new Set([OWNER, RUNTIME, ...ACTION_PROMPTS, ...DOCS, 'tests/first-review-boundary-drift.test.js'])

const read = (path) => Bun.file(new URL(`../${path}`, import.meta.url)).text()

const OWNER_TABLE_ROW = /^\| (\d+)–(\d+)(?:, or no score)? \| ([^|]+?) \| ([^|]+?) \| ([^|]+?) \|$/gm

async function ownerRows() {
  const body = await read(OWNER)
  const start = body.indexOf('The **first review** escalates on its own, coarser scale')
  expect(start, 'the owner table lead-in moved').toBeGreaterThan(-1)
  const table = body.slice(start, body.indexOf('\n\nCodex exposes one flagship', start))
  const rows = [...table.matchAll(OWNER_TABLE_ROW)].map(([, min, max]) => ({
    min: Number(min),
    max: Number(max),
  }))
  expect(rows.length, 'the owner table must state four rows').toBe(4)
  return rows
}

describe('first-review boundary drift', () => {
  test('the runtime constant carries exactly the owner table boundaries', async () => {
    const rows = await ownerRows()
    const source = await read(RUNTIME)
    const block = source.slice(source.indexOf('const REVIEW_BANDS = ['))
    const bands = [...block.slice(0, block.indexOf('\n]')).matchAll(/min: (\d+), max: (\d+|Infinity)/g)]
      .map(([, min, max]) => ({ min: Number(min), max: max === 'Infinity' ? Infinity : Number(max) }))

    expect(bands.length, 'REVIEW_BANDS must mirror the owner table row for row').toBe(rows.length)
    bands.forEach((band, index) => {
      expect(band.min, `REVIEW_BANDS row ${index} lower bound`).toBe(rows[index].min)
      const ownerMax = index === rows.length - 1 ? Infinity : rows[index].max
      expect(band.max, `REVIEW_BANDS row ${index} upper bound`).toBe(ownerMax)
    })
  })

  test('every Action prompt spells out the owner table boundaries and no others', async () => {
    const rows = await ownerRows()
    const [cheap, standard, opus, fable] = rows
    for (const path of CLAUDE_PROMPTS) {
      const body = (await read(path)).replace(/\s+/g, ' ')
      expect(body, `${path}: cheap row`).toContain(`C${cheap.min} to C${cheap.max}`)
      expect(body, `${path}: standard row`).toContain(`C${standard.min} to C${standard.max}`)
      expect(body, `${path}: opus row`).toContain(`C${opus.min} to C${opus.max}`)
      expect(body, `${path}: fable row`).toContain(`C${fable.min} and above`)
    }
    for (const path of CODEX_PROMPTS) {
      const body = (await read(path)).replace(/\s+/g, ' ')
      expect(body, `${path}: cheap row`).toContain(`C${cheap.min} to C${cheap.max}`)
      expect(body, `${path}: everything above collapses onto the bare trigger`)
        .toContain(`C${standard.min} and above`)
    }
    for (const path of ACTION_PROMPTS) {
      const body = (await read(path)).replace(/\s+/g, ' ')
      for (const [, low, high] of body.matchAll(/C(\d+) to C(\d+)/g)) {
        expect(
          rows.some((row) => row.min === Number(low) && row.max === Number(high)),
          `${path}: states C${low} to C${high}, which the owner table does not`,
        ).toBeTrue()
      }
    }
  })

  test('the Claude fix-pr Action prompt states both step-down ladders', async () => {
    for (const path of [CLAUDE_FIX_PR_PROMPT]) {
      const body = (await read(path)).replace(/\s+/g, ' ')
      expect(body, `${path}: one blocking cycle only`).toMatch(
        /above the standard trigger runs one blocking cycle only/i,
      )
      expect(body, `${path}: the fable ladder`).toMatch(/fable[^.]{0,240}@claude opus review/i)
      expect(body, `${path}: the opus ladder`).toMatch(/opus[^.]{0,240}@claude review/i)
      expect(body, `${path}: the floor`).toMatch(/stops at @claude review and never steps down to sonnet/i)
    }
  })

  test('the documentation restatements agree with the owner table', async () => {
    const rows = await ownerRows()
    for (const path of DOCS) {
      const body = (await read(path)).replace(/\s+/g, ' ')
      for (const [, low, high] of body.matchAll(/C(\d+)\s*–\s*C(\d+)/g)) {
        expect(
          rows.some((row) => row.min === Number(low) && row.max === Number(high)),
          `${path}: states C${low}–C${high}, which the owner table does not`,
        ).toBeTrue()
      }
      for (const match of body.matchAll(/C(\d+)\+|C?(\d+) and above/g)) {
        const min = Number(match[1] ?? match[2])
        expect(
          rows.some((row) => row.min === min),
          `${path}: states an open-ended boundary at ${min}, which starts no owner table row`,
        ).toBeTrue()
      }
    }
  })

  test('no other tracked file states a first-review boundary', async () => {
    const tracked = (await $`git ls-files`.cwd(new URL('..', import.meta.url).pathname).text())
      .split('\n')
      .filter((path) => /\.(md|js|yml|yaml)$/.test(path))
      .filter((path) => !path.startsWith('tests/'))
      .filter((path) => !RESTATING_SITES.has(path))

    const BOUNDARY = /C?\d{1,3}\s*(?:–|-|to )\s*C?\d{1,3}/g
    const TRIGGER = /@(?:claude|codex)(?: \w+)? review/

    const offenders = []
    for (const path of tracked) {
      const body = (await read(path)).replace(/\s+/g, ' ')
      for (const match of body.matchAll(BOUNDARY)) {
        const window = body.slice(Math.max(0, match.index - 160), match.index + match[0].length + 160)
        if (TRIGGER.test(window)) offenders.push(`${path}: ${match[0]}`)
      }
    }

    expect(
      offenders,
      'these sites state a first-review boundary; point them at the validate-issue step 6 table instead',
    ).toEqual([])
  })
})
