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
  [
    /do not resolve ambiguity in the artifact's favor/i,
    'no charitable reading of the artifact',
  ],
  [
    /this predates the PR.{0,120}not reasons to drop or downgrade a finding/is,
    'pre-existing is not a dismissal reason',
  ],
  [
    /state what you verified and how/i,
    'state what you verified and how',
  ],
  [
    /compare wording verbatim/i,
    'compare wording verbatim',
  ],
  [
    /paraphrase that silently drops a qualifier is a finding/i,
    'dropped qualifier is a finding',
  ],
  [
    /no network or fetch tool[\s\S]{0,80}immediately/i,
    'no-network routes emit limitation immediately',
  ],
  [
    /LGTM-precondition gap[\s\S]{0,120}(?:Before you write|verification method)/i,
    'LGTM-precondition gap covers the full verification method',
  ],
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
      expect(source, path).toMatch(/Unreachable primary source/i)
      expect(source, path).toMatch(
        /terminal human escalation|human escalation/i,
      )
      expect(source, path).toMatch(/not a finding/i)
      expect(source, path).not.toMatch(
        /primary source is unavailable[\s\S]{0,300}Recommended Optional/i,
      )
    }
  })

  test('keeps the same safety carve-out scope in every review contract copy', () => {
    for (const path of CONTRACT_COPIES) {
      const source = normalized[path]
      expect(source, path).toMatch(/Safety carve-out/i)
      expect(source, path).toMatch(/\bmoney\b/i)
      expect(source, path).toMatch(/data integrity/i)
      expect(source, path).toMatch(/\bsecurity\b/i)
      expect(source, path).toMatch(/authentication and credentials/i)
      expect(source, path).toMatch(/auto-protective mechanism/i)
      expect(source, path).not.toMatch(
        /Better Auth|MMKV|SecureStore|never-persist-absolute-paths|stop-loss|position or fill/i,
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
      expect(source, path).not.toMatch(/could not review the full diff/i)
      expect(source, path).not.toMatch(/LGTM precondition:[^\n]*check CI status first/i)
    }
  })

  test('the GitHub Actions review route selects the guarded standalone prompt', async () => {
    const workflow = await read('.github/workflows/claude-run.yml')
    expect(workflow).toContain('PROMPT_FILE=$PROMPTS_DIR/pr-review-format.md')
    // Shared default must not grant WebFetch (untrusted PR content, cross-repo @main).
    const reviewAllowed = workflow.match(
      /PROMPT_FILE=\$PROMPTS_DIR\/pr-review-format\.md[\s\S]{0,1500}?ALLOWED='([^']+)'/,
    )
    expect(reviewAllowed, 'review-route ALLOWED').not.toBeNull()
    expect(reviewAllowed[1]).not.toMatch(/WebFetch/)
    expect(workflow).toMatch(/extra_allowed_tools/)
    // This repo opts in on the review job caller; the vendored template does not.
    const caller = await read('.github/workflows/claude.yml')
    expect(caller).toMatch(
      /mode: review[\s\S]{0,400}extra_allowed_tools:\s*WebFetch/,
    )
    const template = await read('templates/claude-workflow/workflows/claude.yml')
    expect(template).not.toMatch(
      /^\s*extra_allowed_tools:\s*WebFetch\s*$/m,
    )
    expect(template).toMatch(/# extra_allowed_tools: WebFetch/)
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
      expect(body, path).toMatch(/Unreachable primary source/i)
      expect(body, path).toMatch(
        /Unreachable-source human escalation|terminal human escalation/i,
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
      /treat LGTM plus only such lines as approved with nothing to fix/i,
    )
    expect(prompt).toMatch(
      /LGTM plus zero or more Verification limitation[\s\S]{0,500}triggering comment carried no extra instructions[\s\S]{0,400}STOP/i,
    )
    expect(prompt).toMatch(
      /check mergeability; if CONFLICTING or DIRTY go to Phase 5 without posting the short approval comment/i,
    )
    expect(prompt).toMatch(
      /already approved with nothing to fix/i,
    )
    expect(prompt).toMatch(
      /do not post a disposition comment and do not trigger a re-review/i,
    )
  })

  test('terminal reports propagate Verification limitation lines to the operator', async () => {
    for (const path of [
      'skills/fix-pr-review/SKILL.md',
      'skills/fix-pr-review-loop/SKILL.md',
      'skills/work-on-issue-loop/SKILL.md',
      'templates/claude-workflow/prompts/fix-pr.md',
    ]) {
      const body = await read(path)
      expect(body, path).toMatch(
        /Verification limitation[\s\S]{0,500}(?:name each|naming each|naming every|unverified source)/i,
      )
      expect(body, path).toMatch(
        /omit (?:that |the )?field when none|omit when none|when present[\s\S]{0,80}when not/i,
      )
    }

    for (const path of [
      'skills/fix-pr-review-loop/SKILL.md',
      'skills/work-on-issue-loop/SKILL.md',
    ]) {
      const body = await read(path)
      expect(body, path).toMatch(
        /name each unverified source[\s\S]{0,160}outside the word cap/i,
      )
    }

    const pipeline = await read('workflows/milestone-pipeline.js')
    expect(pipeline).toMatch(/verification_limitations/)
    expect(pipeline).toMatch(
      /Verification limitation[\s\S]{0,160}empty array when none/i,
    )
    expect(pipeline).toMatch(/verification limitations:/i)
    // Both review modes must request and fold the field — slice each schema /
    // function body so a later fallback object or sibling prompt cannot satisfy.
    const sliceConst = (name) => {
      const start = pipeline.indexOf(`const ${name}`)
      expect(start, name).toBeGreaterThan(-1)
      const after = pipeline.slice(start + `const ${name}`.length)
      const next = after.search(/\nconst |\nfunction /)
      return next === -1 ? after : after.slice(0, next)
    }
    expect(sliceConst('SUBAGENT_REVIEW_SCHEMA')).toMatch(/verification_limitations/)
    expect(sliceConst('REVIEW_LOOP_SCHEMA')).toMatch(/verification_limitations/)
    const reviewLoopStart = pipeline.indexOf('function reviewLoopPrompt')
    expect(reviewLoopStart).toBeGreaterThan(-1)
    const afterReviewLoop = pipeline.slice(
      reviewLoopStart + 'function reviewLoopPrompt'.length,
    )
    const nextFn = afterReviewLoop.search(/\nfunction /)
    const reviewLoopBody =
      nextFn === -1 ? afterReviewLoop : afterReviewLoop.slice(0, nextFn)
    expect(reviewLoopBody).toMatch(
      /verification_limitations \(array of exact \*\*Verification limitation:\*\*/,
    )
    expect(pipeline).toMatch(
      /githubLimitations\.length && !String\(review\.summary/,
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
