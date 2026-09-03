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
    expect(step7).toMatch(/\*\*docs-only\*\*[^\n]*prose documentation[^\n]*none of them is agent instruction[^\n]*post no trigger/)
    expect(step7).toMatch(/\*\*Executable Markdown is code\*\*[^\n]*`SKILL\.md`[^\n]*`CLAUDE\.md`[^\n]*`AGENTS\.md`[^\n]*`\.claude\/`[^\n]*`\.github\/`[^\n]*`skills\/`/)
    expect(step7).toMatch(/When a file's class is unclear, it is code/)
    expect(step7).toMatch(/\*\*anything else\*\*[^\n]*cheap shorthand, consuming no rung/)
  })

  test('step 1 sends a bare-LGTM conflict through steps 7 to 9 and step 10 defers to the rule', async () => {
    const skill = await read('skills/fix-pr-review/SKILL.md')
    const step1 = region(skill, '### 1. Fetch all unaddressed review feedback', '### 2. Fetch failing CI checks')
    expect(step1).toMatch(/bare-LGTM PR still runs steps 7 through 9/)
    expect(step1).toMatch(/merge re-review rule decides whether step 10 posts a trigger/)
    const step10 = region(skill, '### 10. Trigger the re-review', '### 11. Report to the user')
    expect(step10).toMatch(/bare-LGTM run that only merged the base routes by step 7/)
  })

  test('rereview-routing restates the rule without granting a rung', async () => {
    const routing = await read('skills/fix-pr-review/rereview-routing.md')
    const row = region(routing, '**Bare LGTM, merge only**', '**Blocking** →')
    expect(row).toMatch(/cheap shorthand when the hand-resolved set holds any non-docs file, consuming no rung/)
    expect(row).toMatch(/\*\*no trigger\*\* when every hand-resolved file is prose documentation[^\n]*none is agent instruction/)
    expect(row).toMatch(/executable Markdown \(`SKILL\.md`, `CLAUDE\.md`, `AGENTS\.md`/)
  })

  test('fix-pr-review-loop handles a cycle that posted no trigger', async () => {
    const loop = await read('skills/fix-pr-review-loop/SKILL.md')
    const step4 = region(loop, '### 4. Resolve the review and loop', '### 5. Report')
    expect(step4).toMatch(/posted no trigger because its step 7 merge re-review rule found a docs-only merge/)
    expect(step4).toMatch(/`MERGEABLE` → the prior LGTM stands, go to step 5 as a clean pass/)
    expect(step4).toMatch(/`UNKNOWN` is GitHub recomputing after the push: wait/)
    expect(step4).toMatch(/`CONFLICTING`\/`DIRTY` → a new base conflict, go to step 4 again/)
    expect(step4).toMatch(/Only a genuine conflict re-enters fix-pr-review/)
  })
})
