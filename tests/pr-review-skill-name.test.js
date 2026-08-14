import { afterAll, describe, expect, test } from 'bun:test'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = new URL('../', import.meta.url)
const repoRoot = fileURLToPath(root)
const read = (path) => Bun.file(new URL(path, root)).text()
const skillsDir = new URL('skills/', root)

/** The review-contract skill's only name. */
const SKILL = 'pr-review'
/** The name it was renamed from. No skill may answer to it again. */
const RETIRED = 'pr-review-format'

/**
 * The GitHub Action review route keeps the old filename: `claude-run.yml`
 * injects the prompt with --append-system-prompt, and Action prompts cannot
 * contain quotes, backticks, or dollar signs, so that file is not a skill.
 */
const ACTION_PROMPT = `templates/claude-workflow/prompts/${RETIRED}.md`

const tempDirs = []
const makeTempDir = (prefix) => {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
})

/** Seed a destination that a pre-rename install would have left behind. */
function seedRetiredSkill(claudeDir, { asSymlink }) {
  const target = join(claudeDir, 'skills', RETIRED)
  mkdirSync(join(claudeDir, 'skills'), { recursive: true })
  if (asSymlink) {
    // What install.sh left: a link into the repo, dangling since the rename.
    symlinkSync(join(repoRoot, 'skills', RETIRED), target)
  } else {
    // What `bunx rk-skills` left: a real copy of the old skill.
    mkdirSync(target, { recursive: true })
    writeFileSync(join(target, 'SKILL.md'), `---\nname: ${RETIRED}\n---\n`)
  }
  return target
}

const stillThere = (path) => lstatSync(path, { throwIfNoEntry: false }) !== undefined

describe('PR review skill name', () => {
  test('ships the review contract as the pr-review skill', async () => {
    const skill = await read(`skills/${SKILL}/SKILL.md`)
    expect(skill.split('\n')[1]).toBe(`name: ${SKILL}`)
    expect(skill).toMatch(/verdict line/i)
  })

  test('leaves no skill answering to the retired name', () => {
    // A skill is addressed by its directory name and by its frontmatter name,
    // so an alias in either form would keep the retired contract loadable.
    expect(existsSync(new URL(RETIRED, skillsDir))).toBe(false)

    for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const manifest = new URL(`${entry.name}/SKILL.md`, skillsDir)
      if (!existsSync(manifest)) continue
      expect(Bun.file(manifest).text()).resolves.not.toMatch(
        new RegExp(`^name:\\s*${RETIRED}\\s*$`, 'm'),
      )
    }
  })

  test('points every skill-name load site at pr-review', async () => {
    const loadSites = [
      'CLAUDE.md',
      'AGENTS.md',
      'README.md',
      'skills/milestone-workflow/SKILL.md',
      'workflows/milestone-pipeline.js',
    ]
    // fix-pr-review is a different skill whose name contains both of these as a
    // substring, so every match is anchored to exclude that prefix.
    const names = (name) => new RegExp(`(?<!fix-)\\b${name}\\b`)
    for (const path of loadSites) {
      const body = await read(path)
      expect(body, path).toMatch(names(SKILL))
      expect(body, path).not.toMatch(names(RETIRED))
    }
  })

  test('keeps the Action review route on its own prompt filename', async () => {
    expect(existsSync(new URL(ACTION_PROMPT, root))).toBe(true)
    const workflow = await read('.github/workflows/claude-run.yml')
    expect(workflow).toContain(`PROMPT_FILE=$PROMPTS_DIR/${RETIRED}.md`)
  })

  test('bin/install.mjs deletes a leftover retired skill from the destination', () => {
    for (const asSymlink of [false, true]) {
      const project = makeTempDir('rk-skills-mjs-')
      const leftover = seedRetiredSkill(join(project, '.claude'), { asSymlink })

      const run = Bun.spawnSync([process.execPath, join(repoRoot, 'bin/install.mjs'), '--project'], {
        cwd: project,
      })

      expect(run.exitCode, run.stderr.toString()).toBe(0)
      expect(stillThere(leftover), `symlink: ${asSymlink}`).toBe(false)
      expect(existsSync(join(project, '.claude/skills', SKILL, 'SKILL.md'))).toBe(true)
    }
  })

  test('install.sh deletes a leftover retired skill from the destination', () => {
    for (const asSymlink of [false, true]) {
      const home = makeTempDir('rk-skills-sh-')
      const leftover = seedRetiredSkill(join(home, '.claude'), { asSymlink })

      const run = Bun.spawnSync(['bash', join(repoRoot, 'install.sh')], {
        env: { ...process.env, HOME: home },
      })

      expect(run.exitCode, run.stderr.toString()).toBe(0)
      expect(stillThere(leftover), `symlink: ${asSymlink}`).toBe(false)
      expect(existsSync(join(home, '.claude/skills', SKILL, 'SKILL.md'))).toBe(true)
    }
  })

  test('neither installer deletes a name the repo still ships', () => {
    const project = makeTempDir('rk-skills-guard-')
    const claudeDir = join(project, '.claude')
    const kept = join(claudeDir, 'skills', SKILL)
    mkdirSync(kept, { recursive: true })
    writeFileSync(join(kept, 'SKILL.md'), `---\nname: ${SKILL}\n---\n`)

    const run = Bun.spawnSync([process.execPath, join(repoRoot, 'bin/install.mjs'), '--project'], {
      cwd: project,
    })

    expect(run.exitCode, run.stderr.toString()).toBe(0)
    expect(existsSync(join(kept, 'SKILL.md'))).toBe(true)
    expect(run.stdout.toString()).not.toContain('Removed')
  })
})
