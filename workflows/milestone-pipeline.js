export const meta = {
  name: 'milestone-pipeline',
  description: 'Implement a dependency graph of Execution-block-stamped GitHub issues — validate, plan, build from verified prerequisite heads, review each pull request to a stable readiness boundary, record orchestrator in-session merges at LGTM plus green CI, pause awaiting each unmerged one, and defer the release to the orchestrator when every issue merges',
  whenToUse: 'When the user has approved a milestone-workflow run plan. args: { tracks: [[2,3]] } or { tracks: [{issues:[2,3]}, {issues:[9], after:[0]}, {issues:[12], runsAfter:[0]}], reviewLoop?: true, reviewMode?: \'github\' | \'subagent\', reviewBot?: \'claude\' | \'codex\', maxReviewCycles?: 5, budgetFloor?: 80000, merge?: true, release?: true, merged?: [{issue, pr, merge_sha, issue_state}] }',
  phases: [
    { title: 'Prep', detail: 'read every issue\'s [C..] score and Execution block' },
    { title: 'Validate', detail: 'each issue is validated against its exact dependency base right before it starts — model and effort derived from its [C..] score band, never stamped' },
    { title: 'Plan', detail: 'Fable plans the issues flagged fableplan: Yes at each issue\'s Plan effort; plans posted to the issues', model: 'fable' },
    { title: 'Implement', detail: 'build each issue on its assigned model/effort in a worktree, open PR, and trigger the review bot only in github review mode' },
    { title: 'Review Loop', detail: 'build-agent first cycle plus fresh two-cycle fix agents against the review bot Action (default github mode, @claude unless reviewBot names codex) or reviewer/fixer subagent cycles, per PR until LGTM; unrelated tracks stay concurrent while successors wait' },
    { title: 'Merge', detail: 'no merge agents — the orchestrator merges in-session; PRs recorded in args.merged count as merged and successors build from the updated base branch, while an LGTM PR without a record pauses the run as awaiting_merge' },
    { title: 'Release', detail: 'when every issue merged: deferred to the orchestrator, which runs sync-docs-release in-session' },
  ],
}

// args.tracks accepts legacy issue-number arrays and dependency-aware objects.
// `after` is a hard code dependency; `runsAfter` is ordering only. Serial issues
// within every track are conservative hard dependencies because their edge kind
// is not explicit. The full graph is validated before any agent starts.
// Build model/effort/fableplan/plan effort come from each issue's ## Execution
// block (stamped by prd-to-issues, revised by execution-plan-review); validation
// and the first-review default derive from the [C..] score band (see BANDS for
// build and validation, REVIEW_BANDS for the reviewer).
// Prep preserves representable stale combinations so the runtime can normalize
// and log them before dispatch.
// Validation still runs as the first step of every issue. Predecessor PRs change
// the ground truth, so each issue is re-checked against its pinned dependency
// heads immediately before it starts.
// Some harness paths deliver args as a JSON string — normalize before validating.
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
// 'github' (default): reviews run through the repo's @claude Action, so the
// review history lives on GitHub under the same bot used outside pipeline
// runs. 'subagent' reviews in-session — a reviewer agent posts a
// pr-review comment, a fixer agent resolves it — the fallback when the
// repo lacks the Action or GitHub Actions is unavailable.
const REVIEW_MODE = ARGS.reviewMode ?? 'github'
// Which GitHub review bot the default github review mode talks to. Claude
// unless the caller explicitly names Codex — a repo having codex.yml installed
// does not select it. Ignored entirely in subagent review mode, which posts no
// GitHub trigger at all.
const REVIEW_BOT = ARGS.reviewBot ?? 'claude'
const MAX_REVIEW_CYCLES = ARGS.maxReviewCycles ?? 5
// Only enforced when the turn has a token target (budget.total set); below the
// floor, remaining issues defer cleanly instead of an agent dying at the ceiling.
// Checked at issue start only — best-effort, not a ceiling guarantee; size the
// floor to roughly one issue's worst-case cost (implement + full review loop).
const BUDGET_FLOOR = ARGS.budgetFloor ?? 80_000
// Merge gating stays LGTM-based, but no agent in this run ever merges: the
// orchestrator merges each PR in-session, under the user's own permission
// mode, and records it in args.merged on the next resume. Defaults to
// reviewLoop because LGTM is the merge criterion — with review loops off
// there is no completed criterion, so merging is off and asking for it
// explicitly is rejected. After a recorded merge, successors build from the
// updated base branch instead of stacking on unmerged predecessor heads.
const MERGE = ARGS.merge ?? REVIEW_LOOP
// When every issue merged, the run defers the release to the orchestrator,
// which runs sync-docs-release in-session (doc sync → land it →
// create-release). No agent runs here. Defaults to merge; meaningless without it.
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

// PRs the orchestrator already merged in-session, as { issue, pr, merge_sha,
// issue_state } records. The orchestrator verifies each PR is MERGED before
// recording it; this run never re-checks GitHub, so the record is the only
// evidence a merge happened and one mistyped number would otherwise report an
// open PR as merged, build successors from a base that lacks the code, and let
// the release fire. Every record therefore identifies the issue/PR PAIR: the
// map is keyed by issue (validated to belong to this run), and the merge gate
// additionally requires the recorded pr to equal the PR this run opened for
// that issue. An LGTM PR with no record pauses its track as awaiting_merge —
// the orchestrator merges it, appends the record, and resumes (cached agents
// replay). Records that never match a gated pair are reported, never ignored.
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
// Issues whose record the merge gate actually consumed. Anything left over at
// the end is a record this run never matched — surfaced, never silently unused.
const CONSUMED_MERGE_RECORDS = new Set()

