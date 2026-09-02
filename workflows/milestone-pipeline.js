export const meta = {
  name: 'milestone-pipeline',
  description: 'Implement a dependency graph of Execution-block-stamped GitHub issues — validate, plan, build from verified prerequisite heads, review each pull request to a stable readiness boundary, record orchestrator in-session merges at LGTM plus green CI, pause awaiting each unmerged one, and defer the release to the orchestrator when every issue merges',
  whenToUse: 'When the user has approved a milestone-workflow run plan. args: { tracks: [[2,3]] } or { tracks: [{issues:[2,3]}, {issues:[9], after:[0]}, {issues:[12], runsAfter:[0]}], reviewLoop?: true, reviewMode?: \'github\' | \'subagent\', reviewBot?: \'claude\' | \'codex\', maxReviewCycles?: 5, budgetFloor?: 80000, merge?: true, release?: true, merged?: [{issue, pr, merge_sha, issue_state}] }',
  phases: [
    { title: 'Prep', detail: 'read every issue\'s [C..] score and Execution block' },
    { title: 'Validate', detail: 'each issue is validated against its exact dependency base right before it starts — model derived from its [C..] score band, effort from a stamped Validate effort line when present, else the band default' },
    { title: 'Plan', detail: 'Fable plans the issues flagged fableplan: Yes at the stamped Plan effort when present, else high (xhigh clamps to high); plans posted to the issues', model: 'fable' },
    { title: 'Implement', detail: 'build each issue on its assigned model/effort in a worktree, open PR, and trigger the review bot only in github review mode; a Build model stamped on the Codex CLI or Cursor CLI runs through that CLI under an Opus driver agent, never on a substituted Claude model' },
    { title: 'Review Loop', detail: 'build-agent first cycle plus fresh two-cycle fix agents against the review bot Action (default github mode, @claude unless reviewBot names codex) or reviewer/fixer subagent cycles, per PR until LGTM; unrelated tracks stay concurrent while successors wait' },
    { title: 'Merge', detail: 'no merge agents — the orchestrator merges in-session; PRs recorded in args.merged count as merged and successors build from the updated base branch, while an LGTM PR without a record pauses the run as awaiting_merge' },
    { title: 'Release', detail: 'when every issue merged: deferred to the orchestrator, which runs sync-docs-release in-session' },
  ],
}

const ARGS = typeof args === 'string' ? JSON.parse(args) : args
if (!ARGS || !Array.isArray(ARGS.tracks) || ARGS.tracks.length === 0) {
  throw new Error('milestone-pipeline requires a non-empty args.tracks array')
}

function assertIndexList(value, field, trackIndex) {
  if (!Array.isArray(value)) {
    throw new Error(`track ${trackIndex + 1} requires ${field} to be an array of track indices`)
  }
  return [...value]
}

const issueOwners = new Map()
const TRACK_KEYS = new Set(['issues', 'after', 'runsAfter'])
const TRACKS = ARGS.tracks.map((input, trackIndex) => {
  const legacy = Array.isArray(input)
  if (!legacy && (!input || typeof input !== 'object' || Array.isArray(input))) {
    throw new Error(`track ${trackIndex + 1} must be an issue array or { issues, after?, runsAfter? }`)
  }
  if (!legacy) {
    const unknownKey = Object.keys(input).find((key) => !TRACK_KEYS.has(key))
    if (unknownKey) {
      throw new Error(`track ${trackIndex + 1} has unknown key "${unknownKey}"; allowed keys are issues, after, runsAfter`)
    }
  }

  const issues = legacy ? input : input.issues
  if (!Array.isArray(issues) || issues.length === 0) {
    throw new Error(`track ${trackIndex + 1} requires a non-empty issues array`)
  }
  for (const issue of issues) {
    if (!Number.isInteger(issue) || issue <= 0) {
      throw new Error(`track ${trackIndex + 1} has invalid issue number ${String(issue)}`)
    }
    if (issueOwners.has(issue)) {
      throw new Error(`issue #${issue} is assigned more than once (tracks ${issueOwners.get(issue) + 1} and ${trackIndex + 1})`)
    }
    issueOwners.set(issue, trackIndex)
  }

  const after = legacy ? [] : assertIndexList(input.after ?? [], 'after', trackIndex)
  const runsAfter = legacy ? [] : assertIndexList(input.runsAfter ?? [], 'runsAfter', trackIndex)
  const predecessors = new Set()
  for (const predecessor of [...after, ...runsAfter]) {
    if (!Number.isInteger(predecessor) || predecessor < 0 || predecessor >= ARGS.tracks.length) {
      throw new Error(`track ${trackIndex + 1} has invalid predecessor index ${String(predecessor)}`)
    }
    if (predecessor === trackIndex) {
      throw new Error(`track ${trackIndex + 1} cannot depend on itself`)
    }
    if (predecessors.has(predecessor)) {
      throw new Error(`track ${trackIndex + 1} has duplicate predecessor index ${predecessor}`)
    }
    predecessors.add(predecessor)
  }

  return { issues: [...issues], after, runsAfter, legacy }
})

const visitState = TRACKS.map(() => 0)
function visitTrack(trackIndex, path) {
  if (visitState[trackIndex] === 2) return
  if (visitState[trackIndex] === 1) {
    const cycle = [...path, trackIndex].map((index) => `track ${index + 1}`).join(' → ')
    throw new Error(`dependency cycle detected: ${cycle}`)
  }
  visitState[trackIndex] = 1
  const nextPath = [...path, trackIndex]
  for (const predecessor of [...TRACKS[trackIndex].after, ...TRACKS[trackIndex].runsAfter]) {
    visitTrack(predecessor, nextPath)
  }
  visitState[trackIndex] = 2
}
TRACKS.forEach((_track, trackIndex) => visitTrack(trackIndex, []))

const REVIEW_LOOP = ARGS.reviewLoop ?? true
const REVIEW_MODE = ARGS.reviewMode ?? 'github'
const REVIEW_BOT = ARGS.reviewBot ?? 'claude'
const MAX_REVIEW_CYCLES = ARGS.maxReviewCycles ?? 5
const BUDGET_FLOOR = ARGS.budgetFloor ?? 80_000
const MERGE = ARGS.merge ?? REVIEW_LOOP
const RELEASE = ARGS.release ?? MERGE
if (typeof REVIEW_LOOP !== 'boolean') throw new Error('reviewLoop must be a boolean')
if (REVIEW_MODE !== 'subagent' && REVIEW_MODE !== 'github') throw new Error("reviewMode must be 'subagent' or 'github'")
if (REVIEW_BOT !== 'claude' && REVIEW_BOT !== 'codex') throw new Error("reviewBot must be 'claude' or 'codex'")
if (!Number.isInteger(MAX_REVIEW_CYCLES) || MAX_REVIEW_CYCLES <= 0) throw new Error('maxReviewCycles must be a positive integer')
if (!Number.isInteger(BUDGET_FLOOR) || BUDGET_FLOOR <= 0) throw new Error('budgetFloor must be a positive integer')
if (typeof MERGE !== 'boolean') throw new Error('merge must be a boolean')
if (MERGE && !REVIEW_LOOP) throw new Error('merge requires reviewLoop — LGTM review readiness is the merge criterion')
if (typeof RELEASE !== 'boolean') throw new Error('release must be a boolean')
if (RELEASE && !MERGE) throw new Error('release requires merge — a release only makes sense after the run lands the code')
const ALL_ISSUES = TRACKS.flatMap((track) => track.issues)

const MERGED_INPUT = ARGS.merged ?? []
if (!Array.isArray(MERGED_INPUT)) throw new Error('merged must be an array of { issue, pr, merge_sha, issue_state } records')
const RUN_ISSUES = new Set(ALL_ISSUES)
const MERGED = new Map()
const MERGED_PRS = new Set()
for (const entry of MERGED_INPUT) {
  if (!entry || !Number.isInteger(entry.issue) || entry.issue <= 0 || !Number.isInteger(entry.pr) || entry.pr <= 0 || typeof entry.merge_sha !== 'string' || entry.merge_sha.length === 0) {
    throw new Error('each merged record requires an integer issue, an integer pr, and a non-empty merge_sha')
  }
  if (!RUN_ISSUES.has(entry.issue)) throw new Error(`merged record for issue #${entry.issue} (PR #${entry.pr}) names an issue outside this run`)
  if (MERGED.has(entry.issue)) throw new Error(`duplicate merged record for issue #${entry.issue}`)
  if (MERGED_PRS.has(entry.pr)) throw new Error(`duplicate merged record for PR #${entry.pr}`)
  MERGED.set(entry.issue, { pr: entry.pr, merge_sha: entry.merge_sha, issue_state: entry.issue_state === 'closed' || entry.issue_state === 'open' ? entry.issue_state : 'unknown' })
  MERGED_PRS.add(entry.pr)
}
const CONSUMED_MERGE_RECORDS = new Set()

const MODEL_IDS = { 'fable': 'fable', 'opus': 'opus', 'sonnet': 'sonnet', 'haiku': 'haiku' }
const MODEL_NAMES = { fable: 'Fable 5.1', opus: 'Opus 5', sonnet: 'Sonnet 5', haiku: 'Haiku 4.5' }

const CLI_HARNESSES = {
  codex: {
    label: 'Codex CLI',
    footerHarness: 'Codex',
    branchPrefix: 'codex/',
    efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
    defaultModels: { luna: () => 'gpt-5.6-luna' },
  },
  cursor: {
    label: 'Cursor CLI',
    footerHarness: 'Cursor',
    branchPrefix: 'cursor/',
    efforts: ['low', 'medium', 'high', 'xhigh'],
    defaultModels: { grok: (effort) => `cursor-grok-4.6-${effort}` },
  },
}
const CLI_DRIVER = { model: 'opus', effort: 'high' }
const CLI_MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/

function isCliHarness(model) {
  return Object.prototype.hasOwnProperty.call(CLI_HARNESSES, model)
}

function buildModelName(ex) {
  if (isCliHarness(ex.model)) return `${ex.build_model_name || ex.cli_model || ex.model} (${CLI_HARNESSES[ex.model].label})`
  return MODEL_NAMES[MODEL_IDS[ex.model] || 'opus']
}

function footerModelName(ex) {
  if (isCliHarness(ex.model)) return ex.build_model_name || ex.cli_model || ex.model
  return MODEL_NAMES[MODEL_IDS[ex.model] || 'opus']
}

function footerHarness(ex) {
  return isCliHarness(ex.model) ? CLI_HARNESSES[ex.model].footerHarness : 'milestone-pipeline'
}

function buildLabel(ex) {
  return isCliHarness(ex.model) ? `${ex.model}:${ex.cli_model}/${ex.effort}` : `${MODEL_IDS[ex.model] || 'opus'}/${ex.effort}`
}

function cliShimCommand(harness, cliModel, effort) {
  if (harness === 'codex') {
    return `codex exec -C "$REPO" -m '${cliModel}' -c model_reasoning_effort=${effort} -s workspace-write -c sandbox_workspace_write.network_access=true --json -o "$RESULT" < "$PROMPT" > "$EVENTS" 2> "$STDERR"`
  }
  return `agent -p --output-format json --model '${cliModel}' --force --trust --workspace "$REPO" "$(cat "$PROMPT")" > "$RESULT" 2> "$STDERR"`
}

