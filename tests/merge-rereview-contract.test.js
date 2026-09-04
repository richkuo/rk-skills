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

const BEHAVIOR = /changes behavior|behavior change|decides by behavior/i
const PROSE_ONLY = /prose[- ]only/i
const CHEAP_TRIGGER = /@claude sonnet review|cheap shorthand/
const FILE_CLASS = /`\.md`-only|docs-only|non-docs file|never covers hand-resolved code,/

describe('merge re-review rule after a bare LGTM', () => {
  const restatements = [
    ['skills/fix-pr-review/SKILL.md', '### 7. Resolve merge conflicts', '### 8. Commit and push'],
    ['skills/fix-pr-review/SKILL.md', '### 10. Trigger the re-review', '### 11. Report to the user'],
    ['skills/fix-pr-review/rereview-routing.md', '**Bare LGTM, merge only**', '**Blocking** →'],
    ['skills/fix-pr-review-loop/SKILL.md', '### 4. Resolve the review and loop', '### 5. Report'],
    ['skills/milestone-workflow/SKILL.md', '**Conflict re-review decision**', '\n'],
    ['README.md', 'a remaining PR that conflicts after a merge', 'then resumes'],
  ]

  for (const [path, start, end] of restatements) {
    test(`${path} keys the rule on behavior at "${start}"`, async () => {
      const text = region(await read(path), start, end)
      expect(text).toMatch(BEHAVIOR)
      expect(text).toMatch(PROSE_ONLY)
      expect(text).toMatch(CHEAP_TRIGGER)
      expect(text).not.toMatch(FILE_CLASS)
    })
  }

  test('fix-pr-review step 7 records the hand-resolved set and excludes auto-merged files', async () => {
    const step7 = region(await read('skills/fix-pr-review/SKILL.md'), '### 7. Resolve merge conflicts', '### 8. Commit and push')
    expect(step7).toMatch(/hand-resolved set/)
    expect(step7).toMatch(/auto-merged/)
    expect(step7).toMatch(/`### Resolved merge conflicts`/)
  })

  test('fix-pr-review-loop step 4 waits on UNKNOWN, re-enters only on a conflict, and counts only posted triggers', async () => {
    const step4 = region(await read('skills/fix-pr-review-loop/SKILL.md'), '### 4. Resolve the review and loop', '### 5. Report')
    expect(step4).toMatch(/`UNKNOWN`[^\n]*wait/)
    expect(step4).toMatch(/`MERGEABLE`[^\n]*clean pass/)
    expect(step4).toMatch(/`CONFLICTING`\/`DIRTY`[^\n]*step 4/)
    expect(step4).toMatch(/posted a trigger, increment `review_count`/)
    expect(step4).toMatch(/posted no trigger increments nothing/)
  })
})
