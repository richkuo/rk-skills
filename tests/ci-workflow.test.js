import { describe, expect, test } from 'bun:test'

const workflowUrl = new URL('../.github/workflows/test.yml', import.meta.url)
const readWorkflow = () => Bun.file(workflowUrl).text()

describe('Bun test workflow contract', () => {
  test('runs for pull request revisions and pushes to main', async () => {
    const workflow = await readWorkflow()

    expect(workflow).toMatch(/on:\n  pull_request:\n    types: \[opened, reopened, synchronize\]\n  push:\n    branches: \[main\]/)
  })

  test('uses read-only permissions and the event-default checkout', async () => {
    const workflow = await readWorkflow()

    expect(workflow).toContain('permissions:\n  contents: read')
    expect(workflow).toContain('uses: actions/checkout@v4')
    expect(workflow).not.toMatch(/^\s+ref:/m)
    expect(workflow).not.toMatch(/:\s*write$/m)
  })

  test('pins Bun and runs the repository test command', async () => {
    const workflow = await readWorkflow()

    expect(workflow).toContain('uses: oven-sh/setup-bun@v2')
    expect(workflow).toContain('bun-version: 1.3.14')
    expect(workflow).toContain('run: bun run test')
  })

  test('cancels only superseded runs for the same workflow ref', async () => {
    const workflow = await readWorkflow()

    expect(workflow).toContain('group: ${{ github.workflow }}-${{ github.ref }}')
    expect(workflow).toContain('cancel-in-progress: true')
  })
})
