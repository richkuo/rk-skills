import { describe, expect, test } from 'bun:test'

/**
 * Canonical complexity score — mirrors validate-issue step 6.
 * Kept as executable golden examples so a reviewer can verify the routing
 * formula without re-deriving it from prose.
 */
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

const [validateIssue, newIssue, githubIssueFormat, prdToIssues, fableValidateLoop, validateFableplanLoop, readme] =
  await Promise.all([
    read('skills/validate-issue/SKILL.md'),
    read('skills/new-issue/SKILL.md'),
    read('skills/github-issue-format/SKILL.md'),
    read('skills/prd-to-issues/SKILL.md'),
    read('skills/fable-validate-loop/SKILL.md'),
    read('skills/validate-fableplan-loop/SKILL.md'),
    read('README.md'),
  ])

describe('complexity score band encoding', () => {
  /** Parse golden rows from validate-issue prose so table drift fails CI. */
  function parseGoldenExamples(markdown) {
    const section = markdown.split('#### Golden examples (consistency checklist)')[1]
    expect(section).toBeTruthy()
    const rows = []
    const rowRe =
      /^\| \((\d+),(\d+),(\d+),(\d+),(\d+)\) \| (\d+)[^|]*\| (\d+) \| \*\*(\d+)\*\* \|/gm
    for (const m of section.matchAll(rowRe)) {
      rows.push({
        axes: {
          scope: Number(m[1]),
          coupling: Number(m[2]),
          risk: Number(m[3]),
          uncertainty: Number(m[4]),
          verification: Number(m[5]),
        },
        documented: {
          capability: Number(m[6]),
          volume: Number(m[7]),
          score: Number(m[8]),
        },
      })
    }
    return rows
  }

  test('golden examples in validate-issue prose match the executable formula', () => {
    const rows = parseGoldenExamples(validateIssue)
    expect(rows.length).toBeGreaterThanOrEqual(5)
    for (const { axes, documented } of rows) {
      const computed = complexityScore(axes)
      expect(documented).toEqual(computed)
    }
  })

  test('skills document the band formula and drop the old sum×5 / Risk floor', () => {
    expect(validateIssue).toContain('25 × Capability + Volume')
    expect(validateIssue).toContain('0–99 under current axis bounds')
    expect(validateIssue).not.toContain('cap at 100 if needed')
    expect(validateIssue).toContain('If **Coupling ≥ 3**')
    expect(validateIssue).toContain('#### Golden examples (consistency checklist)')
    expect(validateIssue).not.toContain('sum × 5')
    expect(validateIssue).not.toContain('Risk floor')
    expect(validateIssue).not.toContain('hard decision-gate over existing tooling')

    expect(newIssue).toContain('25 × Capability + Volume')
    expect(newIssue).toContain('**Complexity: <score>/100** — Capability <k> (<driver>); Volume <v>')
    expect(newIssue).not.toContain('scope: <…>; risk:')
    expect(newIssue).not.toContain('sum ×5')
    expect(newIssue).not.toContain('risk floor')

    expect(githubIssueFormat).toContain('model + effort routing signal')
    expect(githubIssueFormat).toContain('25 × Capability + Volume')

    expect(prdToIssues).toContain('derive from the complexity score band')
    expect(prdToIssues).toContain('25 × Capability + Volume')
  })

  test('fableplan gates key off score ≥ 61', () => {
    expect(fableValidateLoop).toContain('below 61')
    expect(fableValidateLoop).not.toMatch(/below 50|below C50|Capability < 2/)
    expect(validateFableplanLoop).toContain('below 61')
    expect(validateFableplanLoop).not.toMatch(/below 50|Capability < 2/)
    expect(readme).toContain('score ≥ 61')
    expect(readme).not.toContain('score ≥ 50')
  })

  test('the six-band routing matrix is stated consistently across docs and the pipeline', async () => {
    const pipeline = await read('workflows/milestone-pipeline.js')

    // validate-issue holds the canonical matrix.
    expect(validateIssue).toContain('| 0 | 0–9 | Opus 5 · medium | No | Sonnet 5 · high | `@claude` (standard trigger, no pinned model) |')
    expect(validateIssue).toContain('| 1 | 10–20 | Opus 5 · high | No | Sonnet 5 · xhigh | `@claude` (standard trigger, no pinned model) |')
    expect(validateIssue).toContain('| 2 | 21–40 | Opus 5 · high | No | Opus 5 · high | Opus 5 · high |')
    expect(validateIssue).toContain('| 3 | 41–60 | Opus 5 · xhigh | No | Opus 5 · xhigh | Opus 5 · high |')
    expect(validateIssue).toContain('| 4 | 61–80 | Fable 5 · medium | **Yes** | Opus 5 · high | Opus 5 · high |')
    expect(validateIssue).toContain('| 5 | 81–99 | Fable 5 · high | **Yes** | Opus 5 · xhigh | Fable 5 · high |')
    // Escalation is part of the canonical statement.
    expect(validateIssue).toMatch(/upward only, never downward/)

    // prd-to-issues stamps Execution blocks from the same matrix.
    expect(prdToIssues).toContain("| 0 | 0–9 | Sonnet 5 (or the repo's cheap/fast builder) | No | high |")
    expect(prdToIssues).toContain("| 1 | 10–20 | Sonnet 5 (or the repo's cheap/fast builder) | No | xhigh |")
    expect(prdToIssues).toContain('| 2 | 21–40 | Opus 5 | No | high |')
    expect(prdToIssues).toContain('| 3 | 41–60 | Opus 5 | No | xhigh |')
    expect(prdToIssues).toContain('| 4 | 61–80 | Opus 5 | **Yes** | high |')
    expect(prdToIssues).toMatch(/\| 5 \| 81–99 \| Opus 5 \| \*\*Yes\*\* \| xhigh/)
    expect(prdToIssues).toMatch(/Validation is fully derived from the score/)

    // The pipeline executes the same matrix.
    expect(pipeline).toContain("{ name: '0–9', min: 0, max: 9, fableplan: false, validate: { model: 'opus', effort: 'medium' }, build: { model: 'sonnet', effort: 'high' }, review: { model: null, effort: 'high' } }")
    expect(pipeline).toContain("{ name: '10–20', min: 10, max: 20, fableplan: false, validate: { model: 'opus', effort: 'high' }, build: { model: 'sonnet', effort: 'xhigh' }, review: { model: null, effort: 'high' } }")
    expect(pipeline).toContain("{ name: '21–40', min: 21, max: 40, fableplan: false, validate: { model: 'opus', effort: 'high' }, build: { model: 'opus', effort: 'high' }, review: { model: 'opus', effort: 'high' } }")
    expect(pipeline).toContain("{ name: '41–60', min: 41, max: 60, fableplan: false, validate: { model: 'opus', effort: 'xhigh' }, build: { model: 'opus', effort: 'xhigh' }, review: { model: 'opus', effort: 'high' } }")
    expect(pipeline).toContain("{ name: '61–80', min: 61, max: 80, fableplan: true, validate: { model: 'fable', effort: 'medium' }, build: { model: 'opus', effort: 'high' }, review: { model: 'opus', effort: 'high' } }")
    expect(pipeline).toContain("{ name: '81+', min: 81, max: Infinity, fableplan: true, validate: { model: 'fable', effort: 'high' }, build: { model: 'opus', effort: 'xhigh' }, review: { model: 'fable', effort: 'high' } }")

    // fableplan is yes at score ≥ 61 everywhere the signal is defined,
    // and the worked example round-trips its own band through the rule.
    for (const doc of [validateIssue, newIssue, githubIssueFormat]) {
      expect(doc).toMatch(/score is ≥ 61|score is 61 or higher|score ≥ 61/)
      expect(doc).not.toMatch(/Capability ≥ 2 \(score ≥ 50|only when Capability = 2|only at Capability 2/)
    }
    expect(githubIssueFormat).toContain('Volume 20 — Opus 5, xhigh · fableplan: yes')
    // No document may keep describing the superseded band-3 = "no" convention.
    for (const doc of [validateIssue, newIssue, githubIssueFormat, prdToIssues, fableValidateLoop, validateFableplanLoop]) {
      expect(doc).not.toMatch(/verdict line reads `fableplan: no`/)
      expect(doc).not.toMatch(/band 3 is built by Fable 5 directly/)
    }
  })

  test('verdict templates and consumers use Capability/Volume wording', async () => {
    const [executionPlanReview, claudeMd, validateIssueLoop, githubIssueFormat] = await Promise.all([
      read('skills/execution-plan-review/SKILL.md'),
      read('CLAUDE.md'),
      read('skills/validate-issue-loop/SKILL.md'),
      read('skills/github-issue-format/SKILL.md'),
    ])
    expect(validateIssue).toContain('Capability <k> (<driver>); Volume <v>')
    expect(validateIssueLoop).toContain('Capability <k> (<driver>); Volume <v>')
    expect(fableValidateLoop).toContain('Capability <k> (<driver>); Volume <v>')
    expect(executionPlanReview).toContain('conflicts with the score band')
    expect(executionPlanReview).not.toContain('conflicts with the heuristics')
    expect(claudeMd).toContain('model + effort routing signal')
    expect(claudeMd).not.toContain('describe complexity as scope and risk')
    // Money double-fill example must round-trip Risk 4 → Capability 3 → Fable 5 (not Opus).
    expect(githubIssueFormat).toContain('[C95] Orders can be filled twice')
    expect(githubIssueFormat).toContain('Capability 3 (Risk 4 — money/data-integrity on order-fill path); Volume 20 — Opus 5, xhigh')
    // Fable never pairs with xhigh — high is Fable's ceiling.
    expect(githubIssueFormat).not.toContain('Fable 5, xhigh')
    expect(githubIssueFormat).not.toContain('[C70] Orders can be filled twice')
    expect(githubIssueFormat).not.toContain('Capability 2 (risk high on order-fill path)')
  })
})
