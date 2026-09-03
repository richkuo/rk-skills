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
    const section = validateIssueScoring.split(/#+ Golden examples \(consistency checklist\)/)[1]
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

const AXES = ['scope', 'coupling', 'risk', 'uncertainty', 'verification']
const AXIS_HEADING = { scope: 'Scope', coupling: 'Coupling', risk: 'Risk', uncertainty: 'Uncertainty', verification: 'Verification' }

function everyAxisTuple() {
  const tuples = []
  for (let scope = 0; scope <= 4; scope += 1)
    for (let coupling = 0; coupling <= 4; coupling += 1)
      for (let risk = 0; risk <= 4; risk += 1)
        for (let uncertainty = 0; uncertainty <= 4; uncertainty += 1)
          for (let verification = 0; verification <= 4; verification += 1) tuples.push({ scope, coupling, risk, uncertainty, verification })
  return tuples
}

function reachableByCapability() {
  const ranges = new Map()
  for (const axes of everyAxisTuple()) {
    const { capability, score } = complexityScore(axes)
    const range = ranges.get(capability) ?? { min: Infinity, max: -Infinity }
    ranges.set(capability, { min: Math.min(range.min, score), max: Math.max(range.max, score) })
  }
  return ranges
}

const bandOf = (bands, score) => bands.find((row) => row.min <= score && score <= row.max)

describe('complexity score lattice', () => {
  test('the reachable-score table in the scoring reference matches the formula', () => {
    const section = validateIssueScoring.split(/#+ Reachable scores/)[1]
    expect(section).toBeTruthy()
    const rows = [...section.matchAll(/^\| (\d) \| (\d+) to (\d+) \|$/gm)]
    const ranges = reachableByCapability()
    expect(rows.length, 'one row per capability').toBe(ranges.size)
    for (const [, capability, min, max] of rows) {
      expect(ranges.get(Number(capability)), `capability ${capability}`).toEqual({ min: Number(min), max: Number(max) })
    }
  })

  test('a band edge never splits a capability floor from its next volume step', () => {
    const owner = ownerBands()
    const formula = formulaFromOwner()
    for (const [capability, range] of reachableByCapability()) {
      if (capability === 0) continue
      const floor = capability * formula.weight
      expect(range.min, `capability ${capability} floor`).toBe(floor)
      expect(bandOf(owner, floor)?.band, `score ${floor} shares a band with ${floor + 2}`).toBe(bandOf(owner, floor + 2)?.band)
    }
  })

  test('validate and build routing never weaken as the band rises', () => {
    const owner = ownerBands()
    const modelRank = { sonnet: 0, opus: 1, fable: 2 }
    const effortRank = { low: 0, medium: 1, high: 2, xhigh: 3 }
    const rank = ({ model, effort }) => modelRank[model] * 10 + effortRank[effort]
    for (let index = 1; index < owner.length; index += 1) {
      for (const stage of ['validate', 'build']) {
        expect(rank(owner[index][stage]), `band ${owner[index].band} ${stage}`).toBeGreaterThanOrEqual(rank(owner[index - 1][stage]))
      }
    }
  })
})

describe('complexity axis anchors and reported grades', () => {
  test('every axis states one anchor per grade from 0 to 4', () => {
    for (const axis of AXES) {
      const section = validateIssueScoring.split(new RegExp(`^### ${AXIS_HEADING[axis]} \\(`, 'm'))[1]?.split(/^#{2,3} /m)[0]
      expect(section, `${axis} section`).toBeTruthy()
      const grades = [...section.matchAll(/^\| (\d) \| .+ \|$/gm)].map((match) => Number(match[1]))
      expect(grades, `${axis} anchors`).toEqual([0, 1, 2, 3, 4])
    }
  })

  test('the rationale and verdict templates carry all five grades wherever they are quoted', async () => {
    const templates = [
      'skills/validate-issue/SKILL.md',
      'skills/validate-issue-loop/SKILL.md',
      'skills/fable-validate-loop/SKILL.md',
      'skills/validate-fableplan-loop/SKILL.md',
      'skills/fable-validate-fableplan/SKILL.md',
      'skills/fable-validate-fableplan-loop/SKILL.md',
      'skills/new-issue/SKILL.md',
    ]
    for (const path of templates) {
      const line = (await read(path)).split('\n').find((candidate) => /Complexity: <score>\/100/.test(candidate))
      expect(line, `${path}: template line`).toBeDefined()
      expect(line, path).toMatch(/Capability <k> \(Risk <r>, Uncertainty <u> — <driver>\); Volume <v> \(Scope <s>, Coupling <c>, Verification <x>\)/)
    }
  })

  test('the github-issue-format example line recomputes to its own score under the owner formula', async () => {
    const body = await read('skills/github-issue-format/SKILL.md')
    const match = body.match(/\*\*Complexity: (\d+)\/100\*\* — Capability (\d) \(Risk (\d), Uncertainty (\d) — [^)]*\); Volume (\d+) \(Scope (\d), Coupling (\d), Verification (\d)\)/)
    expect(match, 'example line carries all five grades').toBeTruthy()
    const [, score, capability, risk, uncertainty, volume, scope, coupling, verification] = match.map(Number)
    expect(complexityScore({ scope, coupling, risk, uncertainty, verification })).toEqual({ capability, volume, score })
  })
})

describe('complexity grading procedure', () => {
  test('validation grades blind, cites evidence, and reports an Axes block', () => {
    const step = validateIssue.slice(validateIssue.indexOf('### 6. Score complexity'), validateIssue.indexOf('### 7.'))
    expect(step).toMatch(/write its `Axes:` line with one piece of evidence per grade before you look up the grade the issue's rationale line states/)
    expect(validateIssueScoring).toMatch(/grade first and compare second/)
    expect(validateIssueScoring).toMatch(/before you look up the grades the issue's rationale line states/)
    expect(validateIssueScoring).toMatch(/one piece of evidence per grade/)
    const verdict = validateIssue.slice(validateIssue.indexOf('### 8. Output the verdict'))
    const block = verdict.slice(verdict.indexOf('Axes:'), verdict.indexOf('**#<N>: Update issue description?'))
    for (const line of ['- Scope <s> —', '- Coupling <c> —', '- Risk <r> —', '- Uncertainty <u> —', '- Verification <x> —', '- Differs: <axis> <issue grade> → <traced grade>']) {
      expect(block, line).toContain(line)
    }
  })

  test('a rescore that raises the score or changes a grade is an update, and a rescore never lowers routing', () => {
    const decision = validateIssue.slice(validateIssue.indexOf('<next-step line>'), validateIssue.indexOf('**Next-step line.**'))
    expect(decision).toMatch(/Yes for .*a rescore: a title prefix below the recomputed score, or a rationale line whose grades differ from the traced ones at a recomputed score that is not lower/)
    expect(decision).toMatch(/restamp the title prefix, the rationale line, and the fableplan signal/)
    expect(decision).toMatch(/A recomputed score below the title score restamps nothing/)
    expect(decision).toMatch(/a title with no prefix gets none from a rescore/)
    expect(decision).toMatch(/No only when .*with no rescore edit due/)
    const rules = validateIssueScoring.slice(validateIssueScoring.indexOf('## Grading rules'), validateIssueScoring.indexOf('## Build the edit list first'))
    expect(rules).toMatch(/a prefix above the recomputed score keeps its value/)
  })

  test('a rescore restamps the Execution block upward only and never lowers the published fableplan signal', async () => {
    const decision = validateIssue.slice(validateIssue.indexOf('<next-step line>'), validateIssue.indexOf('**Next-step line.**'))
    expect(decision).toMatch(/restamp its `Build model:`, `Effort:`, and `fableplan first:` lines to the recomputed band's defaults, upward only/)
    expect(decision).toMatch(/Fable 5\.1 or on a Codex CLI or Cursor CLI harness keeps its model and effort and gains only `fableplan first: Yes`/)
    expect(decision).toMatch(/`Complexity:` value is always the recomputed score/)
    expect(decision).toMatch(/`fableplan:` field is a routing signal: `yes` when the title score or the recomputed score is 71 or higher/)
    const editing = await read('skills/validate-issue/issue-editing.md')
    expect(editing).toMatch(/restamp its `Build model:`, `Effort:`, and `fableplan first:` lines to the new band's defaults[^\n]*upward only: never lower a model or an effort/)
    for (const path of ['skills/fable-validate-loop/SKILL.md', 'skills/validate-fableplan-loop/SKILL.md']) {
      const gate = (await read(path)).match(/\*\*Score gate:\*\*[^\n]*/)[0]
      expect(gate, path).toMatch(/`fableplan: no`[^\n]*both \*\*below 71\*\*/)
      expect(gate, path).toMatch(/Never read the raw `Complexity:` value/)
    }
    const routing = validateIssueScoring.slice(validateIssueScoring.indexOf('## Routing details'))
    expect(routing).toMatch(/bands 4 and 5 differ in validate effort and in first reviewer/)
    expect(routing).toMatch(/a moved edge that a first-review row starts on moves that table/)
    expect(validateIssueScoring).toMatch(/the build model follows Capability alone\. Volume[^\n]*can carry the score across the next band edge/)
  })

  test('the Scope anchors assign every file count to exactly one grade', () => {
    const section = validateIssueScoring.split(/^### Scope \(/m)[1].split(/^#{2,3} /m)[0]
    const anchor = (grade) => section.match(new RegExp(`^\\| ${grade} \\| (.+) \\|$`, 'm'))[1]
    expect(anchor(3)).toMatch(/^Six to fourteen files/)
    expect(anchor(4)).toMatch(/^Fifteen or more files/)
    expect(section).toMatch(/A mechanical change that touches fifteen or more files is Scope 4/)
  })
})
