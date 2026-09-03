import { describe, expect, test } from 'bun:test'

const root = new URL('../', import.meta.url)
const read = (path) => Bun.file(new URL(path, root)).text()

const region = (text, start, end) => {
  const a = text.indexOf(start)
  const b = text.indexOf(end, a + start.length)
  expect(a).toBeGreaterThan(-1)
  expect(b).toBeGreaterThan(a)
  return text.slice(a, b)
}

describe('merge re-review rule after a bare LGTM', () => {
  test('fix-pr-review step 7 owns the rule and keys it on the hand-resolved set', async () => {
    const skill = await read('skills/fix-pr-review/SKILL.md')
    const step7 = region(skill, '### 7. Resolve merge conflicts', '### 8. Commit and push')
    expect(step7).toContain('**Merge re-review rule.**')
    expect(step7).toMatch(/hand-resolved set/)
    expect(step7).toMatch(/auto-merged are base-branch work and do not count/)
    expect(step7).toMatch(/\*\*decide whether it changes behavior\*\*/)
    expect(step7).toMatch(/\*\*Prose only\*\*[^\n]*post no trigger/)
    expect(step7).toMatch(/\*\*Behavior changed, or any doubt\*\*[^\n]*`SKILL\.md`[^\n]*`@claude sonnet review`[^\n]*consuming no rung/)
    expect(step7).toMatch(/file extension is evidence and never the answer/)
    expect(step7).toMatch(/Record the decision, the hand-resolved set, and the reason under `### Resolved merge conflicts`/)
  })

  test('step 1 sends a bare-LGTM conflict through steps 7 to 9 and step 10 defers to the rule', async () => {
    const skill = await read('skills/fix-pr-review/SKILL.md')
    const step1 = region(skill, '### 1. Fetch all unaddressed review feedback', '### 2. Fetch failing CI checks')
    expect(step1).toMatch(/bare-LGTM PR still runs steps 7 through 9/)
    expect(step1).toMatch(/merge re-review rule decides whether step 10 posts a trigger/)
    const step10 = region(skill, '### 10. Trigger the re-review', '### 11. Report to the user')
    expect(step10).toMatch(/bare-LGTM run that only merged the base routes by step 7/)
    expect(step10).toMatch(/cheap shorthand when step 7 decided the hand-resolved diff changes behavior or was in doubt, no trigger when it decided prose only/)
  })

  test('rereview-routing restates the rule without granting a rung', async () => {
    const routing = await read('skills/fix-pr-review/rereview-routing.md')
    const row = region(routing, '**Bare LGTM, merge only**', '**Blocking** →')
    expect(row).toMatch(/cheap shorthand when step 7 decided the hand-resolved diff changes behavior or was in doubt, consuming no rung/)
    expect(row).toMatch(/\*\*no trigger\*\* when step 7 decided it is prose only/)
  })

  test('milestone-workflow makes the same behavior decision and names the loop skills', async () => {
    const ms = await read('skills/milestone-workflow/SKILL.md')
    expect(ms).toMatch(/\*\*Conflict re-review decision\*\*[^\n]*decide whether it changes behavior/)
    expect(ms).toMatch(/A behavior change, or any doubt[^\n]*`SKILL\.md`[^\n]*`@claude sonnet review`/)
    expect(ms).toMatch(/`fix-pr-review` step 7 and `fix-pr-review-loop` step 4 make the same decision/)
  })

  test('fix-pr-review-loop handles a cycle that posted no trigger', async () => {
    const loop = await read('skills/fix-pr-review-loop/SKILL.md')
    const step4 = region(loop, '### 4. Resolve the review and loop', '### 5. Report')
    expect(step4).toMatch(/\*\*Merge re-review rule\*\* \(the same decision as `milestone-workflow` step 5 sub-step 3\)/)
    expect(step4).toMatch(/Prose only keeps the LGTM and posts no trigger/)
    expect(step4).toMatch(/a behavior change, or any doubt, means it posted `@claude sonnet review`/)
    expect(step4).toMatch(/`MERGEABLE` → the prior LGTM stands, go to step 5 as a clean pass/)
    expect(step4).toMatch(/`UNKNOWN` is GitHub recomputing after the push: wait/)
    expect(step4).toMatch(/`CONFLICTING`\/`DIRTY` → a new base conflict, go to step 4 again/)
    expect(step4).toMatch(/Only a genuine conflict re-enters fix-pr-review/)
  })
})