function cliDriverPrompt(taskPrompt, ex, kind = 'implement') {
  const harness = CLI_HARNESSES[ex.model]
  const modelName = footerModelName(ex)
  const cliBinary = ex.model === 'codex' ? 'codex' : 'agent'
  const loginCheck = ex.model === 'codex' ? 'codex login status' : 'agent status'
  const isFix = kind === 'fix'
  const skillName = isFix ? 'fix-pr-review' : 'work-on-issue'
  const footerVerb = isFix ? 'Updated' : 'Created'
  const noTriggerOverride = 'do NOT trigger, post, or wait for any `@claude` or `@codex` re-review; stop after pushing the fixes and posting the per-finding disposition comment, because the driver owns every review trigger'
  const skillLine = `one line telling the CLI agent to read the \`${skillName}\` skill file directly at the first path that exists among \`~/.codex/skills/${skillName}/SKILL.md\`, \`~/.cursor/skills/${skillName}/SKILL.md\`, and \`~/.claude/skills/${skillName}/SKILL.md\` (resolve the path yourself and write the resolved absolute path into the file), and to use the \`${harness.branchPrefix}\` branch prefix, the PR title bracket \`[C<score>, ${modelName}, ${ex.effort}]\`, and the footer \`${footerVerb} with LLM: ${modelName} | ${ex.effort} | Harness: ${harness.footerHarness}\` on every commit and PR body`
  const preflightReturn = isFix
    ? 'return the blocked shape the task prompt\'s final paragraph defines (status blocked, or blocker set), with head_ref and head_sha read from `gh pr view <num> --json headRefName,headRefOid` as they stand, and the blocker naming the missing piece'
    : 'return pr_number 0, empty head fields, and the blocker naming the missing piece'
  const promptFileStep = isFix
    ? `The task prompt below is addressed to YOU, the driver. Run every step of it that reads or writes GitHub state yourself (fetching the standing review, deciding whether to stop, watching the Actions run, reading the verdict, posting any re-trigger it authorizes). Where it says to invoke the \`fix-pr-review\` skill, forward that pass to the CLI instead: write a fix prompt to a file OUTSIDE the repository tree (the session scratchpad, else a mkdtemp directory) that names the PR number and the review comment to address, carries the task prompt's constraints and overrides verbatim, states this override (${noTriggerOverride}), and ends with ${skillLine}.`
    : `Write the task prompt below, verbatim, to a file OUTSIDE the repository tree (the session scratchpad, else a mkdtemp directory), followed by one line telling the CLI agent that the driver handles every review trigger and review cycle in the task prompt, so it stops once the pull request is open and verified, and ${skillLine}.`
  const verifyStep = isFix
    ? `After each pass, verify \`gh pr view <num> --json headRefName,headRefOid\` and read the PR's newest comments. A pass that exits zero with neither a new head commit nor a disposition comment is a blocker.`
    : `Verify the pull request exactly as a Claude builder would (\`gh pr list --search "#<issue> in:title,body" --state open\`, then \`gh pr view <num> --json headRefName,headRefOid\`). No PR after a successful exit is a blocker.`
  const reviewStep = isFix
    ? `The CLI agent never posts a review trigger. When the task prompt authorizes a re-trigger, post it yourself, as its own one-line comment, exactly as the task prompt's routing selects, after the CLI agent's disposition comment has landed; when the task prompt forbids re-triggering, post nothing.`
    : `The task prompt's review directive is yours: post the cycle-1 trigger it names yourself (its own one-line comment, no footer), watch the Actions run, read the verdict, and forward each fix pass the directive asks for to the same shim with a fix prompt that names the PR and the review comment, states this override (${noTriggerOverride}), and ends with the same skill-path line for \`fix-pr-review\`, the same branch-prefix rule, and the footer verb \`Updated\`. You post every re-trigger the directive's routing selects; the CLI agent posts none.`
  const returnShape = isFix
    ? 'Return via StructuredOutput exactly what the task prompt\'s final paragraph asks for, and name any substitution, stray write, or retry in the summary.'
    : 'Return via StructuredOutput exactly what the task prompt\'s final paragraph asks for, plus flags naming any substitution, stray write, or retry.'
  return `You are a ${isFix ? 'fix-pass' : 'build'} DRIVER agent in this repo. The ${isFix ? 'fix pass' : 'build'} itself runs on ${modelName} through the ${harness.label} (model id \`${ex.cli_model}\`, effort \`${ex.effort}\`). You never write product code and you never substitute a Claude model for that ${isFix ? 'fix pass' : 'build'}: the issue's Execution block stamps this external harness, and silently building on another model is the defect this driver exists to close. If the CLI cannot run, return the blocker.

Load the \`cli-dispatch\` skill BEFORE doing anything else (mandatory) and follow it exactly. Then:
1. Preflight: \`command -v ${cliBinary}\` must succeed and \`${loginCheck}\` must report a signed-in account. Either failure is a blocker — ${preflightReturn}.
2. Snapshot \`git status --porcelain\` in the main checkout before dispatching.
3. ${promptFileStep}
4. Run the shim from the repository root with the prompt passed as data (the file, never string-interpolated into the command), in the background with output redirected to files, and poll for exit — a full ${isFix ? 'fix pass' : 'build'} exceeds any foreground Bash timeout:
   \`${cliShimCommand(ex.model, ex.cli_model, ex.effort)}\`
   Never add \`--dangerously-bypass-approvals-and-sandbox\`, \`--yolo\`, or any flag the cli-dispatch skill does not name.
5. On a non-zero exit, retry the shim once with the same inputs; a second failure is a blocker. Read the CLI's final message and, when the output names the model that served the run, compare it with \`${ex.cli_model}\` — a different model is a substitution: report it ${isFix ? 'in the summary' : 'in flags and in the summary'}, never as a ${modelName} ${isFix ? 'fix pass' : 'build'}. An output that names no model is recorded as model unverified beside the requested id.
6. Diff \`git status --porcelain\` in the main checkout against the snapshot; report any stray change outside the issue's worktree ${isFix ? 'in the summary' : 'in flags'}.
7. ${verifyStep}
8. ${reviewStep}

Task prompt${isFix ? ' (addressed to the driver; each fix pass reaches the ' + harness.label + ' agent through the fix prompt file step 3 describes)' : ' for the ' + harness.label + ' agent (write it to the prompt file verbatim)'}:
----- BEGIN TASK PROMPT -----
${taskPrompt}
----- END TASK PROMPT -----

${returnShape}`
}

const BANDS = [
  { name: '0–9', min: 0, max: 9, fableplan: false, validate: { model: 'opus', effort: 'medium' }, build: { model: 'sonnet', effort: 'high' } },
  { name: '10–20', min: 10, max: 20, fableplan: false, validate: { model: 'opus', effort: 'high' }, build: { model: 'sonnet', effort: 'xhigh' } },
  { name: '21–50', min: 21, max: 50, fableplan: false, validate: { model: 'opus', effort: 'high' }, build: { model: 'opus', effort: 'high' } },
  { name: '51–70', min: 51, max: 70, fableplan: false, validate: { model: 'opus', effort: 'xhigh' }, build: { model: 'opus', effort: 'xhigh' } },
  { name: '71–80', min: 71, max: 80, fableplan: true, validate: { model: 'fable', effort: 'medium' }, build: { model: 'opus', effort: 'high' } },
  { name: '81+', min: 81, max: Infinity, fableplan: true, validate: { model: 'fable', effort: 'high' }, build: { model: 'opus', effort: 'xhigh' } },
]

const REVIEW_BANDS = [
  { name: '0–20', min: 0, max: 20, review: { model: 'sonnet', effort: 'high' } },
  { name: '21–70', min: 21, max: 70, review: { model: null, effort: 'high' } },
  { name: '71–80', min: 71, max: 80, review: { model: 'opus', effort: 'high' } },
  { name: '81+', min: 81, max: Infinity, review: { model: 'fable', effort: 'high' } },
]

function hasScore(complexity) {
  return Number.isInteger(complexity) && complexity >= 0
}

function bandFor(complexity) {
  if (!hasScore(complexity)) return BANDS[BANDS.length - 1]
  return BANDS.find((band) => complexity >= band.min && complexity <= band.max) || BANDS[BANDS.length - 1]
}

function reviewBandFor(complexity) {
  if (!hasScore(complexity)) return REVIEW_BANDS[REVIEW_BANDS.length - 1]
  return REVIEW_BANDS.find((band) => complexity >= band.min && complexity <= band.max) || REVIEW_BANDS[REVIEW_BANDS.length - 1]
}

const REVIEW_MODEL_RANK = new Map(REVIEW_BANDS.map((band, index) => [band.review.model, index]))
function reviewModelRank(model) {
  const resolved = model === 'haiku' ? 'sonnet' : (model ?? null)
  const rank = REVIEW_MODEL_RANK.get(resolved)
  return rank === undefined ? -1 : rank
}

const CODEX_REVIEW_SHORTHAND = { fable: null, opus: null, sonnet: 'luna', haiku: 'luna' }

const CLAUDE_REVIEW_SHORTHAND = { fable: 'fable', opus: 'opus', sonnet: 'sonnet', haiku: 'sonnet' }

const NONBLOCKING_RETRIGGER = { claude: '@claude sonnet review', codex: '@codex luna review' }

function firstReviewTrigger(ex) {
  const stamped = MODEL_IDS[ex.first_review_model]
  const review = reviewBandFor(ex.review_complexity ?? ex.complexity).review
  if (REVIEW_BOT === 'codex') {
    const source = stamped || review.model
    const shorthand = source ? CODEX_REVIEW_SHORTHAND[source] : null
    const effort = stamped ? ex.first_review_effort : null
    return `@codex${shorthand ? ` ${shorthand}` : ''} review${effort ? ` effort:${effort}` : ''}`
  }
  if (stamped) {
    const shorthand = CLAUDE_REVIEW_SHORTHAND[stamped]
    if (shorthand !== stamped) log(`stamped first-review model ${MODEL_NAMES[stamped]} → @claude ${shorthand} review (claude.yml resolves no ${stamped} shorthand, and an unresolved one routes to the write-capable fix-pr job)`)
    return `@claude ${shorthand} review${ex.first_review_effort ? ` effort:${ex.first_review_effort}` : ''}`
  }
  if (!review.model) return '@claude review'
  if (review.model === 'opus') return '@claude opus review'
  if (review.model === 'sonnet') return '@claude sonnet review'
  return `@claude ${review.model} review effort:${review.effort}`
}

const STEP_DOWN_LADDERS = {
  fable: [{ model: 'opus', effort: 'high' }, { model: null, effort: 'high' }],
  opus: [{ model: null, effort: 'high' }],
}

const CLAUDE_STEP_DOWN_TRIGGER = [
  [/^@claude\s+fable\b/, '@claude opus review'],
  [/^@claude\s+opus\b/, '@claude review'],
]

function blockingRetrigger(ex) {
  const cycle1 = firstReviewTrigger(ex)
  if (REVIEW_BOT === 'codex') return cycle1
  for (const [pattern, rung] of CLAUDE_STEP_DOWN_TRIGGER) if (pattern.test(cycle1)) return rung
  return cycle1
}

