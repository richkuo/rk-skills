import { describe, expect, test } from 'bun:test'

const workflowUrl = new URL('../.github/workflows/test.yml', import.meta.url)
const readWorkflow = () => Bun.file(workflowUrl).text()

function topLevelBlock(source, key) {
  const lines = source.split('\n')
  const start = lines.findIndex((line) => line.startsWith(`${key}:`))
  if (start === -1) return null

  let end = start + 1
  while (end < lines.length && (lines[end] === '' || /^\s/.test(lines[end]))) end += 1
  return lines.slice(start, end).join('\n').trimEnd()
}

describe('Bun test workflow contract', () => {
  test('runs for pull request revisions and pushes to main', async () => {
    const workflow = await readWorkflow()

    const on = topLevelBlock(workflow, 'on')
    expect(on).toBeTruthy()
    expect(on).toMatch(/^  pull_request:/m)
    expect(on).toMatch(/types:[\s\S]{0,80}synchronize/)
    expect(on).toMatch(/^  push:/m)
    expect(on).toMatch(/branches:[\s\S]{0,40}\bmain\b/)
  })

  test('uses read-only permissions and the event-default checkout', async () => {
    const workflow = await readWorkflow()

    const grants = topLevelBlock(workflow, 'permissions').split('\n').slice(1).map((line) => line.replace(/#.*$/, '').trim()).filter(Boolean)
    expect(grants).toEqual(['contents: read'])
    expect(workflow).toMatch(/uses: actions\/checkout@[0-9a-f]{40} # \S+/m)
    expect(workflow).not.toMatch(/^\s+ref:/m)
  })

  test('pins Bun and runs the repository test command', async () => {
    const workflow = await readWorkflow()

    expect(workflow).toMatch(/uses: oven-sh\/setup-bun@[0-9a-f]{40} # \S+/m)
    expect(workflow).toMatch(/bun-version: \d+\.\d+\.\d+$/m)
    expect(workflow).toContain('run: bun run test')
  })

  test('gates both bot bundles routing suites', async () => {
    const workflow = await readWorkflow()

    expect(workflow).toContain(
      "run: python3 -m unittest discover -s templates/claude-workflow/scripts -p 'test_*.py'",
    )
    expect(workflow).toContain(
      "run: python3 -m unittest discover -s templates/codex-workflow/scripts -p 'test_*.py'",
    )
  })

  test('bounds hung test runs', async () => {
    const workflow = await readWorkflow()

    expect(workflow).toMatch(/timeout-minutes: \d+/)
  })

  test('cancels only superseded runs for the same workflow ref', async () => {
    const workflow = await readWorkflow()

    expect(workflow).toContain('group: ${{ github.workflow }}-${{ github.ref }}')
    expect(workflow).toContain('cancel-in-progress: true')
  })
})
