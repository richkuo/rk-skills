import { describe, expect, test } from 'bun:test'

const workflowUrl = new URL('../.github/workflows/test.yml', import.meta.url)
const readWorkflow = () => Bun.file(workflowUrl).text()

function topLevelBlock(source, key) {
  return blocksOf(source, key, 0)[0] ?? null
}

function blocksOf(source, key, onlyIndent = null) {
  const lines = source.split('\n')
  const blocks = []
  lines.forEach((line, start) => {
    const match = line.match(new RegExp(`^(\\s*)(?:-\\s+)?${key}:(.*)$`))
    if (!match || (onlyIndent !== null && match[1].length !== onlyIndent)) return
    const indent = match[1].length
    let end = start + 1
    while (end < lines.length && (lines[end].trim() === '' || lines[end].search(/\S/) > indent)) end += 1
    blocks.push(lines.slice(start, end).join('\n').trimEnd())
  })
  return blocks
}

function grantsOf(block) {
  const [head, ...rest] = block.split('\n')
  const inline = head.replace(/#.*$/, '').split(':').slice(1).join(':').trim()
  const nested = rest.map((line) => line.replace(/#.*$/, '').trim()).filter(Boolean)
  return inline ? [inline, ...nested] : nested
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

  test('every permissions block, top-level or job-level, grants contents read only, with the event-default checkout', async () => {
    const workflow = await readWorkflow()

    const blocks = blocksOf(workflow, 'permissions')
    expect(blocks.length, 'a top-level permissions block exists').toBeGreaterThan(0)
    expect(topLevelBlock(workflow, 'permissions')).toBeTruthy()
    for (const block of blocks) {
      expect(grantsOf(block), block).toEqual(['contents: read'])
    }
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
