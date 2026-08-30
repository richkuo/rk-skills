import { describe, expect, test } from 'bun:test'

const root = new URL('../', import.meta.url)
const read = (path) => Bun.file(new URL(path, root)).text()

const OWNER = 'skills/github-issue-format/SKILL.md'

const ISSUE_BODY_CONSUMERS = [
  OWNER,
  'skills/new-issue/SKILL.md',
  'skills/prd-to-issues/SKILL.md',
  'skills/fable-new-issue/SKILL.md',
  'skills/work-on-issue-loop/SKILL.md',
  'skills/fix-pr-review/SKILL.md',
  'skills/validate-issue/issue-editing.md',
  'templates/claude-workflow/prompts/fix-pr.md',
  'templates/claude-workflow/prompts/issue-workflow.md',
  'templates/codex-workflow/prompts/fix-pr.md',
  'templates/codex-workflow/prompts/issue-workflow.md',
]

const ORDER_STATERS = [OWNER, 'CLAUDE.md']

const BACKFILL_CONSUMERS = [
  'skills/validate-issue/issue-editing.md',
  'templates/claude-workflow/prompts/issue-workflow.md',
  'templates/codex-workflow/prompts/issue-workflow.md',
]

const ALL = [...new Set([...ISSUE_BODY_CONSUMERS, ...ORDER_STATERS, ...BACKFILL_CONSUMERS])]

const texts = Object.fromEntries(await Promise.all(ALL.map(async (path) => [path, await read(path)])))
const normalized = Object.fromEntries(Object.entries(texts).map(([path, source]) => [path, source.replace(/\s+/g, ' ')]))

describe('Issue-body Plain simple English contract', () => {
  test('every issue-composing file requires the section with its 55-word cap', () => {
    for (const path of ISSUE_BODY_CONSUMERS) {
      expect(normalized[path], path).toMatch(
        /## Plain simple English[\s\S]{0,320}55 words|55 words[\s\S]{0,320}## Plain simple English/,
      )
    }
  })

  test('the canonical section order places the section after the criteria and before any Execution block', () => {
    for (const path of ORDER_STATERS) {
      expect(normalized[path], path).toMatch(
        /## Acceptance criteria`?, (?:then )?`?## Plain simple English`?, then any Execution block, (?:then |and then )?the attribution footer/,
      )
    }
    const template = texts['skills/new-issue/SKILL.md']
    const criteria = template.indexOf('## Acceptance criteria')
    const plain = template.indexOf('## Plain simple English')
    const footer = template.indexOf('Created with LLM: <current model>')
    expect(criteria).toBeGreaterThan(-1)
    expect(plain).toBeGreaterThan(criteria)
    expect(footer).toBeGreaterThan(plain)
  })

  test('github-issue-format owns the rule and a metadata-only edit never adds the section', () => {
    const owner = normalized[OWNER]
    expect(owner).toMatch(/`## Plain simple English` is (?:mandatory|required) on every issue/i)
    expect(owner).toMatch(/edit that rewrites body prose adds the section when it is missing/i)
    expect(owner).toMatch(/changes only machine metadata[\s\S]{0,160}does not add it/i)
  })

  test('routes that rewrite an existing body backfill the missing section', () => {
    for (const path of BACKFILL_CONSUMERS) {
      expect(normalized[path], path).toMatch(
        /## Plain simple English[\s\S]{0,400}add (?:it|that section) when (?:the body has none|it is missing)/,
      )
    }
  })
})
