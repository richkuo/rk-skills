import { describe, expect, test } from 'bun:test'

const root = new URL('../', import.meta.url)
const read = (path) => Bun.file(new URL(path, root)).text()

/** Files that compose a new issue body, or rewrite an existing one. */
const ISSUE_BODY_CONSUMERS = [
  'skills/github-issue-format/SKILL.md',
  'skills/new-issue/SKILL.md',
  'skills/prd-to-issues/SKILL.md',
  'skills/fable-new-issue/SKILL.md',
  'skills/work-on-issue-loop/SKILL.md',
  'skills/validate-issue/issue-editing.md',
  'templates/claude-workflow/prompts/fix-pr.md',
  'templates/claude-workflow/prompts/issue-workflow.md',
]

/** Files that state the canonical section order. */
const ORDER_STATERS = [
  'skills/github-issue-format/SKILL.md',
  'CLAUDE.md',
  'AGENTS.md',
]

/** Files whose route rewrites an existing body, so it must backfill. */
const BACKFILL_CONSUMERS = [
  'skills/validate-issue/issue-editing.md',
  'templates/claude-workflow/prompts/issue-workflow.md',
]

const ALL = [...new Set([...ISSUE_BODY_CONSUMERS, ...ORDER_STATERS, ...BACKFILL_CONSUMERS])]

const texts = Object.fromEntries(
  await Promise.all(ALL.map(async (path) => [path, await read(path)])),
)
const normalized = Object.fromEntries(
  Object.entries(texts).map(([path, source]) => [path, source.replace(/\s+/g, ' ')]),
)

describe('Issue-body Plain simple English contract', () => {
  test('every issue-composing file requires the section with its 55-word cap', () => {
    for (const path of ISSUE_BODY_CONSUMERS) {
      const source = normalized[path]
      expect(source, path).toMatch(/Plain simple English/)
      expect(source, path).toMatch(
        /Plain simple English[\s\S]{0,320}55 words|55 words[\s\S]{0,320}Plain simple English/i,
      )
    }
  })

  test('the canonical section order is stated identically wherever it appears', () => {
    for (const path of ORDER_STATERS) {
      expect(normalized[path], path).toContain(
        '`## Acceptance criteria`, `## Plain simple English`, then any Execution block, then the attribution footer',
      )
    }
  })

  test('github-issue-format owns the rule and its limits', () => {
    const owner = normalized['skills/github-issue-format/SKILL.md']

    expect(owner).toMatch(/`## Plain simple English` is mandatory on every issue/i)
    expect(owner).toMatch(/ASD-STE100/)
    // Points at the shared Response Style rules instead of restating them.
    expect(owner).toMatch(/CLAUDE\.md\/AGENTS\.md Response Style rules/)
    // The section is for a human reader, never a second copy of the approach.
    expect(owner).toMatch(/Never restate the approach there/i)
    expect(owner).toMatch(/never put a time or effort estimate in it/i)
  })

  test('the new-issue body template places the section after the criteria and before the footer', () => {
    const template = texts['skills/new-issue/SKILL.md']
    const criteria = template.indexOf('## Acceptance criteria')
    const plain = template.indexOf('## Plain simple English')
    const footer = template.indexOf('Created with LLM: <current model>')

    expect(criteria).toBeGreaterThan(-1)
    expect(plain).toBeGreaterThan(criteria)
    expect(footer).toBeGreaterThan(plain)
  })

  test('routes that rewrite an existing body backfill the missing section', () => {
    for (const path of BACKFILL_CONSUMERS) {
      expect(normalized[path], path).toMatch(
        /Plain simple English[\s\S]{0,400}add (?:it|that section) when (?:the body has none|it is missing)/i,
      )
    }
  })

  test('the GitHub Issues instructions carry the rule in both harness files', () => {
    for (const path of ['CLAUDE.md', 'AGENTS.md']) {
      const source = normalized[path]
      expect(source, path).toMatch(/Issue body order:[\s\S]{0,400}Plain simple English/i)
      expect(source, path).toMatch(
        /plain-language section is mandatory on every issue[\s\S]{0,200}55 words/i,
      )
    }
  })

  test('the contract inventory records the rule, its owner, and this guard', async () => {
    const inventory = await read('docs/contract-inventory.md')

    expect(inventory).toMatch(/Issue-body `## Plain simple English` section|Issue-body `Plain simple English` section/)
    expect(inventory).toMatch(/tests\/issue-plain-simple-english-contract\.test\.js/)
  })
})
