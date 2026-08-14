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

  test('never destroys a backup an earlier run wrote', () => {
    const home = makeHome()
    mkdirSync(join(home, '.codex'), { recursive: true })
    writeFileSync(join(home, '.codex/AGENTS.md'), 'first notes\n')

    expect(runInstall(home).exitCode).toBe(0)

    // A second run finds a fresh real file at the same target. The first run's
    // backup must survive it, so the new one takes the next free name. Unlink
    // before writing: the target is now a symlink into the repo, and writing
    // through it would edit the repo's own AGENTS.md.
    rmSync(join(home, '.codex/AGENTS.md'))
    writeFileSync(join(home, '.codex/AGENTS.md'), 'second notes\n')

    expect(runInstall(home).exitCode).toBe(0)

    expect(readFileSync(join(home, '.codex/AGENTS.md.bak'), 'utf8')).toBe('first notes\n')
    expect(readFileSync(join(home, '.codex/AGENTS.md.bak.2'), 'utf8')).toBe('second notes\n')
    expect(lstatSync(join(home, '.codex/AGENTS.md')).isSymbolicLink()).toBe(true)
  })

  test('does not nest a directory backup inside an existing directory backup', () => {
    const home = makeHome()
    const skill = shippedSkills[0]
    const target = join(home, '.codex/skills', skill)
    mkdirSync(target, { recursive: true })
    writeFileSync(join(target, 'SKILL.md'), 'current copy\n')
    // `mv dir dir.bak` moves dir *into* dir.bak when the backup is a directory,
    // which buries the earlier backup instead of replacing it.
    mkdirSync(`${target}.bak`, { recursive: true })
    writeFileSync(join(`${target}.bak`, 'SKILL.md'), 'earlier backup\n')

    const run = runInstall(home)

    expect(run.exitCode, run.stderr.toString()).toBe(0)
    expect(readFileSync(join(`${target}.bak`, 'SKILL.md'), 'utf8')).toBe('earlier backup\n')
    expect(existsSync(join(`${target}.bak`, skill))).toBe(false)
    expect(readFileSync(join(`${target}.bak.2`, 'SKILL.md'), 'utf8')).toBe('current copy\n')
    expect(lstatSync(target).isSymbolicLink()).toBe(true)
  })

  test('keeps the file unlinked rather than clobber a backup when every name is taken', () => {
    const home = makeHome()
    mkdirSync(join(home, '.codex'), { recursive: true })
    const target = join(home, '.codex/AGENTS.md')
    writeFileSync(target, 'live notes\n')
    // install.sh tries .bak, then .bak.2 through .bak.99.
    writeFileSync(`${target}.bak`, 'backup 1\n')
    for (let n = 2; n <= 99; n++) writeFileSync(`${target}.bak.${n}`, `backup ${n}\n`)

    const run = runInstall(home)

    expect(run.exitCode, run.stderr.toString()).toBe(0)
    // Refusing to link loses nothing; clobbering a backup loses a file.
    expect(readFileSync(target, 'utf8')).toBe('live notes\n')
    expect(readFileSync(`${target}.bak`, 'utf8')).toBe('backup 1\n')
    expect(readFileSync(`${target}.bak.99`, 'utf8')).toBe('backup 99\n')
    expect(existsSync(`${target}.bak.100`)).toBe(false)
    expect(run.stdout.toString()).toContain('not linked')
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
