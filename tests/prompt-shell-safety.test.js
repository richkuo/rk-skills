import { describe, expect, test } from 'bun:test'
import { readdir } from 'node:fs/promises'

const PROMPT_DIRS = [
  'templates/claude-workflow/prompts/',
  'templates/codex-workflow/prompts/',
]

describe('shared prompt shell safety', () => {
  for (const dir of PROMPT_DIRS) {
    test(`no prompt file in ${dir} contains a double quote, backtick, or dollar sign`, async () => {
      const promptsDir = new URL(`../${dir}`, import.meta.url)
      const files = (await readdir(promptsDir)).filter((name) => name.endsWith('.md'))
      expect(files.length).toBeGreaterThan(0)

      for (const name of files) {
        const text = await Bun.file(new URL(name, promptsDir)).text()
        const offenders = [...text.matchAll(/["`$]/g)]
        expect(offenders, `${dir}${name} contains forbidden character(s): ${offenders.map((m) => m[0]).join(', ')}`).toHaveLength(0)
      }
    })
  }
})
