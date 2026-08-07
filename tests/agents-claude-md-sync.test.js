import { describe, expect, test } from 'bun:test'

const root = new URL('../', import.meta.url)
const read = (path) => Bun.file(new URL(path, root)).text()

// AGENTS.md is the Codex-harness rendition of CLAUDE.md. The two files must be
// line-for-line identical except for these harness substitutions. Any other
// difference is drift: a rule landed in one file and not the other.
const SUBSTITUTIONS = [
  { from: 'CLAUDE.md', to: 'AGENTS.md' },
  { from: 'Claude Code', to: 'Codex' },
  { from: '`cc/issue-', to: '`codex/issue-' },
]

const applyCombo = (line, combo) =>
  combo.reduce((acc, { from, to }) => acc.replaceAll(from, to), line)

// Every subset of SUBSTITUTIONS, so each differing line may use any mix of them.
const combos = SUBSTITUTIONS.reduce(
  (acc, sub) => acc.concat(acc.map((combo) => [...combo, sub])),
  [[]],
).filter((combo) => combo.length > 0)

const [claudeLines, agentsLines] = await Promise.all([
  read('CLAUDE.md').then((t) => t.split('\n')),
  read('AGENTS.md').then((t) => t.split('\n')),
])

describe('AGENTS.md stays in sync with CLAUDE.md', () => {
  test('same line count', () => {
    expect(agentsLines.length).toBe(claudeLines.length)
  })

  test('every line is identical or an allowed harness substitution', () => {
    const drifted = []
    claudeLines.forEach((claudeLine, i) => {
      const agentsLine = agentsLines[i]
      if (agentsLine === undefined || claudeLine === agentsLine) return
      const explained = combos.some(
        (combo) => applyCombo(claudeLine, combo) === agentsLine,
      )
      if (!explained) {
        drifted.push(
          `line ${i + 1}:\n  CLAUDE.md: ${claudeLine}\n  AGENTS.md: ${agentsLine}`,
        )
      }
    })
    expect(drifted).toEqual([])
  })
})
