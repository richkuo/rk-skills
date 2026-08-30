import { describe, expect, test } from 'bun:test'

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
