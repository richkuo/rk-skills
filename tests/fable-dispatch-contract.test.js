import { describe, expect, test } from 'bun:test'
import { readdir } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const read = (path) => Bun.file(new URL(path, root)).text()

const DISPATCH_SKILL = 'skills/fable-dispatch/SKILL.md'

const KNOWN_DISPATCHERS = [
  'skills/fableplan/SKILL.md',
  'skills/fable-validate/SKILL.md',
  'skills/fable-new-issue/SKILL.md',
  'skills/fable-advisor/SKILL.md',
  'skills/fable-orchestrate/SKILL.md',
]

const skillDirs = (await readdir(new URL('skills/', root), { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => `skills/${entry.name}/SKILL.md`)

const skillTexts = Object.fromEntries(
  await Promise.all(skillDirs.map(async (path) => [path, await Bun.file(new URL(path, root)).text()])),
)

const namesFableModel = (source) => /model:\s*'?fable'?/.test(source.replace(/`/g, ''))

describe('fable dispatch contract', () => {
  test('every skill dispatching model: fable references fable-dispatch', () => {
    const dispatchers = Object.entries(skillTexts)
      .filter(([, source]) => namesFableModel(source))
      .map(([path]) => path)

    for (const path of KNOWN_DISPATCHERS) {
      expect(dispatchers, `${path} should name model: fable`).toContain(path)
    }
    for (const path of dispatchers) {
      if (path === DISPATCH_SKILL) continue
      expect(skillTexts[path], path).toContain('fable-dispatch')
    }
  })

  test('the shim command line carries the read-only flags and no dangerous flag', async () => {
    const skill = await read(DISPATCH_SKILL)
    const codeBlocks = skill.match(/```[\s\S]*?```/g) ?? []
    const shimBlocks = codeBlocks.filter((block) => /\bclaude\b[\s\S]*?(-p|--print)/.test(block))
    expect(shimBlocks.length, 'a fenced shim command block exists').toBeGreaterThan(0)

    const shim = shimBlocks.join('\n')
    for (const flag of ['--model fable', '--effort', '--output-format json', '--permission-mode plan', '--allowedTools']) {
      expect(shim, flag).toContain(flag)
    }
    for (const block of codeBlocks) {
      expect(block, 'no code block carries the dangerous flag').not.toContain('--dangerously-skip-permissions')
    }
    const flat = skill.replace(/\s+/g, ' ')
    expect(flat).toMatch(/--dangerously-skip-permissions[\s\S]{0,200}never/i)
    expect(flat, 'a downgraded model is reported, never silently adopted').toMatch(/report(s)? both the failure and the downgrade/i)
    expect(flat, 'the prompt is passed as data').toMatch(/never[\s\S]{0,120}interpolat/i)
    expect(flat, 'the footer names the model that actually ran').toMatch(/footer[\s\S]{0,160}\.?modelUsage/i)
  })

  test('no fable-family skill hardcodes the harness field in a footer', () => {
    const fableSkills = Object.keys(skillTexts).filter((path) => path.startsWith('skills/fable'))
    for (const path of new Set([...KNOWN_DISPATCHERS, ...fableSkills])) {
      expect(skillTexts[path], path).not.toContain('Harness: Claude Code')
    }
  })
})
