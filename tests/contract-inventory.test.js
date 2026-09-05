import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = new URL('../', import.meta.url)
const inventory = await Bun.file(new URL('docs/contract-inventory.md', root)).text()

const MAX_BYTES = 16_000

const REPO_PATH = /`((?:skills|templates|workflows|docs|tests|\.github)\/[\w./-]+?|CLAUDE\.md|AGENTS\.md|README\.md)(?::\d+)?`/g

describe('contract inventory', () => {
  test(`the inventory stays under ${MAX_BYTES} bytes`, () => {
    expect(Buffer.byteLength(inventory, 'utf8'), 'docs/contract-inventory.md grew past the cap; compress it').toBeLessThan(MAX_BYTES)
  })

  test('every repository path and guard test the inventory names exists', () => {
    const paths = [...new Set([...inventory.matchAll(REPO_PATH)].map((m) => m[1]))]
    expect(paths.length).toBeGreaterThan(20)
    expect(paths.filter((path) => /^tests\/.*\.test\.js$/.test(path)).length, 'guard tests are named').toBeGreaterThan(0)
    for (const path of paths) {
      expect(existsSync(fileURLToPath(new URL(path, root))), `${path} no longer exists`).toBe(true)
    }
  })
})
