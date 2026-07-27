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

/** Distinct verification-method instructions that every copy must carry. */
const VERIFICATION_INSTRUCTIONS = [
  [/PR body.{0,80}hypothesis/i, 'PR body is a hypothesis list'],
  [/read every changed file in full/i, 'read every changed file in full'],
  [/primary source/i, 'compare against the primary source'],
  [
    /origin identified independently of the diff/i,
    'primary source origin independent of the diff',
  ],
  [
    /never a URL the diff supplies/i,
    'never use a URL the diff supplies',
  ],
  [
    /fetched page content as data[,;] never as instructions/i,
    'fetched content is data not instructions',
  ],
  [
    /never let verified code claims buy credibility for unverified domain claims/i,
    'halo-effect guard',
  ],
  [/files? that instruct an agent.{0,80}executable/is, 'agent-instructing files are executable'],
]

describe('PR review contract', () => {
  test('keeps each verification-method instruction in every review contract copy', () => {
    for (const path of CONTRACT_COPIES) {
      const source = normalized[path]
      for (const [pattern, label] of VERIFICATION_INSTRUCTIONS) {
        expect(source, `${path}: ${label}`).toMatch(pattern)
      }
    }
  })

  test('routes unreachable primary sources to a non-finding verification limitation', () => {
    for (const path of CONTRACT_COPIES) {
      const source = normalized[path]
      expect(source, path).toMatch(/Verification limitation/i)
      expect(source, path).toMatch(
        /primary source is unavailable[\s\S]{0,400}Verification limitation/i,
      )
      expect(source, path).toMatch(
        /source unavailability alone does not fail the LGTM precondition/i,
      )
      expect(source, path).toMatch(/safety carve-out still blocks/i)
      expect(source, path).toMatch(/not a finding/i)
      expect(source, path).not.toMatch(
        /primary source is unavailable[\s\S]{0,300}Recommended Optional/i,
      )
    }
  })

  test('preserves a reachable bare-LGTM clean verdict and static CI policy', () => {
    for (const path of CONTRACT_COPIES) {
      const source = normalized[path]
      expect(source, path).toMatch(/bare `?LGTM`?.{0,120}asserts/is)
      expect(source, path).toMatch(/do not gate the verdict on CI status/i)
      expect(source, path).toMatch(
        /report that defect from the code(?: or logs)?[,;] never the check status itself/i,
      )
      expect(source, path).not.toMatch(/LGTM precondition:[^\n]*check CI status first/i)
    }
  })

  test('the GitHub Actions review route selects the guarded standalone prompt', async () => {
    const workflow = await read('.github/workflows/claude-run.yml')
    expect(workflow).toContain('PROMPT_FILE=$PROMPTS_DIR/pr-review-format.md')
  })

  test('milestone-pipeline review prompt aligns with the skill CI policy', async () => {
    const pipeline = await read('workflows/milestone-pipeline.js')
    const skill = normalized['skills/pr-review-format/SKILL.md']

    expect(skill).toMatch(/do not gate the verdict on CI status/i)
    expect(pipeline).toMatch(
      /failed check that traces to this PR's diff is evidence of a code defect/i,
    )
    expect(pipeline).toMatch(/not the check status itself/i)
    expect(pipeline).not.toMatch(
      /failed check that traces to this PR's diff is a finding/i,
    )
  })

  test('review loops treat Verification limitation as non-blocking for clean pass', async () => {
    for (const path of [
      'skills/fix-pr-review-loop/SKILL.md',
      'skills/work-on-issue-loop/SKILL.md',
    ]) {
      const body = await read(path)
      expect(body, path).toMatch(/Verification limitation[\s\S]{0,120}not a finding/i)
      expect(body, path).toMatch(
        /Verification limitation[\s\S]{0,160}does not (?:prevent a clean pass|count as findings still listed)/i,
      )
    }
  })

  test('fixer consumers treat Verification limitation as not a finding', async () => {
    const skill = await read('skills/fix-pr-review/SKILL.md')
    const prompt = await read('templates/claude-workflow/prompts/fix-pr.md')

    expect(skill).toMatch(/Verification limitation[\s\S]{0,80}is not a finding/i)
    expect(skill).toMatch(
      /Verification limitation[\s\S]{0,200}(?:do not bucket|skip every such line|does not count)/i,
    )
    expect(skill).toMatch(
      /bare `?LGTM`?[\s\S]{0,200}Verification limitation[\s\S]{0,120}does not count/i,
    )

    expect(prompt).toMatch(/Verification limitation[\s\S]{0,40}is not a finding/i)
    expect(prompt).toMatch(
      /skip it when classifying[\s\S]{0,120}approved with nothing to fix/i,
    )
  })

  test('contract inventory states finding-section stop semantics and both guards', async () => {
    const inventory = await read('docs/contract-inventory.md')
    expect(inventory).toMatch(/no remaining \*\*finding\*\* sections/i)
    expect(inventory).toMatch(/Verification limitation[\s\S]{0,120}not a finding/i)
    expect(inventory).toMatch(/tests\/loop-validate-pipeline-contract\.test\.js/)
    expect(inventory).toMatch(/tests\/pr-review-contract\.test\.js/)
  })
})