function validateRouteFor(ex, band) {
  const model = band.validate.model
  const stamped = ex.validate_effort
  if (!stamped) return { model, effort: band.validate.effort, note: '' }
  if (model === 'fable' && stamped === 'xhigh') return { model, effort: 'high', note: ' (stamped Validate effort xhigh → high: Fable never runs at xhigh)' }
  if (model !== 'fable' && (stamped === 'low' || stamped === 'medium')) return { model, effort: 'high', note: ` (stamped Validate effort ${stamped} → high for ${MODEL_NAMES[model]}: low/medium are Fable-only)` }
  return { model, effort: stamped, note: ` (stamped Validate effort ${stamped} overrides the band default ${band.validate.effort})` }
}

function derivedBuild(complexity) {
  const band = bandFor(complexity)
  return { model: band.build.model, effort: band.build.effort, fableplan: band.fableplan, band }
}

const PREP_SCHEMA = {
  type: 'object',
  required: ['issues'],
  properties: {
    issues: {
      type: 'array',
      items: {
        type: 'object',
        required: ['number', 'title', 'model', 'effort', 'fableplan'],
        properties: {
          number: { type: 'integer' },
          title: { type: 'string', description: 'The issue title EXACTLY as gh issue view --json title reports it, including any [C<score>] prefix — the runtime reconciles the reported complexity against this prefix, so a shortened or reworded title makes a scored issue look unscored' },
          complexity: { type: 'integer', minimum: 0, description: 'The integer from the [C<score>] title prefix — a literal [C0] is a real score of 0; OMIT this field entirely when the title carries no [C..] prefix, because absence is how the runtime tells an unscored issue from a genuinely zero-scored one' },
          model: { type: 'string', enum: ['fable', 'opus', 'sonnet', 'haiku', 'codex', 'cursor'], description: 'From "Build model:" — Fable 5.1→fable, Opus 5→opus, etc.; a parenthetical "(Codex CLI…)"→codex, "(Cursor CLI…)"→cursor' },
          build_model_name: { type: 'string', description: 'For codex/cursor only: the display name before the parenthetical, e.g. "Luna" from "Luna (Codex CLI)"; OMIT for Claude models' },
          cli_model: { type: 'string', description: 'For codex/cursor only: the explicit CLI model id after the comma inside the parenthetical, e.g. "gpt-5.6-luna" from "Luna (Codex CLI, gpt-5.6-luna)"; OMIT when the parenthetical carries no id — the runtime resolves a default only for names it knows' },
          effort: { type: 'string', enum: ['low', 'medium', 'high', 'xhigh', 'max'], description: 'Raw tier from "Effort:"; low and medium are Fable-only and max is Codex CLI-only — runtime normalizes non-Fable low/medium→high, max→xhigh on Opus/Sonnet, max→high on Fable, max→xhigh on Cursor' },
          validate_effort: { type: 'string', enum: ['low', 'medium', 'high', 'xhigh'], description: 'Raw tier from an optional "Validate effort:" line — OMIT when absent, because absence is how the runtime tells a stamped tier from the [C..] band default. Preserve the tier verbatim; the runtime clamps xhigh to high on a Fable validate and raises low/medium to high on a non-Fable validate' },
          plan_effort: { type: 'string', enum: ['low', 'medium', 'high', 'xhigh'], description: 'Raw tier from an optional "Plan effort:" line — OMIT when absent, because absence is how the runtime tells a stamped tier from the high default. Preserve the tier verbatim; the runtime clamps xhigh to high (Fable never runs at xhigh). Ignored when fableplan is false' },
          fableplan: { type: 'boolean', description: 'True when "fableplan first:" starts with Yes' },
          first_review_model: { type: 'string', enum: ['fable', 'opus', 'sonnet', 'haiku'], description: 'From the optional "PR review:" line — the model named in a `@claude <model> review …` first-review trigger; OMIT this field when the line is a standard `@claude` trigger or absent — the runtime derives the default from the [C..] band, and presence is how it tells a stamped trigger from an unstamped one' },
          first_review_effort: { type: 'string', enum: ['medium', 'high', 'xhigh'], description: 'From "effort:<tier>" in that first-review trigger; OMIT when unspecified — the runtime derives the default from the [C..] band' },
          missing_block: { type: 'boolean', description: 'True when the issue has no ## Execution block (fields above are then your best-heuristic defaults)' },
        },
      },
    },
  },
}

const VALIDATION_SCHEMA = {
  type: 'object',
  required: ['verdict', 'summary', 'corrections', 'implementation_constraints', 'rescored_complexity'],
  properties: {
    verdict: { type: 'string', enum: ['VALID', 'VALID_WITH_CORRECTIONS', 'INVALID'] },
    rescored_complexity: { type: 'integer', description: 'Your own step-6 complexity score (0–99) for the issue as validated; 0 only if you could not score it. The runtime escalates to a higher band when this outranks the title prefix — upward only, never downward' },
    summary: { type: 'string', description: 'One-paragraph verdict summary' },
    corrections: { type: 'array', items: { type: 'string' }, description: 'Concrete edits the issue body needs (empty if none)' },
    implementation_constraints: { type: 'array', items: { type: 'string' }, description: 'Hard requirements the implementer must honor (invariants, refuted approaches, preferred option, merge-order notes)' },
    invalid_reason: { type: 'string', description: 'Only when verdict is INVALID: why' },
  },
}

const PLAN_SCHEMA = {
  type: 'object',
  required: ['plan', 'constraints'],
  properties: {
    plan: { type: 'string', description: 'The full implementation plan as posted to the issue, with its numbered steps and per-step verify points intact' },
    constraints: { type: 'array', items: { type: 'string' }, description: 'Hard requirements the builder must honor, distilled from the plan' },
  },
}

const IMPLEMENT_SCHEMA = {
  type: 'object',
  required: ['pr_number', 'pr_url', 'head_ref', 'head_sha', 'summary', 'tests_passed', 'github_review_status', 'github_review_nonblocking_remaining', 'github_review_summary'],
  properties: {
    pr_number: { type: 'integer', description: '0 if blocked / no PR opened' },
    pr_url: { type: 'string' },
    head_ref: { type: 'string', description: 'Verified pull request head branch; empty if blocked / no PR opened' },
    head_sha: { type: 'string', description: 'Verified pull request head commit at implementation completion; empty if blocked / no PR opened' },
    summary: { type: 'string' },
    tests_passed: { type: 'boolean' },
    github_review_status: { type: 'string', enum: ['not_run', 'lgtm', 'needs_updates', 'blocked'], description: 'Standing @claude verdict after the implementation agent handles github review cycle 1; not_run outside github review mode' },
    github_review_nonblocking_remaining: { type: 'integer', description: 'Non-blocking findings still open after github review cycle 1; 0 when not_run or at a bare LGTM' },
    github_review_summary: { type: 'string', description: 'What the implementation agent fixed or refuted in github review cycle 1 and the standing verdict; empty when not_run' },
    github_review_blocker: { type: 'string', description: 'Only when github_review_status is blocked' },
    blocker: { type: 'string', description: 'Only if blocked: what stopped you' },
    flags: { type: 'array', items: { type: 'string' }, description: 'Anything the operator should know (pre-existing flakes, unfiled follow-ons)' },
  },
}

const SUBAGENT_REVIEW_SCHEMA = {
  type: 'object',
  required: ['verdict', 'blocking_count', 'nonblocking_count', 'head_ref', 'head_sha', 'comment_url', 'summary'],
  properties: {
    verdict: { type: 'string', enum: ['lgtm', 'needs_updates'], description: 'The pr-review verdict line of the posted review' },
    blocking_count: { type: 'integer', description: 'Items under ### Needs Fixing plus ### Requires Human Review' },
    nonblocking_count: { type: 'integer', description: 'Items under ### Recommended Optional plus ### Create Follow-up Issue' },
    head_ref: { type: 'string', description: 'Exact pull request head branch that was reviewed' },
    head_sha: { type: 'string', description: 'Exact pull request head commit that was reviewed' },
    comment_url: { type: 'string', description: 'URL of the posted review comment' },
    summary: { type: 'string', description: 'One-paragraph review summary' },
  },
}

const REVIEW_FIX_SCHEMA = {
  type: 'object',
  required: ['fixed_count', 'refuted_count', 'head_ref', 'head_sha', 'summary'],
  properties: {
    fixed_count: { type: 'integer', description: 'Findings fixed (including follow-up issues filed)' },
    refuted_count: { type: 'integer', description: 'Findings refuted on the record in the disposition comment' },
    head_ref: { type: 'string', description: 'Exact pull request head branch after the push' },
    head_sha: { type: 'string', description: 'Exact pull request head commit after the push' },
    summary: { type: 'string', description: 'What was fixed, what was refuted and why' },
    blocker: { type: 'string', description: 'Only if the fix pass could not complete: what stopped you' },
  },
}

const githubReviewBatchSchema = (cycleLimit) => ({
  type: 'object',
  required: ['status', 'nonblocking_remaining', 'cycles_run', 'summary', 'head_ref', 'head_sha'],
  properties: {
    status: { type: 'string', enum: ['lgtm', 'needs_updates', 'blocked'] },
    nonblocking_remaining: { type: 'integer', description: 'Non-blocking findings still open on the standing review (0 when status is a bare LGTM)' },
    cycles_run: { type: 'integer', minimum: 1, maximum: cycleLimit, description: `Review cycles completed by this agent; ${cycleLimit === 1 ? 'exactly 1' : `1 to ${cycleLimit}`}, never more than the assigned range` },
    summary: { type: 'string', description: 'What this batch fixed or refuted and the standing verdict' },
    head_ref: { type: 'string', description: 'Exact pull request head branch after this batch' },
    head_sha: { type: 'string', description: 'Exact pull request head commit after this batch' },
    blocker: { type: 'string', description: 'Only when status is blocked' },
  },
})

function completedContext(completed) {
  return completed.map((record) => `- Issue #${record.issue} → PR #${record.prNumber} ${record.head.merged ? '(merged into the base branch)' : `(head: ${record.head.ref} @ ${record.head.sha})`}`).join('\n')
}

function skippedContext(skipped) {
  return skipped.map((record) => `- Issue #${record.issue}: ${record.reason}`).join('\n')
}

function validatePrompt(issue, completed, skipped, baseRefs) {
  const predecessorContext = completedContext(completed)
  const missingContext = skippedContext(skipped)
  return [
    `You are a read-only validation agent in this repo. Invoke the \`validate-issue\` skill with args \`${issue}\` and follow its procedure exactly:`,
    `fetch GitHub issue #${issue} with \`gh issue view ${issue}\`, verify every factual claim (including PRD section references) against the actual code and PRD with file:line citations,`,
    `check architectural feasibility and self-consistency of the approach, and check for staleness: whether code merged since the issue was filed changes its best approach.`,
    predecessorContext ? `\nStable predecessor results (deduplicated):\n${predecessorContext}` : '',
    missingContext ? `\nSkipped predecessor results whose code does not exist:\n${missingContext}` : '',
    baseRefs.length ? `\nHard dependency base refs, ordered by predecessor track and pinned to the reviewed pull request commits: ${JSON.stringify(baseRefs)}. Verify each PR/ref/SHA tuple and validate against those exact commits, not only the default branch, before returning a valid verdict.` : '',
    `\nDo NOT modify any files, do NOT comment on the issue, do NOT start implementing.`,
    `Return via StructuredOutput: verdict (VALID / VALID_WITH_CORRECTIONS / INVALID), a verdict summary, the concrete issue-body corrections needed,`,
    `the implementation constraints an implementer must honor (repo invariants at risk, refuted approaches, the preferred approach, merge-order notes),`,
    `and rescored_complexity: your own step-6 complexity score (0–99) from the change surface you traced — independent of the title prefix; 0 only if you could not score it.`,
  ].join(' ')
}

