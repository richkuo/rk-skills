import { describe, expect, test } from 'bun:test'
import { workflowConstant } from './helpers/workflow-constants.js'

const root = new URL('../', import.meta.url)
const read = (path) => Bun.file(new URL(path, root)).text()

const [validateIssue, validateIssueScoring, prdToIssues, pipeline, milestoneplan] = await Promise.all([
  read('skills/validate-issue/SKILL.md'),
  read('skills/validate-issue/complexity-scoring.md'),
  read('skills/prd-to-issues/SKILL.md'),
  read('workflows/milestone-pipeline.js'),
  read('skills/milestoneplan/SKILL.md'),
])

function formulaFromOwner() {
  const step = validateIssue.slice(validateIssue.indexOf('The canonical formula is:'))
  const mapping = [...step.matchAll(/`(\d)(?:–(\d))? → (\d)`/g)]
  expect(mapping.length, 'the capability mapping states four pairs').toBe(4)
  const capabilityOf = new Map()
  for (const [, low, high, capability] of mapping) {
    for (let axis = Number(low); axis <= Number(high ?? low); axis += 1) capabilityOf.set(axis, Number(capability))
  }
  const floor = step.match(/Coupling ≥ (\d)\*\*, use at least Capability (\d)/)
  const volume = step.match(/\(Scope \+ Coupling \+ Verification\) × (\d+)/)
  const score = step.match(/(\d+) × Capability \+ Volume/)
  expect(floor, 'the coupling floor is stated').toBeTruthy()
  expect(volume, 'the volume multiplier is stated').toBeTruthy()
  expect(score, 'the score weight is stated').toBeTruthy()
  return {
    capability: ({ risk, uncertainty, coupling }) => {
      let capability = capabilityOf.get(Math.max(risk, uncertainty))
      if (coupling >= Number(floor[1])) capability = Math.max(capability, Number(floor[2]))
      return capability
    },
    volume: ({ scope, coupling, verification }) => (scope + coupling + verification) * Number(volume[1]),
    weight: Number(score[1]),
  }
}

export function complexityScore(axes) {
  const formula = formulaFromOwner()
  const capability = formula.capability(axes)
  const volume = formula.volume(axes)
  return { capability, volume, score: formula.weight * capability + volume }
}

const MODEL_KEY = { 'Sonnet 5': 'sonnet', 'Opus 5': 'opus', 'Fable 5.1': 'fable' }
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
  return workflowConstant(pipeline, 'BANDS').map(({ min, max, fableplan, validate, build }) => ({ min, max, fableplan, validate, build }))
}

describe('complexity score band encoding', () => {
  test('golden examples in the validate-issue reference match the formula the owner states', () => {
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
    const rows = [...prdToIssues.matchAll(/^\| (\d) \| (\d+)–(\d+) \| (Sonnet 5|Opus 5|Fable 5.1)[^|]*\| (\*\*Yes\*\*|No) \| (\w+) ?\|/gm)]
    expect(rows.length, 'prd-to-issues states six bands').toBe(owner.length)
    rows.forEach(([, band, min, max, model, fableplan, effort], index) => {
      const row = owner[index]
      expect({ band: Number(band), min: Number(min), max: Number(max) }, `row ${band} bounds`).toEqual({ band: row.band, min: row.min, max: row.max })
      expect(fableplan === '**Yes**', `row ${band} fableplan`).toBe(row.fableplan)
      expect({ model: MODEL_KEY[model], effort }, `row ${band} build`).toEqual(row.build)
    })
  })

  test('the milestoneplan validate copy covers every owner band with the owner routing', () => {
    const owner = ownerBands()
    const line = milestoneplan.match(/^- \*\*Validate\*\*[^\n]*$/m)?.[0]
    expect(line, 'milestoneplan states its Validate mapping').toBeTruthy()
    const ranges = [...line.matchAll(/`((?:Sonnet 5|Opus 5|Fable 5\.1) · \w+)` at `\[C(\d+)\]`(?:–`\[C(\d+)\]`| and above)/g)]
      .map(([, cell, min, max]) => ({ validate: spec(cell), min: Number(min), max: max === undefined ? Infinity : Number(max) }))
    expect(ranges.length, 'milestoneplan states validate ranges').toBeGreaterThan(0)
    for (const row of owner) {
      const covering = ranges.filter((range) => range.min <= row.min && row.max <= range.max)
      expect(covering.length, `band ${row.band} (${row.min}–${row.max}) is covered by exactly one milestoneplan range`).toBe(1)
      expect(covering[0].validate, `band ${row.band} validate`).toEqual(row.validate)
    }
    for (let score = 0; score <= owner.at(-1).max; score += 1) {
      expect(ranges.filter((range) => range.min <= score && score <= range.max).length, `score ${score} maps to one range`).toBe(1)
    }
  })

  test('the score gate and the never-lower rule stay stated', async () => {
    expect(validateIssueScoring).toMatch(/never lower[^.\n]{0,80}rescore|rescore[^.\n]{0,80}never lower/i)
    for (const path of ['skills/validate-issue/SKILL.md', 'skills/new-issue/SKILL.md', 'skills/github-issue-format/SKILL.md']) {
      expect(await read(path), path).toMatch(/score (?:is )?(?:≥|>=|at or above|reaches|of) ?71|71 or (?:higher|above|more)/)
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
