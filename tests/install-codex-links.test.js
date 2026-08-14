import { afterAll, describe, expect, test } from 'bun:test'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = new URL('../', import.meta.url)
const repoRoot = fileURLToPath(root)

/** The skill name install.sh retires wherever an older install left it. */
const RETIRED = 'pr-review-format'

const tempDirs = []
const makeHome = () => {
  const dir = mkdtempSync(join(tmpdir(), 'rk-skills-codex-'))
  tempDirs.push(dir)
  return dir
}
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
})

const runInstall = (home) => Bun.spawnSync(['bash', join(repoRoot, 'install.sh')], { env: { ...process.env, HOME: home } })

/** Every skill directory the repo ships — the set both destinations must carry. */
const shippedSkills = readdirSync(join(repoRoot, 'skills'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)

const stillThere = (path) => lstatSync(path, { throwIfNoEntry: false }) !== undefined

describe('install.sh Codex links', () => {
  test('links every shipped skill into ~/.codex/skills when Codex is set up', () => {
    const home = makeHome()
    mkdirSync(join(home, '.codex'), { recursive: true })

    const run = runInstall(home)

    expect(run.exitCode, run.stderr.toString()).toBe(0)
    expect(shippedSkills.length).toBeGreaterThan(0)
    for (const name of shippedSkills) {
      const target = join(home, '.codex/skills', name)
      expect(lstatSync(target).isSymbolicLink(), name).toBe(true)
      expect(readlinkSync(target), name).toBe(join(repoRoot, 'skills', name))
    }
  })

  test('links AGENTS.md as the Codex global instructions', () => {
    const home = makeHome()
    mkdirSync(join(home, '.codex'), { recursive: true })

    expect(runInstall(home).exitCode).toBe(0)

    const target = join(home, '.codex/AGENTS.md')
    expect(lstatSync(target).isSymbolicLink()).toBe(true)
    expect(readlinkSync(target)).toBe(join(repoRoot, 'AGENTS.md'))
  })

  test('backs up a real ~/.codex/AGENTS.md instead of discarding it', () => {
    const home = makeHome()
    mkdirSync(join(home, '.codex'), { recursive: true })
    writeFileSync(join(home, '.codex/AGENTS.md'), 'hand-written codex notes\n')

    expect(runInstall(home).exitCode).toBe(0)

    expect(readFileSync(join(home, '.codex/AGENTS.md.bak'), 'utf8')).toBe('hand-written codex notes\n')
    expect(lstatSync(join(home, '.codex/AGENTS.md')).isSymbolicLink()).toBe(true)
  })

  test('retires the renamed skill in ~/.codex/skills too', () => {
    const home = makeHome()
    const target = join(home, '.codex/skills', RETIRED)
    mkdirSync(join(home, '.codex/skills'), { recursive: true })
    // What an older hand-made Codex link left: a link into the repo, dangling
    // since the rename. existsSync reports a dangling link as absent, so the
    // retire step has to lstat it.
    symlinkSync(join(repoRoot, 'skills', RETIRED), target)

    const run = runInstall(home)

    expect(run.exitCode, run.stderr.toString()).toBe(0)
    expect(stillThere(target)).toBe(false)
    expect(stillThere(`${target}.bak`)).toBe(false)
  })

  test('creates nothing under ~/.codex when Codex is not set up', () => {
    const home = makeHome()

    const run = runInstall(home)

    expect(run.exitCode, run.stderr.toString()).toBe(0)
    expect(existsSync(join(home, '.codex'))).toBe(false)
    // The Claude destination is still installed in full.
    expect(existsSync(join(home, '.claude/CLAUDE.md'))).toBe(true)
  })

  test('keeps workflows and the /commit command out of ~/.codex', () => {
    const home = makeHome()
    mkdirSync(join(home, '.codex'), { recursive: true })

    expect(runInstall(home).exitCode).toBe(0)

    // Both are Claude Code formats; Codex has no reader for them.
    expect(existsSync(join(home, '.codex/workflows'))).toBe(false)
    expect(existsSync(join(home, '.codex/commands'))).toBe(false)
    expect(existsSync(join(home, '.claude/commands/commit.md'))).toBe(true)
  })
})
