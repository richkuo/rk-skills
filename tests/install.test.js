import { afterAll, describe, expect, test } from 'bun:test'
import {
  cpSync,
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

const SKILL = 'pr-review'
const RETIRED = 'pr-review-format'

const tempDirs = []
const makeTempDir = (prefix = 'rk-skills-') => {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
})

const runInstall = (home, script = join(repoRoot, 'install.sh')) =>
  Bun.spawnSync(['bash', script], { env: { ...process.env, HOME: home } })
const runMjs = (project, script = join(repoRoot, 'bin/install.mjs')) =>
  Bun.spawnSync([process.execPath, script, '--project'], { cwd: project })

const shippedSkills = readdirSync(join(repoRoot, 'skills'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)

const stillThere = (path) => lstatSync(path, { throwIfNoEntry: false }) !== undefined

function seedRetiredSkill(claudeDir, { asSymlink }) {
  const target = join(claudeDir, 'skills', RETIRED)
  mkdirSync(join(claudeDir, 'skills'), { recursive: true })
  if (asSymlink) {
    symlinkSync(join(repoRoot, 'skills', RETIRED), target)
  } else {
    mkdirSync(target, { recursive: true })
    writeFileSync(join(target, 'SKILL.md'), `---\nname: ${RETIRED}\n---\n`)
  }
  return target
}

function stageRepo() {
  const repo = makeTempDir('rk-skills-repo-')
  mkdirSync(join(repo, 'bin'), { recursive: true })
  cpSync(join(repoRoot, 'bin/install.mjs'), join(repo, 'bin/install.mjs'))
  cpSync(join(repoRoot, 'install.sh'), join(repo, 'install.sh'))
  for (const name of [SKILL, RETIRED]) {
    mkdirSync(join(repo, 'skills', name), { recursive: true })
    writeFileSync(join(repo, 'skills', name, 'SKILL.md'), `---\nname: ${name}\n---\n`)
  }
  return repo
}

describe('install.sh Codex links', () => {
  test('links every shipped skill into ~/.codex/skills when Codex is set up', () => {
    const home = makeTempDir()
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
    const home = makeTempDir()
    mkdirSync(join(home, '.codex'), { recursive: true })

    expect(runInstall(home).exitCode).toBe(0)

    const target = join(home, '.codex/AGENTS.md')
    expect(lstatSync(target).isSymbolicLink()).toBe(true)
    expect(readlinkSync(target)).toBe(join(repoRoot, 'AGENTS.md'))
  })

  test('backs up a real ~/.codex/AGENTS.md instead of discarding it', () => {
    const home = makeTempDir()
    mkdirSync(join(home, '.codex'), { recursive: true })
    writeFileSync(join(home, '.codex/AGENTS.md'), 'hand-written codex notes\n')

    expect(runInstall(home).exitCode).toBe(0)

    expect(readFileSync(join(home, '.codex/AGENTS.md.bak'), 'utf8')).toBe('hand-written codex notes\n')
    expect(lstatSync(join(home, '.codex/AGENTS.md')).isSymbolicLink()).toBe(true)
  })

  test('never destroys a backup an earlier run wrote', () => {
    const home = makeTempDir()
    mkdirSync(join(home, '.codex'), { recursive: true })
    writeFileSync(join(home, '.codex/AGENTS.md'), 'first notes\n')

    expect(runInstall(home).exitCode).toBe(0)

    rmSync(join(home, '.codex/AGENTS.md'))
    writeFileSync(join(home, '.codex/AGENTS.md'), 'second notes\n')

    expect(runInstall(home).exitCode).toBe(0)

    expect(readFileSync(join(home, '.codex/AGENTS.md.bak'), 'utf8')).toBe('first notes\n')
    expect(readFileSync(join(home, '.codex/AGENTS.md.bak.2'), 'utf8')).toBe('second notes\n')
    expect(lstatSync(join(home, '.codex/AGENTS.md')).isSymbolicLink()).toBe(true)
  })

  test('does not nest a directory backup inside an existing directory backup', () => {
    const home = makeTempDir()
    const skill = shippedSkills[0]
    const target = join(home, '.codex/skills', skill)
    mkdirSync(target, { recursive: true })
    writeFileSync(join(target, 'SKILL.md'), 'current copy\n')
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
    const home = makeTempDir()
    mkdirSync(join(home, '.codex'), { recursive: true })
    const target = join(home, '.codex/AGENTS.md')
    writeFileSync(target, 'live notes\n')
    writeFileSync(`${target}.bak`, 'backup 1\n')
    for (let n = 2; n <= 99; n++) writeFileSync(`${target}.bak.${n}`, `backup ${n}\n`)

    const run = runInstall(home)

    expect(run.exitCode, run.stderr.toString()).toBe(0)
    expect(readFileSync(target, 'utf8')).toBe('live notes\n')
    expect(readFileSync(`${target}.bak`, 'utf8')).toBe('backup 1\n')
    expect(readFileSync(`${target}.bak.99`, 'utf8')).toBe('backup 99\n')
    expect(existsSync(`${target}.bak.100`)).toBe(false)
    expect(run.stdout.toString()).toContain('not linked')
  })

  test('retires the renamed skill in ~/.codex/skills too', () => {
    const home = makeTempDir()
    const target = join(home, '.codex/skills', RETIRED)
    mkdirSync(join(home, '.codex/skills'), { recursive: true })
    symlinkSync(join(repoRoot, 'skills', RETIRED), target)

    const run = runInstall(home)

    expect(run.exitCode, run.stderr.toString()).toBe(0)
    expect(stillThere(target)).toBe(false)
    expect(stillThere(`${target}.bak`)).toBe(false)
  })

  test('creates nothing under ~/.codex when Codex is not set up', () => {
    const home = makeTempDir()

    const run = runInstall(home)

    expect(run.exitCode, run.stderr.toString()).toBe(0)
    expect(existsSync(join(home, '.codex'))).toBe(false)
    expect(existsSync(join(home, '.claude/CLAUDE.md'))).toBe(true)
  })

  test('keeps workflows and the /commit command out of ~/.codex', () => {
    const home = makeTempDir()
    mkdirSync(join(home, '.codex'), { recursive: true })

    expect(runInstall(home).exitCode).toBe(0)

    expect(existsSync(join(home, '.codex/workflows'))).toBe(false)
    expect(existsSync(join(home, '.codex/commands'))).toBe(false)
    expect(existsSync(join(home, '.claude/commands/commit.md'))).toBe(true)
  })
})

describe('retired skill cleanup', () => {
  test('bin/install.mjs retires a leftover retired skill from the destination', () => {
    for (const asSymlink of [false, true]) {
      const project = makeTempDir('rk-skills-mjs-')
      const leftover = seedRetiredSkill(join(project, '.claude'), { asSymlink })

      const run = runMjs(project)

      expect(run.exitCode, run.stderr.toString()).toBe(0)
      expect(stillThere(leftover), `symlink: ${asSymlink}`).toBe(false)
      if (asSymlink) {
        expect(stillThere(`${leftover}.bak`)).toBe(false)
      } else {
        expect(readFileSync(join(`${leftover}.bak`, 'SKILL.md'), 'utf8')).toContain(`name: ${RETIRED}`)
      }
      expect(existsSync(join(project, '.claude/skills', SKILL, 'SKILL.md'))).toBe(true)
    }
  })

  test('install.sh retires a leftover retired skill from the destination', () => {
    for (const asSymlink of [false, true]) {
      const home = makeTempDir('rk-skills-sh-')
      const leftover = seedRetiredSkill(join(home, '.claude'), { asSymlink })

      const run = runInstall(home)

      expect(run.exitCode, run.stderr.toString()).toBe(0)
      expect(stillThere(leftover), `symlink: ${asSymlink}`).toBe(false)
      if (asSymlink) {
        expect(stillThere(`${leftover}.bak`)).toBe(false)
      } else {
        expect(readFileSync(join(`${leftover}.bak`, 'SKILL.md'), 'utf8')).toContain(`name: ${RETIRED}`)
      }
      expect(existsSync(join(home, '.claude/skills', SKILL, 'SKILL.md'))).toBe(true)
    }
  })

  test('neither installer overwrites an existing backup or deletes the original', () => {
    const installers = [
      { name: 'bin/install.mjs', run: (base) => runMjs(base) },
      { name: 'install.sh', run: (base) => runInstall(base) },
    ]
    for (const installer of installers) {
      const base = makeTempDir('rk-skills-bak-')
      const leftover = seedRetiredSkill(join(base, '.claude'), { asSymlink: false })
      const backup = join(base, '.claude/skills', `${RETIRED}.bak`)
      writeFileSync(backup, 'earlier backup\n')

      const run = installer.run(base)

      expect(run.exitCode, run.stderr.toString()).toBe(0)
      expect(stillThere(leftover), installer.name).toBe(true)
      expect(readFileSync(backup, 'utf8'), installer.name).toBe('earlier backup\n')
    }
  })

  test('neither installer retires a name the repo ships', () => {
    const mjsRepo = stageRepo()
    const project = makeTempDir('rk-skills-guard-mjs-')
    seedRetiredSkill(join(project, '.claude'), { asSymlink: false })

    const mjsRun = runMjs(project, join(mjsRepo, 'bin/install.mjs'))

    expect(mjsRun.exitCode, mjsRun.stderr.toString()).toBe(0)
    expect(existsSync(join(project, '.claude/skills', RETIRED, 'SKILL.md'))).toBe(true)
    expect(stillThere(join(project, '.claude/skills', `${RETIRED}.bak`))).toBe(false)

    const shRepo = stageRepo()
    const home = makeTempDir('rk-skills-guard-sh-')

    const shRun = runInstall(home, join(shRepo, 'install.sh'))

    expect(shRun.exitCode, shRun.stderr.toString()).toBe(0)
    expect(lstatSync(join(home, '.claude/skills', RETIRED)).isSymbolicLink()).toBe(true)
    expect(readFileSync(join(home, '.claude/skills', RETIRED, 'SKILL.md'), 'utf8')).toContain(`name: ${RETIRED}`)
  })
})
