import { describe, expect, test } from 'bun:test'

const root = new URL('../', import.meta.url)
const read = (path) => Bun.file(new URL(path, root)).text()

const [prdToIssues, executionPlanReview, milestoneWorkflow, readme] = await Promise.all([
  read('skills/prd-to-issues/SKILL.md'),
  read('skills/execution-plan-review/SKILL.md'),
  read('skills/milestone-workflow/SKILL.md'),
  read('README.md'),
])

describe('Execution block ordering contract', () => {
  test('prd-to-issues stamps typed direct predecessors', () => {
    expect(prdToIssues).toContain('- **Depends on:** #<n>[, #<n>…] | none')
    expect(prdToIssues).toContain('- **Runs after:** #<n>[, #<n>…] | none')
    expect(prdToIssues).toMatch(/same-package.*Runs after/i)
  })

  test('execution-plan-review exposes revisions and validates their combined graph', () => {
    expect(executionPlanReview).toContain('| Issue | C | Depends on | Runs after |')
    expect(executionPlanReview).toMatch(/revision.*Depends on.*Runs after/is)
    expect(executionPlanReview).toMatch(/reject.*cycle.*union/is)
  })

  test('milestone-workflow preserves explicit values and labels legacy inference', () => {
    expect(milestoneWorkflow).toMatch(/explicit `none`.*authoritative/i)
    expect(milestoneWorkflow).toMatch(/inferred.*hard.*ordering/is)
  })

  test('README publishes both ordering fields', () => {
    expect(readme).toContain('`Depends on`')
    expect(readme).toContain('`Runs after`')
  })
})
