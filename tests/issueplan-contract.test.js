import { describe, expect, test } from 'bun:test'

const root = new URL('../', import.meta.url)
const read = (path) => Bun.file(new URL(path, root)).text()

const [issueplan, readme] = await Promise.all([
  read('skills/issueplan/SKILL.md'),
  read('README.md'),
])

describe('issueplan contract', () => {
  test('plans and builds with the current LLM in one session', () => {
    expect(issueplan).toMatch(/current large language model.*same session/is)
    expect(issueplan).toContain('Keep the same session and current LLM for planning and building.')
    expect(issueplan).toContain('Use no subagent at any point.')
    expect(issueplan).toMatch(/Do not call the Agent tool, Task tool, workflow delegation/is)
    expect(issueplan).not.toContain('subagent_type')
    expect(issueplan).not.toContain('model: fable')
  })

  test('keeps the issue plan and build flow', () => {
    expect(issueplan).toContain('gh issue view <N> --json number,title,body,url')
    expect(issueplan).toContain('Save the plan to a temporary scratchpad immediately.')
    expect(issueplan).toContain('Check the plan against the code')
    expect(issueplan).toContain('gh issue comment <N> --body-file <tmpfile>')
    expect(issueplan).toContain('Ask whether to continue building or stop after the posted plan.')
    expect(issueplan).toContain('Create an isolated git worktree')
    expect(issueplan).toContain('Build from the plan')
  })

  test('attributes the plan to the active session', () => {
    expect(issueplan).toContain('Created with LLM: <current session model> | <current session effort> | Harness: issueplan')
    expect(issueplan).toContain('Never infer unavailable attribution values.')
  })

  test('is documented in the skill catalog', () => {
    expect(readme).toContain('| `issueplan` |')
    expect(readme).toMatch(/issueplan.*current session/is)
  })
})
