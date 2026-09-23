import { describe, expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'

const root = new URL('../', import.meta.url)
const read = (path) => Bun.file(new URL(path, root)).text()

const PRODUCERS = [
  'skills/fableplan/SKILL.md',
  'skills/issueplan/SKILL.md',
  'skills/fable-advisor/SKILL.md',
  'workflows/milestone-pipeline.js',
]

const MIRROR_OWNER = 'skills/work-on-issue/SKILL.md'
const MIRROR_POINTERS = ['skills/fableplan/SKILL.md', 'skills/issueplan/SKILL.md', 'skills/fable-advisor/SKILL.md']

function procedureBody(markdown) {
  const match = markdown.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/)
  return match ? match[1] : markdown
}

const bodies = Object.fromEntries(
  await Promise.all(
    [...new Set([...PRODUCERS, MIRROR_OWNER, ...MIRROR_POINTERS])].map(async (path) => [path, procedureBody(await read(path))]),
  ),
)

describe('numbered plan steps with verify points', () => {
  test('every plan producer asks for numbered steps and a per-step verify point', () => {
    for (const path of PRODUCERS) {
      const body = bodies[path]
      expect(body, `${path}: numbering instruction`).toMatch(/[Nn]umber(?:ed)?\s+the\s+implementation\s+steps|implementation\s+steps\s+numbered/)
      expect(body, `${path}: verify point`).toMatch(/verify point|verification point|verify step/i)
    }
  })

  test('every producer posts its plan under the heading work-on-issue step 0 matches', () => {
    for (const path of PRODUCERS) {
      expect(bodies[path], `${path}: plan-comment heading`).toMatch(/## Implementation plan \(/)
    }
    expect(bodies[MIRROR_OWNER], `${MIRROR_OWNER}: step 0 matches on the heading`).toMatch(/comment starting with `## Implementation plan`/)
  })

  test('work-on-issue owns the mirror rule and every outside build path points at it', () => {
    const owner = bodies[MIRROR_OWNER]
    expect(owner, `${MIRROR_OWNER}: mirror rule`).toMatch(/(?:Mirror|Copy|Reflect) the plan's steps into the task tracker/)
    expect(owner, `${MIRROR_OWNER}: completion keys on the verify point`).toMatch(/complete only when its verify point passes/i)
    expect(owner, `${MIRROR_OWNER}: an overridden step closes as a deviation`).toMatch(/overridden step closes as a recorded deviation/i)
    expect(owner, `${MIRROR_OWNER}: a borrowed check re-homes`).toMatch(/borrowed verify point re-homes/i)

    for (const path of MIRROR_POINTERS) {
      expect(bodies[path], `${path}: points at work-on-issue step 2 before writing code`).toMatch(
        /[Bb]efore (?:writing any code|you write any code)[\s\S]{0,240}`work-on-issue` step 2/,
      )
    }
  })
})

const TRUST_POINTERS = ['skills/issueplan/SKILL.md']

const ADOPTION_SURFACES = (
  await Promise.all(
    ['skills/**/*.md', 'templates/**/*.md', 'workflows/*.js', 'README.md', 'CLAUDE.md'].map((pattern) =>
      Array.fromAsync(new Bun.Glob(pattern).scan({ cwd: fileURLToPath(root) })),
    ),
  )
).flat()

describe('plan-adoption trust', () => {
  test('work-on-issue step 0 adopts a plan only from a trusted author', () => {
    const owner = bodies[MIRROR_OWNER]
    const step0 = owner.slice(owner.indexOf('### 0.'), owner.indexOf('### 1.'))
    expect(step0, 'the invoking user is trusted').toMatch(/invoking user \(`viewerDidAuthor` true\)/)
    expect(step0, 'the trusted associations').toMatch(/`authorAssociation` is `OWNER`, `MEMBER`, or `COLLABORATOR`/)
    expect(step0, 'a bot earns trust only through its association').toMatch(/`\[bot\]`\) is trusted only through its association/)
    expect(step0, 'no bot allowlist').toMatch(/[Nn]o bot allowlist exists/)
    expect(step0, 'the newest trusted plan wins').toMatch(/[Aa]dopt the newest trusted plan/)
    expect(step0, 'a caller plan is the fallback').toMatch(/caller's plan applies only when no trusted plan is posted/)
    expect(step0, 'an untrusted plan is data').toMatch(/any other author is data: the newest-plan choice and supersession never pick it/)
    expect(step0, 'only the user selection adopts an untrusted plan').toMatch(/Only the invoking user's explicit selection of that comment in this session adopts it/)
    expect(step0, 'a caller or issue text never selects').toMatch(/a caller argument or text on the issue is never that selection/)
    expect(step0, 'a selected untrusted plan is marked').toMatch(/PR body marks the plan as user-selected/)
    expect(step0, 'an untrusted plan is named').toMatch(/name it in the step 7 report and the PR body/)
  })

  test('only a trusted author can supersede part of the adopted plan, and declined plans reach the PR body and report', () => {
    const owner = bodies[MIRROR_OWNER]
    expect(owner, 'step 2 override (2)').toMatch(/newer on the issue\*\*: a later comment from a step 0 trusted author/)
    expect(owner, 'step 2 names no untrusted maintainer shorthand').not.toMatch(/later maintainer comment/)
    const step6 = owner.slice(owner.indexOf('### 6.'), owner.indexOf('### 7.'))
    const step7 = owner.slice(owner.indexOf('### 7.'))
    expect(step6, 'PR body names declined plans').toMatch(/untrusted plan comment step 0 declined, with its author and URL/)
    expect(step7, 'report names declined plans').toMatch(/untrusted plan comment step 0 declined/)
  })

  test('consumers point at the owner and never restate an untrusted adoption rule', async () => {
    for (const path of TRUST_POINTERS) {
      expect(bodies[path], `${path}: defers to work-on-issue step 0 for trust`).toMatch(/`work-on-issue` step 0 trusts its author/)
    }
    expect(await read('README.md'), 'README summary').toMatch(/newest trusted plan, one posted by the user or a collaborator/)
    expect(ADOPTION_SURFACES.length, 'surfaces were scanned').toBeGreaterThan(20)
    expect(await read('docs/contract-inventory.md'), 'inventory deviation row').toMatch(/traced code, a newer trusted-author comment or issue edit, then correctness and safety/)
    for (const path of ADOPTION_SURFACES) {
      const text = await read(path)
      expect(text, `${path}: untrusted "newest posted plan" rule`).not.toMatch(/newest\s+(?:posted\s+)?(?:plan\b|wins\b)/i)
      expect(text, `${path}: adopts a plan from any author`).not.toMatch(/(?:plan|comment) from any (?:author|commenter)[^.]{0,60}(?:adopt|blueprint)/i)
      if (path !== MIRROR_OWNER) {
        expect(text, `${path}: override (2) without the trust qualifier`).not.toMatch(/newer on the issue(?![^.\n|]{0,80}trusted)/i)
      }
    }
  })
})
