import { describe, expect, test } from 'bun:test'

const root = new URL('../', import.meta.url)
const read = (path) => Bun.file(new URL(path, root)).text()

const CONTRACT_COPIES = [
  'skills/pr-review/SKILL.md',
  'templates/claude-workflow/prompts/pr-review-format.md',
  'templates/claude-review.yml',
  'templates/codex-workflow/prompts/pr-review-format.md',
  'templates/codex-review.yml',
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
  [
    /sweep the full diff once per dimension/i,
    'sweep every review dimension before drafting',
  ],
  [
    /correctness and logic[\s\S]{0,500}security and input handling/i,
    'cover all six review dimensions',
  ],
  [
    /event-state matrix[\s\S]{0,500}same-object\/new-generation/i,
    'enumerate asynchronous states and stale identities',
  ],
  [
    /every sibling producer and consumer[\s\S]{0,160}inverse and compound transitions/i,
    'expand each finding through its bug class',
  ],
  [
    /counterfactual closure pass[\s\S]{0,300}zero material findings/i,
    'repeat from the beginning with drafted fixes applied',
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
      expect(source, path).toMatch(/not a finding/i)
      expect(source, path).toMatch(/safety carve-out still applies/i)
      // The blocking route is scoped to fetch-capable harnesses — a network-less
      // route must emit only the non-blocking line, or autonomous loops livelock.
      expect(source, path).toMatch(/reachable in principle but unavailable this run/i)
      expect(source, path).toMatch(/fixed property of the harness/i)
      expect(source, path).toMatch(
        /no network or fetch tool[\s\S]{0,250}never a blocking item/i,
      )
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
  })

  test('the Codex review route selects the same guarded prompt, read-only', async () => {
    const workflow = await read('.github/workflows/codex-run.yml')
    expect(workflow).toContain('PROMPT_FILE="$PROMPTS_DIR/pr-review-format.md"')
    // The read-only sandbox is what denies the review agent writes AND network;
    // the job token carries no push right either. Both must survive edits.
    expect(workflow).toMatch(
      /sandbox:\s*\$\{\{\s*inputs\.mode == 'review' && 'read-only'/,
    )
    expect(workflow).not.toMatch(/^\s*id-token:\s*write/m)
  })

  test('milestone-pipeline review prompt aligns with the skill CI policy', async () => {
    const pipeline = await read('workflows/milestone-pipeline.js')
    const skill = normalized['skills/pr-review/SKILL.md']

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

  test.each([
    'templates/claude-workflow/prompts/fix-pr.md',
    'templates/codex-workflow/prompts/fix-pr.md',
  ])('%s treats Verification limitation as not a finding', async (promptPath) => {
    const skill = await read('skills/fix-pr-review/SKILL.md')
    const prompt = await read(promptPath)

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
      'templates/codex-workflow/prompts/fix-pr.md',
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
  })

  test('the fix-pr-review core stays small and delegates complete procedures', async () => {
    const [skill, recipes, disposition, flags, routing] = await Promise.all([
      read('skills/fix-pr-review/SKILL.md'),
      read('skills/fix-pr-review/fetch-recipes.md'),
      read('skills/fix-pr-review/disposition-comment.md'),
      read('skills/fix-pr-review/red-flags-and-mistakes.md'),
      read('skills/fix-pr-review/rereview-routing.md'),
    ])

    expect(skill.split('\n').length - 1).toBeLessThan(200)
    for (const reference of [
      'fetch-recipes.md',
      'disposition-comment.md',
      'red-flags-and-mistakes.md',
      'rereview-routing.md',
    ]) {
      expect(skill, reference).toContain(`](${reference})`)
    }

    expect(recipes).toContain('reviewThreads(first:100)')
    expect(recipes).toContain('--log-failed')
    expect(recipes).toMatch(/`bucket: cancel`/)
    expect(disposition).toContain('Resolved judgment calls (was Requires Human Review)')
    expect(disposition).toContain('/replies')
    expect(flags).toContain('Red Flags — STOP')
    expect(flags).toContain('Common Mistakes')
    expect(flags).toContain('Blind-implementing the review')
    // Step 10's procedure moved wholesale into the routing reference: the band
    // table, the C81+ ladder and its floor, and the posting commands.
    expect(routing).toMatch(/C0.{0,4}C10/)
    expect(routing).toContain('@claude sonnet review')
    expect(routing).toContain('@claude opus review')
    expect(routing).toContain('@claude fable review effort:high')
    expect(routing).toMatch(/never steps down to sonnet/i)
    expect(routing).toContain('@codex luna review')
  })

  test('fix-pr-review step-label consumers use surviving whole-number labels', async () => {
    const consumers = [
      ['skills/fix-pr-review-loop/SKILL.md', ['1', '3', '5', '7', '10']],
      ['skills/work-on-issue-loop/SKILL.md', ['1', '3', '5', '10']],
      ['workflows/milestone-pipeline.js', ['10']],
    ]
    for (const [path, labels] of consumers) {
      const body = await read(path)
      expect(body, path).not.toMatch(
        /fix-pr-review[^\n]{0,500}step(?:s|-)?\s*(?:1\.5|3\.5|4\.5)/i,
      )
      for (const label of labels) {
        expect(body, `${path}: step ${label}`).toMatch(
          new RegExp(`fix-pr-review[^\\n]{0,500}step(?:s|-)?\\s*${label}\\b`, 'i'),
        )
      }
    }
  })

  test('every review-trigger site routes the reviewer by complexity band', async () => {
    const consumers = [
      'skills/fix-pr-review-loop/SKILL.md',
      'skills/work-on-issue-loop/SKILL.md',
      'skills/fix-pr-review/rereview-routing.md',
      'templates/claude-workflow/prompts/issue-workflow.md',
      'templates/claude-workflow/prompts/fix-pr.md',
    ]
    // The heavy tier every site must name, and the tier only a first review may
    // name — fable reviews cycle 1 and never repeats, so the two fixer sites
    // must fall back to the standard trigger instead.
    const FIRST_REVIEW_SITES = new Set([
      'skills/fix-pr-review-loop/SKILL.md',
      'skills/work-on-issue-loop/SKILL.md',
      'templates/claude-workflow/prompts/issue-workflow.md',
    ])
    for (const path of consumers) {
      const body = (await read(path)).replace(/\s+/g, ' ')
      expect(body, `${path}: C41–C80 opus tier`).toMatch(/@claude opus review/)
      expect(body, `${path}: C0–C10 sonnet tier`).toMatch(/@claude sonnet review/)
      expect(body, `${path}: band read from a C score`).toMatch(/C0.{0,4}C10/)
      if (FIRST_REVIEW_SITES.has(path)) {
        expect(body, `${path}: C81+ fable tier`).toMatch(/@claude fable review effort:high/)
      } else {
        // A fixer never posts a fable trigger — fable reviews cycle 1 only, and
        // its blocking re-reviews step down to opus and then to the standard
        // reviewer. Prose may still name the fable trigger it steps down from.
        expect(body, `${path}: fixer must not post a fable trigger`).not.toMatch(
          /--body "@claude fable review|body the .{0,20}words @claude fable review/,
        )
        expect(body, `${path}: fable steps down`).toMatch(/steps? down|step-down/i)
        expect(body, `${path}: fable never repeats`).toMatch(
          /only ever runs once|reviews the first cycle only|first cycle only/i,
        )
        // The C81+ ladder floors at the standard trigger. Sonnet is a band tier
        // and the non-blocking tier; it is never a C81+ blocking rung.
        expect(body, `${path}: ladder floors above sonnet`).toMatch(
          /never (?:steps? down|drops?) to (?:`?@claude )?sonnet|stops (?:there|at `@claude review`)[^.]{0,80}sonnet/i,
        )
      }
    }
  })

  // The Codex prompts are band consumers too, but they must never name a
  // @claude trigger, so they get their own assertions rather than a row in the
  // list above. Codex has one flagship: every band above C10 collapses onto the
  // bare trigger, and only the C0–C10 band and the non-blocking re-review keep
  // the cheap `luna` shorthand.
  test('the Codex Action prompts route the cheap band to @codex luna review', async () => {
    const CODEX_CONSUMERS = [
      'templates/codex-workflow/prompts/issue-workflow.md',
      'templates/codex-workflow/prompts/fix-pr.md',
    ]
    for (const path of CODEX_CONSUMERS) {
      const body = (await read(path)).replace(/\s+/g, ' ')
      expect(body, `${path}: C0–C10 cheap tier`).toMatch(/@codex luna review/)
      expect(body, `${path}: band read from a C score`).toMatch(/C0 to C10/)
      expect(body, `${path}: C11+ collapses onto the bare trigger`).toMatch(
        /@codex review at C11 and above/,
      )
      // Codex is this cycle's bot; naming a @claude trigger would switch bots.
      expect(body, `${path}: never posts a @claude trigger`).not.toMatch(
        /body[^.]{0,40}@claude|--body "@claude/,
      )
    }
    // The fixer's C81+ ladder stays on the flagship at every cycle; stepping it
    // down to luna would review the heaviest PR on the cheapest model.
    const fixer = (await read('templates/codex-workflow/prompts/fix-pr.md')).replace(/\s+/g, ' ')
    expect(fixer, 'C81+ ladder never reaches luna').toMatch(/never reaches luna/i)
  })

  test('the standalone review workflow resolves every band shorthand it is sent', async () => {
    const workflow = texts['templates/claude-review.yml']
    for (const [shorthand, modelId] of [
      ['sonnet', 'claude-sonnet-5'],
      ['opus', 'claude-opus-5'],
      ['fable', 'claude-fable-5'],
    ]) {
      expect(workflow, `${shorthand} shorthand`).toMatch(
        new RegExp(`@claude ${shorthand}'\\)\\s*&&\\s*'${modelId}'`),
      )
    }
  })

  test('contract inventory states finding-section stop semantics and both guards', async () => {
    const inventory = await read('docs/contract-inventory.md')
    expect(inventory).toMatch(/no remaining \*\*finding\*\* sections/i)
    expect(inventory).toMatch(/Verification limitation[\s\S]{0,120}not a finding/i)
    expect(inventory).toMatch(/tests\/loop-validate-pipeline-contract\.test\.js/)
    expect(inventory).toMatch(/tests\/pr-review-contract\.test\.js/)
  })

  test('no site names a fixed Codex trigger that overrides the band', async () => {
    // Every statement of the Codex trigger derives it from the one band table.
    // A band-free "post @codex review instead" sends a C0-C10 PR to the
    // flagship while the paragraph above it routes that band to luna.
    const consumers = [
      'skills/fix-pr-review-loop/SKILL.md',
      'skills/fix-pr-review/rereview-routing.md',
      'templates/codex-workflow/prompts/fix-pr.md',
      'templates/codex-workflow/prompts/issue-workflow.md',
    ]
    for (const path of consumers) {
      const body = (await read(path)).replace(/\s+/g, ' ')
      expect(body, `${path}: names the cheap Codex tier`).toMatch(/@codex luna review/)
      expect(body, `${path}: ties the cheap tier to C0-C10`).toMatch(
        /@codex luna review[^.]{0,120}C0.{0,4}C10|C0.{0,4}C10[^.]{0,120}@codex luna review/,
      )
      expect(body, `${path}: no band-free "post @codex review instead"`).not.toMatch(
        /post `?@codex review`? instead/i,
      )
    }

    // A stamped `PR review:` line overrides the band on Codex too. A site that
    // states the band without the stamp mapping sends a [C5] issue stamped
    // fable to `@codex luna review` — the cheapest model on the one change whose
    // operator asked for the strongest reviewer — or invites an agent to compose
    // `@codex fable review`, which codex.yml routes to its write-capable job.
    // Only the sites that SELECT a trigger from the stamp need the mapping.
    // templates/codex-workflow/prompts/fix-pr.md repeats the cycle-1 trigger
    // verbatim, so the mapping was already applied upstream; it is asserted
    // separately below.
    const STAMP_SELECTING_SITES = [
      'skills/fix-pr-review-loop/SKILL.md',
      'skills/fix-pr-review/rereview-routing.md',
      'templates/codex-workflow/prompts/issue-workflow.md',
    ]
    for (const path of STAMP_SELECTING_SITES) {
      const body = (await read(path)).replace(/\s+/g, ' ')
      expect(body, `${path}: sonnet/haiku map to luna`).toMatch(
        /(?:sonnet|haiku)[^.]{0,70}luna|luna[^.]{0,70}(?:sonnet|haiku)/i,
      )
      expect(body, `${path}: opus/fable map to the flagship trigger`).toMatch(
        /(?:opus|fable)[^.]{0,90}@codex review|@codex review[^.]{0,90}(?:opus|fable)/i,
      )
      expect(body, `${path}: the stamped effort rides along`).toMatch(/effort:<tier>/i)
    }
    // The Codex fixer must say the mapping already happened, so it repeats the
    // cycle-1 trigger instead of re-deriving one from a @claude model name.
    const codexFixer = (await read('templates/codex-workflow/prompts/fix-pr.md')).replace(/\s+/g, ' ')
    expect(codexFixer, 'stamp was mapped upstream').toMatch(
      /already mapped onto the Codex column|luna for sonnet or haiku/i,
    )
    expect(codexFixer, 'never carries a @claude shorthand').toMatch(
      /[Nn]ever carry a @claude model shorthand across to @codex/,
    )
    // Codex has no Fable tier, so the two skill pages must say the cycle-1
    // trigger repeats instead of pointing a Codex cycle at the @claude ladder.
    for (const path of ['skills/fix-pr-review-loop/SKILL.md', 'skills/fix-pr-review/rereview-routing.md']) {
      const body = (await read(path)).replace(/\s+/g, ' ')
      expect(body, `${path}: no Fable tier on Codex`).toMatch(/Codex has no Fable tier|no Fable tier/i)
      expect(body, `${path}: the Codex cycle-1 trigger repeats`).toMatch(
        /cycle-1 trigger (?:simply )?repeats/i,
      )
    }
  })

  test('every trigger the pipeline can emit resolves to the review route on its Action', async () => {
    // Both Actions take the FIRST token after the mention that is not a known
    // model shorthand as the ROUTE KEYWORD. So an unadmitted shorthand does not
    // merely lose the model — the keyword stops being `review`, and a
    // trusted-author PR then takes the write-capable fix-pr route. Every
    // shorthand any routing table can emit must therefore be one the Action
    // admits, on both bots.
    const source = await read('workflows/milestone-pipeline.js')

    const shorthandTable = (name) => {
      const body = source.match(new RegExp(`const ${name} = \\{([^}]*)\\}`))[1]
      return body.split(',').map((pair) => pair.split(':')[1].trim().replace(/^'|'$/g, ''))
        .filter((value) => value !== 'null')
    }
    // The Action's admitted set, taken from its own route-keyword parser.
    const admitted = async (workflow, group) => {
      const body = await read(workflow)
      return new Set(body.match(new RegExp(`\\^\\(${group}[^)]*\\)`))[0].replace(/^\^\(|\)$/g, '').split('|'))
    }

    // Both the repo's own workflow and the template copy a consumer repo
    // installs — a shorthand admitted here but not there breaks on install.
    let claudeAdmitted
    for (const workflow of ['.github/workflows/claude.yml', 'templates/claude-workflow/workflows/claude.yml']) {
      claudeAdmitted = await admitted(workflow, 'opus')
      for (const shorthand of shorthandTable('CLAUDE_REVIEW_SHORTHAND')) {
        expect(claudeAdmitted.has(shorthand), `${workflow} admits "${shorthand}"`).toBeTrue()
      }
    }
    let codexAdmitted
    for (const workflow of ['.github/workflows/codex.yml', 'templates/codex-workflow/workflows/codex.yml']) {
      codexAdmitted = await admitted(workflow, 'sol')
      for (const shorthand of shorthandTable('CODEX_REVIEW_SHORTHAND')) {
        expect(codexAdmitted.has(shorthand), `${workflow} admits "${shorthand}"`).toBeTrue()
      }
    }
    // The band table feeds the same emitter, so its models must be admitted too.
    const bandModels = [...source.match(/const REVIEW_BANDS = \[[\s\S]*?\n\]/)[0].matchAll(/review: \{ model: (?:'([a-z]+)'|null)/g)]
      .map((m) => m[1]).filter(Boolean)
    expect(bandModels.length, 'band models found').toBeGreaterThan(0)
    for (const model of bandModels) {
      expect(claudeAdmitted.has(model), `claude.yml admits band model "${model}"`).toBeTrue()
    }
    // Every build model must be REPRESENTABLE as a review trigger, so a stamp
    // naming one can never fall through to an unadmitted shorthand.
    const buildModels = Object.keys(JSON.parse(
      source.match(/const MODEL_IDS = (\{[^}]*\})/)[1].replace(/'/g, '"'),
    ))
    for (const model of buildModels) {
      expect(source, `CLAUDE_REVIEW_SHORTHAND covers ${model}`).toMatch(
        new RegExp(`CLAUDE_REVIEW_SHORTHAND = \\{[^}]*\\b${model}:`),
      )
      expect(source, `CODEX_REVIEW_SHORTHAND covers ${model}`).toMatch(
        new RegExp(`CODEX_REVIEW_SHORTHAND = \\{[^}]*\\b${model}:`),
      )
    }
  })

  test('the routing page lets a band row apply only with no cycle-1 trigger comment', async () => {
    // The page states the cycle-1 rule in prose; an unqualified band table beside
    // it gives a competing answer for a stamped PR, and the ladder then posts a
    // trigger the code never would.
    const body = (await read('skills/fix-pr-review/rereview-routing.md')).replace(/\s+/g, ' ')
    expect(body, 'band table is gated on having no cycle-1 trigger comment').toMatch(
      /band table[^.]{0,80}ONLY when the PR carries no cycle-1 trigger comment/i,
    )
    // …and the gate must survive a PR whose only trigger comment is the cheap
    // non-blocking re-trigger, which a pass posts at any band.
    expect(body, 'the gate covers a PR left with no trigger after the skip').toMatch(
      /none left after the cheap non-blocking re-triggers are skipped/i,
    )
    expect(body, 'no heading orders band routing after the cycle-1 check').not.toMatch(
      /check what ran cycle 1, then route on the band/i,
    )
    // The C81+ row must not assert that fable ran cycle 1 — a stamp can put any
    // model on a C81+ cycle 1, which the same page says keeps its own trigger.
    expect(body, 'C81+ row asserts nothing about what ran cycle 1').not.toMatch(
      /`?@claude fable review effort:high`? ran cycle 1/i,
    )
    // A stamped PR review: line carries a trigger, not a score.
    expect(body, 'the stamp is not listed as a score source').not.toMatch(
      /[Rr]ead the score[^.]{0,60}a stamped `?PR review:?`? line/,
    )
    // Without "earliest", a fixer can read the newest trigger comment — a
    // step-down rung, or a non-blocking `@claude sonnet review` — as cycle 1,
    // and send a C90 PR's blocking findings to the cheapest tier.
    expect(body, 'cycle 1 is the earliest trigger comment').toMatch(
      /EARLIEST[^.]{0,90}trigger|earliest[^.]{0,90}`?@<bot> … review`? trigger/i,
    )
    expect(body, 'a non-blocking re-trigger is not a rung').toMatch(
      /consumes no rung|never a ladder position/i,
    )
    // Excluding the cheap shorthand only while counting rungs is not enough: a
    // first review can arrive with no trigger comment at all (a human reviewer,
    // or the loop's "feedback already present" branch), so on a C90 PR the
    // earliest trigger comment can be a non-blocking `@claude sonnet review`.
    // Reading that as cycle 1 pins every blocking re-review to the cheapest
    // tier, which is the failure the earliest-comment rule exists to prevent.
    expect(body, 'the cheap re-trigger is skipped during the cycle-1 read').toMatch(
      /skipping every cheap non-blocking re-trigger[^.]{0,160}unless the PR's band is C0–C10/i,
    )
    // The three sibling consumers already order the same read; they stay in step.
    for (const path of [
      'templates/claude-workflow/prompts/fix-pr.md',
      'templates/codex-workflow/prompts/fix-pr.md',
      'workflows/milestone-pipeline.js',
    ]) {
      const sibling = (await read(path)).replace(/\s+/g, ' ')
      expect(sibling, `${path}: earliest trigger comment`).toMatch(/EARLIEST/)
      // Each sibling names its own bot's cheap shorthand and skips it during
      // the cycle-1 read; the pipeline interpolates NONBLOCKING_RETRIGGER.
      expect(sibling, `${path}: skips the cheap re-trigger during the cycle-1 read`).toMatch(
        /skipping (?:every|any) (?:@claude sonnet review|@codex luna review|\\`\$\{NONBLOCKING_RETRIGGER\[REVIEW_BOT\]\}\\`)/i,
      )
    }
    // The two Action prompts must also gate the band fallback on the skip, or a
    // PR whose only trigger comment is the cheap one still has no fallback.
    for (const path of ['templates/claude-workflow/prompts/fix-pr.md', 'templates/codex-workflow/prompts/fix-pr.md']) {
      expect((await read(path)).replace(/\s+/g, ' '), `${path}: band fallback covers the skip`).toMatch(
        /no cycle-1 trigger comment[^.]{0,180}none left after the non-blocking (?:sonnet|luna) comments are skipped/i,
      )
    }
  })

  test('no site maps a @claude model shorthand onto @codex', async () => {
    // codex.yml resolves only sol|terra|luna|mini|codex|spark. A phrase like
    // "@codex sonnet review" still starts the Action, falls through to the
    // default model, and takes `sonnet` as the route keyword — which selects the
    // write-capable fix-pr job on a trusted-author PR. No site may post one.
    const consumers = [
      'skills/fix-pr-review-loop/SKILL.md',
      'skills/work-on-issue-loop/SKILL.md',
      'skills/fix-pr-review/rereview-routing.md',
      'skills/fix-pr-review/SKILL.md',
      'skills/milestone-workflow/SKILL.md',
      'templates/codex-workflow/prompts/fix-pr.md',
      'templates/codex-workflow/prompts/issue-workflow.md',
      'workflows/milestone-pipeline.js',
      'README.md',
      'docs/contract-inventory.md',
    ]
    for (const path of consumers) {
      const body = await read(path)
      // Prose that WARNS against the phrase is the fix, so only posting
       // forms are forbidden.
      expect(body, `${path}: never posts a @claude shorthand on @codex`).not.toMatch(
        /--body "@codex (?:sonnet|opus|fable|haiku)|words @codex (?:sonnet|opus|fable|haiku)|post `?@codex (?:sonnet|opus|fable|haiku)/,
      )
    }
    // The shorthand set the Action actually admits, so the guard above is real.
    for (const workflow of ['.github/workflows/codex.yml', 'templates/codex-workflow/workflows/codex.yml']) {
      expect(await read(workflow), `${workflow}: shorthand set`).toMatch(
        /sol\|terra\|luna\|mini\|codex\|spark/,
      )
    }
  })

  test('the loop skill warns that a @claude shorthand misroutes the Codex Action', async () => {
    // codex.yml fires on any line-start @codex (invocation gate), falls through
    // to the default model, and takes the first non-shorthand token as the route
    // keyword — so `sonnet` selects the write-capable fix-pr route on a
    // trusted-author PR. The skill must not understate that as "nothing runs".
    const body = (await read('skills/fix-pr-review-loop/SKILL.md')).replace(/\s+/g, ' ')
    expect(body, 'names the misrouted phrase').toMatch(/@codex sonnet review/)
    expect(body, 'says it reaches the write-capable fix-pr route').toMatch(
      /write-capable fix-pr route|fix-pr route, which mints/i,
    )
    expect(body, 'says it pushes to the branch').toMatch(/pushes commits/i)
    expect(body, 'keeps the untrusted-author carve-out').toMatch(/fork or an untrusted-author/i)
    expect(body, 'never claims the Action does not run').not.toMatch(
      /matches no trigger|no Action answers|a review that never runs/i,
    )
  })

  test('every step-down statement keys the ladder to a Fable first review, never to a band', async () => {
    // The code keys the step-down to the reviewer that ran cycle 1
    // (milestone-pipeline.js: firstReview.model !== 'fable'), so a stamped
    // Fable trigger steps down at ANY score. A band-keyed restatement tells the
    // fixer to repeat a Fable trigger the same page forbids.
    const consumers = [
      'skills/fix-pr-review/rereview-routing.md',
      'skills/fix-pr-review/SKILL.md',
      'skills/fix-pr-review-loop/SKILL.md',
      'skills/validate-issue/SKILL.md',
      'skills/validate-issue/complexity-scoring.md',
      'templates/claude-workflow/prompts/fix-pr.md',
      'templates/codex-workflow/prompts/fix-pr.md',
      'workflows/milestone-pipeline.js',
      'README.md',
      'docs/contract-inventory.md',
    ]
    for (const path of consumers) {
      const body = (await read(path)).replace(/\s+/g, ' ')
      // No site may say the step-down belongs to a band, or that a non-fable
      // band is what keeps its own trigger.
      expect(body, `${path}: ladder is not band-keyed`).not.toMatch(
        /[Oo]nly the C81\+ band steps down|only the fable band steps down|first review in (?:any )?other band keeps/,
      )
      expect(body, `${path}: step-down keys to the cycle-1 reviewer`).toMatch(
        /key(?:s|ed) to the reviewer that (?:actually )?ran cycle 1/i,
      )
    }
    // The two normative fixer sites must also say a stamped Fable steps down at
    // any score, and that a non-fable first review keeps its own trigger.
    for (const path of ['skills/fix-pr-review/rereview-routing.md', 'templates/claude-workflow/prompts/fix-pr.md']) {
      const body = (await read(path)).replace(/\s+/g, ' ')
      expect(body, `${path}: stamped fable steps down at any score`).toMatch(
        /stamped[^.]{0,120}[Ff]able[^.]{0,120}any score|PR review[^.]{0,120}[Ff]able[^.]{0,140}any score/,
      )
      expect(body, `${path}: non-fable first review keeps its trigger`).toMatch(
        /(?:any )?other (?:model|than Fable)[^.]{0,120}keeps its own trigger|first review on any model other than Fable keeps its own trigger/i,
      )
    }
  })

  test('the Codex first-review prompt honours a stamped PR review line', async () => {
    // milestone-pipeline.js firstReviewTrigger maps a stamped model onto the
    // Codex column, so the Action prompt must state the same override.
    const body = (await read('templates/codex-workflow/prompts/issue-workflow.md')).replace(/\s+/g, ' ')
    expect(body, 'stamped line overrides the band').toMatch(/stamped PR review:? line[^.]{0,120}overrides/i)
    expect(body, 'sonnet/haiku map to luna').toMatch(/@codex luna review when it names sonnet or haiku/i)
    expect(body, 'opus/fable map to the bare trigger').toMatch(/@codex review when it names opus or fable/i)
    // Its Claude sibling states the same override — the two stay in step.
    const claude = (await read('templates/claude-workflow/prompts/issue-workflow.md')).replace(/\s+/g, ' ')
    expect(claude, 'claude sibling states the override').toMatch(/stamped PR review:? line[^.]{0,80}overrides/i)
    // Stating the override without a model mapping lets a stamped haiku through
    // verbatim, and claude.yml reads that as the route keyword.
    expect(claude, 'haiku maps to the sonnet trigger').toMatch(
      /@claude sonnet review when the stamp names sonnet or haiku/i,
    )
    expect(claude, 'names the admitted shorthand set').toMatch(
      /resolves only opus, sonnet and fable/i,
    )
    expect(claude, 'never posts an unadmitted claude shorthand').not.toMatch(
      /post `?@claude haiku|words @claude haiku/i,
    )
    // The two planning sites that author or render a stamp must name the legal
    // set too, or an operator stamps a model no Action admits.
    for (const path of ['skills/prd-to-issues/SKILL.md', 'skills/milestoneplan/SKILL.md']) {
      const body = (await read(path)).replace(/\s+/g, ' ')
      expect(body, `${path}: names the admitted shorthand set`).toMatch(
        /`?sonnet`?, `?opus`? or `?fable`?|admits only `?sonnet`?\/`?opus`?\/`?fable`?/i,
      )
      expect(body, `${path}: route-keyword consequence stated`).toMatch(/route keyword/i)
    }
    // work-on-issue-loop composes the first-review trigger from the same stamp,
    // so restating the band table without the mapping is what lets a stamped
    // haiku through verbatim. Its fix-pr-review-loop pointer is framed as bot
    // selection and preflight, which a Claude-default run reads as settled, so
    // the mapping has to be stated here.
    const loop = (await read('skills/work-on-issue-loop/SKILL.md')).replace(/\s+/g, ' ')
    expect(loop, 'stamped line overrides the band').toMatch(/stamped `?PR review:?`? line[^.]{0,140}overrides the band/i)
    expect(loop, 'haiku maps to the sonnet trigger').toMatch(
      /stamped `?sonnet`? or `?haiku`? posts `?@claude sonnet review/i,
    )
    expect(loop, 'names the admitted shorthand set').toMatch(
      /resolves only `?opus`?, `?sonnet`? and `?fable`?/i,
    )
    expect(loop, 'route-keyword consequence stated').toMatch(/route keyword/i)
    expect(loop, 'never posts an unadmitted claude shorthand').not.toMatch(/@claude haiku/i)
    expect(loop, 'maps onto the Codex column too').toMatch(/@codex luna review/)
  })

  test('no site claims a rescore always replaces the stamped first review', async () => {
    // milestone-pipeline replaces a stamped PR review: model only when the
    // rescored REVIEW band's default outranks it — a rescore never lowers review
    // routing. A restatement that lumps review in with build/effort/fableplan
    // tells a reader the operator's stronger choice is always discarded.
    const body = (await read('skills/milestone-workflow/SKILL.md')).replace(/\s+/g, ' ')
    expect(body, 'review is not listed among the unconditional replacements').not.toMatch(
      /build effort, fableplan, and review all move to the escalated band's defaults/i,
    )
    expect(body, 'the review stamp is kept unless the band default outranks it').toMatch(
      /only when that default outranks the stamp/i,
    )
    expect(body, 'build, effort and fableplan still replace unconditionally').toMatch(
      /build model, build effort and fableplan always move to the escalated band's defaults/i,
    )
  })

  test('contract inventory carries the band-derived review trigger row', async () => {
    const inventory = await read('docs/contract-inventory.md')
    expect(inventory).toMatch(/Band-derived review trigger/)
    expect(inventory).toMatch(/@claude opus review.{0,120}@claude fable review effort:high/)
    expect(inventory).toMatch(/@claude sonnet review.{0,120}@claude review/)
  })
})