async function validateWithRetry(issue, prompt, options) {
  let blocker = 'validation agent failed'
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const disposition = attempt === 1 ? 'retrying once' : 'retries exhausted'
    try {
      const validation = await agent(prompt, options)
      if (validation) return { validation, blocker: null }
      blocker = 'validation agent failed'
      log(`#${issue}: validation attempt ${attempt}/2 returned no result; ${disposition}`)
    } catch (error) {
      const detail = error?.message || error
      blocker = `validation threw: ${detail}`
      log(`#${issue}: validation attempt ${attempt}/2 threw — ${detail}; ${disposition}`)
    }
  }
  return { validation: null, blocker }
}

function planPrompt(issue, validation, planEffort) {
  const corrections = validation.corrections.length
    ? `\nA validation pass found these issue-body corrections (a later agent applies them — plan as if they were already applied):\n${validation.corrections.map((c) => `- ${c}`).join('\n')}\n`
    : ''
  const constraints = (validation.implementation_constraints || []).length
    ? `\nHard constraints from validation:\n${validation.implementation_constraints.map((c) => `- ${c}`).join('\n')}\n`
    : ''
  return `You are a read-only planning agent on Fable 5.1 in this repo. GitHub issue #${issue} is flagged "fableplan first" — the design is the hard part and a separate builder will implement your plan.

Validation summary: ${validation.summary}
${corrections}${constraints}
Fetch the issue (\`gh issue view ${issue}\`), read the referenced PRD sections and any relevant code, and produce a concrete implementation plan: files to create/modify, data shapes, control flow, edge cases, and the test list. Number the implementation steps (1., 2., …) and end each step with a verify point — the observable check that proves the step is done (a command to run, a test that passes, a file state to confirm). The builder mirrors these numbered steps into its progress tracker, so a step without a number or a verify point loses its anchor. Carry the same numbering and verify points into both the posted comment and the plan text you return. Plan the absolute-best solution — cost and code volume are not constraints; only correctness and safety are.

Post the plan as a comment on issue #${issue}, with the heading line \`## Implementation plan (Fable 5.1)\` above the plan body — \`work-on-issue\` step 0 matches on that heading to find a posted plan, so a standalone run later fails to recognize a plan posted without it (footer: \`Created with LLM: Fable 5.1 | ${planEffort} | Harness: milestone-pipeline\`). The user approved this milestone run plan, which explicitly authorizes commenting the plan on this issue — the comment is the handoff artifact the builder implements against, and posting it is the whole point of this step, not an incidental side effect. Do NOT modify any files, comment anywhere else, or start implementing.

Return via StructuredOutput: the plan text, and the distilled hard constraints the builder must honor.`
}

function implementPrompt(issue, ex, validation, plan, completed, skipped, baseRefs, reviewLoop) {
  const footerModel = footerModelName(ex)
  const harness = footerHarness(ex)
  const corrections = validation.corrections.length
    ? validation.corrections.map((c) => `- ${c}`).join('\n')
    : ''
  const constraints = (validation.implementation_constraints || []).concat(plan ? plan.constraints : [])
  const predecessorContext = completedContext(completed)
  const missingContext = skippedContext(skipped)
  const workOnIssueArgs = baseRefs.length
    ? `{ issue: ${issue}, baseRefs: ${JSON.stringify(baseRefs)} }`
    : `{ issue: ${issue} }`
  const reviewDirective = !reviewLoop
    ? '\n\nThis run has reviewLoop disabled: do not request or trigger any pull request review. Return github_review_status not_run, github_review_nonblocking_remaining 0, and an empty github_review_summary.'
    : REVIEW_MODE === 'github'
      ? `\n\nAfter the PR is open, handle github review cycle 1 yourself:
1. Trigger the review bot with its own one-line comment, no footer: \`gh pr comment <num> --body "${firstReviewTrigger(ex)}"\`. (If the repo's .github/workflows/${REVIEW_BOT}.yml uses a different trigger phrase, match it.)
2. Find that Actions run and \`gh run watch\` it. Read the resulting verdict on the current PR head.
3. If it is a bare LGTM with no actionable findings, stop the review work.
4. Otherwise invoke the \`fix-pr-review\` skill with the PR number and follow it exactly: re-validate each finding, fix or refute it, push, post dispositions, re-trigger through the skill's step-10 routing with \`@${REVIEW_BOT}\` as this cycle's review bot. The blocking re-trigger is keyed to the reviewer that actually ran cycle 1 — the trigger you posted in step 1 — and the band does not decide it, because the band only ever selected that reviewer. For this PR that makes the blocking re-trigger exactly \`${blockingRetrigger(ex)}\` and the non-blocking one \`${NONBLOCKING_RETRIGGER[REVIEW_BOT]}\`; post the one that matches what you addressed, verbatim.${REVIEW_BOT === 'claude' ? ' (That value already applies the rule: every reviewer above the standard trigger runs one blocking cycle only, so a `@claude fable review` cycle 1 steps down to `@claude opus review` and a `@claude opus review` cycle 1 steps down to `@claude review`, and neither trigger is ever repeated on a blocking re-review; a cycle 1 on the standard trigger or on sonnet sits at or below the ladder floor and repeats its own trigger, so that reviewer survives every cycle.)' : ' (This run selected Codex — never switch to @claude. Codex exposes one flagship and no fable tier, so its cycle-1 trigger simply repeats; the C81+ ladder stays on the bare trigger and never reaches luna.)'} Then wait for that re-review verdict.
5. Stop after that verdict. Do not fix the re-review's findings; the pipeline gives later cycles to another agent.

Return the standing verdict as github_review_status, the remaining non-blocking count, and a github_review_summary. If cycle 1 cannot finish, return github_review_status blocked and github_review_blocker.`
      : '\n\nThis run reviews pull requests with in-session subagents: do not trigger, request, or comment any `@claude` or `@codex` review — the pipeline dispatches its own reviewer against the open PR. Return github_review_status not_run, github_review_nonblocking_remaining 0, and an empty github_review_summary.'
  return `You are an implementation agent in this repo. Your job: implement GitHub issue #${issue} end-to-end and open a PR.

Validation summary (from a Fable review of the issue against the current code): ${validation.summary}
${predecessorContext ? `\nStable predecessor results (deduplicated):\n${predecessorContext}\n` : ''}${missingContext ? `\nSkipped predecessor results whose code does not exist:\n${missingContext}\n` : ''}${corrections ? `\nStep 1 — Update the issue body first. Load the \`github-issue-format\` skill BEFORE editing (mandatory), then apply these validation corrections to issue #${issue} (preserve the rest of the body — including the ## Execution block — and the [C..] title unless a correction says otherwise):\n${corrections}\nThe user approved this milestone run plan, which explicitly authorizes applying these validation corrections to this issue.\nFooter: \`Validated with LLM: ${footerModel} | ${ex.effort} | Harness: ${harness}\` — these are validation corrections, so the appended verb is \`Validated\`; stack it under the existing footer lines.\n` : ''}${plan ? `\nA Fable 5.1 implementation plan was posted on the issue — implement against it. Mirror its numbered steps into your task tracker before writing code, per work-on-issue step 2, and complete each item only when its verify point passes. Deviating is allowed only with a stated reason in the PR body.\n` : ''}${constraints.length ? `\nHard requirements from validation${plan ? ' and the plan' : ''} (violating any is a correctness failure):\n${constraints.map((c) => `- ${c}`).join('\n')}\n` : ''}
Invoke the \`work-on-issue\` skill with args \`${workOnIssueArgs}\`. When baseRefs are present, validate them and prepare the dependency base exactly as that skill requires before changing product files; never fall back to the default branch or omit a ref after an integration conflict. Implement per the ${corrections ? 'corrected ' : ''}issue body (its Acceptance criteria are the contract — including the negative ones), follow repo conventions in CLAUDE.md, and note dependency merge order in the PR body. Add tests for every behavior you introduce. Run the project's full test and build suites; if a test fails, verify whether it also fails on the unmodified base before dismissing it as pre-existing, and say so. Commit + open a PR closing #${issue}, footer \`Created with LLM: ${footerModel} | ${ex.effort} | Harness: ${harness}\`.${reviewDirective}

Verify the opened PR with \`gh pr view <num> --json headRefName,headRefOid\`. Return via StructuredOutput: pr_number, pr_url, head_ref (exact current headRefName after any cycle-1 fixes), head_sha (exact current headRefOid), summary, tests_passed, github_review_status, github_review_nonblocking_remaining, github_review_summary, any github_review_blocker, any implementation blocker, and flags the operator should know about. If implementation is blocked, return pr_number 0, empty head fields, and the blocker instead of guessing.`
}