const MODEL_IDS = { 'fable': 'fable', 'opus': 'opus', 'sonnet': 'sonnet', 'haiku': 'haiku' }
const MODEL_NAMES = { fable: 'Fable 5', opus: 'Opus 5', sonnet: 'Sonnet 5', haiku: 'Haiku 4.5' }

// Every routing default derives from the [C<score>] band. Stamped Execution
// fields (Build model, Effort, fableplan, Plan effort, PR review) override the
// build/plan/first-review defaults; validation is derived only — never stamped,
// so no issue can carry a stale validate line that nothing reads. An ABSENT score
// (no [C..] prefix) is unknown, not small: it routes as the top band. A literal
// [C0] is a real score and routes to the bottom band — see hasScore below.
// Fable never runs at xhigh, so the Fable rows cap at high.
const BANDS = [
  { name: '0–9', min: 0, max: 9, fableplan: false, validate: { model: 'opus', effort: 'medium' }, build: { model: 'sonnet', effort: 'high' } },
  { name: '10–20', min: 10, max: 20, fableplan: false, validate: { model: 'opus', effort: 'high' }, build: { model: 'sonnet', effort: 'xhigh' } },
  { name: '21–40', min: 21, max: 40, fableplan: false, validate: { model: 'opus', effort: 'high' }, build: { model: 'opus', effort: 'high' } },
  { name: '41–60', min: 41, max: 60, fableplan: false, validate: { model: 'opus', effort: 'xhigh' }, build: { model: 'opus', effort: 'xhigh' } },
  { name: '61–80', min: 61, max: 80, fableplan: true, validate: { model: 'fable', effort: 'medium' }, build: { model: 'opus', effort: 'high' } },
  { name: '81+', min: 81, max: Infinity, fableplan: true, validate: { model: 'fable', effort: 'high' }, build: { model: 'opus', effort: 'xhigh' } },
]

// The reviewer escalates on its own, coarser scale, so these boundaries (10, 40
// and 80) deliberately do not line up with the build/validate bands above. The
// reviewer is always a fresh agent — sharing the builder's model family is
// accepted; the fresh context is the isolation that matters. The 11–40 band's
// review is the standard bare-@claude reviewer: model null means "no override —
// inherit the session default". Sonnet takes the 0–10 first review, and it is
// also the cheaper re-review after a pass that addressed nothing blocking, in
// any band (see runSubagentReviewLoop). Fable reviews only cycle 1: after a
// fable first review, the blocking re-reviews step down one rung at a time,
// opus and then the standard bare-@claude reviewer, where the ladder stops —
// a C81+ PR never steps down to sonnet (see runSubagentReviewLoop).
const REVIEW_BANDS = [
  { name: '0–10', min: 0, max: 10, review: { model: 'sonnet', effort: 'high' } },
  { name: '11–40', min: 11, max: 40, review: { model: null, effort: 'high' } },
  { name: '41–80', min: 41, max: 80, review: { model: 'opus', effort: 'high' } },
  { name: '81+', min: 81, max: Infinity, review: { model: 'fable', effort: 'high' } },
]

// "No score" and a score of zero are distinct inputs. An absent [C..] prefix
// arrives as undefined and routes to the top band because the complexity is
// unknown; a literal [C0] is the smallest real score and routes to the bottom
// band. The prep normalizer below reconciles the field against the title, so a
// prep agent that reports a score the title does not carry cannot downgrade
// routing — any disagreement resolves to unknown, which is the top band.
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

// Codex exposes one flagship, so the heavy Claude reviewer tiers (opus and
// fable) and the bare-@claude tier collapse onto its bare default trigger; only
// the cheap tier — the C0–C10 band and the non-blocking re-review — has a
// distinct shorthand. A null entry means "no shorthand — bare trigger".
const CODEX_REVIEW_SHORTHAND = { fable: null, opus: null, sonnet: 'luna', haiku: 'luna' }

// The cheaper re-review shorthand after a pass that addressed nothing blocking,
// per fix-pr-review step 10.
const NONBLOCKING_RETRIGGER = { claude: '@claude sonnet review', codex: '@codex luna review' }

// The github-mode cycle-1 trigger comment, derived from the review band unless
// the issue stamps its own `@<bot> <model> review …` line. The C11–C40 band is
// the bare standard trigger; the Action picks its configured default model.
function firstReviewTrigger(ex) {
  const stamped = MODEL_IDS[ex.first_review_model]
  const review = reviewBandFor(ex.review_complexity ?? ex.complexity).review
  if (REVIEW_BOT === 'codex') {
    const source = stamped || review.model
    const shorthand = source ? CODEX_REVIEW_SHORTHAND[source] : null
    const effort = stamped ? ex.first_review_effort : null
    return `@codex${shorthand ? ` ${shorthand}` : ''} review${effort ? ` effort:${effort}` : ''}`
  }
  if (stamped) return `@claude ${stamped} review${ex.first_review_effort ? ` effort:${ex.first_review_effort}` : ''}`
  if (!review.model) return '@claude review'
  if (review.model === 'opus') return '@claude opus review'
  if (review.model === 'sonnet') return '@claude sonnet review'
  return `@claude ${review.model} review effort:${review.effort}`
}

