import { describe, expect, test } from 'bun:test'

const root = new URL('../', import.meta.url)
const read = (path) => Bun.file(new URL(path, root)).text()

const example = await read('skills/pr-review/example-review.md')
const skill = await read('skills/pr-review/SKILL.md')

const blocks = [...example.matchAll(/```markdown\n([\s\S]*?)```/g)].map((match) =>
  match[1].trimEnd(),
)
const [needsUpdates, bareLgtm] = blocks

const SECTION_ORDER = [
  '### Needs Fixing',
  '### Requires Human Review',
  '### Recommended Optional',
  '### Create Follow-up Issue',
]

const SECTION_FIELDS = {
  '### Needs Fixing': ['Invariant:', 'Must survive:', 'Plain simple English:'],
  '### Requires Human Review': ['Recommended proposed solution:', 'Plain simple English:'],
  '### Recommended Optional': ['Invariant:', 'Must survive:', 'Plain simple English:'],
  '### Create Follow-up Issue': ['Plain simple English:'],
}

const DEFINED_FIELDS = new Set([
  'Invariant:',
  'Must survive:',
  'Recommended proposed solution:',
  'Plain simple English:',
  'Verification limitation:',
])

const FOOTER = /^Reviewed with LLM: [^|]+ \| [^|]+ \| Harness: .+$/m

const findingsEnd = needsUpdates.search(/\n\*\*Verification limitation:\*\*|\n---$/m)
const findingsRegion = findingsEnd === -1 ? needsUpdates : needsUpdates.slice(0, findingsEnd)

const sectionBody = (heading) => {
  const start = findingsRegion.indexOf(`${heading}\n`)
  if (start === -1) return ''
  const rest = findingsRegion.slice(start + heading.length)
  const next = rest.search(/\n### /)
  return next === -1 ? rest : rest.slice(0, next)
}

const nonBlank = (block) => block.split('\n').filter((line) => line.trim())

describe('PR review worked example', () => {
  test('the skill points at the example and keeps its own prose authoritative', () => {
    expect(skill).toContain('](example-review.md)')
    expect(skill.replace(/\s+/g, ' ')).toMatch(
      /example-review\.md[\s\S]{0,600}these rules win/i,
    )
    expect(example.replace(/\s+/g, ' ')).toMatch(/rules in \[SKILL\.md\]\(SKILL\.md\) win/i)
  })

  test('ships one Needs Updates review and one bare LGTM review', () => {
    expect(blocks).toHaveLength(2)
    expect(needsUpdates.split('\n')[0]).toBe('Needs Updates')

    const lgtmLines = nonBlank(bareLgtm)
    expect(lgtmLines).toHaveLength(3)
    expect(lgtmLines[0]).toBe('LGTM')
    expect(lgtmLines[1]).toBe('---')
    expect(bareLgtm).toMatch(FOOTER)
  })

  test('shows all four H3 sections in the blocking-first order, one item each', () => {
    const headings = [...needsUpdates.matchAll(/^### .+$/gm)].map((match) => match[0])
    expect(headings).toEqual(SECTION_ORDER)
    for (const heading of SECTION_ORDER) {
      expect(skill, `Format rules must name ${heading}`).toContain(heading.slice(4))
      expect(
        sectionBody(heading).match(/^1\. \*\*.+\*\*$/m),
        `${heading}: numbered item with a bold one-sentence title`,
      ).not.toBeNull()
    }
  })

  test('each section carries its required fields in the required order', () => {
    for (const heading of SECTION_ORDER) {
      const fields = [...sectionBody(heading).matchAll(/^\*\*([^*]+:)\*\*/gm)].map(
        (match) => match[1],
      )
      expect(fields, heading).toEqual(SECTION_FIELDS[heading])
      expect(fields[fields.length - 1], `${heading}: last field`).toBe('Plain simple English:')
    }
  })

  test('uses no field name the Format rules do not define', () => {
    for (const [, field] of needsUpdates.matchAll(/^\*\*([^*]+:)\*\*/gm)) {
      expect(DEFINED_FIELDS.has(field), `undefined field name: ${field}`).toBe(true)
      expect(skill, `Format rules must name ${field}`).toContain(field.replace(/:$/, ''))
    }
  })

  test('places the Verification limitation line outside every finding section', () => {
    const lines = needsUpdates.split('\n')
    const limitIndex = lines.findIndex((line) => line.startsWith('**Verification limitation:**'))
    expect(limitIndex).toBeGreaterThan(-1)

    const lastHeading = lines.reduce((acc, line, i) => (line.startsWith('### ') ? i : acc), -1)
    expect(limitIndex, 'sits after the last finding section').toBeGreaterThan(lastHeading)

    const limitLine = lines[limitIndex]
    expect(limitLine).toMatch(/^\*\*Verification limitation:\*\* .+ unavailable — .+\.$/)
    expect(limitLine).not.toMatch(/Invariant:|Must survive:|Plain simple English:/)
    expect(limitLine).not.toMatch(/^\s*\d+\./)
    expect(nonBlank(lines.slice(limitIndex + 1).join('\n'))[0]).toBe('---')
  })

  test('both example reviews end with the Reviewed attribution footer', () => {
    for (const [index, block] of blocks.entries()) {
      const trailing = nonBlank(block).slice(-2)
      expect(trailing[0], `block ${index + 1}: footer separator`).toBe('---')
      expect(trailing[1], `block ${index + 1}: Reviewed verb`).toMatch(FOOTER)
    }
  })

  test('keeps every plain-simple-English field under 55 words', () => {
    const fields = [
      ...needsUpdates.matchAll(
        /^\*\*(Plain simple English|Recommended proposed solution):\*\* (.+)$/gm,
      ),
    ]
    expect(fields.length).toBeGreaterThanOrEqual(5)
    for (const [, label, body] of fields) {
      expect(body.trim().split(/\s+/).length, `${label} word count`).toBeLessThan(55)
    }
  })

  test('keeps the Requires Human Review technical description under 50 words', () => {
    const description = sectionBody('### Requires Human Review')
      .split('\n')
      .find((line) => line.startsWith('`skills/'))
    expect(description, 'description line').toBeDefined()
    expect(description.trim().split(/\s+/).length).toBeLessThan(50)
  })
})
