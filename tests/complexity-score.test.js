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

const [validateIssue, validateIssueScoring, newIssue, githubIssueFormat, prdToIssues, fableValidateLoop, validateFableplanLoop, readme] =
  await Promise.all([
    read('skills/validate-issue/SKILL.md'),
    read('skills/validate-issue/complexity-scoring.md'),
    read('skills/new-issue/SKILL.md'),
    read('skills/github-issue-format/SKILL.md'),
    read('skills/prd-to-issues/SKILL.md'),
    read('skills/fable-validate-loop/SKILL.md'),
    read('skills/validate-fableplan-loop/SKILL.md'),
    read('README.md'),
  ])

const STEP_LABEL_CONSUMERS = [
  ['AGENTS.md', ['6']],
  ['CLAUDE.md', ['6']],
  ['README.md', ['6']],
  ['docs/contract-inventory.md', ['8']],
  ['skills/execution-plan-review/SKILL.md', ['6']],
  ['skills/fable-validate-fableplan-loop/SKILL.md', ['11']],
  ['skills/fable-validate-fableplan/SKILL.md', ['11']],
  ['skills/fable-validate-loop/SKILL.md', ['11']],
  ['skills/fable-validate/SKILL.md', ['7', '8', '9', '11']],
  ['skills/github-issue-format/SKILL.md', ['6']],
  ['skills/new-issue/SKILL.md', ['6', '7']],
  ['skills/prd-to-issues/SKILL.md', ['6']],
  ['skills/validate-fableplan-loop/SKILL.md', ['0', '1', '7', '11']],
  ['skills/validate-issue-loop/SKILL.md', ['0', '1', '7', '11']],
  ['tests/complexity-score.test.js', ['6']],
]

const PROPOSAL_CONCERN_CONSUMERS = [
  'skills/fable-validate-loop/SKILL.md',
  'skills/fable-validate-fableplan/SKILL.md',
  'skills/fable-validate-fableplan-loop/SKILL.md',
]

