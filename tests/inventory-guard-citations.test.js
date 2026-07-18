import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Keep docs from citing renamed/deleted Bun guard tests.
 * Inventory and READMEs list `tests/*.test.js` paths as the enforcement
 * surface — a dangling citation silently defeats the anti-drift theme.
 */

const rootDir = new URL('../', import.meta.url)
const rootPath = Bun.fileURLToPath(rootDir)
const read = (path) => Bun.file(new URL(path, rootDir)).text()

const sources = [
  'docs/contract-inventory.md',
  'README.md',
  'templates/claude-workflow/README.md',
]

/** Match backtick or bare references to repo-root Bun tests. */
const GUARD_PATH_RE = /(?:`|\b)(tests\/[A-Za-z0-9._/-]+\.test\.js)(?:`|\b)/g

function citedGuardPaths(markdown) {
  const found = new Set()
  for (const match of markdown.matchAll(GUARD_PATH_RE)) {
    found.add(match[1])
  }
  return [...found].sort()
}

describe('inventory guard path citations', () => {
  test('every tests/*.test.js path cited in inventory/READMEs exists on disk', async () => {
    const allCited = new Set()

    for (const source of sources) {
      const text = await read(source)
      const cited = citedGuardPaths(text)
      expect(cited.length, `${source} should cite at least one guard test`).toBeGreaterThan(0)
      for (const rel of cited) {
        allCited.add(rel)
        const abs = join(rootPath, rel)
        expect(existsSync(abs), `${source} cites missing guard ${rel}`).toBe(true)
      }
    }

    // Sanity: the new PR-review guard must be among citations once documented.
    expect([...allCited]).toContain('tests/pr-review-format-contract.test.js')
  })
})
