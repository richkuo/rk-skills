import { describe, expect, test } from 'bun:test'

const root = new URL('../', import.meta.url)
const read = (path) => Bun.file(new URL(path, root)).text()

const CONTRACT_COPIES = [
  'skills/pr-review-format/SKILL.md',
  'templates/claude-workflow/prompts/pr-review-format.md',
  'templates/claude-review.yml',
]

const texts = Object.fromEntries(
  await Promise.all(CONTRACT_COPIES.map(async (path) => [path, await read(path)])),
)
const normalized = Object.fromEntries(
  Object.entries(texts).map(([path, source]) => [path, source.replace(/\s+/g, ' ')]),
)

describe('PR review contract', () => {
  test('keeps the verification method in every review contract copy', () => {
    for (const path of CONTRACT_COPIES) {
      const source = normalized[path]
      expect(source, path).toMatch(/PR body.{0,80}hypothesis/i)
      expect(source, path).toMatch(/read every changed file in full/i)
      expect(source, path).toMatch(/primary source/i)
      expect(source, path).toMatch(/files? that instruct an agent.{0,80}executable/is)
    }
  })

  test('keeps inaccessible primary sources non-blocking unless safety applies', () => {
    for (const path of CONTRACT_COPIES) {
      const source = normalized[path]
      expect(source, path).toMatch(
        /primary source is unavailable[\s\S]{0,300}Recommended Optional/i,
      )
      expect(source, path).toMatch(
        /source unavailability alone does not fail the LGTM precondition/i,
      )
      expect(source, path).toMatch(/safety carve-out still blocks/i)
    }
  })

  test('preserves a reachable bare-LGTM clean verdict and static CI policy', () => {
    for (const path of CONTRACT_COPIES) {
      const source = normalized[path]
      expect(source, path).toMatch(/bare `?LGTM`?.{0,120}asserts/is)
      expect(source, path).toMatch(/do not gate the verdict on CI status/i)
      expect(source, path).not.toMatch(/LGTM precondition:[^\n]*check CI status first/i)
    }
  })

  test('the GitHub Actions review route selects the guarded standalone prompt', async () => {
    const workflow = await read('.github/workflows/claude-run.yml')
    expect(workflow).toContain('PROMPT_FILE=$PROMPTS_DIR/pr-review-format.md')
  })
})