function githubReviewBatchPrompt(issue, prNumber, ex, validation, plan, startCycle, cycleLimit) {
  const footerModel = footerModelName(ex)
  const harness = footerHarness(ex)
  const constraints = (validation.implementation_constraints || []).concat(plan ? plan.constraints : [])
  const endCycle = startCycle + cycleLimit - 1
  return `You are a PR review-resolution agent in this repo. You own review cycles ${startCycle} through ${endCycle} of at most ${MAX_REVIEW_CYCLES} for PR #${prNumber}. Read all state from the PR itself; do not assume anything a previous agent did. Run at most ${cycleLimit} cycle${cycleLimit === 1 ? '' : 's'}, and stop early on a bare LGTM or blocker.

For each assigned cycle:
1. Fetch the latest @${REVIEW_BOT} review on PR #${prNumber} (the github-actions bot comment carrying a verdict line). If a review run is still in flight, find its Actions run and \`gh run watch\` it rather than sleeping.
2. If that review is an LGTM with no actionable findings left on the current head, stop with status lgtm and nonblocking_remaining 0.
3. Otherwise invoke the \`fix-pr-review\` skill with args \`${prNumber}\` and follow it exactly: RE-VALIDATE every finding against the actual code before changing anything, fix what survives validation, resolve any merge conflicts with main, commit/push (footer \`Updated with LLM: ${footerModel} | ${ex.effort} | Harness: ${harness}\`), post a per-finding disposition comment, and re-trigger per that skill's step-10 routing with \`@${REVIEW_BOT}\` as this cycle's review bot (its own one-line comment, no footer): \`${NONBLOCKING_RETRIGGER[REVIEW_BOT]}\` when only non-blocking items were addressed, else the blocking trigger keyed to the reviewer that actually ran cycle 1. The band does not decide the blocking trigger — it only ever selected the cycle-1 reviewer. Cycle 1 of this PR was triggered with \`${firstReviewTrigger(ex)}\`; confirm that against the EARLIEST \`@${REVIEW_BOT} … review\` comment on the PR before you rely on it, ${firstReviewTrigger(ex) === NONBLOCKING_RETRIGGER[REVIEW_BOT] ? `and do NOT skip the \`${NONBLOCKING_RETRIGGER[REVIEW_BOT]}\` comments while you look: cycle 1 of THIS pull request was itself \`${NONBLOCKING_RETRIGGER[REVIEW_BOT]}\`, so the EARLIEST such comment is the genuine cycle 1 and the blocking re-trigger repeats it verbatim` : `skipping any \`${NONBLOCKING_RETRIGGER[REVIEW_BOT]}\` comment while you look — that is the cheap non-blocking re-trigger, which a pass posts at any band and which is not cycle 1 here, because cycle 1 was \`${firstReviewTrigger(ex)}\``}.${REVIEW_BOT === 'claude' ? ' Every reviewer above the standard trigger runs one blocking cycle only, so step down one rung per blocking re-review. If that cycle-1 trigger names fable, the rungs are `@claude opus review` when no `@claude opus review` comment follows the fable one, and `@claude review` once a step-down to opus has already happened. If it names opus, the single rung is `@claude review`, posted for the first blocking re-review and every one after it. Either ladder stops at `@claude review` and never reaches sonnet, and neither the fable nor the opus trigger is ever repeated on a blocking re-review. If the cycle-1 trigger is the standard `@claude review` or names sonnet, it sits at or below the ladder floor: repeat that same trigger verbatim for every blocking re-review, whatever the band, so that reviewer survives every cycle.' : ' Codex exposes one flagship and no fable tier, so repeat that cycle-1 trigger verbatim for every blocking re-review; never switch to @claude, which this run did not select.'}).
4. Wait for that re-review's verdict. If another assigned cycle remains and the verdict is not a bare LGTM, repeat from step 1. Otherwise stop.

The issue's Acceptance criteria${constraints.length ? ' and these hard requirements from validation' + (plan ? ' and the Fable plan' : '') : ''} OUTRANK any reviewer suggestion — reject findings that would weaken them and say why in the disposition.
${constraints.length ? constraints.map((c) => `- ${c}`).join('\n') + '\n' : ''}

Work ONLY in the PR branch's existing worktree (or add a worktree for the branch if missing) — never the main checkout.

At the stopping boundary, verify \`gh pr view ${prNumber} --json headRefName,headRefOid\`. Return via StructuredOutput: status (the verdict now standing on the PR: lgtm / needs_updates, or blocked), nonblocking_remaining, cycles_run (${cycleLimit === 1 ? 'exactly 1' : `1 or ${cycleLimit}`}, never above ${cycleLimit}), a summary of what you fixed or refuted, the exact head_ref and head_sha, and any blocker.`
}

function fixDispatch(ex, prompt, prNumber, cycleNote) {
  if (isCliHarness(ex.model)) {
    log(`PR #${prNumber}: ${cycleNote} fix pass forwards to ${buildModelName(ex)} @ ${ex.effort} through a ${MODEL_NAMES[CLI_DRIVER.model]} driver`)
    return { prompt: cliDriverPrompt(prompt, ex, 'fix'), model: CLI_DRIVER.model, effort: CLI_DRIVER.effort }
  }
  return { prompt, model: MODEL_IDS[ex.model] || 'opus', effort: ex.effort }
}

async function runGithubReviewLoop(issue, prNumber, ex, validation, plan, initialReview) {
  if (initialReview.status === 'not_run') {
    return { final_status: 'blocked', cycles_run: 0, summary: 'implementation agent did not complete github review cycle 1', head_ref: initialReview.head_ref, head_sha: initialReview.head_sha, blocker: 'github review cycle 1 was not run' }
  }
  const notes = [`cycle 1: ${initialReview.status}, ${initialReview.nonblocking_remaining} non-blocking remaining — ${initialReview.summary}`]
  let head = { ref: initialReview.head_ref, sha: initialReview.head_sha }
  let cycles = 1
  let standingStatus = initialReview.status

  log(`PR #${prNumber}: cycle 1 → ${initialReview.status}, ${initialReview.nonblocking_remaining} non-blocking remaining (implementation agent)`)
  if (initialReview.status === 'blocked') {
    return { final_status: 'blocked', cycles_run: cycles, summary: notes.join('\n'), head_ref: head.ref, head_sha: head.sha, blocker: initialReview.blocker || 'implementation agent review cycle blocked' }
  }
  if (initialReview.status === 'lgtm' && initialReview.nonblocking_remaining === 0) {
    return { final_status: 'lgtm', cycles_run: cycles, summary: notes.join('\n'), head_ref: head.ref, head_sha: head.sha }
  }

  while (cycles < MAX_REVIEW_CYCLES) {
    const startCycle = cycles + 1
    const cycleLimit = Math.min(2, MAX_REVIEW_CYCLES - cycles)
    const endCycle = startCycle + cycleLimit - 1
    const labelCycles = cycleLimit === 1 ? `c${startCycle}` : `c${startCycle}-c${endCycle}`
    const batch = fixDispatch(ex, githubReviewBatchPrompt(issue, prNumber, ex, validation, plan, startCycle, cycleLimit), prNumber, `cycles ${startCycle}-${endCycle}`)
    const batchResult = await agent(batch.prompt, {
      model: batch.model,
      effort: batch.effort,
      schema: githubReviewBatchSchema(cycleLimit),
      phase: 'Review Loop',
      label: `review-loop:PR#${prNumber} ${labelCycles}`,
    })
    if (!batchResult) {
      return { final_status: 'blocked', cycles_run: cycles, summary: notes.join('\n'), head_ref: head.ref, head_sha: head.sha, blocker: `cycles ${startCycle}-${endCycle} fix agent failed` }
    }
    if (!Number.isInteger(batchResult.cycles_run) || batchResult.cycles_run < 1 || batchResult.cycles_run > cycleLimit) {
      return { final_status: 'blocked', cycles_run: cycles, summary: notes.join('\n'), head_ref: head.ref, head_sha: head.sha, blocker: `cycles ${startCycle}-${endCycle} agent returned invalid cycles_run ${String(batchResult.cycles_run)}` }
    }
    cycles += batchResult.cycles_run
    standingStatus = batchResult.status
    head = { ref: batchResult.head_ref, sha: batchResult.head_sha }
    notes.push(`cycles ${startCycle}-${cycles}: ${batchResult.status}, ${batchResult.nonblocking_remaining} non-blocking remaining — ${batchResult.summary}`)
    log(`PR #${prNumber}: cycles ${startCycle}-${cycles} → ${batchResult.status}, ${batchResult.nonblocking_remaining} non-blocking remaining`)
    if (batchResult.status === 'blocked') {
      return { final_status: 'blocked', cycles_run: cycles, summary: notes.join('\n'), head_ref: head.ref, head_sha: head.sha, blocker: batchResult.blocker || `cycle ${cycles} blocked` }
    }
    if (batchResult.status === 'lgtm' && batchResult.nonblocking_remaining === 0) {
      return { final_status: 'lgtm', cycles_run: cycles, summary: notes.join('\n'), head_ref: head.ref, head_sha: head.sha }
    }
    if (batchResult.status === 'lgtm' && cycles >= MAX_REVIEW_CYCLES) {
      return { final_status: 'lgtm_with_nonblocking', cycles_run: cycles, summary: notes.join('\n'), head_ref: head.ref, head_sha: head.sha }
    }
  }
  return {
    final_status: standingStatus === 'lgtm' ? 'lgtm_with_nonblocking' : 'max_cycles_exhausted',
    cycles_run: cycles,
    summary: notes.join('\n'),
    head_ref: head.ref,
    head_sha: head.sha,
  }
}

function subagentReviewPrompt(issue, prNumber, cycle) {
  const reReview = cycle > 1
    ? ` This is re-review cycle ${cycle}: a fix pass addressed the previous review and posted a per-finding disposition comment — verify each disposition against the actual code rather than taking it on faith, and review any new commits in full.`
    : ''
  return `You are an independent pull-request review agent in this repo — you did not write this code; review it cold. Load the \`pr-review\` skill BEFORE composing anything (mandatory): its verdict line, section structure, materiality filter, and safety carve-out are the contract.${reReview}

Review PR #${prNumber}, which closes issue #${issue}:
1. \`gh pr view ${prNumber} --json headRefName,headRefOid,baseRefName,url,state\` — record the exact head you review.
2. \`git fetch origin\`, then read the full diff against the base AND every changed file in full at that head commit — the LGTM precondition requires completing every applicable Before you write item from the pr-review skill (including full-file reads, self-consistency, primary sourcing, and no charitable reading), from a detached checkout or worktree of the head commit, never the main checkout's working tree.
3. Read issue #${issue} (\`gh issue view ${issue}\`): its Acceptance criteria are the contract the PR must meet.
4. Take one CI snapshot (\`gh pr checks ${prNumber}\`): a failed check that traces to this PR's diff is evidence of a code defect — report the defect from the failing assertion/code, not the check status itself; pending checks are never waited on.
5. Post the review as ONE comment on PR #${prNumber} in the exact pr-review structure (footer verb Reviewed, harness milestone-pipeline).

Do NOT modify any files, do NOT fix anything, and do NOT trigger any \`@claude\` or \`@codex\` review comment.

Return via StructuredOutput: verdict (lgtm / needs_updates, matching the posted verdict line), blocking_count (### Needs Fixing + ### Requires Human Review items), nonblocking_count (### Recommended Optional + ### Create Follow-up Issue items), the exact head_ref and head_sha you reviewed, comment_url, and a one-paragraph summary.`
}

function subagentFixPrompt(issue, prNumber, ex, validation, plan, commentUrl) {
  const footerModel = footerModelName(ex)
  const harness = footerHarness(ex)
  const constraints = (validation.implementation_constraints || []).concat(plan ? plan.constraints : [])
  return `You are a PR review-resolution agent in this repo. A fresh review was just posted on PR #${prNumber} (${commentUrl}). Invoke the \`fix-pr-review\` skill with args \`${prNumber}\` and follow it exactly, with ONE override: do NOT trigger, post, or wait for any \`@claude\` or \`@codex\` re-review — this run re-reviews with an in-session subagent after you finish, so stop after pushing your fixes and posting the per-finding disposition comment.

RE-VALIDATE every finding against the actual code before changing anything; fix what survives validation (including filing any ### Create Follow-up Issue items per that skill), refute on the record what doesn't, resolve any merge conflicts with the base branch, run the full test and build suites, then commit and push (footer \`Updated with LLM: ${footerModel} | ${ex.effort} | Harness: ${harness}\`).

The issue's Acceptance criteria${constraints.length ? ' and these hard requirements from validation' + (plan ? ' and the Fable plan' : '') : ''} OUTRANK any reviewer suggestion — reject findings that would weaken them and say why in the disposition.
${constraints.length ? constraints.map((c) => `- ${c}`).join('\n') + '\n' : ''}
Work ONLY in the PR branch's existing worktree (or add a worktree for the branch if missing) — never the main checkout.

After pushing, verify \`gh pr view ${prNumber} --json headRefName,headRefOid\`. Return via StructuredOutput: fixed_count, refuted_count, the exact head_ref and head_sha after your push, a summary of what was fixed and what was refuted, and blocker ONLY if the pass could not complete.`
}