// The trigger for a BLOCKING re-review, keyed to the reviewer that actually ran
// cycle 1 — never to the band, which only ever selected that reviewer. Fable
// reviews the first cycle only, so a Fable cycle 1 steps down one rung per
// blocking re-review (opus, then the bare trigger, where it stops). Every other
// cycle-1 reviewer repeats its own trigger, so an operator's stamped `PR review:`
// line survives every cycle. Codex has one flagship and no Fable tier, so its
// cycle-1 trigger always repeats. Mirrors runSubagentReviewLoop's FABLE_STEP_DOWN.
function blockingRetrigger(ex) {
  const cycle1 = firstReviewTrigger(ex)
  if (REVIEW_BOT !== 'codex' && /^@claude\s+fable\b/.test(cycle1)) return '@claude opus review'
  return cycle1
}

// Band-derived build for an issue with no Execution block: the band default.
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
          model: { type: 'string', enum: ['fable', 'opus', 'sonnet', 'haiku'], description: 'From "Build model:" — Fable 5→fable, Opus 5→opus, etc.' },
          effort: { type: 'string', enum: ['low', 'medium', 'high', 'xhigh'], description: 'Raw tier from "Effort:"; low and medium are Fable-only — runtime normalizes non-Fable low/medium→high' },
          plan_effort: { type: 'string', enum: ['low', 'medium', 'high', 'xhigh'], description: 'Raw tier from optional "Plan effort:"; OMIT this field entirely when the line is absent — the runtime defaults it to high, and its presence is how the runtime tells a stamped tier from an unstamped one. The planner is always Fable 5, so low/medium/high are legal; preserve a stamped xhigh verbatim so the runtime can clamp it to high and log (Fable never runs at xhigh). Ignored when fableplan is false' },
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

// A bounded github-mode review batch: the standing verdict after one or two
// cycles. The build agent handles cycle 1; every later agent handles at most
// two cycles. All durable state lives on the PR, so rotation loses no history.
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
  return `You are a read-only planning agent on Fable 5 in this repo. GitHub issue #${issue} is flagged "fableplan first" — the design is the hard part and a separate builder will implement your plan.

Validation summary: ${validation.summary}
${corrections}${constraints}
Fetch the issue (\`gh issue view ${issue}\`), read the referenced PRD sections and any relevant code, and produce a concrete implementation plan: files to create/modify, data shapes, control flow, edge cases, and the test list. Number the implementation steps (1., 2., …) and end each step with a verify point — the observable check that proves the step is done (a command to run, a test that passes, a file state to confirm). The builder mirrors these numbered steps into its progress tracker, so a step without a number or a verify point loses its anchor. Carry the same numbering and verify points into both the posted comment and the plan text you return. Plan the absolute-best solution — cost and code volume are not constraints; only correctness and safety are.

Post the plan as a comment on issue #${issue}, with the heading line \`## Implementation plan (Fable 5)\` above the plan body — \`work-on-issue\` step 0 matches on that heading to find a posted plan, so a standalone run later fails to recognize a plan posted without it (footer: \`Created with LLM: Fable 5 | ${planEffort} | Harness: milestone-pipeline\`). The user approved this milestone run plan, which explicitly authorizes commenting the plan on this issue — the comment is the handoff artifact the builder implements against, and posting it is the whole point of this step, not an incidental side effect. Do NOT modify any files, comment anywhere else, or start implementing.

Return via StructuredOutput: the plan text, and the distilled hard constraints the builder must honor.`
}

