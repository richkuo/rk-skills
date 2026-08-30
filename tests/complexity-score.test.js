import { describe, expect, test } from 'bun:test'

export function capabilityFromAxes({ risk, uncertainty, coupling }) {
  const map = (n) => (n <= 1 ? 0 : n === 2 ? 1 : n === 3 ? 2 : 3)
  let capability = map(Math.max(risk, uncertainty))
  if (coupling >= 3) capability = Math.max(capability, 2)
  return capability
}

export function volumeFromAxes({ scope, coupling, verification }) {
  return (scope + coupling + verification) * 2
}

export function complexityScore(axes) {
  const capability = capabilityFromAxes(axes)
  const volume = volumeFromAxes(axes)
  return { capability, volume, score: 25 * capability + volume }
}

const root = new URL('../', import.meta.url)
const read = (path) => Bun.file(new URL(path, root)).text()

const [validateIssue, validateIssueScoring, prdToIssues, pipeline] = await Promise.all([
  read('skills/validate-issue/SKILL.md'),
  read('skills/validate-issue/complexity-scoring.md'),
  read('skills/prd-to-issues/SKILL.md'),
  read('workflows/milestone-pipeline.js'),
])

const MODEL_KEY = { 'Sonnet 5': 'sonnet', 'Opus 5': 'opus', 'Fable 5': 'fable' }
const spec = (cell) => {
  const [model, effort] = cell.split('·').map((part) => part.trim())
  return { model: MODEL_KEY[model], effort }
}

function ownerBands() {
  const rows = [...validateIssue.matchAll(/^\| (\d) \| (\d+)–(\d+) \| ([^|]+?) \| (\*\*Yes\*\*|No) \| ([^|]+?) \|$/gm)]
  return rows.map(([, band, min, max, validate, fableplan, build]) => ({
    band: Number(band),
    min: Number(min),
    max: Number(max),
    fableplan: fableplan === '**Yes**',
    validate: spec(validate),
    build: spec(build),
  }))
}

function pipelineBands() {
  const block = pipeline.slice(pipeline.indexOf('const BANDS = ['))
  return [...block.slice(0, block.indexOf('\n]')).matchAll(
    /min: (\d+), max: (\d+|Infinity), fableplan: (true|false), validate: \{ model: '(\w+)', effort: '(\w+)' \}, build: \{ model: '(\w+)', effort: '(\w+)' \}/g,
  )].map(([, min, max, fableplan, vModel, vEffort, bModel, bEffort]) => ({
    min: Number(min),
    max: max === 'Infinity' ? Infinity : Number(max),
    fableplan: fableplan === 'true',
    validate: { model: vModel, effort: vEffort },
    build: { model: bModel, effort: bEffort },
  }))
}

describe('complexity score band encoding', () => {
  test('golden examples in the validate-issue reference match the executable formula', () => {
    const section = validateIssueScoring.split('#### Golden examples (consistency checklist)')[1]
    expect(section).toBeTruthy()
    const rowRe = /^\| \((\d+),(\d+),(\d+),(\d+),(\d+)\) \| (\d+)[^|]*\| (\d+) \| \*\*(\d+)\*\* \|/gm
    const rows = [...section.matchAll(rowRe)]
    expect(rows.length).toBeGreaterThanOrEqual(5)
    for (const m of rows) {
      const axes = { scope: Number(m[1]), coupling: Number(m[2]), risk: Number(m[3]), uncertainty: Number(m[4]), verification: Number(m[5]) }
      expect(complexityScore(axes)).toEqual({ capability: Number(m[6]), volume: Number(m[7]), score: Number(m[8]) })
    }
  })

  test('the pipeline band constant mirrors the validate-issue band table row for row', () => {
    const owner = ownerBands()
    const runtime = pipelineBands()
    expect(owner.length, 'the owner table states six bands').toBe(6)
    expect(runtime.length, 'BANDS mirrors the owner table').toBe(owner.length)
    owner.forEach((row, index) => {
      const band = runtime[index]
      expect(band.min, `band ${row.band} lower bound`).toBe(row.min)
      expect(band.max, `band ${row.band} upper bound`).toBe(index === owner.length - 1 ? Infinity : row.max)
      expect(band.fableplan, `band ${row.band} fableplan`).toBe(row.fableplan)
      expect(band.validate, `band ${row.band} validate`).toEqual(row.validate)
      expect(band.build, `band ${row.band} build`).toEqual(row.build)
    })
  })

  test('the prd-to-issues band table states the same build routing as the owner', () => {
    const owner = ownerBands()
    const rows = [...prdToIssues.matchAll(/^\| (\d) \| (\d+)–(\d+) \| (Sonnet 5|Opus 5|Fable 5)[^|]*\| (\*\*Yes\*\*|No) \| (\w+) ?\|/gm)]
    expect(rows.length, 'prd-to-issues states six bands').toBe(owner.length)
    rows.forEach(([, band, min, max, model, fableplan, effort], index) => {
      const row = owner[index]
      expect({ band: Number(band), min: Number(min), max: Number(max) }, `row ${band} bounds`).toEqual({ band: row.band, min: row.min, max: row.max })
      expect(fableplan === '**Yes**', `row ${band} fableplan`).toBe(row.fableplan)
      expect({ model: MODEL_KEY[model], effort }, `row ${band} build`).toEqual(row.build)
    })
  })

  test('the score gate and the never-lower rule stay stated', async () => {
    expect(validateIssueScoring).toMatch(/Never lower routing from a validator rescore/)
    for (const path of ['skills/validate-issue/SKILL.md', 'skills/new-issue/SKILL.md', 'skills/github-issue-format/SKILL.md']) {
      expect(await read(path), path).toMatch(/score is ≥ 71|score is 71 or higher|score ≥ 71/)
    }
  })

  test('proposal concern consumers follow the current general-check label', async () => {
    const proposalLabels = [...validateIssue.matchAll(/^#### (5[a-z])\. /gm)].map((match) => match[1])
    const generalChecksLabel = validateIssue.match(/^#### (5[a-z])\. General checks$/m)?.[1]
    expect(generalChecksLabel).toBeDefined()

    for (const path of ['skills/fable-validate-loop/SKILL.md', 'skills/fable-validate-fableplan/SKILL.md', 'skills/fable-validate-fableplan-loop/SKILL.md']) {
      const text = await read(path)
      expect(text, path).toContain(`${generalChecksLabel} concerns`)
      for (const label of proposalLabels.filter((candidate) => candidate !== generalChecksLabel)) {
        expect(text, path).not.toContain(`${label} concerns`)
      }
    }
    expect(await read('skills/fable-validate/SKILL.md')).toContain(`${proposalLabels.join('/')} proposal checks`)
  })
})
