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
  return { capability, volume, score: Math.min(100, 25 * capability + volume) }
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
  test('golden examples from validate-issue', () => {
    expect(complexityScore({ scope: 4, coupling: 0, risk: 0, uncertainty: 0, verification: 0 })).toEqual({
      capability: 0,
      volume: 8,
      score: 8,
    })
    expect(complexityScore({ scope: 0, coupling: 0, risk: 0, uncertainty: 4, verification: 0 })).toEqual({
      capability: 3,
      volume: 0,
      score: 75,
    })
    expect(complexityScore({ scope: 0, coupling: 4, risk: 1, uncertainty: 1, verification: 0 })).toEqual({
      capability: 2,
      volume: 8,
      score: 58,
    })
    expect(complexityScore({ scope: 0, coupling: 0, risk: 4, uncertainty: 0, verification: 0 })).toEqual({
      capability: 3,
      volume: 0,
      score: 75,
    })
    expect(complexityScore({ scope: 0, coupling: 0, risk: 3, uncertainty: 0, verification: 0 })).toEqual({
      capability: 2,
      volume: 0,
      score: 50,
    })
  })

  test('skills document the band formula and drop the old sum×5 / Risk floor', () => {
    expect(validateIssue).toContain('25 × Capability + Volume')
    expect(validateIssue).toContain('If **Coupling ≥ 3**')
    expect(validateIssue).toContain('#### Golden examples (consistency checklist)')
    expect(validateIssue).not.toContain('sum × 5')
    expect(validateIssue).not.toContain('Risk floor')
    expect(validateIssue).not.toContain('hard decision-gate over existing tooling')

    expect(newIssue).toContain('25 × Capability + Volume')
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
    const [executionPlanReview, claudeMd, validateIssueLoop] = await Promise.all([
      read('skills/execution-plan-review/SKILL.md'),
      read('CLAUDE.md'),
      read('skills/validate-issue-loop/SKILL.md'),
    ])
    expect(validateIssue).toContain('Capability <k> (<driver>); Volume <v>')
    expect(validateIssueLoop).toContain('Capability <k> (<driver>); Volume <v>')
    expect(fableValidateLoop).toContain('Capability <k> (<driver>); Volume <v>')
    expect(executionPlanReview).toContain('conflicts with the score band')
    expect(executionPlanReview).not.toContain('conflicts with the heuristics')
    expect(claudeMd).toContain('model + effort routing signal')
    expect(claudeMd).not.toContain('describe complexity as scope and risk')
  })
})
