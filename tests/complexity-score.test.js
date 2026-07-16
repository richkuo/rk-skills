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

  test('fableplan gates key off Capability ≥ 2 / score ≥ 50', () => {
    expect(fableValidateLoop).toContain('Capability < 2')
    expect(fableValidateLoop).toContain('below 50')
    expect(fableValidateLoop).not.toMatch(/below C50/)
    expect(validateFableplanLoop).toContain('Capability < 2')
    expect(validateFableplanLoop).toContain('below 50')
    expect(readme).toContain('Capability ≥ 2 / score ≥ 50')
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
    expect(githubIssueFormat).toContain('Orders can be filled twice when two fills arrive at the same moment [C95, Fable 5, xhigh]')
    expect(githubIssueFormat).toContain('Capability 3 (Risk 4 — money/data-integrity on order-fill path); Volume 20 — Fable 5, xhigh')
    expect(githubIssueFormat).not.toContain('[C70, Opus')
    expect(githubIssueFormat).not.toContain('Capability 2 (risk high on order-fill path)')
  })
})