function implementPrompt(issue, ex, validation, plan, completed, skipped, baseRefs, reviewLoop) {
  const footerModel = MODEL_NAMES[ex.model]
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
4. Otherwise invoke the \`fix-pr-review\` skill with the PR number and follow it exactly: re-validate each finding, fix or refute it, push, post dispositions, re-trigger through the skill's step-10 routing with \`@${REVIEW_BOT}\` as this cycle's review bot. The blocking re-trigger is keyed to the reviewer that actually ran cycle 1 — the trigger you posted in step 1 — and the band does not decide it, because the band only ever selected that reviewer. For this PR that makes the blocking re-trigger exactly \`${blockingRetrigger(ex)}\` and the non-blocking one \`${NONBLOCKING_RETRIGGER[REVIEW_BOT]}\`; post the one that matches what you addressed, verbatim.${REVIEW_BOT === 'claude' ? ' (That value already applies the rule: a `@claude fable review` cycle 1 steps down to `@claude opus review`, because fable reviews the first cycle only and its trigger is never repeated; a cycle 1 on any other model repeats its own trigger, so a stamped reviewer survives every cycle.)' : ' (This run selected Codex — never switch to @claude. Codex exposes one flagship and no fable tier, so its cycle-1 trigger simply repeats; the C81+ ladder stays on the bare trigger and never reaches luna.)'} Then wait for that re-review verdict.
5. Stop after that verdict. Do not fix the re-review's findings; the pipeline gives later cycles to another agent.

Return the standing verdict as github_review_status, the remaining non-blocking count, and a github_review_summary. If cycle 1 cannot finish, return github_review_status blocked and github_review_blocker.`
      : '\n\nThis run reviews pull requests with in-session subagents: do not trigger, request, or comment any `@claude` or `@codex` review — the pipeline dispatches its own reviewer against the open PR. Return github_review_status not_run, github_review_nonblocking_remaining 0, and an empty github_review_summary.'
  return `You are an implementation agent in this repo. Your job: implement GitHub issue #${issue} end-to-end and open a PR.

Validation summary (from a Fable review of the issue against the current code): ${validation.summary}
${predecessorContext ? `\nStable predecessor results (deduplicated):\n${predecessorContext}\n` : ''}${missingContext ? `\nSkipped predecessor results whose code does not exist:\n${missingContext}\n` : ''}${corrections ? `\nStep 1 — Update the issue body first. Load the \`github-issue-format\` skill BEFORE editing (mandatory), then apply these validation corrections to issue #${issue} (preserve the rest of the body — including the ## Execution block — and the [C..] title unless a correction says otherwise):\n${corrections}\nThe user approved this milestone run plan, which explicitly authorizes applying these validation corrections to this issue.\nFooter: \`Validated with LLM: ${footerModel} | ${ex.effort} | Harness: milestone-pipeline\` — these are validation corrections, so the appended verb is \`Validated\`; stack it under the existing footer lines.\n` : ''}${plan ? `\nA Fable 5 implementation plan was posted on the issue — implement against it. Mirror its numbered steps into your task tracker before writing code, per work-on-issue step 2, and complete each item only when its verify point passes. Deviating is allowed only with a stated reason in the PR body.\n` : ''}${constraints.length ? `\nHard requirements from validation${plan ? ' and the plan' : ''} (violating any is a correctness failure):\n${constraints.map((c) => `- ${c}`).join('\n')}\n` : ''}
Invoke the \`work-on-issue\` skill with args \`${workOnIssueArgs}\`. When baseRefs are present, validate them and prepare the dependency base exactly as that skill requires before changing product files; never fall back to the default branch or omit a ref after an integration conflict. Implement per the ${corrections ? 'corrected ' : ''}issue body (its Acceptance criteria are the contract — including the negative ones), follow repo conventions in CLAUDE.md, and note dependency merge order in the PR body. Add tests for every behavior you introduce. Run the project's full test and build suites; if a test fails, verify whether it also fails on the unmodified base before dismissing it as pre-existing, and say so. Commit + open a PR closing #${issue}, footer \`Created with LLM: ${footerModel} | ${ex.effort} | Harness: milestone-pipeline\`.${reviewDirective}

Verify the opened PR with \`gh pr view <num> --json headRefName,headRefOid\`. Return via StructuredOutput: pr_number, pr_url, head_ref (exact current headRefName after any cycle-1 fixes), head_sha (exact current headRefOid), summary, tests_passed, github_review_status, github_review_nonblocking_remaining, github_review_summary, any github_review_blocker, any implementation blocker, and flags the operator should know about. If implementation is blocked, return pr_number 0, empty head fields, and the blocker instead of guessing.`
}

function githubReviewBatchPrompt(issue, prNumber, ex, validation, plan, startCycle, cycleLimit) {
  const footerModel = MODEL_NAMES[ex.model]
  const constraints = (validation.implementation_constraints || []).concat(plan ? plan.constraints : [])
  const endCycle = startCycle + cycleLimit - 1
  return `You are a PR review-resolution agent in this repo. You own review cycles ${startCycle} through ${endCycle} of at most ${MAX_REVIEW_CYCLES} for PR #${prNumber}. Read all state from the PR itself; do not assume anything a previous agent did. Run at most ${cycleLimit} cycle${cycleLimit === 1 ? '' : 's'}, and stop early on a bare LGTM or blocker.

For each assigned cycle:
1. Fetch the latest @${REVIEW_BOT} review on PR #${prNumber} (the github-actions bot comment carrying a verdict line). If a review run is still in flight, find its Actions run and \`gh run watch\` it rather than sleeping.
2. If that review is an LGTM with no actionable findings left on the current head, stop with status lgtm and nonblocking_remaining 0.
3. Otherwise invoke the \`fix-pr-review\` skill with args \`${prNumber}\` and follow it exactly: RE-VALIDATE every finding against the actual code before changing anything, fix what survives validation, resolve any merge conflicts with main, commit/push (footer \`Updated with LLM: ${footerModel} | ${ex.effort} | Harness: milestone-pipeline\`), post a per-finding disposition comment, and re-trigger per that skill's step-10 routing with \`@${REVIEW_BOT}\` as this cycle's review bot (its own one-line comment, no footer): \`${NONBLOCKING_RETRIGGER[REVIEW_BOT]}\` when only non-blocking items were addressed, else the blocking trigger keyed to the reviewer that actually ran cycle 1. The band does not decide the blocking trigger — it only ever selected the cycle-1 reviewer. Cycle 1 of this PR was triggered with \`${firstReviewTrigger(ex)}\`; confirm that against the EARLIEST \`@${REVIEW_BOT} … review\` comment on the PR before you rely on it.${REVIEW_BOT === 'claude' ? ' If that cycle-1 trigger names fable, step down one rung per blocking re-review — `@claude opus review` when no `@claude opus review` comment follows the fable one, and `@claude review` once a step-down to opus has already happened; that ladder stops at `@claude review` and never reaches sonnet, and the fable trigger is never repeated because fable reviews the first cycle only. If it names any other model, repeat that same trigger verbatim for every blocking re-review, whatever the band, so a stamped reviewer survives every cycle.' : ' Codex exposes one flagship and no fable tier, so repeat that cycle-1 trigger verbatim for every blocking re-review; never switch to @claude, which this run did not select.'}).
4. Wait for that re-review's verdict. If another assigned cycle remains and the verdict is not a bare LGTM, repeat from step 1. Otherwise stop.

The issue's Acceptance criteria${constraints.length ? ' and these hard requirements from validation' + (plan ? ' and the Fable plan' : '') : ''} OUTRANK any reviewer suggestion — reject findings that would weaken them and say why in the disposition.
${constraints.length ? constraints.map((c) => `- ${c}`).join('\n') + '\n' : ''}

Work ONLY in the PR branch's existing worktree (or add a worktree for the branch if missing) — never the main checkout.

At the stopping boundary, verify \`gh pr view ${prNumber} --json headRefName,headRefOid\`. Return via StructuredOutput: status (the verdict now standing on the PR: lgtm / needs_updates, or blocked), nonblocking_remaining, cycles_run (${cycleLimit === 1 ? 'exactly 1' : `1 or ${cycleLimit}`}, never above ${cycleLimit}), a summary of what you fixed or refuted, the exact head_ref and head_sha, and any blocker.`
}

