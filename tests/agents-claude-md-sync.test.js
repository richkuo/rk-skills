import { describe, expect, test } from 'bun:test'
import { lstatSync, readlinkSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = new URL('../', import.meta.url)
const read = (path) => Bun.file(new URL(path, root)).text()

// AGENTS.md is a symlink to CLAUDE.md, so the Codex-facing doc and the
// Claude-facing doc are one file and cannot drift apart. These tests guard the
// link itself: replacing it with a copy would let a rule land in one file and
// not the other again.
const agentsPath = fileURLToPath(new URL('AGENTS.md', root))

describe('AGENTS.md is a symlink to CLAUDE.md', () => {
  test('AGENTS.md is a symbolic link', () => {
    expect(lstatSync(agentsPath).isSymbolicLink()).toBe(true)
  })

  test('the link target is CLAUDE.md', () => {
    expect(readlinkSync(agentsPath)).toBe('CLAUDE.md')
  })

  test('reading AGENTS.md returns the CLAUDE.md content', async () => {
    const [claude, agents] = await Promise.all([
      read('CLAUDE.md'),
      read('AGENTS.md'),
    ])
    expect(agents).toBe(claude)
  })
})
