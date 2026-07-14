import { describe, expect, test } from 'bun:test'

const workflowUrl = new URL('../.github/workflows/test.yml', import.meta.url)
const readWorkflow = () => Bun.file(workflowUrl).text()
const readOnlyPermissions = 'permissions:\n  contents: read'

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

    expect(workflow).toMatch(/on:\n  pull_request:\n    types: \[opened, reopened, synchronize\]\n  push:\n    branches: \[main\]/)
  })

  test('uses read-only permissions and the event-default checkout', async () => {
    const workflow = await readWorkflow()

    expect(topLevelBlock(workflow, 'permissions')).toBe(readOnlyPermissions)
    expect(workflow).toContain('uses: actions/checkout@v4')
    expect(workflow).not.toMatch(/^\s+ref:/m)
  })

  test('rejects every permission grant beyond contents read', async () => {
    const workflow = await readWorkflow()
    const unsafePermissions = [
      'permissions: write-all',
      'permissions:\n  contents: write-all',
      'permissions:\n  contents: read\n  packages: write # note',
      'permissions:\n  contents: read\n  packages: write   ',
    ]

    for (const permissions of unsafePermissions) {
      const mutated = workflow.replace(readOnlyPermissions, permissions)
      expect(topLevelBlock(mutated, 'permissions')).not.toBe(readOnlyPermissions)
    }
  })

  test('pins Bun and runs the repository test command', async () => {
    const workflow = await readWorkflow()

    expect(workflow).toContain('uses: oven-sh/setup-bun@v2')
    expect(workflow).toContain('bun-version: 1.3.14')
    expect(workflow).toContain('run: bun run test')
  })

  test('bounds hung test runs', async () => {
    const workflow = await readWorkflow()

    expect(workflow).toContain('timeout-minutes: 5')
  })

  test('cancels only superseded runs for the same workflow ref', async () => {
    const workflow = await readWorkflow()

    expect(workflow).toContain('group: ${{ github.workflow }}-${{ github.ref }}')
    expect(workflow).toContain('cancel-in-progress: true')
  })
})