async function runSubagentReviewLoop(issue, prNumber, ex, validation, plan) {
  const bandReview = reviewBandFor(ex.review_complexity ?? ex.complexity).review
  const firstReview = { model: MODEL_IDS[ex.first_review_model] || bandReview.model, effort: ex.first_review_effort || bandReview.effort }
  const ladder = STEP_DOWN_LADDERS[firstReview.model]
  let stepDown = 0
  const nextBlockingReview = () => {
    if (!ladder) return firstReview
    const rung = ladder[Math.min(stepDown, ladder.length - 1)]
    stepDown += 1
    return rung
  }
  const notes = []
  let nextReview = firstReview
  let head = { ref: '', sha: '' }
  let cycles = 0
  while (cycles < MAX_REVIEW_CYCLES) {
    cycles += 1
    const reviewOptions = {
      effort: nextReview.effort,
      schema: SUBAGENT_REVIEW_SCHEMA,
      phase: 'Review Loop',
      label: `review:PR#${prNumber} c${cycles} (${nextReview.model || 'claude'}/${nextReview.effort})`,
    }
    if (nextReview.model) reviewOptions.model = nextReview.model
    const review = await agent(subagentReviewPrompt(issue, prNumber, cycles), reviewOptions)
    if (!review) {
      return { final_status: 'blocked', cycles_run: cycles, summary: notes.join('\n'), head_ref: head.ref, head_sha: head.sha, blocker: `cycle ${cycles} reviewer agent failed` }
    }
    head = { ref: review.head_ref, sha: review.head_sha }
    notes.push(`cycle ${cycles} review (${nextReview.model || 'claude'}/${nextReview.effort}): ${review.verdict}, ${review.blocking_count} blocking + ${review.nonblocking_count} non-blocking — ${review.summary}`)
    log(`PR #${prNumber}: cycle ${cycles} review (${nextReview.model || 'claude'}/${nextReview.effort}) → ${review.verdict}, ${review.blocking_count} blocking + ${review.nonblocking_count} non-blocking`)
    if (review.verdict === 'lgtm' && review.blocking_count + review.nonblocking_count === 0) {
      return { final_status: 'lgtm', cycles_run: cycles, summary: notes.join('\n'), head_ref: review.head_ref, head_sha: review.head_sha }
    }
    if (cycles >= MAX_REVIEW_CYCLES) {
      if (review.verdict === 'lgtm') {
        return { final_status: 'lgtm_with_nonblocking', cycles_run: cycles, summary: notes.join('\n'), head_ref: review.head_ref, head_sha: review.head_sha }
      }
      break
    }
    const fixDispatched = fixDispatch(ex, subagentFixPrompt(issue, prNumber, ex, validation, plan, review.comment_url), prNumber, `cycle ${cycles}`)
    const fix = await agent(fixDispatched.prompt, {
      model: fixDispatched.model,
      effort: fixDispatched.effort,
      schema: REVIEW_FIX_SCHEMA,
      phase: 'Review Loop',
      label: `fix:PR#${prNumber} c${cycles} (${ex.model}/${ex.effort})`,
    })
    if (!fix || fix.blocker) {
      return { final_status: 'blocked', cycles_run: cycles, summary: notes.join('\n'), head_ref: fix?.head_ref || head.ref, head_sha: fix?.head_sha || head.sha, blocker: fix?.blocker || `cycle ${cycles} fix agent failed` }
    }
    notes.push(`cycle ${cycles} fix: ${fix.fixed_count} fixed, ${fix.refuted_count} refuted — ${fix.summary}`)
    head = { ref: fix.head_ref, sha: fix.head_sha }
    nextReview = review.blocking_count === 0 ? { model: 'sonnet', effort: 'high' } : nextBlockingReview()
  }
  return { final_status: 'max_cycles_exhausted', cycles_run: cycles, summary: notes.join('\n'), head_ref: head.ref, head_sha: head.sha }
}

const prep = await agent(
  `You are a read-only prep agent in this repo. For each GitHub issue number in this list: ${ALL_ISSUES.join(', ')} — run \`gh issue view <n> --json title,body\` and extract:
- title: the issue title EXACTLY as \`gh issue view --json title\` reports it, including any [C<score>] prefix. Never shorten, reword, or strip the prefix: the runtime reconciles the complexity you report against this title, so a trimmed title makes a scored issue look unscored and routes the whole run to the most expensive band
- complexity: the integer from the [C<score>] title prefix. A literal [C0] is a real score of 0. When the title carries NO [C..] prefix at all, OMIT the field rather than sending 0 — the runtime treats absence as "unknown complexity" and routes it to the top band, and a filled-in 0 would claim the issue is the smallest possible change
- model: from the "## Execution" block's "**Build model:**" line — map "Fable 5.1"→fable, "Opus 5" (any Opus)→opus, Sonnet→sonnet, Haiku→haiku. When the line carries a parenthetical naming an external harness — "Luna (Codex CLI)", "Grok (Cursor CLI, cursor-grok-4.6-high)" — map "(Codex CLI…)"→codex and "(Cursor CLI…)"→cursor, set build_model_name to the name before the parenthetical (e.g. "Luna"), and set cli_model to the id after the comma inside the parenthetical when one is present; OMIT cli_model when the parenthetical carries no id, and OMIT both fields for Claude models
- effort: from "**Effort:**" — one of low/medium/high/xhigh/max; low and medium are Fable-only tiers and max is a Codex CLI-only tier, preserve them verbatim (including on another model) so the runtime can identify and normalize stale combinations
- plan_effort: from an optional "**Plan effort:**" line — one of low/medium/high/xhigh. When the line is absent, OMIT the field — absence means the fableplan stage runs at its high default. Preserve a stamped tier verbatim so the runtime can clamp xhigh to high and log it. Only the effort is stampable — never read a model from this line
- validate_effort: from an optional "**Validate effort:**" line — one of low/medium/high/xhigh. When the line is absent, OMIT the field — absence means validation runs at the [C..] band default. Preserve a stamped tier verbatim so the runtime can clamp or raise it and log the change
- fableplan: true when "**fableplan first:**" starts with "Yes"
- first_review_model / first_review_effort: from the optional "**PR review:**" line — when it names a first-review trigger like \`@claude fable review effort:high\`, extract that model and effort; when the line is a standard \`@claude\` trigger or absent, OMIT both fields — the runtime derives the default from the [C..] band, and it treats presence as "an operator stamped a trigger"
- do NOT extract a "**Validate model:**" line — the validate model is derived from the [C..] score band by the runtime and a stamped model is never read
If an issue has NO Execution block, set missing_block: true and fill the fields with conservative defaults (model opus, effort high, fableplan false — never fable: Fable builds only on an explicit stamp, and the runtime re-derives these from the validated score anyway). Do not modify anything anywhere.
Return via StructuredOutput.`,
  { schema: PREP_SCHEMA, phase: 'Prep', label: 'prep:execution-blocks', effort: 'low' }
)
if (!prep) throw new Error('prep agent failed — cannot resolve Execution blocks')
const SCORE_PREFIX = /^\s*\[C(\d+)\]/
const normalizedIssues = prep.issues.map((issue) => {
  const normalized = { ...issue }
  const prefixMatch = SCORE_PREFIX.exec(normalized.title || '')
  const prefixScore = prefixMatch ? Number(prefixMatch[1]) : undefined
  if (hasScore(normalized.complexity) && normalized.complexity !== prefixScore) {
    const titleSays = prefixMatch ? `reads [C${prefixScore}]` : 'carries no [C<score>] prefix'
    log(`#${normalized.number}: prep reported C${normalized.complexity} but the title ${titleSays} — routing as unscored (unknown), which takes the top band`)
    delete normalized.complexity
  } else if (!hasScore(normalized.complexity) && hasScore(prefixScore)) {
    log(`#${normalized.number}: prep omitted the score but the title reads [C${prefixScore}] — routing on the title prefix`)
    normalized.complexity = prefixScore
  }
  if (isCliHarness(normalized.model)) {
    const harness = CLI_HARNESSES[normalized.model]
    if (normalized.effort === 'max' && !harness.efforts.includes('max')) {
      log(`#${normalized.number}: normalized build effort max → xhigh for ${harness.label} (max is a Codex CLI-only tier)`)
      normalized.effort = 'xhigh'
    }
    if (!harness.efforts.includes(normalized.effort)) {
      log(`#${normalized.number}: normalized build effort ${normalized.effort} → high for ${harness.label}`)
      normalized.effort = 'high'
    }
    if (!normalized.cli_model) {
      const resolveDefault = harness.defaultModels[String(normalized.build_model_name || '').trim().toLowerCase()]
      if (resolveDefault) {
        normalized.cli_model = resolveDefault(normalized.effort)
      } else {
        normalized.cli_error = `Build model "${normalized.build_model_name || normalized.model}" on the ${harness.label} carries no CLI model id and has no known default — stamp it as "<Name> (${harness.label}, <model-id>)"`
        log(`#${normalized.number}: ${normalized.cli_error}`)
      }
    }
    if (normalized.cli_model && !CLI_MODEL_ID.test(String(normalized.cli_model))) {
      normalized.cli_error = `Build model id ${JSON.stringify(String(normalized.cli_model))} on the ${harness.label} carries a character outside the allowed set (letters, digits, ".", "_", ":", "-"; it must start with a letter or digit) — that id would reach a shell command, so the issue is blocked; stamp it as "<Name> (${harness.label}, <model-id>)" with a plain id`
      log(`#${normalized.number}: ${normalized.cli_error}`)
    }
  } else if (normalized.effort === 'max') {
    const ceiling = normalized.model === 'fable' ? 'high' : 'xhigh'
    log(`#${normalized.number}: normalized build effort max → ${ceiling} for ${MODEL_NAMES[normalized.model] || normalized.model} (max is a Codex CLI-only tier)`)
    normalized.effort = ceiling
  }
  if ((normalized.effort === 'medium' || normalized.effort === 'low') && normalized.model !== 'fable' && !isCliHarness(normalized.model)) {
    log(`#${normalized.number}: normalized build effort ${normalized.effort} → high for ${MODEL_NAMES[normalized.model] || normalized.model} (low/medium are Fable-only)`)
    normalized.effort = 'high'
  }
  if (normalized.model === 'fable' && normalized.effort === 'xhigh') {
    log(`#${normalized.number}: normalized build effort xhigh → high (Fable never runs at xhigh)`)
    normalized.effort = 'high'
  }
  const stampedPlanEffort = normalized.plan_effort
  if (normalized.plan_effort === 'xhigh') {
    log(`#${normalized.number}: normalized plan effort xhigh → high (Fable never runs at xhigh)`)
    normalized.plan_effort = 'high'
  }
  if (normalized.first_review_model === 'fable' && normalized.first_review_effort === 'xhigh') {
    log(`#${normalized.number}: normalized first-review effort xhigh → high (Fable never runs at xhigh)`)
    normalized.first_review_effort = 'high'
  }
  if (stampedPlanEffort && !normalized.fableplan && !normalized.missing_block) {
    log(`#${normalized.number}: ignoring Plan effort ${stampedPlanEffort} — fableplan is false, so no plan stage runs`)
  }
  return normalized
})
const EX = new Map(normalizedIssues.map((i) => [i.number, i]))
const missing = normalizedIssues.filter((i) => i.missing_block).map((i) => `#${i.number}`)
if (missing.length) log(`WARNING: no Execution block on ${missing.join(', ')} — build routing derives from each issue's validated score band`)

