import { describe, expect, test } from 'bun:test'
import { readdir } from 'node:fs/promises'

const promptsDir = new URL('../templates/claude-workflow/prompts/', import.meta.url)

// claude-run.yml composes these prompts into claude_args, which is
// shell-evaluated: a double quote breaks the --append-system-prompt "..."
// quoting, and a backtick or dollar sign would expand or execute. It rejects
// any prompt containing '["`$]' at runtime — this test catches the same
// violation at PR time instead of the next time someone triggers a run.
describe('shared prompt shell safety', () => {
  test('no shared prompt file contains a double quote, backtick, or dollar sign', async () => {
    const files = (await readdir(promptsDir)).filter((name) => name.endsWith('.md'))
    expect(files.length).toBeGreaterThan(0)

    for (const name of files) {
      const text = await Bun.file(new URL(name, promptsDir)).text()
      const offenders = [...text.matchAll(/["`$]/g)]
      expect(offenders, `${name} contains forbidden character(s): ${offenders.map((m) => m[0]).join(', ')}`).toHaveLength(0)
    }
  })
})
