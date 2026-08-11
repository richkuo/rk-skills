import { describe, expect, test } from 'bun:test'
import { readdirSync } from 'node:fs'

const root = new URL('../', import.meta.url)
const read = (path) => Bun.file(new URL(path, root)).text()

const skillNames = readdirSync(new URL('skills/', root), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()

const skills = Object.fromEntries(
  await Promise.all(
    skillNames.map(async (name) => [name, await read(`skills/${name}/SKILL.md`)]),
  ),
)

// Each harness auto-discovers <home>/skills/<name>/SKILL.md from its own home
// directory. An installer that names only one of them silently leaves the other
// two harnesses without the skills.
const HARNESS_HOMES = ['.claude', '.codex', '.cursor']

// Skills that cannot run outside Claude Code, and why. Fable-model subagents and
// the Workflow tool have no Codex or Cursor equivalent, so invoking these there
// fails partway instead of at the door unless the file says so up front.
const CLAUDE_CODE_ONLY = [
  'fable-advisor',
  'fable-new-issue',
  'fable-new-issue-loop',
  'fable-orchestrate',
  'fable-validate',
  'fable-validate-fableplan',
  'fable-validate-fableplan-loop',
  'fable-validate-loop',
  'fableplan',
  'fableplan-loop',
  'fableplan-work-on-issue',
  'milestone-workflow',
  'validate-fableplan-loop',
]

describe('installers cover every harness', () => {
  test('bin/install.mjs targets all three harness homes', async () => {
    const source = await read('bin/install.mjs')
    for (const home of HARNESS_HOMES) {
      expect(source).toContain(`'${home}'`)
    }
  })

  test('install.sh links skills into all three harness homes', async () => {
    const source = await read('install.sh')
    for (const home of HARNESS_HOMES) {
      expect(source).toContain(`/${home}`)
    }
  })

  test('install.sh only removes symlinks that resolve into this repo', async () => {
    const source = await read('install.sh')
    // The prune step exists to clear duplicate discovery roots. It must stay
    // scoped to this repo's own links; a bare `rm` over the directory would
    // delete skills the user installed from somewhere else.
    expect(source).toContain('"$REPO"/skills/*) rm "$entry"')
  })
})

describe('skill frontmatter stays portable', () => {
  // Codex rejects unknown SKILL.md frontmatter keys outright. Keeping every
  // skill to name + description is what lets one folder serve all three agents.
  test('only name and description are declared', () => {
    const offenders = []
    for (const [name, text] of Object.entries(skills)) {
      const match = text.match(/^---\n([\s\S]*?)\n---/)
      if (!match) {
        offenders.push(`${name}: no frontmatter block`)
        continue
      }
      const keys = match[1]
        .split('\n')
        .filter((line) => /^[A-Za-z][\w-]*:/.test(line))
        .map((line) => line.split(':')[0])
      const unexpected = keys.filter((key) => !['name', 'description'].includes(key))
      if (unexpected.length > 0) offenders.push(`${name}: ${unexpected.join(', ')}`)
    }
    expect(offenders).toEqual([])
  })
})

// Only the commands agents copy matter here; surrounding prose legitimately
// names `.claude/` to say "do not write there".
const commandLines = (text) => {
  const lines = []
  let inFence = false
  for (const line of text.split('\n')) {
    if (line.trimStart().startsWith('```')) {
      inFence = !inFence
      continue
    }
    if (inFence) lines.push(line)
  }
  return lines
}

describe('worktree instructions respect harness boundaries', () => {
  const worktreeCommands = Object.entries(skills).flatMap(([name, text]) =>
    commandLines(text)
      .filter((line) => line.includes('git worktree add'))
      .map((line) => ({ name, line: line.trim() })),
  )

  test('at least one skill documents the hand-made worktree command', () => {
    expect(worktreeCommands.length).toBeGreaterThan(0)
  })

  test('no skill tells Cursor or Codex to write into .claude/', () => {
    const offenders = worktreeCommands
      .filter(({ line }) => line.includes('.claude/'))
      .map(({ name, line }) => `${name}: ${line}`)
    expect(offenders).toEqual([])
  })

  test('hand-made worktrees land under the harness-neutral .worktrees/', () => {
    const offenders = worktreeCommands
      .filter(({ line }) => !line.includes('.worktrees/'))
      .map(({ name, line }) => `${name}: ${line}`)
    expect(offenders).toEqual([])
  })

  test('EnterWorktree is never described as using the name verbatim', () => {
    // It normalises the name (observed: "/" becomes "+", branch gains a
    // "worktree-" prefix), so a skill that rebuilds the branch or path from the
    // name it passed will anchor later git commands at something that is not there.
    const offenders = []
    for (const [name, text] of Object.entries(skills)) {
      if (/uses it verbatim|use it verbatim|verbatim as the branch/.test(text)) {
        offenders.push(name)
      }
    }
    expect(offenders).toEqual([])
  })
})

describe('Claude Code only skills say so', () => {
  test.each(CLAUDE_CODE_ONLY)('%s carries a harness note', (name) => {
    expect(skills[name]).toContain('> **Harness:** Claude Code only')
  })

  test('no other skill claims to be Claude Code only', () => {
    const unexpected = Object.entries(skills)
      .filter(([name, text]) => text.includes('> **Harness:** Claude Code only') && !CLAUDE_CODE_ONLY.includes(name))
      .map(([name]) => name)
    expect(unexpected).toEqual([])
  })
})