const results = []
const recordedIssues = new Set()

function addResult(result) {
  if (recordedIssues.has(result.issue)) throw new Error(`internal error: duplicate result for issue #${result.issue}`)
  recordedIssues.add(result.issue)
  results.push(result)
}

function dedupeRecords(records) {
  const seen = new Set()
  return records.filter((record) => {
    if (seen.has(record.issue)) return false
    seen.add(record.issue)
    return true
  })
}

function dedupeBaseRefs(values) {
  const seen = new Set()
  return values.filter((base) => {
    if (!base || seen.has(base.pr)) return false
    seen.add(base.pr)
    return true
  })
}

function verifiedHead(pr, ref, sha) {
  if (!Number.isInteger(pr) || pr <= 0) return null
  if (typeof ref !== 'string' || ref.length === 0) return null
  if (typeof sha !== 'string' || !/^[0-9a-f]{40,64}$/i.test(sha)) return null
  return { pr, ref, sha: sha.toLowerCase() }
}

function blockIssues(track, startIndex, reason, skipped, status = 'dependency_blocked') {
  for (const issue of track.issues.slice(startIndex)) {
    addResult({ issue, status, blocker: reason })
    skipped.push({ issue, reason })
    log(`#${issue}: blocked — ${reason}`)
  }
}

function trackOutcome(status, completed, skipped, head, unresolved, blocker) {
  return {
    status,
    completed: dedupeRecords(completed),
    skipped: dedupeRecords(skipped),
    head,
    unresolved,
    blocker,
  }
}

async function executeTrack(trackIndex) {
  const track = TRACKS[trackIndex]
  const hardPredecessors = await Promise.all(track.after.map(async (index) => ({ index, outcome: await runTrack(index) })))
  const orderingPredecessors = await Promise.all(track.runsAfter.map(async (index) => ({ index, outcome: await runTrack(index) })))
  const predecessorOutcomes = [...hardPredecessors, ...orderingPredecessors].map((entry) => entry.outcome)
  const inheritedCompleted = dedupeRecords(predecessorOutcomes.flatMap((outcome) => outcome.completed))
  const inheritedSkipped = dedupeRecords(predecessorOutcomes.flatMap((outcome) => outcome.skipped))

  const failedHard = hardPredecessors.find(({ outcome }) => outcome.status !== 'ready' || !outcome.head)
  if (failedHard) {
    const reason = `hard prerequisite track ${failedHard.index + 1} did not reach a stable code head: ${failedHard.outcome.blocker || failedHard.outcome.status}`
    const localSkipped = []
    blockIssues(track, 0, reason, localSkipped)
    return trackOutcome('blocked', inheritedCompleted, [...inheritedSkipped, ...localSkipped], null, false, reason)
  }

  const unresolvedOrdering = orderingPredecessors.find(({ outcome }) => outcome.unresolved)
  if (unresolvedOrdering) {
    const reason = `ordering prerequisite track ${unresolvedOrdering.index + 1} has an unresolved pull request: ${unresolvedOrdering.outcome.blocker || unresolvedOrdering.outcome.status}`
    const localSkipped = []
    blockIssues(track, 0, reason, localSkipped)
    return trackOutcome('blocked', inheritedCompleted, [...inheritedSkipped, ...localSkipped], null, false, reason)
  }

  const localCompleted = []
  const localSkipped = []
  let baseRefs = dedupeBaseRefs(hardPredecessors.map(({ outcome }) => outcome.head).filter((candidate) => candidate && !candidate.merged))
  let head = null
  let status = 'ready'
  let blocker = null
  let unresolved = false

  for (let issueIndex = 0; issueIndex < track.issues.length; issueIndex += 1) {
    const issue = track.issues[issueIndex]
    if (budget.total && budget.remaining() < BUDGET_FLOOR) {
      blocker = `token budget floor reached (${Math.round(budget.remaining() / 1000)}k of ${Math.round(budget.total / 1000)}k remaining, floor ${Math.round(BUDGET_FLOOR / 1000)}k)`
      log(`#${issue}: ${blocker}; deferring the rest of track ${trackIndex + 1}`)
      for (const deferred of track.issues.slice(issueIndex)) {
        addResult({ issue: deferred, status: 'budget_deferred', blocker })
        localSkipped.push({ issue: deferred, reason: `${blocker} — issue never started` })
      }
      status = 'blocked'
      break
    }
    const ex = EX.get(issue) || { number: issue, title: `#${issue}`, model: 'opus', effort: 'high', fableplan: false, missing_block: true }
    const completed = dedupeRecords([...inheritedCompleted, ...localCompleted])
    const skipped = dedupeRecords([...inheritedSkipped, ...localSkipped])
    if (ex.cli_error) {
      blocker = ex.cli_error
      log(`#${issue}: blocked before validation — ${blocker}; blocking later issues in track ${trackIndex + 1}`)
      addResult({ issue, status: 'blocked', blocker })
      localSkipped.push({ issue, reason: `${blocker} — issue never started` })
      status = 'blocked'
      blockIssues(track, issueIndex + 1, `unmet in-track hard prerequisite #${issue}: ${blocker}`, localSkipped)
      break
    }

    const validationPrompt = validatePrompt(issue, completed, skipped, baseRefs)
    const validateBand = bandFor(ex.complexity)
    const validateRoute = validateRouteFor(ex, validateBand)
    log(`#${issue}: ${hasScore(ex.complexity) ? `C${ex.complexity} (band ${validateBand.name})` : 'no [C..] prefix — unknown routes as the top band'} — validating on ${MODEL_NAMES[validateRoute.model]} @ ${validateRoute.effort}${validateRoute.note}`)
    const validationOptions = {
      model: validateRoute.model,
      effort: validateRoute.effort,
      schema: VALIDATION_SCHEMA,
      phase: 'Validate',
      label: `validate:#${issue}`,
    }
    const validationDispatch = await validateWithRetry(issue, validationPrompt, validationOptions)
    let validation = validationDispatch.validation
    blocker = validationDispatch.blocker
    if (!validation) {
      log(`#${issue}: ${blocker}; blocking later issues in track ${trackIndex + 1}`)
      addResult({ issue, status: 'validation_failed', blocker })
      localSkipped.push({ issue, reason: `${blocker} — issue never implemented` })
      status = 'blocked'
      blockIssues(track, issueIndex + 1, `unmet in-track hard prerequisite #${issue}: ${blocker}`, localSkipped)
      break
    }
    const rescored = Number.isInteger(validation.rescored_complexity) && validation.rescored_complexity > 0 ? validation.rescored_complexity : undefined
    let effectiveComplexity = hasScore(ex.complexity) ? ex.complexity : rescored
    if (hasScore(rescored) && BANDS.indexOf(bandFor(rescored)) > BANDS.indexOf(validateBand)) {
      effectiveComplexity = rescored
      const escalatedBand = bandFor(rescored)
      const escalatedRoute = validateRouteFor(ex, escalatedBand)
      log(`#${issue}: validator re-scored ${hasScore(ex.complexity) ? `C${ex.complexity}` : 'the unprefixed issue'} → C${rescored} (band ${escalatedBand.name}) — re-validating on ${MODEL_NAMES[escalatedRoute.model]} @ ${escalatedRoute.effort}${escalatedRoute.note}`)
      const escalatedDispatch = await validateWithRetry(issue, validationPrompt, { ...validationOptions, model: escalatedRoute.model, effort: escalatedRoute.effort })
      if (escalatedDispatch.validation) {
        validation = escalatedDispatch.validation
      } else {
        log(`#${issue}: escalated validation failed (${escalatedDispatch.blocker}) — the original ${MODEL_NAMES[validateRoute.model]} verdict stands`)
      }
    }
    let reviewComplexity = effectiveComplexity
    if (hasScore(reviewComplexity) && hasScore(rescored) &&
        REVIEW_BANDS.indexOf(reviewBandFor(rescored)) > REVIEW_BANDS.indexOf(reviewBandFor(reviewComplexity))) {
      log(`#${issue}: validator re-scored C${reviewComplexity} → C${rescored} across a review boundary — first review moves to review band ${reviewBandFor(rescored).name}`)
      reviewComplexity = rescored
    }
    ex.review_complexity = hasScore(ex.complexity) ? reviewComplexity : undefined

    if (ex.first_review_model && hasScore(ex.complexity) && hasScore(ex.review_complexity) &&
        REVIEW_BANDS.indexOf(reviewBandFor(ex.review_complexity)) > REVIEW_BANDS.indexOf(reviewBandFor(ex.complexity))) {
      const rescoredBand = reviewBandFor(ex.review_complexity)
      const stampedName = MODEL_NAMES[MODEL_IDS[ex.first_review_model]]
      if (reviewModelRank(rescoredBand.review.model) > reviewModelRank(MODEL_IDS[ex.first_review_model])) {
        log(`#${issue}: rescored review band ${rescoredBand.name} outranks the stamped first review ${stampedName} — dropping the stamp for the band default`)
        delete ex.first_review_model
        delete ex.first_review_effort
      } else {
        log(`#${issue}: keeping the stamped first review ${stampedName} — the rescored review band ${rescoredBand.name} does not outrank it, and a rescore never lowers review routing`)
      }
    }
    if (validation.verdict === 'INVALID') {
      blocker = validation.invalid_reason || validation.summary
      log(`#${issue}: INVALID — ${blocker}; blocking later issues in track ${trackIndex + 1}`)
      addResult({ issue, status: 'invalid', reason: blocker })
      localSkipped.push({ issue, reason: `validated INVALID — ${blocker}` })
      status = 'blocked'
      blockIssues(track, issueIndex + 1, `unmet in-track hard prerequisite #${issue}: ${blocker}`, localSkipped)
      break
    }

    let rescore = null
    if (!ex.missing_block && hasScore(ex.complexity) && BANDS.indexOf(bandFor(effectiveComplexity)) > BANDS.indexOf(bandFor(ex.complexity))) {
      const derived = derivedBuild(effectiveComplexity)
      const previousName = buildModelName(ex)
      rescore = {
        from: ex.complexity,
        to: effectiveComplexity,
        previous: { model: ex.model, effort: ex.effort, fableplan: ex.fableplan },
        rerouted: { model: derived.model, effort: derived.effort, fableplan: derived.fableplan },
      }
      if (isCliHarness(ex.model)) {
        rescore.rerouted = { model: ex.model, effort: ex.effort, fableplan: derived.fableplan }
        ex.fableplan = derived.fableplan
        log(`#${issue}: RESCORED C${rescore.from} → C${rescore.to} — keeping the stamped ${previousName} @ ${ex.effort} build (an external harness stamp is a deliberate override)${derived.fableplan && !rescore.previous.fableplan ? ', adding fableplan' : ''} (band ${derived.band.name}); the issue needs a [C${rescore.to}] restamp`)
      } else {
        ex.model = derived.model
        ex.effort = derived.effort
        ex.fableplan = derived.fableplan
        log(`#${issue}: RESCORED C${rescore.from} → C${rescore.to} — re-routing build ${previousName} @ ${rescore.previous.effort} → ${MODEL_NAMES[derived.model]} @ ${derived.effort}${derived.fableplan && !rescore.previous.fableplan ? ' with fableplan' : ''} (band ${derived.band.name}); the issue needs a [C${rescore.to}] restamp`)
      }
    }

    if (ex.missing_block) {
      const buildComplexity = hasScore(ex.complexity) ? effectiveComplexity : undefined
      const derived = derivedBuild(buildComplexity)
      ex.model = derived.model
      ex.effort = derived.effort
      ex.fableplan = derived.fableplan
      const source = hasScore(ex.complexity)
        ? `band ${derived.band.name}`
        : `band ${derived.band.name} (complexity unknown — no [C<score>] prefix, so a validator rescore never lowers the build route)`
      log(`#${issue}: no Execution block — deriving build ${MODEL_NAMES[derived.model]} @ ${derived.effort}${derived.fableplan ? ' with fableplan' : ''} from ${source}`)
    }
    const modelId = MODEL_IDS[ex.model] || 'opus'
    const cliBuild = isCliHarness(ex.model)

    let plan = null
    const planEffort = ex.plan_effort || 'high'
    if (ex.fableplan) {
      try {
        plan = await agent(planPrompt(issue, validation, planEffort), {
          model: 'fable',
          effort: planEffort,
          schema: PLAN_SCHEMA,
          phase: 'Plan',
          label: `plan:#${issue}`,
        })
      } catch (error) {
        log(`#${issue}: fableplan threw — ${error?.message || error}; building without a posted plan`)
      }
      if (!plan) log(`#${issue}: fableplan agent failed — building without a posted plan`)
    }

    log(`#${issue} (${hasScore(ex.complexity) ? `C${ex.complexity}` : 'unscored'}): ${validation.verdict} → implementing on ${buildModelName(ex)} @ ${ex.effort}${cliBuild ? ` (model id ${ex.cli_model}, driven by a ${MODEL_NAMES[CLI_DRIVER.model]} @ ${CLI_DRIVER.effort} driver agent)` : ''}${plan ? ` (against Fable plan @ ${planEffort})` : ''}`)
    let impl
    try {
      const taskPrompt = implementPrompt(issue, ex, validation, plan, completed, skipped, baseRefs, REVIEW_LOOP)
      impl = await agent(cliBuild ? cliDriverPrompt(taskPrompt, ex) : taskPrompt, {
        model: cliBuild ? CLI_DRIVER.model : modelId,
        effort: cliBuild ? CLI_DRIVER.effort : ex.effort,
        schema: IMPLEMENT_SCHEMA,
        phase: 'Implement',
        label: `implement:#${issue} (${buildLabel(ex)})`,
      })
    } catch (error) {
      impl = null
      blocker = `implementation threw: ${error?.message || error}`
    }

    const implementationHead = impl ? verifiedHead(impl.pr_number, impl.head_ref, impl.head_sha) : null
    if (!impl || !implementationHead) {
      blocker ||= impl?.blocker || (impl?.pr_number ? 'opened pull request without a verified head ref and commit' : 'implementation agent failed or opened no pull request')
      log(`#${issue}: blocked — ${blocker}; blocking later issues in track ${trackIndex + 1}`)
      addResult(rescore ? { issue, status: 'blocked', blocker, rescore } : { issue, status: 'blocked', blocker })
      localSkipped.push({ issue, reason: `implementation blocked — ${blocker}` })
      status = 'blocked'
      unresolved = !impl || Boolean(impl.pr_number)
      blockIssues(track, issueIndex + 1, `unmet in-track hard prerequisite #${issue}: ${blocker}`, localSkipped)
      break
    }

    head = implementationHead
    const record = {
      issue,
      status: 'pr_open',
      pr: impl.pr_number,
      pr_url: impl.pr_url,
      head_ref: impl.head_ref,
      head_sha: impl.head_sha,
      tests_passed: impl.tests_passed,
      flags: impl.flags || [],
    }
    if (rescore) record.rescore = rescore
    addResult(record)
    const reviewNote = REVIEW_LOOP
      ? REVIEW_MODE === 'subagent' ? ', dispatching subagent review; waiting for review readiness' : `, @${REVIEW_BOT} review triggered; waiting for review readiness`
      : ''
    log(`#${issue}: PR #${impl.pr_number} open on ${impl.head_ref}${reviewNote}`)

    if (REVIEW_LOOP) {
      let review
      try {
        review = REVIEW_MODE === 'subagent'
          ? await runSubagentReviewLoop(issue, impl.pr_number, ex, validation, plan)
          : await runGithubReviewLoop(issue, impl.pr_number, ex, validation, plan, {
              status: impl.github_review_status,
              nonblocking_remaining: impl.github_review_nonblocking_remaining,
              summary: impl.github_review_summary,
              blocker: impl.github_review_blocker,
              head_ref: impl.head_ref,
              head_sha: impl.head_sha,
            })
      } catch (error) {
        review = { final_status: 'blocked', cycles_run: 0, summary: `review-loop threw: ${error?.message || error}` }
      }
      review ||= { final_status: 'blocked', cycles_run: 0, summary: 'review-loop agent failed', head_ref: '', head_sha: '' }
      record.review = review
      const reviewApproved = review.final_status === 'lgtm' || review.final_status === 'lgtm_with_nonblocking'
      const reviewHead = verifiedHead(impl.pr_number, review.head_ref, review.head_sha)
      const reviewReady = reviewApproved && reviewHead?.ref === implementationHead.ref
      if (reviewHead) {
        head = reviewHead
        record.head_ref = review.head_ref
        record.head_sha = review.head_sha
      }
      record.status = reviewReady ? 'lgtm' : reviewApproved ? 'review_invalid_head' : `review_${review.final_status}`
      log(`PR #${impl.pr_number}: review loop ${review.final_status} after ${review.cycles_run} cycle(s)`)
      if (!reviewReady) {
        blocker = reviewApproved
          ? `PR #${impl.pr_number} review reached LGTM without a verified readiness head`
          : `PR #${impl.pr_number} review did not reach LGTM: ${review.summary}`
        localSkipped.push({ issue, reason: blocker })
        status = 'blocked'
        unresolved = true
        blockIssues(track, issueIndex + 1, `unmet in-track hard prerequisite #${issue}: ${blocker}`, localSkipped)
        break
      }
    }

    if (MERGE) {
      const recordedMerge = MERGED.get(issue)
      if (recordedMerge && recordedMerge.pr !== impl.pr_number) {
        blocker = `merged record for issue #${issue} names PR #${recordedMerge.pr}, but this run opened PR #${impl.pr_number} for it — correct the record before resuming`
        record.status = 'merge_record_mismatch'
        record.blocker = blocker
        log(`PR #${impl.pr_number}: ${blocker}`)
        localSkipped.push({ issue, reason: blocker })
        status = 'blocked'
        unresolved = true
        blockIssues(track, issueIndex + 1, `unmet in-track hard prerequisite #${issue}: ${blocker}`, localSkipped)
        break
      }
      if (!recordedMerge) {
        blocker = `PR #${impl.pr_number} awaits orchestrator merge (LGTM at ${head.ref} @ ${head.sha})`
        record.status = 'awaiting_merge'
        record.blocker = blocker
        log(`PR #${impl.pr_number}: awaiting orchestrator merge — merge it in-session, then resume with the args.merged record`)
        localSkipped.push({ issue, reason: blocker })
        status = 'blocked'
        unresolved = true
        blockIssues(track, issueIndex + 1, `hard prerequisite #${issue}: ${blocker}`, localSkipped, 'merge_pending')
        break
      }
      CONSUMED_MERGE_RECORDS.add(issue)
      record.status = 'merged'
      record.merge_sha = recordedMerge.merge_sha
      record.issue_state = recordedMerge.issue_state
      log(`PR #${impl.pr_number}: merged by the orchestrator; issue #${issue} ${recordedMerge.issue_state}`)
      head = { ...head, merged: true }
      localCompleted.push({ issue, prNumber: impl.pr_number, prUrl: impl.pr_url, head })
      baseRefs = []
    } else {
      localCompleted.push({ issue, prNumber: impl.pr_number, prUrl: impl.pr_url, head })
      baseRefs = [head]
    }
  }

  return trackOutcome(
    status,
    [...inheritedCompleted, ...localCompleted],
    [...inheritedSkipped, ...localSkipped],
    head,
    unresolved,
    blocker,
  )
}

