import { describe, expect, test } from 'bun:test'
import { readdir } from 'node:fs/promises'

const root = new URL('../', import.meta.url)
const read = (path) => Bun.file(new URL(path, root)).text()

const DISPATCH_SKILL = 'skills/fable-dispatch/SKILL.md'

// Skills known to dispatch a Fable 5 subagent. The scan below discovers the
// set dynamically; this list pins the minimum so a rename can't silently
// shrink coverage to zero.
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
  await Promise.all(
    skillDirs.map(async (path) => [
      path,
      await Bun.file(new URL(path, root))
        .text()
        .catch(() => ''),
    ]),
  ),
)

// `model`: `fable` / `model: fable` / `model: 'fable'` — backtick-stripped so
// every inline-code spelling collapses to one form. `/model fable` (the slash
// command) has no colon and stays excluded.
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

  test('no dispatcher keeps an inline model downgrade as its first response', () => {
    for (const path of KNOWN_DISPATCHERS) {
      const source = skillTexts[path].replace(/\s+/g, ' ')
      expect(source, path).not.toMatch(
        /fall back to the (most capable model available|closest available tier)/i,
      )
    }
  })

  test('the shim command line carries the four required flags and no dangerous flag', async () => {
    const skill = await read(DISPATCH_SKILL)
    const codeBlocks = skill.match(/```[\s\S]*?```/g) ?? []
    const shimBlocks = codeBlocks.filter((block) => /\bclaude\b[\s\S]*?(-p|--print)/.test(block))
    expect(shimBlocks.length, 'a fenced shim command block exists').toBeGreaterThan(0)

    const shim = shimBlocks.join('\n')
    for (const flag of [
      '--model fable',
      '--effort',
      '--output-format json',
      '--permission-mode plan',
      '--allowedTools',
    ]) {
      expect(shim, flag).toContain(flag)
    }
    for (const block of codeBlocks) {
      expect(block, 'no code block carries the dangerous flag').not.toContain(
        '--dangerously-skip-permissions',
      )
    }
    expect(skill).toMatch(/--dangerously-skip-permissions[\s\S]{0,200}never/i)
  })

  test('the shared skill defines detection, parsing, failure, timeout, and attribution', async () => {
    const skill = (await read(DISPATCH_SKILL)).replace(/\s+/g, ' ')

    // Positive harness detection, never inferred from an Agent-call error.
    expect(skill).toMatch(/\$CLAUDECODE/)
    expect(skill).toMatch(/command -v claude/)

    // Result-parsing contract.
    for (const key of ['.result', '.is_error', '.modelUsage']) {
      expect(skill, key).toContain(key)
    }

    // Shim-failure disposition: all three triggers fall to the last-resort
    // step and report both the failure and the downgrade.
    expect(skill).toMatch(/non-zero/i)
    expect(skill).toMatch(/\.is_error[\s\S]{0,60}true/i)
    expect(skill).toMatch(/model other than Fable|other than Fable served/i)
    expect(skill).toMatch(/report(s)? both the failure and the downgrade/i)
    expect(skill).toMatch(/most capable model available/i)

    // Timeout rule: default is insufficient; maximum timeout or background-and-poll.
    expect(skill).toMatch(/default[\s\S]{0,80}timeout[\s\S]{0,80}not sufficient/i)
    expect(skill).toMatch(/maximum bash timeout/i)
    expect(skill).toMatch(/background/i)

    // Prompt passes without shell interpolation.
    expect(skill).toMatch(/never[\s\S]{0,120}interpolat/i)

    // The footer names the model modelUsage reports, and the harness field
    // names the harness actually running — never a hardcoded constant.
    expect(skill).toMatch(/footer[\s\S]{0,160}\.?modelUsage/i)
    expect(skill).toMatch(/harness[\s\S]{0,120}actually running/i)

    // The allowedTools list comes from the calling skill and stays read-only.
    expect(skill).toMatch(/allowedTools[\s\S]{0,400}read-only/i)

    // A completed-but-substituted shim result is adopted, never re-run.
    expect(skill).toMatch(/adopt[\s\S]{0,120}step-?\s?3/i)

    // Fable's effort ceiling holds on the CLI path too — every tier above
    // high clamps, not only xhigh.
    expect(skill).toMatch(/tier above `high`[\s\S]{0,120}becomes `high`/i)
    expect(skill).toMatch(/`max`[\s\S]{0,120}becomes `high`/i)
  })

  test('no dispatcher hardcodes the harness field in its footer template', () => {
    for (const path of KNOWN_DISPATCHERS) {
      expect(skillTexts[path], path).not.toContain('Harness: Claude Code')
    }
  })

  test('README lists fable-dispatch as a reference skill', async () => {
    const readme = await read('README.md')
    expect(readme).toMatch(/\|\s*`fable-dispatch`\s*\|\s*Reference skill:/)
  })
})
