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

const MIRROR_POINTERS = [
  'skills/fableplan/SKILL.md',
  'skills/issueplan/SKILL.md',
  'skills/fable-advisor/SKILL.md',
]

const INVENTORY = 'docs/contract-inventory.md'

function procedureBody(markdown) {
  const match = markdown.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/)
  return match ? match[1] : markdown
}

const texts = Object.fromEntries(
  await Promise.all(
    [...new Set([...PRODUCERS, MIRROR_OWNER, ...MIRROR_POINTERS, INVENTORY])].map(
      async (path) => [path, await read(path)],
    ),
  ),
)

describe('numbered plan steps with verify points', () => {
  test('every plan producer asks for numbered steps and a per-step verify point', () => {
    for (const path of PRODUCERS) {
      const body = procedureBody(texts[path])
      expect(body, `${path}: numbering instruction`).toMatch(
        /[Nn]umber(?:ed)?\s+the\s+implementation\s+steps|implementation\s+steps\s+numbered/,
      )

      expect(body, `${path}: numbering shape`).toMatch(/`?1\.`?,\s*`?2\.`?/)
      expect(body, `${path}: verify point`).toMatch(/verify point/i)
      expect(body, `${path}: verify point is an observable check`).toMatch(
        /verify point[\s\S]{0,160}observable check[\s\S]{0,120}proves the step is done/i,
      )
    }
  })

  test('work-on-issue owns the mirror rule for a plan of any length', () => {
    const body = procedureBody(texts[MIRROR_OWNER])
    expect(body, `${MIRROR_OWNER}: mirror rule`).toMatch(
      /Mirror the plan's steps into the task tracker/,
    )
    // Trigger scope: every adopted plan, not only a long one.
    expect(body, `${MIRROR_OWNER}: any-length trigger`).toMatch(
      /Before writing any code[\s\S]{0,200}every[\s\S]{0,60}adopted plan[\s\S]{0,80}regardless of length/i,
    )
    expect(body, `${MIRROR_OWNER}: completion keys on the verify point`).toMatch(
      /complete only when its verify point passes/i,
    )
    // Fallback 1 — the trigger fires on EITHER element missing, not only both.
    // A numbered plan with no per-step checks must still get checks derived,
    // because the same bullet forbids an item with no verify point.
    expect(body, `${MIRROR_OWNER}: fallback trigger covers either element`).toMatch(
      /missing its numbers, its verify points, or both/i,
    )
    expect(body, `${MIRROR_OWNER}: either absence alone triggers the fallback`).toMatch(
      /[Ee]ither element missing on its own triggers this fallback/,
    )
    expect(body, `${MIRROR_OWNER}: derive whichever element is missing`).toMatch(
      /derive whichever element is missing[\s\S]{0,400}missing both gets \*\*both\*\* derived/i,
    )
    // The superseded AND-only trigger must not come back.
    expect(body, `${MIRROR_OWNER}: fallback not scoped to both-missing`).not.toMatch(
      /plan carries no numbers or verify points/i,
    )
    expect(body, `${MIRROR_OWNER}: no item without a verify point`).toMatch(
      /never leave an item with no verify point/i,
    )
    // Fallback 2 — no tracker in the harness still has a compliant action.
    expect(body, `${MIRROR_OWNER}: no-tracker fallback`).toMatch(
      /harness exposes no task tracker[\s\S]{0,400}scratchpad file/i,
    )
    // Fallback 2 must keep the checklist out of the commit.
    expect(body, `${MIRROR_OWNER}: scratchpad stays unstaged`).toMatch(
      /outside the repository working tree/i,
    )
  })

  test('an overridden plan step has a reachable terminal state', () => {
    const body = procedureBody(texts[MIRROR_OWNER])
    expect(body, `${MIRROR_OWNER}: overridden-step disposition`).toMatch(
      /overridden step closes as a recorded deviation/i,
    )
    // The deviation carries its own check and reaches the PR body.
    expect(body, `${MIRROR_OWNER}: deviation carries a verify point`).toMatch(
      /deviation carrying its own verify point/i,
    )
    expect(body, `${MIRROR_OWNER}: deviation reaches the PR body`).toMatch(
      /overridden step closes as a recorded deviation[\s\S]{0,900}PR body per step 6/i,
    )
    // No tracker rule may push the builder to build an overridden step.
    expect(body, `${MIRROR_OWNER}: no pressure to build an overridden step`).toMatch(
      /justifies building a step the traced code, a newer issue comment, or safety has overridden/i,
    )
  })

  test('an item that borrowed a later step\'s verify point re-homes when that step is overridden', () => {
    const body = procedureBody(texts[MIRROR_OWNER])

    expect(body, `${MIRROR_OWNER}: every borrower re-homes`).toMatch(
      /every[\s\S]{0,60}borrowed it[\s\S]{0,40}re-homes/i,
    )

    expect(body, `${MIRROR_OWNER}: borrowed check follows a replacement`).toMatch(
      /re-homes[\s\S]{0,200}replacement step's verify point/i,
    )
    // With no replacement the borrower still terminates: own check, else a deviation.
    expect(body, `${MIRROR_OWNER}: borrower terminates without a replacement`).toMatch(
      /own observable check[\s\S]{0,200}closes? as a recorded deviation of its own/i,
    )
    // No borrower is left waiting on a check that can never run.
    expect(body, `${MIRROR_OWNER}: no borrower left unreachable`).toMatch(
      /never left waiting on a check that can never run/i,
    )
    // The trigger is the cross-reference, not how it arose: a compliant plan may
    // author a verify point that keys on a later step, and the mirroring agent
    // copies it verbatim, so the derived-check fallback never fires.
    expect(body, `${MIRROR_OWNER}: re-homing is origin-agnostic`).toMatch(
      /derived by the mirroring agent[\s\S]{0,80}or written by the plan's own author/i,
    )
    expect(body, `${MIRROR_OWNER}: re-homing not scoped to the derived fallback`).not.toMatch(
      /adopted a later step's check \*\*under the first fallback above\*\*/i,
    )
    // Chains resolve: overriding step 8 must reach step 3, which borrowed step 5,
    // which borrowed step 8 — not only the direct borrower.
    expect(body, `${MIRROR_OWNER}: re-homing cascades through chains`).toMatch(
      /[Rr]e-homing cascades[\s\S]{0,400}repeats until no open item keys on a check that cannot run/i,
    )
    // The fallback's forward pointer must name the re-homing paragraph, not the

    expect(body, `${MIRROR_OWNER}: fallback points at the re-homing rule`).toMatch(
      /the borrowed check re-homes[\s\S]{0,120}A borrowed verify point re-homes when its source step is overridden/,
    )
    expect(body, `${MIRROR_OWNER}: pointer distinguishes the two dispositions`).toMatch(
      /overridden-step disposition[\s\S]{0,120}governs the \*cancelled step's own\* item, not its borrowers/i,
    )
  })

  test('the guardrail table signals that a borrowing item cannot simply close', () => {
    const body = procedureBody(texts[MIRROR_OWNER])
    const row = body
      .split('\n')
      .find((line) => line.startsWith('|') && /verify point keys on a later step/i.test(line))
    expect(row, `${MIRROR_OWNER}: borrowing guardrail row present`).toBeDefined()
    expect(row, `${MIRROR_OWNER}: borrowing row names re-homing`).toMatch(/[Rr]e-home/)
    expect(row, `${MIRROR_OWNER}: borrowing row is origin-agnostic`).toMatch(
      /whether the mirroring agent derived the cross-reference or the plan's author wrote it/i,
    )
    expect(row, `${MIRROR_OWNER}: borrowing row forbids a bare close`).toMatch(
      /never close it as done and never leave it waiting/i,
    )
  })

  test('the guardrail row states the same trigger scope as step 2', () => {
    const body = procedureBody(texts[MIRROR_OWNER])
    const row = body
      .split('\n')
      .find((line) => line.startsWith('|') && /Adopted plan/.test(line) && /task tracker/.test(line))
    expect(row, `${MIRROR_OWNER}: guardrail row present`).toBeDefined()

    expect(row, `${MIRROR_OWNER}: guardrail row not narrowed to long plans`).not.toMatch(
      /long or many-part/i,
    )
    expect(row, `${MIRROR_OWNER}: guardrail row any-length trigger`).toMatch(/any length/i)
    expect(row, `${MIRROR_OWNER}: guardrail row names the verify point`).toMatch(/verify point/i)
  })

  test('build paths outside work-on-issue step 2 point at the owner', () => {
    for (const path of MIRROR_POINTERS) {
      const body = procedureBody(texts[path])
      expect(body, `${path}: points at work-on-issue step 2`).toMatch(
        /(?:[Mm]irror|copy)[\s\S]{0,200}`work-on-issue` step 2/,
      )
      expect(body, `${path}: mirrors before writing code`).toMatch(
        /[Bb]efore (?:writing any code|you write any code)[\s\S]{0,240}`work-on-issue` step 2/,
      )
    }
  })

  test('every producer posts its plan under the heading work-on-issue step 0 matches', () => {

    for (const path of PRODUCERS) {
      const body = procedureBody(texts[path])
      expect(body, `${path}: plan-comment heading`).toMatch(/## Implementation plan \(/)
    }
    const owner = procedureBody(texts[MIRROR_OWNER])
    expect(owner, `${MIRROR_OWNER}: step 0 matches on the heading`).toMatch(
      /comment starting with `## Implementation plan`/,
    )
  })

  test('fableplan planning-phase-only mode still forbids the build step', () => {

    const body = procedureBody(texts['skills/fableplan/SKILL.md'])
    expect(body, 'fableplan: planning-only forbids steps 7-8').toMatch(
      /Do NOT execute steps 7–8/,
    )
  })

  test('the contract inventory records the rule, its owner, and this guard', () => {
    const inventory = texts[INVENTORY]
    expect(inventory).toMatch(/[Nn]umbered plan steps/)
    expect(inventory).toContain('tests/plan-steps-contract.test.js')
    for (const path of PRODUCERS) {
      expect(inventory, `${path}: inventory consumer row`).toContain(
        path.replace(/^skills\/|\/SKILL\.md$/g, ''),
      )
    }
    expect(inventory).toContain('work-on-issue')
  })
})