const trackPromises = new Array(TRACKS.length)
function runTrack(trackIndex) {
  if (!trackPromises[trackIndex]) {
    trackPromises[trackIndex] = executeTrack(trackIndex).catch((error) => {
      const reason = `track ${trackIndex + 1} threw: ${error?.message || error}`
      const skipped = []
      const unresolved = REVIEW_LOOP && results.some((result) => TRACKS[trackIndex].issues.includes(result.issue) && result.pr && result.status !== 'lgtm')
      for (const issue of TRACKS[trackIndex].issues) {
        if (recordedIssues.has(issue)) continue
        addResult({ issue, status: 'track_failed', blocker: reason })
        skipped.push({ issue, reason })
      }
      log(reason)
      return trackOutcome('blocked', [], skipped, null, unresolved, reason)
    })
  }
  return trackPromises[trackIndex]
}

await parallel(TRACKS.map((_track, trackIndex) => () => runTrack(trackIndex)))

const resultOrder = new Map(ALL_ISSUES.map((issue, index) => [issue, index]))
results.sort((left, right) => resultOrder.get(left.issue) - resultOrder.get(right.issue))

const unmatched_merged_records = MERGED_INPUT
  .filter((entry) => !CONSUMED_MERGE_RECORDS.has(entry.issue))
  .map((entry) => ({ issue: entry.issue, pr: entry.pr, reason: results.find((result) => result.issue === entry.issue)?.status === 'merge_record_mismatch' ? 'record names a different PR than the run opened for this issue' : 'issue never reached the merge gate in this run' }))
for (const entry of unmatched_merged_records) {
  log(`merged record for issue #${entry.issue} (PR #${entry.pr}) was not used — ${entry.reason}`)
}

let release = null
if (RELEASE) {
  const mergedRecords = results.filter((result) => result.status === 'merged')
  if (results.length === 0 || mergedRecords.length !== results.length) {
    const summary = `release skipped — ${mergedRecords.length} of ${results.length} issues reached merged status`
    log(summary)
    release = { released: false, skipped: true, summary }
  } else {
    const summary = 'every issue merged — run sync-docs-release in-session (sync docs, land the doc change, then create-release)'
    log(`release deferred to the orchestrator: ${summary}`)
    release = { released: false, deferred: true, summary }
  }
}

const awaiting_merge = results
  .filter((result) => result.status === 'awaiting_merge')
  .map((result) => ({ issue: result.issue, pr: result.pr, pr_url: result.pr_url, head_ref: result.head_ref, head_sha: result.head_sha }))

return { results, release, awaiting_merge, unmatched_merged_records }
