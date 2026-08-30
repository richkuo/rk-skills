import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = new URL('../', import.meta.url)
const inventory = await Bun.file(new URL('docs/contract-inventory.md', root)).text()

const REPO_PATH = /`((?:skills|templates|workflows|docs|tests|\.github)\/[\w./-]+?|CLAUDE\.md|AGENTS\.md|README\.md)(?::\d+)?`/g

describe('contract inventory', () => {
  test('every guard cell names a test file that exists', () => {
    const guards = [...new Set([...inventory.matchAll(/tests\/[\w-]+\.test\.js/g)].map((m) => m[0]))]
    expect(guards.length).toBeGreaterThan(0)
    for (const guard of guards) {
      expect(existsSync(fileURLToPath(new URL(guard, root))), `${guard} no longer exists`).toBe(true)
    }
  })

  test('every repository path the inventory names exists', () => {
    const paths = [...new Set([...inventory.matchAll(REPO_PATH)].map((m) => m[1]))]
    expect(paths.length).toBeGreaterThan(20)
    for (const path of paths) {
      expect(existsSync(fileURLToPath(new URL(path, root))), `${path} no longer exists`).toBe(true)
    }
  })
})