describe('complexity score band encoding', () => {
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

  test('all 15 validate-issue step-label consumers use surviving labels', async () => {
    expect(STEP_LABEL_CONSUMERS).toHaveLength(15)
    for (const [path, labels] of STEP_LABEL_CONSUMERS) {
      const text = await read(path)
      expect(text, path).not.toMatch(/validate-issue[^\n]{0,120}step(?:s|-)?\s*(?:6\.5|7\.5|7\.6)/i)
      for (const label of labels) {
        expect(text, `${path}: step ${label}`).toMatch(new RegExp(`validate-issue[^\\n]{0,160}step(?:s|-)?\\s*${label}\\b`, 'i'))
      }
    }
  })

  test('proposal concern consumers follow the current general-check label', async () => {
    const proposalLabels = [...validateIssue.matchAll(/^#### (5[a-z])\. /gm)].map((match) => match[1])
    const generalChecksLabel = validateIssue.match(/^#### (5[a-z])\. General checks$/m)?.[1]
    expect(generalChecksLabel).toBeDefined()

    for (const path of PROPOSAL_CONCERN_CONSUMERS) {
      const text = await read(path)
      expect(text, path).toContain(`${generalChecksLabel} concerns`)
      for (const label of proposalLabels.filter((candidate) => candidate !== generalChecksLabel)) {
        expect(text, path).not.toContain(`${label} concerns`)
      }
    }

    const fableValidate = await read('skills/fable-validate/SKILL.md')
    expect(fableValidate).toContain(`${proposalLabels.join('/')} proposal checks`)
  })

  test('the validate-issue core stays small and delegates complete procedures', async () => {
    const [architecture, consistency, editing] = await Promise.all([
      read('skills/validate-issue/architecture.md'),
      read('skills/validate-issue/proposal-consistency.md'),
      read('skills/validate-issue/issue-editing.md'),
    ])

    expect(validateIssue.split('\n').length - 1).toBeLessThan(200)
    for (const reference of ['architecture.md', 'proposal-consistency.md', 'complexity-scoring.md', 'issue-editing.md']) {
      expect(validateIssue).toContain(`](${reference})`)
    }
    for (const marker of ['Named wrapper/helper', 'Set claim', 'Benefit claim', 'Conjunction or negative', 'Negative over a window', 'Superlative, method-over-set, or cited baseline', 'Aggregate, dedupe, prorate, or shared state', 'Missing, undocumented, or unhandled surface']) {
      expect(validateIssue).toContain(marker)
    }
    for (const marker of ['Runtime topology', 'Ownership checklist', 'Touch-set completeness', 'Isolation boundaries']) {
      expect(architecture).toContain(marker)
    }
    for (const marker of ['Lifetime and population', 'Verb audit', 'Consumer completeness', 'Failure policy']) {
      expect(consistency).toContain(marker)
    }
    for (const marker of ['Grade the axes', 'Golden examples', 'Routing details']) {
      expect(validateIssueScoring).toContain(marker)
    }
    for (const marker of ['Verify the rewrite', 'final consistency pass', 'Edit the title', 'Verify the saved issue']) {
      expect(editing).toContain(marker)
    }
    expect(editing).toContain('harness that actually produced the edit')
    expect(editing).toContain('GitHub Action identifier')
    expect(editing).not.toContain('Use `Codex` for this interactive harness')
    expect(validateIssueScoring).toContain("main skill's band table")
    expect(validateIssueScoring).not.toMatch(/first review[^\n]*(?:0–20|21–80|81–99)/i)
    expect(validateIssueScoring).not.toContain('scores 0–20 inherit')
  })

  test('golden examples in the validate-issue reference match the executable formula', () => {
    const rows = parseGoldenExamples(validateIssueScoring)
    expect(rows.length).toBeGreaterThanOrEqual(5)
    for (const { axes, documented } of rows) {
      const computed = complexityScore(axes)
      expect(documented).toEqual(computed)
    }
  })

  test('the scoring reference leaves band outcomes in the canonical table', () => {
    const goldenExamples = validateIssueScoring
      .split('#### Golden examples (consistency checklist)')[1]
      .split('## Routing details')[0]

    expect(goldenExamples).not.toMatch(/Sonnet|Opus|Fable|builder|planner|effort/)
    expect(validateIssueScoring).not.toMatch(/builder remains|through 80|from 81/)
    expect(validateIssueScoring).toContain("Derive the `fableplan` signal, planner, builder, and effort from the main skill's band table")
  })

  test('skills document the band formula and drop the old sum×5 / Risk floor', () => {
    expect(validateIssue).toContain('25 × Capability + Volume')
    expect(validateIssue).toContain('0–99 under current axis bounds')
    expect(validateIssue).not.toContain('cap at 100 if needed')
    expect(validateIssue).toContain('If **Coupling ≥ 3**')
    expect(validateIssueScoring).toContain('#### Golden examples (consistency checklist)')
    expect(`${validateIssue}\n${validateIssueScoring}`).not.toContain('sum × 5')
    expect(`${validateIssue}\n${validateIssueScoring}`).not.toContain('Risk floor')
    expect(`${validateIssue}\n${validateIssueScoring}`).not.toContain('hard decision-gate over existing tooling')

    expect(newIssue).toContain('canonical score formula and routing table in `validate-issue` step 6')
    expect(newIssue).not.toContain('25 × Capability + Volume')
    expect(newIssue).toContain('**Complexity: <score>/100** — Capability <k> (<driver>); Volume <v>')
    expect(newIssue).not.toContain('scope: <…>; risk:')
    expect(newIssue).not.toContain('sum ×5')
    expect(newIssue).not.toContain('risk floor')

    expect(githubIssueFormat).toContain('model + effort routing signal')
    expect(githubIssueFormat).toContain('canonical formula, axes, and routing table from `validate-issue` step 6')
    expect(githubIssueFormat).not.toContain('25 × Capability + Volume')

    expect(prdToIssues).toContain('derive from the complexity score band')
    expect(prdToIssues).not.toContain('25 × Capability + Volume')
    expect([validateIssue, validateIssueScoring, newIssue, githubIssueFormat, prdToIssues].filter((doc) => doc.includes('25 × Capability + Volume'))).toHaveLength(1)
  })

  test('fableplan gates key off score ≥ 71', () => {
    expect(fableValidateLoop).toContain('below 71')
    expect(fableValidateLoop).not.toMatch(/below 50|below C50|Capability < 2/)
    expect(validateFableplanLoop).toContain('below 71')
    expect(validateFableplanLoop).not.toMatch(/below 50|Capability < 2/)
    expect(readme).toContain('score ≥ 71')
    expect(readme).not.toContain('score ≥ 61')
  })

  test('the seven-band routing matrix is stated consistently across docs and the pipeline', async () => {
    const pipeline = await read('workflows/milestone-pipeline.js')

    expect(validateIssue).toContain('| 0 | 0–9 | Opus 5 · medium | No | Sonnet 5 · high |')
    expect(validateIssue).toContain('| 1 | 10–20 | Opus 5 · high | No | Sonnet 5 · xhigh |')
    expect(validateIssue).toContain('| 2 | 21–40 | Opus 5 · high | No | Opus 5 · high |')
    expect(validateIssue).toContain('| 3 | 41–60 | Opus 5 · xhigh | No | Opus 5 · xhigh |')
    expect(validateIssue).toContain('| 4 | 61–70 | Fable 5 · medium | No | Opus 5 · xhigh |')
    expect(validateIssue).toContain('| 5 | 71–80 | Fable 5 · medium | **Yes** | Opus 5 · high |')
    expect(validateIssue).toContain('| 6 | 81–99 | Fable 5 · high | **Yes** | Opus 5 · xhigh |')
    expect(validateIssueScoring).toMatch(/Never lower routing from a validator rescore/)

    expect(prdToIssues).toContain("| 0 | 0–9 | Sonnet 5 (or the repo's cheap/fast builder) | No | high |")
    expect(prdToIssues).toContain("| 1 | 10–20 | Sonnet 5 (or the repo's cheap/fast builder) | No | xhigh |")
    expect(prdToIssues).toContain('| 2 | 21–40 | Opus 5 | No | high |')
    expect(prdToIssues).toContain('| 3 | 41–60 | Opus 5 | No | xhigh |')
    expect(prdToIssues).toContain('| 4 | 61–70 | Opus 5 | No | xhigh |')
    expect(prdToIssues).toContain('| 5 | 71–80 | Opus 5 | **Yes** | high |')
    expect(prdToIssues).toMatch(/\| 6 \| 81–99 \| Opus 5 \| \*\*Yes\*\* \| xhigh/)
    expect(prdToIssues).toMatch(/Validation is fully derived from the score/)

    expect(pipeline).toContain("{ name: '0–9', min: 0, max: 9, fableplan: false, validate: { model: 'opus', effort: 'medium' }, build: { model: 'sonnet', effort: 'high' } }")
    expect(pipeline).toContain("{ name: '10–20', min: 10, max: 20, fableplan: false, validate: { model: 'opus', effort: 'high' }, build: { model: 'sonnet', effort: 'xhigh' } }")
    expect(pipeline).toContain("{ name: '21–40', min: 21, max: 40, fableplan: false, validate: { model: 'opus', effort: 'high' }, build: { model: 'opus', effort: 'high' } }")
    expect(pipeline).toContain("{ name: '41–60', min: 41, max: 60, fableplan: false, validate: { model: 'opus', effort: 'xhigh' }, build: { model: 'opus', effort: 'xhigh' } }")
    expect(pipeline).toContain("{ name: '61–70', min: 61, max: 70, fableplan: false, validate: { model: 'fable', effort: 'medium' }, build: { model: 'opus', effort: 'xhigh' } }")
    expect(pipeline).toContain("{ name: '71–80', min: 71, max: 80, fableplan: true, validate: { model: 'fable', effort: 'medium' }, build: { model: 'opus', effort: 'high' } }")
    expect(pipeline).toContain("{ name: '81+', min: 81, max: Infinity, fableplan: true, validate: { model: 'fable', effort: 'high' }, build: { model: 'opus', effort: 'xhigh' } }")

    expect(validateIssue).toContain('| 0–10 | Sonnet 5 · high | `@claude sonnet review` |')
    expect(validateIssue).toContain('| 11–40 | the reviewer\'s default model | `@claude review` (standard trigger, no pinned model) |')
    expect(validateIssue).toContain('| 41–80 | Opus 5 · high | `@claude opus review` |')
    expect(validateIssue).toContain('| 81–99, or no score | Fable 5 · high | `@claude fable review effort:high` |')
    expect(pipeline).toContain("{ name: '0–10', min: 0, max: 10, review: { model: 'sonnet', effort: 'high' } }")
    expect(pipeline).toContain("{ name: '11–40', min: 11, max: 40, review: { model: null, effort: 'high' } }")
    expect(pipeline).toContain("{ name: '41–80', min: 41, max: 80, review: { model: 'opus', effort: 'high' } }")
    expect(pipeline).toContain("{ name: '81+', min: 81, max: Infinity, review: { model: 'fable', effort: 'high' } }")
    expect(validateIssue).toMatch(/never steps down to Sonnet/i)

    for (const doc of [validateIssue, newIssue, githubIssueFormat]) {
      expect(doc).toMatch(/score is ≥ 71|score is 71 or higher|score ≥ 71/)
      expect(doc).not.toMatch(/Capability ≥ 2 \(score ≥ 50|only when Capability = 2|only at Capability 2/)
    }
    expect(githubIssueFormat).toContain('Volume 20 — Opus 5, xhigh · fableplan: yes')
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
    expect(githubIssueFormat).toContain('[C95] Orders can be filled twice')
    expect(githubIssueFormat).toContain('Capability 3 (Risk 4 — money/data-integrity on order-fill path); Volume 20 — Opus 5, xhigh')
    expect(githubIssueFormat).not.toContain('Fable 5, xhigh')
    expect(githubIssueFormat).not.toContain('[C70] Orders can be filled twice')
    expect(githubIssueFormat).not.toContain('Capability 2 (risk high on order-fill path)')
  })
})
