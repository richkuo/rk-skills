import { describe, expect, test } from 'bun:test'
import { readdir } from 'node:fs/promises'

const PROMPT_DIRS = [
  'templates/claude-workflow/prompts/',
  'templates/codex-workflow/prompts/',
]

// claude-run.yml composes its prompts into claude_args, which is
// shell-evaluated: a double quote breaks the --append-system-prompt "..."
// quoting, and a backtick or dollar sign would expand or execute. It rejects
// any prompt containing '["`$]' at runtime — this test catches the same
// violation at PR time instead of the next time someone triggers a run.
//
// codex-run.yml writes its prompt to a file and passes prompt-file, so nothing
// is shell-evaluated there. The Codex prompts are held to the identical rule
// anyway: the two bundles share one prompt-authoring rule, and either bundle's
// prompt must stay droppable into the other's override slot.
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