// Script-owned github-mode loop: the build agent completes cycle 1, then each
// fresh fix agent completes at most two cycles. The stopping rules and return
// shape remain compatible with the merge gate.
async function runGithubReviewLoop(issue, prNumber, ex, validation, plan, initialReview) {
  const modelId = MODEL_IDS[ex.model]
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
    const batchResult = await agent(githubReviewBatchPrompt(issue, prNumber, ex, validation, plan, startCycle, cycleLimit), {
      model: modelId,
      effort: ex.effort,
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
5. Post the review as ONE comment on PR #${prNumber} in the exact pr-review structure (footer verb Validated, harness milestone-pipeline).

Do NOT modify any files, do NOT fix anything, and do NOT trigger any \`@claude\` or \`@codex\` review comment.

Return via StructuredOutput: verdict (lgtm / needs_updates, matching the posted verdict line), blocking_count (### Needs Fixing + ### Requires Human Review items), nonblocking_count (### Recommended Optional + ### Create Follow-up Issue items), the exact head_ref and head_sha you reviewed, comment_url, and a one-paragraph summary.`
}

function subagentFixPrompt(issue, prNumber, ex, validation, plan, commentUrl) {
  const footerModel = MODEL_NAMES[ex.model]
  const constraints = (validation.implementation_constraints || []).concat(plan ? plan.constraints : [])
  return `You are a PR review-resolution agent in this repo. A fresh review was just posted on PR #${prNumber} (${commentUrl}). Invoke the \`fix-pr-review\` skill with args \`${prNumber}\` and follow it exactly, with ONE override: do NOT trigger, post, or wait for any \`@claude\` or \`@codex\` re-review — this run re-reviews with an in-session subagent after you finish, so stop after pushing your fixes and posting the per-finding disposition comment.

RE-VALIDATE every finding against the actual code before changing anything; fix what survives validation (including filing any ### Create Follow-up Issue items per that skill), refute on the record what doesn't, resolve any merge conflicts with the base branch, run the full test and build suites, then commit and push (footer \`Updated with LLM: ${footerModel} | ${ex.effort} | Harness: milestone-pipeline\`).

The issue's Acceptance criteria${constraints.length ? ' and these hard requirements from validation' + (plan ? ' and the Fable plan' : '') : ''} OUTRANK any reviewer suggestion — reject findings that would weaken them and say why in the disposition.
${constraints.length ? constraints.map((c) => `- ${c}`).join('\n') + '\n' : ''}
Work ONLY in the PR branch's existing worktree (or add a worktree for the branch if missing) — never the main checkout.

After pushing, verify \`gh pr view ${prNumber} --json headRefName,headRefOid\`. Return via StructuredOutput: fixed_count, refuted_count, the exact head_ref and head_sha after your push, a summary of what was fixed and what was refuted, and blocker ONLY if the pass could not complete.`
}

// Orchestrates reviewer ↔ fixer cycles in-session: the reviewer posts a
// pr-review comment and returns its verdict; a fixer resolves it; repeat.
// First review runs on the issue's "PR review:" model/effort when one is
// stamped, else on the [C..] score's REVIEW_BANDS default;
// a re-review after a fix pass that addressed only non-blocking findings drops
// to sonnet/high, mirroring the fix-pr-review skill's @claude-sonnet routing.
// A fable first review is first-review-only, and the blocking re-reviews after
// it step down one rung at a time: opus/high for the first, then the standard
// bare-@claude reviewer (model null) for every one after that. The ladder stops
// there — it never steps down to sonnet, which is a band tier and the
// non-blocking tier, never a C81+ blocking rung.
// Returns the same shape as the github-mode review-loop agent. A needs_updates
// verdict on the final cycle ends the loop unfixed (max_cycles_exhausted) —
// never a fix push that no reviewer would see.
async function runSubagentReviewLoop(issue, prNumber, ex, validation, plan) {
  // model null means "no override — inherit the session default", the
  // subagent equivalent of the bare @claude trigger (band 0).
  const bandReview = reviewBandFor(ex.review_complexity ?? ex.complexity).review
  const firstReview = { model: MODEL_IDS[ex.first_review_model] || bandReview.model, effort: ex.first_review_effort || bandReview.effort }
  // Fable reviews the first cycle only, then the reviewer steps down one rung
  // per blocking re-review: opus for the first, the standard bare-@claude
  // reviewer for every one after that, where the ladder stops — it never drops
  // to sonnet. A non-fable first review keeps its own model for every blocking
  // re-review. Non-blocking cycles route to sonnet separately and never consume
  // a rung.
  const FABLE_STEP_DOWN = [{ model: 'opus', effort: 'high' }, { model: null, effort: 'high' }]
  let stepDown = 0
  const nextBlockingReview = () => {
    if (firstReview.model !== 'fable') return firstReview
    const rung = FABLE_STEP_DOWN[Math.min(stepDown, FABLE_STEP_DOWN.length - 1)]
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
    const fix = await agent(subagentFixPrompt(issue, prNumber, ex, validation, plan, review.comment_url), {
      model: MODEL_IDS[ex.model] || 'opus',
      effort: ex.effort,
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

// ---- Prep: one agent reads every issue's Execution block ----
const prep = await agent(
  `You are a read-only prep agent in this repo. For each GitHub issue number in this list: ${ALL_ISSUES.join(', ')} — run \`gh issue view <n> --json title,body\` and extract:
- title: the issue title EXACTLY as \`gh issue view --json title\` reports it, including any [C<score>] prefix. Never shorten, reword, or strip the prefix: the runtime reconciles the complexity you report against this title, so a trimmed title makes a scored issue look unscored and routes the whole run to the most expensive band
- complexity: the integer from the [C<score>] title prefix. A literal [C0] is a real score of 0. When the title carries NO [C..] prefix at all, OMIT the field rather than sending 0 — the runtime treats absence as "unknown complexity" and routes it to the top band, and a filled-in 0 would claim the issue is the smallest possible change
- model: from the "## Execution" block's "**Build model:**" line — map "Fable 5"→fable, "Opus 5" (any Opus)→opus, Sonnet→sonnet, Haiku→haiku
- effort: from "**Effort:**" — one of low/medium/high/xhigh; low and medium are Fable-only tiers, preserve them verbatim (including on a non-Fable model) so the runtime can identify and normalize stale combinations
- plan_effort: from the optional "**Plan effort:**" line — one of low/medium/high/xhigh. When the line is absent, OMIT the field rather than filling in a default: the runtime applies high itself, and it treats the field's presence as "an operator stamped a tier", so a filled-in default would make every unstamped issue look stamped. The fableplan stage always runs on Fable 5, so low and medium are legal here even though they are Fable-only build tiers; preserve a stamped xhigh verbatim so the runtime can clamp and log it (Fable never runs at xhigh). Only the effort is stampable — never read a model from this line
- fableplan: true when "**fableplan first:**" starts with "Yes"
- first_review_model / first_review_effort: from the optional "**PR review:**" line — when it names a first-review trigger like \`@claude fable review effort:high\`, extract that model and effort; when the line is a standard \`@claude\` trigger or absent, OMIT both fields — the runtime derives the default from the [C..] band, and it treats presence as "an operator stamped a trigger"
- do NOT extract a "**Validate effort:**" or "**Validate model:**" line — validation is derived from the [C..] score band by the runtime and a legacy stamp is never read
If an issue has NO Execution block, set missing_block: true and fill the fields with conservative defaults (model opus, effort high, fableplan false — never fable: Fable builds only on an explicit stamp, and the runtime re-derives these from the validated score anyway). Do not modify anything anywhere.
Return via StructuredOutput.`,
  { schema: PREP_SCHEMA, phase: 'Prep', label: 'prep:execution-blocks', effort: 'low' }
)
if (!prep) throw new Error('prep agent failed — cannot resolve Execution blocks')
const SCORE_PREFIX = /^\s*\[C(\d+)\]/
const normalizedIssues = prep.issues.map((issue) => {
  const normalized = { ...issue }
  // Prep reads complexity from the [C<score>] title prefix and nothing else, so
  // the runtime can check its work against the title it already has. Reconcile
  // the reported value against the prefix and drop to unknown on ANY
  // disagreement, not just a reported 0: a reported 0 on a [C50] title would
  // take the CHEAPEST band, and a reported 5 on a [C90] title the second
  // cheapest. Unknown takes the top band, so this only ever escalates routing.
  const prefixMatch = SCORE_PREFIX.exec(normalized.title || '')
  const prefixScore = prefixMatch ? Number(prefixMatch[1]) : undefined
  if (hasScore(normalized.complexity) && normalized.complexity !== prefixScore) {
    const titleSays = prefixMatch ? `reads [C${prefixScore}]` : 'carries no [C<score>] prefix'
    log(`#${normalized.number}: prep reported C${normalized.complexity} but the title ${titleSays} — routing as unscored (unknown), which takes the top band`)
    delete normalized.complexity
  }
  if ((normalized.effort === 'medium' || normalized.effort === 'low') && normalized.model !== 'fable') {
    log(`#${normalized.number}: normalized build effort ${normalized.effort} → high for ${MODEL_NAMES[normalized.model] || normalized.model} (low/medium are Fable-only)`)
    normalized.effort = 'high'
  }
  // Fable never runs at xhigh — high is its ceiling on every stage. Clamp, never dispatch.
  if (normalized.model === 'fable' && normalized.effort === 'xhigh') {
    log(`#${normalized.number}: normalized build effort xhigh → high (Fable never runs at xhigh)`)
    normalized.effort = 'high'
  }
  // The planner is always Fable 5, so a stamped xhigh Plan effort is illegal on every issue.
  if (normalized.plan_effort === 'xhigh') {
    log(`#${normalized.number}: normalized plan effort xhigh → high (the planner is Fable 5; Fable never runs at xhigh)`)
    normalized.plan_effort = 'high'
  }
  if (normalized.first_review_model === 'fable' && normalized.first_review_effort === 'xhigh') {
    log(`#${normalized.number}: normalized first-review effort xhigh → high (Fable never runs at xhigh)`)
    normalized.first_review_effort = 'high'
  }
  // A stamped Plan effort on a fableplan: false issue is never read. Say so once
  // rather than dropping it silently — the operator set a tier that does nothing.
  // Presence is the "operator stamped a tier" signal, which only holds because
  // prep is instructed to OMIT plan_effort when the line is absent (the default
  // is applied at dispatch instead). Never give prep a fill-in default for this
  // field or every unstamped issue starts logging here.
  // Skipped when the block was missing entirely: the defaults we filled in are
  // already reported by the missing-block warning below.
  if (normalized.plan_effort && !normalized.fableplan && !normalized.missing_block) {
    log(`#${normalized.number}: ignoring Plan effort ${normalized.plan_effort} — fableplan is false, so no plan stage runs`)
  }
  return normalized
})
const EX = new Map(normalizedIssues.map((i) => [i.number, i]))
const missing = normalizedIssues.filter((i) => i.missing_block).map((i) => `#${i.number}`)
if (missing.length) log(`WARNING: no Execution block on ${missing.join(', ')} — build routing derives from each issue's validated score band`)

// ---- Dependency graph: unrelated tracks run concurrently; every successor
// waits for its predecessors' stable readiness boundary. ----
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
  // Merged predecessor heads live on the base branch already — they satisfy the
  // hard edge without a baseRef, so successors build from the updated base.
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

    const validationPrompt = validatePrompt(issue, completed, skipped, baseRefs)
    const validateBand = bandFor(ex.complexity)
    const validateRoute = validateBand.validate
    log(`#${issue}: ${hasScore(ex.complexity) ? `C${ex.complexity} (band ${validateBand.name})` : 'no [C..] prefix — unknown routes as the top band'} — validating on ${MODEL_NAMES[validateRoute.model]} @ ${validateRoute.effort}`)
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
    // Escalation: the validator's own score outranks the title prefix upward,
    // never downward. An under-scored issue got the weakest validator — the
    // one least likely to catch the under-score — so a higher rescored band
    // re-validates once on that band's stronger route before the verdict
    // stands. The escalated score also drives downstream band defaults.
    // The validator returns 0 both for "I scored it zero" and for "I could not
    // score it", so an unscored issue with no usable rescore stays unknown
    // rather than collapsing onto the bottom band.
    const rescored = Number.isInteger(validation.rescored_complexity) && validation.rescored_complexity > 0 ? validation.rescored_complexity : undefined
    let effectiveComplexity = hasScore(ex.complexity) ? ex.complexity : rescored
    if (hasScore(rescored) && BANDS.indexOf(bandFor(rescored)) > BANDS.indexOf(validateBand)) {
      effectiveComplexity = rescored
      const escalatedBand = bandFor(rescored)
      log(`#${issue}: validator re-scored ${hasScore(ex.complexity) ? `C${ex.complexity}` : 'the unprefixed issue'} → C${rescored} (band ${escalatedBand.name}) — re-validating on ${MODEL_NAMES[escalatedBand.validate.model]} @ ${escalatedBand.validate.effort}`)
      const escalatedDispatch = await validateWithRetry(issue, validationPrompt, { ...validationOptions, model: escalatedBand.validate.model, effort: escalatedBand.validate.effort })
      if (escalatedDispatch.validation) {
        validation = escalatedDispatch.validation
      } else {
        log(`#${issue}: escalated validation failed (${escalatedDispatch.blocker}) — the original ${MODEL_NAMES[validateRoute.model]} verdict stands`)
      }
    }
    // Review routing is clamped the way the validate band above is: upward only.
    // An issue with no [C<score>] prefix has UNKNOWN complexity, which reviews on
    // the heaviest row, so a validator rescore of 5 must not hand it the cheapest
    // reviewer. Nothing outranks the top band, so an unscored issue simply stays
    // unknown here; a scored issue keeps the escalated value, which can only rise.
    ex.review_complexity = hasScore(ex.complexity) ? effectiveComplexity : undefined
    if (validation.verdict === 'INVALID') {
      blocker = validation.invalid_reason || validation.summary
      log(`#${issue}: INVALID — ${blocker}; blocking later issues in track ${trackIndex + 1}`)
      addResult({ issue, status: 'invalid', reason: blocker })
      localSkipped.push({ issue, reason: `validated INVALID — ${blocker}` })
      status = 'blocked'
      blockIssues(track, issueIndex + 1, `unmet in-track hard prerequisite #${issue}: ${blocker}`, localSkipped)
      break
    }

    // A validated rescore that lands in a higher band re-routes the stamped
    // build too: the stamp predates the rescore, so the stronger band default
    // replaces it (upward only — a downward rescore never weakens routing).
    // The rescore rides on the issue's result record so the orchestrator can
    // restamp the [C..] title and Execution block and tell the user.
    let rescore = null
    if (!ex.missing_block && hasScore(ex.complexity) && BANDS.indexOf(bandFor(effectiveComplexity)) > BANDS.indexOf(bandFor(ex.complexity))) {
      const derived = derivedBuild(effectiveComplexity)
      rescore = {
        from: ex.complexity,
        to: effectiveComplexity,
        previous: { model: ex.model, effort: ex.effort, fableplan: ex.fableplan },
        rerouted: { model: derived.model, effort: derived.effort, fableplan: derived.fableplan },
      }
      ex.model = derived.model
      ex.effort = derived.effort
      ex.fableplan = derived.fableplan
      // A stamped first-review trigger predates the rescore too — the band
      // default for the rescored band takes over.
      delete ex.first_review_model
      delete ex.first_review_effort
      log(`#${issue}: RESCORED C${rescore.from} → C${rescore.to} — re-routing build ${MODEL_NAMES[rescore.previous.model]} @ ${rescore.previous.effort} → ${MODEL_NAMES[derived.model]} @ ${derived.effort}${derived.fableplan && !rescore.previous.fableplan ? ' with fableplan' : ''} (band ${derived.band.name}); the issue needs a [C${rescore.to}] restamp`)
    }

    // An issue with no Execution block now has a validated score — derive its
    // build and fableplan from the band instead of a conservative constant.
    if (ex.missing_block) {
      const derived = derivedBuild(effectiveComplexity)
      ex.model = derived.model
      ex.effort = derived.effort
      ex.fableplan = derived.fableplan
      log(`#${issue}: no Execution block — deriving build ${MODEL_NAMES[derived.model]} @ ${derived.effort}${derived.fableplan ? ' with fableplan' : ''} from band ${derived.band.name}`)
    }
    // Fable is never a build fallback — it builds only on an explicit user stamp.
    const modelId = MODEL_IDS[ex.model] || 'opus'

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

    log(`#${issue} (${hasScore(ex.complexity) ? `C${ex.complexity}` : 'unscored'}): ${validation.verdict} → implementing on ${MODEL_NAMES[modelId]} @ ${ex.effort}${plan ? ` (against Fable plan @ ${planEffort})` : ''}`)
    let impl
    try {
      impl = await agent(implementPrompt(issue, ex, validation, plan, completed, skipped, baseRefs, REVIEW_LOOP), {
        model: modelId,
        effort: ex.effort,
        schema: IMPLEMENT_SCHEMA,
        phase: 'Implement',
        label: `implement:#${issue} (${modelId}/${ex.effort})`,
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
      // No merge agent runs in this workflow: merging is the orchestrator's
      // job, in-session. A PR recorded in args.merged already landed (the
      // orchestrator verified it MERGED before recording); an unrecorded PR
      // pauses the track here so the orchestrator can gate on CI, merge it
      // pinned to this reviewed head, and resume with the record appended.
      const recordedMerge = MERGED.get(issue)
      if (recordedMerge && recordedMerge.pr !== impl.pr_number) {
        // The record claims a different PR closed this issue. One of the two
        // numbers is wrong, so neither can be trusted: refuse to count this as
        // merged, and block descendants rather than build them from a base
        // branch that may not contain the code. The record stays unconsumed so
        // the end-of-run report names it.
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

// A record the merge gate never consumed means the orchestrator's bookkeeping
// and this run disagree — the issue never reached the gate, or its record was
// rejected as a mismatch. Name each one so a wrong record can never look like
// a silently accepted merge.
const unmatched_merged_records = MERGED_INPUT
  .filter((entry) => !CONSUMED_MERGE_RECORDS.has(entry.issue))
  .map((entry) => ({ issue: entry.issue, pr: entry.pr, reason: results.find((result) => result.issue === entry.issue)?.status === 'merge_record_mismatch' ? 'record names a different PR than the run opened for this issue' : 'issue never reached the merge gate in this run' }))
for (const entry of unmatched_merged_records) {
  log(`merged record for issue #${entry.issue} (PR #${entry.pr}) was not used — ${entry.reason}`)
}

// ---- Release: only when every issue in the run reached merged — a partial
// milestone never publishes. No agent runs here either: the release lands a
// doc change and publishes, so it belongs to the orchestrator in-session. ----
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

// Every LGTM PR still waiting on an orchestrator merge, so the orchestrator
// can merge each one and resume without re-parsing per-issue results.
const awaiting_merge = results
  .filter((result) => result.status === 'awaiting_merge')
  .map((result) => ({ issue: result.issue, pr: result.pr, pr_url: result.pr_url, head_ref: result.head_ref, head_sha: result.head_sha }))

return { results, release, awaiting_merge, unmatched_merged_records }
