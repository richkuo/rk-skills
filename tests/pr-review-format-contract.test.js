import { describe, expect, test } from 'bun:test'

/**
 * Semantic synchronization for the PR-review format triple.
 * Full-file equality is wrong: interactive and CI copies intentionally diverge
 * (CI status gating, "never execute project code", safety trigger lists).
 * This guard asserts the shared contract markers that must stay aligned.
 */

const root = new URL('../', import.meta.url)
const read = (path) => Bun.file(new URL(path, root)).text()

const [skill, ciPrompt, minimalYml] = await Promise.all([
  read('skills/pr-review-format/SKILL.md'),
  read('templates/claude-workflow/prompts/pr-review-format.md'),
  read('templates/claude-review.yml'),
])

/** Collapse YAML / markdown wrapping so `**Must\n survive:**` matches the field. */
const normalize = (text) => text.replace(/\s+/g, ' ')

const copies = [
  { name: 'skills/pr-review-format/SKILL.md', text: skill, flat: normalize(skill) },
  {
    name: 'templates/claude-workflow/prompts/pr-review-format.md',
    text: ciPrompt,
    flat: normalize(ciPrompt),
  },
  { name: 'templates/claude-review.yml', text: minimalYml, flat: normalize(minimalYml) },
]

/** Required markers every copy must satisfy (matched against whitespace-normalized text). */
const sharedMarkers = [
  { id: 'verdict-lgtm', re: /\bLGTM\b/ },
  { id: 'verdict-needs-updates', re: /Needs Updates/ },
  { id: 'section-needs-fixing', re: /### Needs Fixing/ },
  { id: 'section-requires-human-review', re: /### Requires Human Review/ },
  { id: 'section-recommended-optional', re: /### Recommended Optional/ },
  { id: 'section-create-follow-up', re: /### Create Follow-up Issue/ },
  {
    id: 'blocking-rule',
    re: /Needs Updates.{0,200}Needs Fixing.{0,120}Requires Human Review|Needs Fixing.{0,80}Requires Human Review.{0,200}Needs Updates/i,
  },
  { id: 'materiality-trivia', re: /trivia/i },
  { id: 'materiality-nit', re: /\bnit\b/i },
  { id: 'safety-carve-out', re: /Safety carve-out/i },
  { id: 'safety-overrides-materiality', re: /overrides.{0,80}materiality/i },
  { id: 'plain-simple-english-field', re: /\*\*Plain simple English:\*\*/ },
  { id: 'plain-simple-english-word-cap', re: /55 words/ },
  { id: 'invariant-field', re: /\*\*Invariant:\*\*/ },
  { id: 'must-survive-field', re: /\*\*Must survive:\*\*/ },
  { id: 'recommended-proposed-solution', re: /\*\*Recommended proposed solution:\*\*/ },
  { id: 'follow-up-last-resort', re: /Create Follow-up Issue.{0,80}last resort/i },
  { id: 'human-review-last-resort', re: /Requires Human Review.{0,80}last resort/i },
  { id: 'numbered-list', re: /numbered list/i },
]

describe('PR review format shared semantics', () => {
  for (const { name, flat } of copies) {
    test(`${name} carries every required shared marker`, () => {
      const missing = sharedMarkers.filter(({ re }) => !re.test(flat)).map(({ id }) => id)
      expect(missing, `${name} missing: ${missing.join(', ')}`).toEqual([])
    })
  }

  test('field order: Plain simple English before Invariant and Must survive', () => {
    for (const { name, flat } of copies) {
      const plain = flat.indexOf('**Plain simple English:**')
      const invariant = flat.indexOf('**Invariant:**')
      const mustSurvive = flat.indexOf('**Must survive:**')
      expect(plain, `${name}: Plain simple English`).toBeGreaterThanOrEqual(0)
      expect(invariant, `${name}: Invariant after Plain`).toBeGreaterThan(plain)
      expect(mustSurvive, `${name}: Must survive after Invariant`).toBeGreaterThan(invariant)
    }
  })

  test('field order: Plain simple English before Recommended proposed solution', () => {
    for (const { name, flat } of copies) {
      const plain = flat.indexOf('**Plain simple English:**')
      const recommended = flat.indexOf('**Recommended proposed solution:**')
      expect(recommended, `${name}: Recommended proposed solution after Plain`).toBeGreaterThan(plain)
    }
  })

  test('Invariant and Must survive are tied to Needs Fixing and Recommended Optional', () => {
    for (const { name, flat } of copies) {
      expect(flat).toMatch(
        /Needs Fixing.{0,200}Recommended Optional.{0,200}Invariant|Invariant.{0,200}Needs Fixing.{0,120}Recommended Optional/i,
      )
      expect(flat, `${name} mentions Must survive near Needs Fixing / Optional`).toMatch(
        /Must survive.{0,300}Needs Fixing|Needs Fixing.{0,400}Must survive/i,
      )
    }
  })
})

describe('PR review format intentional CI divergence', () => {
  test('CI prompt and minimal workflow forbid executing project code', () => {
    for (const flat of [normalize(ciPrompt), normalize(minimalYml)]) {
      expect(flat).toMatch(/never execute|do NOT run test suites|Do NOT execute the project's code/i)
    }
  })

  test('CI copies must not gate the verdict on CI status', () => {
    for (const flat of [normalize(ciPrompt), normalize(minimalYml)]) {
      expect(flat).toMatch(/Do NOT gate the verdict on CI/i)
    }
  })

  test('interactive skill keeps CI inspection in the LGTM precondition', () => {
    expect(normalize(skill)).toMatch(/check CI status/i)
  })
})
