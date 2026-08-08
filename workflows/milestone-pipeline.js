export const meta = {
  name: 'milestone-pipeline',
  description: 'Implement a dependency graph of Execution-block-stamped GitHub issues — validate, plan, build from verified prerequisite heads, review each pull request to a stable readiness boundary, merge at LGTM plus green CI, and cut a release when every issue merges',
  whenToUse: 'When the user has approved a milestone-workflow run plan. args: { tracks: [[2,3]] } or { tracks: [{issues:[2,3]}, {issues:[9], after:[0]}, {issues:[12], runsAfter:[0]}], reviewLoop?: true, reviewMode?: \'subagent\' | \'github\', maxReviewCycles?: 5, budgetFloor?: 80000, merge?: true, release?: true }',
  phases: [
    { title: 'Prep', detail: 'read every issue\'s [C..] score and Execution block' },
    { title: 'Validate', detail: 'each issue is validated against its exact dependency base right before it starts — model and effort derived from its [C..] score band, never stamped' },
    { title: 'Plan', detail: 'Fable plans the issues flagged fableplan: Yes at each issue\'s Plan effort; plans posted to the issues', model: 'fable' },
    { title: 'Implement', detail: 'build each issue on its assigned model/effort in a worktree, open PR, and trigger @claude review only in github review mode' },
    { title: 'Review Loop', detail: 'reviewer/fixer subagent cycles (default) or build-agent first cycle plus fresh two-cycle fix agents against @claude in github mode, per PR until LGTM; unrelated tracks stay concurrent while successors wait' },
    { title: 'Merge', detail: 'squash-merge each PR at LGTM plus green CI on the pinned reviewed head, delete its branch, confirm its issue closed; successors then build from the updated base branch', model: 'sonnet' },
    { title: 'Release', detail: 'when every issue merged: sync docs and publish a GitHub release via the sync-docs-release skill', model: 'sonnet' },
  ],
}

// args.tracks accepts legacy issue-number arrays and dependency-aware objects.
// `after` is a hard code dependency; `runsAfter` is ordering only. Serial issues
// within every track are conservative hard dependencies because their edge kind
// is not explicit. The full graph is validated before any agent starts.
// Build model/effort/fableplan/plan effort come from each issue's ## Execution
// block (stamped by prd-to-issues, revised by execution-plan-review); validation
// and the first-review default derive from the [C..] score band (see BANDS).
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
// 'subagent' (default): reviews run as in-session subagents — a reviewer agent
// posts a pr-review-format comment, a fixer agent resolves it, orchestrated by
// this script; no GitHub Actions dependency (runner outages can't stall the
// loop) and no queue latency. 'github' preserves the @claude Action flow.
const REVIEW_MODE = ARGS.reviewMode ?? 'subagent'
const MAX_REVIEW_CYCLES = ARGS.maxReviewCycles ?? 5
// Only enforced when the turn has a token target (budget.total set); below the
// floor, remaining issues defer cleanly instead of an agent dying at the ceiling.
// Checked at issue start only — best-effort, not a ceiling guarantee; size the
// floor to roughly one issue's worst-case cost (implement + full review loop).
const BUDGET_FLOOR = ARGS.budgetFloor ?? 80_000
// Merge each PR once it reaches LGTM readiness (plus green CI, checked by the
// merge agent). Defaults to reviewLoop because LGTM is the merge criterion —
// with review loops off there is no completed criterion, so merging is off and
// asking for it explicitly is rejected. After a merge, successors build from
// the updated base branch instead of stacking on unmerged predecessor heads.
const MERGE = ARGS.merge ?? REVIEW_LOOP
// When every issue merged, one Sonnet agent runs sync-docs-release (doc sync →
// land it → create-release). Defaults to merge; meaningless without it.
const RELEASE = ARGS.release ?? MERGE
if (typeof REVIEW_LOOP !== 'boolean') throw new Error('reviewLoop must be a boolean')
if (REVIEW_MODE !== 'subagent' && REVIEW_MODE !== 'github') throw new Error("reviewMode must be 'subagent' or 'github'")
if (!Number.isInteger(MAX_REVIEW_CYCLES) || MAX_REVIEW_CYCLES <= 0) throw new Error('maxReviewCycles must be a positive integer')
if (!Number.isInteger(BUDGET_FLOOR) || BUDGET_FLOOR <= 0) throw new Error('budgetFloor must be a positive integer')
if (typeof MERGE !== 'boolean') throw new Error('merge must be a boolean')
if (MERGE && !REVIEW_LOOP) throw new Error('merge requires reviewLoop — LGTM review readiness is the merge criterion')
if (typeof RELEASE !== 'boolean') throw new Error('release must be a boolean')
if (RELEASE && !MERGE) throw new Error('release requires merge — a release only makes sense after the run lands the code')
const ALL_ISSUES = TRACKS.flatMap((track) => track.issues)

const MODEL_IDS = { 'fable': 'fable', 'opus': 'opus', 'sonnet': 'sonnet', 'haiku': 'haiku' }
const MODEL_NAMES = { fable: 'Fable 5', opus: 'Opus 5', sonnet: 'Sonnet 5', haiku: 'Haiku 4.5' }

// Every routing default derives from the [C<score>] band. Stamped Execution
// fields (Build model, Effort, fableplan, Plan effort, PR review) override the
// build/plan/first-review defaults; validation is derived only — never stamped,
// so no issue can carry a stale validate line that nothing reads. A score of 0
// means "no [C..] prefix", which is unknown, not small: it routes as the top
// band. Fable never runs at xhigh, so the Fable rows cap at high.
// The reviewer is always a fresh agent — sharing the builder's model family
// is accepted; the fresh context is the isolation that matters. Sonnet never
// takes a first review: it appears only as the cheaper re-review after a pass
// that addressed nothing blocking (see runSubagentReviewLoop).
const BANDS = [
  { name: '0–24', min: 0, max: 24, fableplan: false, validate: { model: 'opus', effort: 'medium' }, build: { model: 'sonnet', effort: 'xhigh' }, review: { model: 'opus', effort: 'high' } },
  { name: '25–49', min: 25, max: 49, fableplan: false, validate: { model: 'opus', effort: 'high' }, build: { model: 'opus', effort: 'xhigh' }, review: { model: 'opus', effort: 'high' } },
  { name: '50–74', min: 50, max: 74, fableplan: true, validate: { model: 'fable', effort: 'high' }, build: { model: 'opus', effort: 'high' }, review: { model: 'opus', effort: 'high' } },
  { name: '75+', min: 75, max: Infinity, fableplan: true, validate: { model: 'fable', effort: 'high' }, build: { model: 'fable', effort: 'high' }, review: { model: 'fable', effort: 'high' } },
]

function bandFor(complexity) {
  if (!Number.isInteger(complexity) || complexity <= 0) return BANDS[BANDS.length - 1]
  return BANDS.find((band) => complexity >= band.min && complexity <= band.max) || BANDS[BANDS.length - 1]
}

// Band-derived build for an issue with no Execution block: the band default,
// with one relief valve — a trivial band-0 issue (Capability 0, Volume ≤ 7,
// so score ≤ 7) builds at high instead of xhigh.
function derivedBuild(complexity) {
  const band = bandFor(complexity)
  const effort = band === BANDS[0] && complexity > 0 && complexity <= 7 ? 'high' : band.build.effort
  return { model: band.build.model, effort, fableplan: band.fableplan, band }
}

const PREP_SCHEMA = {
  type: 'object',
  required: ['issues'],
  properties: {
    issues: {
      type: 'array',
      items: {
        type: 'object',
        required: ['number', 'title', 'complexity', 'model', 'effort', 'fableplan'],
        properties: {
          number: { type: 'integer' },
          title: { type: 'string' },
          complexity: { type: 'integer', description: 'From the [C..] title prefix; 0 if absent' },
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
    plan: { type: 'string', description: 'The full implementation plan as posted to the issue' },
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
    verdict: { type: 'string', enum: ['lgtm', 'needs_updates'], description: 'The pr-review-format verdict line of the posted review' },
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

const MERGE_SCHEMA = {
  type: 'object',
  required: ['merged', 'merge_sha', 'issue_state', 'summary'],
  properties: {
    merged: { type: 'boolean' },
    merge_sha: { type: 'string', description: 'Merge commit SHA on the base branch; empty when merged is false' },
    issue_state: { type: 'string', enum: ['closed', 'open', 'unknown'], description: 'State of the linked issue after the merge' },
    branch_deleted: { type: 'boolean', description: 'Whether the PR head branch was deleted' },
    summary: { type: 'string' },
    blocker: { type: 'string', description: 'Only when merged is false: what stopped the merge' },
  },
}

const RELEASE_SCHEMA = {
  type: 'object',
  required: ['released', 'summary'],
  properties: {
    released: { type: 'boolean' },
    tag: { type: 'string', description: 'Published release tag; empty when released is false' },
    release_url: { type: 'string' },
    docs_change: { type: 'string', enum: ['pr_merged', 'direct_commit', 'none_needed'], description: 'How the doc sync landed' },
    summary: { type: 'string' },
    blocker: { type: 'string', description: 'Only when released is false: what stopped the release' },
  },
}

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
Fetch the issue (\`gh issue view ${issue}\`), read the referenced PRD sections and any relevant code, and produce a concrete implementation plan: files to create/modify, data shapes, control flow, edge cases, and the test list. Plan the absolute-best solution — cost and code volume are not constraints; only correctness and safety are.

Post the plan as a comment on issue #${issue} (footer: \`Created with LLM: Fable 5 | ${planEffort} | Harness: milestone-pipeline\`). The user approved this milestone run plan, which explicitly authorizes commenting the plan on this issue — the comment is the handoff artifact the builder implements against, and posting it is the whole point of this step, not an incidental side effect. Do NOT modify any files, comment anywhere else, or start implementing.

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
1. Trigger the review bot with its own one-line comment, no footer: \`gh pr comment <num> --body "@claude review"\`. (If the repo's .github/workflows/claude.yml uses a different trigger phrase, match it.)
2. Find that Actions run and \`gh run watch\` it. Read the resulting verdict on the current PR head.
3. If it is a bare LGTM with no actionable findings, stop the review work.
4. Otherwise invoke the \`fix-pr-review\` skill with the PR number and follow it exactly: re-validate each finding, fix or refute it, push, post dispositions, re-trigger through the skill's step-7 routing, and wait for that re-review verdict.
5. Stop after that verdict. Do not fix the re-review's findings; the pipeline gives later cycles to another agent.

Return the standing verdict as github_review_status, the remaining non-blocking count, and a github_review_summary. If cycle 1 cannot finish, return github_review_status blocked and github_review_blocker.`
      : '\n\nThis run reviews pull requests with in-session subagents: do not trigger, request, or comment any `@claude` review — the pipeline dispatches its own reviewer against the open PR. Return github_review_status not_run, github_review_nonblocking_remaining 0, and an empty github_review_summary.'
  return `You are an implementation agent in this repo. Your job: implement GitHub issue #${issue} end-to-end and open a PR.

Validation summary (from a Fable review of the issue against the current code): ${validation.summary}
${predecessorContext ? `\nStable predecessor results (deduplicated):\n${predecessorContext}\n` : ''}${missingContext ? `\nSkipped predecessor results whose code does not exist:\n${missingContext}\n` : ''}${corrections ? `\nStep 1 — Update the issue body first. Load the \`github-issue-format\` skill BEFORE editing (mandatory), then apply these validation corrections to issue #${issue} (preserve the rest of the body — including the ## Execution block — and the [C..] title unless a correction says otherwise):\n${corrections}\nThe user approved this milestone run plan, which explicitly authorizes applying these validation corrections to this issue.\nFooter: \`Updated with LLM: ${footerModel} | ${ex.effort} | Harness: milestone-pipeline\`.\n` : ''}${plan ? `\nA Fable 5 implementation plan was posted on the issue — implement against it. Deviating is allowed only with a stated reason in the PR body.\n` : ''}${constraints.length ? `\nHard requirements from validation${plan ? ' and the plan' : ''} (violating any is a correctness failure):\n${constraints.map((c) => `- ${c}`).join('\n')}\n` : ''}
Invoke the \`work-on-issue\` skill with args \`${workOnIssueArgs}\`. When baseRefs are present, validate them and prepare the dependency base exactly as that skill requires before changing product files; never fall back to the default branch or omit a ref after an integration conflict. Implement per the ${corrections ? 'corrected ' : ''}issue body (its Acceptance criteria are the contract — including the negative ones), follow repo conventions in CLAUDE.md, and note dependency merge order in the PR body. Add tests for every behavior you introduce. Run the project's full test and build suites; if a test fails, verify whether it also fails on the unmodified base before dismissing it as pre-existing, and say so. Commit + open a PR closing #${issue}, footer \`Created with LLM: ${footerModel} | ${ex.effort} | Harness: milestone-pipeline\`.${reviewDirective}

Verify the opened PR with \`gh pr view <num> --json headRefName,headRefOid\`. Return via StructuredOutput: pr_number, pr_url, head_ref (exact current headRefName after any cycle-1 fixes), head_sha (exact current headRefOid), summary, tests_passed, github_review_status, github_review_nonblocking_remaining, github_review_summary, any github_review_blocker, any implementation blocker, and flags the operator should know about. If implementation is blocked, return pr_number 0, empty head fields, and the blocker instead of guessing.`
}

function githubReviewBatchPrompt(issue, prNumber, ex, validation, plan, startCycle, cycleLimit) {
  const footerModel = MODEL_NAMES[ex.model]
  const constraints = (validation.implementation_constraints || []).concat(plan ? plan.constraints : [])
  const endCycle = startCycle + cycleLimit - 1
  return `You are a PR review-resolution agent in this repo. You own review cycles ${startCycle} through ${endCycle} of at most ${MAX_REVIEW_CYCLES} for PR #${prNumber}. Read all state from the PR itself; do not assume anything a previous agent did. Run at most ${cycleLimit} cycle${cycleLimit === 1 ? '' : 's'}, and stop early on a bare LGTM or blocker.

For each assigned cycle:
1. Fetch the latest @claude review on PR #${prNumber} (the github-actions bot comment carrying a verdict line). If a review run is still in flight, find its Actions run and \`gh run watch\` it rather than sleeping.
2. If that review is an LGTM with no actionable findings left on the current head, stop with status lgtm and nonblocking_remaining 0.
3. Otherwise invoke the \`fix-pr-review\` skill with args \`${prNumber}\` and follow it exactly: RE-VALIDATE every finding against the actual code before changing anything, fix what survives validation, resolve any merge conflicts with main, commit/push (footer \`Updated with LLM: ${footerModel} | ${ex.effort} | Harness: milestone-pipeline\`), post a per-finding disposition comment, and re-trigger per that skill's step-7 routing (\`@claude review\`, or \`@claude sonnet review\` when only non-blocking items were addressed — its own one-line comment, no footer).
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
  return `You are an independent pull-request review agent in this repo — you did not write this code; review it cold. Load the \`pr-review-format\` skill BEFORE composing anything (mandatory): its verdict line, section structure, materiality filter, and safety carve-out are the contract.${reReview}

Review PR #${prNumber}, which closes issue #${issue}:
1. \`gh pr view ${prNumber} --json headRefName,headRefOid,baseRefName,url,state\` — record the exact head you review.
2. \`git fetch origin\`, then read the full diff against the base AND every changed file in full at that head commit — the LGTM precondition requires completing every applicable Before you write item from the pr-review-format skill (including full-file reads, self-consistency, primary sourcing, and no charitable reading), from a detached checkout or worktree of the head commit, never the main checkout's working tree.
3. Read issue #${issue} (\`gh issue view ${issue}\`): its Acceptance criteria are the contract the PR must meet.
4. Take one CI snapshot (\`gh pr checks ${prNumber}\`): a failed check that traces to this PR's diff is evidence of a code defect — report the defect from the failing assertion/code, not the check status itself; pending checks are never waited on.
5. Post the review as ONE comment on PR #${prNumber} in the exact pr-review-format structure (footer verb Validated, harness milestone-pipeline).

Do NOT modify any files, do NOT fix anything, and do NOT trigger any \`@claude\` review comment.

Return via StructuredOutput: verdict (lgtm / needs_updates, matching the posted verdict line), blocking_count (### Needs Fixing + ### Requires Human Review items), nonblocking_count (### Recommended Optional + ### Create Follow-up Issue items), the exact head_ref and head_sha you reviewed, comment_url, and a one-paragraph summary.`
}

function subagentFixPrompt(issue, prNumber, ex, validation, plan, commentUrl) {
  const footerModel = MODEL_NAMES[ex.model]
  const constraints = (validation.implementation_constraints || []).concat(plan ? plan.constraints : [])
  return `You are a PR review-resolution agent in this repo. A fresh review was just posted on PR #${prNumber} (${commentUrl}). Invoke the \`fix-pr-review\` skill with args \`${prNumber}\` and follow it exactly, with ONE override: do NOT trigger, post, or wait for any \`@claude\` re-review — this run re-reviews with an in-session subagent after you finish, so stop after pushing your fixes and posting the per-finding disposition comment.

RE-VALIDATE every finding against the actual code before changing anything; fix what survives validation (including filing any ### Create Follow-up Issue items per that skill), refute on the record what doesn't, resolve any merge conflicts with the base branch, run the full test and build suites, then commit and push (footer \`Updated with LLM: ${footerModel} | ${ex.effort} | Harness: milestone-pipeline\`).

The issue's Acceptance criteria${constraints.length ? ' and these hard requirements from validation' + (plan ? ' and the Fable plan' : '') : ''} OUTRANK any reviewer suggestion — reject findings that would weaken them and say why in the disposition.
${constraints.length ? constraints.map((c) => `- ${c}`).join('\n') + '\n' : ''}
Work ONLY in the PR branch's existing worktree (or add a worktree for the branch if missing) — never the main checkout.

After pushing, verify \`gh pr view ${prNumber} --json headRefName,headRefOid\`. Return via StructuredOutput: fixed_count, refuted_count, the exact head_ref and head_sha after your push, a summary of what was fixed and what was refuted, and blocker ONLY if the pass could not complete.`
}

function mergePrompt(issue, prNumber, head, reviewMode) {
  const githubReviewGate = reviewMode === 'github'
    ? `4. Independent review gate (the FINAL read before merge): re-fetch the live PR head and ALL PR issue comments after every CI wait and any branch update. The live head must still equal the reviewed readiness SHA ${head.sha}; if update-branch changed it, STOP and require a fresh review. From the full comment history, identify the newest exact one-line \`@claude [model] review [effort]\` trigger and the newest completed review output from \`github-actions[bot]\` whose body links \`/actions/runs/<run-id>\`. Resolve that linked run and require \`status == completed\` and \`conclusion == success\`. Require the output's \`created_at\` to be later than the trigger's \`created_at\`, and require its body to contain exactly one standalone verdict line that is \`LGTM\` (not \`Needs Updates\`). A newer trigger or run-linked bot comment without a completed matching output blocks the merge; never fall back to an older LGTM. Do not compare the workflow run's \`head_sha\` to the PR: an \`issue_comment\` run reports the default-branch SHA, not the PR head (GitHub's Actions event reference: \`issue_comment\` runs use the last commit on the default branch), so bind the verdict to the code by time instead. Resolve when head ${head.sha} became visible on GitHub — the earliest \`created_at\` among \`gh api repos/{owner}/{repo}/commits/${head.sha}/check-suites\`, or that commit's \`.commit.committer.date\` when it has no check suite — and require the LGTM output's \`created_at\` to be strictly later. An LGTM that predates the head it would merge reviewed older code: STOP. This gate must catch a re-review that changes or supersedes the verdict during CI. Once it succeeds, run step 5 immediately — no command may run between this final validation and the pinned merge.`
    : ''
  const mergeStep = reviewMode === 'github' ? 5 : 4
  const verifyStep = mergeStep + 1
  const issueStep = mergeStep + 2
  const verifiedShaRule = reviewMode === 'github'
    ? `<verified-sha> is ${head.sha}; if step 3 changed the head, step 4 blocks until a fresh review reaches readiness.`
    : `<verified-sha> is ${head.sha} when step 3 did not update the branch, or the new head you captured after update-branch.`
  return `You are a merge agent in this repo. PR #${prNumber} (closes issue #${issue}) reached review readiness at head ${head.ref} @ ${head.sha}. The user approved this milestone run plan, which explicitly authorizes merging this PR, deleting its branch, and closing its issue.

1. Verify the PR: \`gh pr view ${prNumber} --json state,headRefName,headRefOid,mergeStateStatus\` — it must be OPEN with headRefOid exactly ${head.sha}. A different head means commits landed after the review: STOP and return merged false with that as the blocker.
2. CI gate: \`gh pr checks ${prNumber} --watch\` and wait for completion. Any failed check → do NOT merge; return merged false with the failing check as the blocker. No checks configured counts as passing.
3. If the branch is behind the base at all — whether or not the repo requires up-to-date branches: run \`gh pr update-branch ${prNumber}\` ONLY when it merges cleanly, then capture the new head (\`gh pr view ${prNumber} --json headRefOid\`) and repeat the CI gate on that new head. The reviewed code must prove itself against the base it will actually land on — never merge a behind branch untested. If update-branch reports conflicts, do NOT resolve them — return merged false, blocker "merge conflict with the base branch".
${githubReviewGate ? `${githubReviewGate}\n` : ''}${mergeStep}. Merge: \`gh pr merge ${prNumber} --squash --delete-branch --match-head-commit <verified-sha>\` — ALWAYS pin: ${verifiedShaRule} Never run the merge unpinned. If the merge is rejected because the head no longer matches, a commit landed after your CI gate: do NOT retry with a fresh SHA — return merged false with that as the blocker.
${verifyStep}. Verify: \`gh pr view ${prNumber} --json state,mergeCommit\` — state must be MERGED; record the merge commit SHA.
${issueStep}. Confirm issue #${issue} auto-closed (\`gh issue view ${issue} --json state\`). If still open, close it: \`gh issue close ${issue} --comment "Closed by PR #${prNumber}.\n\n---\nUpdated with LLM: Sonnet 5 | low | Harness: milestone-pipeline"\`.

Never push commits, never edit files, never resolve merge conflicts. Return via StructuredOutput: merged, merge_sha, issue_state, branch_deleted, summary, and blocker only when merged is false.`
}

function releasePrompt(mergedRecords) {
  const mergedList = mergedRecords.map((record) => `- Issue #${record.issue} → PR #${record.pr} (${record.pr_url})`).join('\n')
  return `You are a release agent in this repo. Every issue in this milestone run merged:
${mergedList}

The user approved this milestone run plan, which explicitly authorizes syncing docs and publishing a release. Invoke the \`sync-docs-release\` skill and follow it exactly: sync CLAUDE.md / AGENTS.md / SKILL.md / README.md to reflect the merged PRs above, land the doc changes (branch + PR per the repo's rules, or a direct commit when the repo allows it — if the docs land via PR, merge that PR after its checks pass before releasing), then run create-release. Footers: \`Created with LLM: Sonnet 5 | medium | Harness: milestone-pipeline\`.

Return via StructuredOutput: released, tag, release_url, docs_change (pr_merged / direct_commit / none_needed), summary, and blocker only when released is false.`
}

// Orchestrates reviewer ↔ fixer cycles in-session: the reviewer posts a
// pr-review-format comment and returns its verdict; a fixer resolves it; repeat.
// First review runs on the issue's "PR review:" model/effort when one is
// stamped, else on the [C..] band's review default;
// a re-review after a fix pass that addressed only non-blocking findings drops
// to sonnet/high, mirroring the fix-pr-review skill's @claude-sonnet routing.
// Returns the same shape as the github-mode review-loop agent. A needs_updates
// verdict on the final cycle ends the loop unfixed (max_cycles_exhausted) —
// never a fix push that no reviewer would see.
async function runSubagentReviewLoop(issue, prNumber, ex, validation, plan) {
  const bandReview = bandFor(ex.effective_complexity ?? ex.complexity).review
  const firstReview = { model: MODEL_IDS[ex.first_review_model] || bandReview.model, effort: ex.first_review_effort || bandReview.effort }
  const notes = []
  let nextReview = firstReview
  let head = { ref: '', sha: '' }
  let cycles = 0
  while (cycles < MAX_REVIEW_CYCLES) {
    cycles += 1
    const review = await agent(subagentReviewPrompt(issue, prNumber, cycles), {
      model: nextReview.model,
      effort: nextReview.effort,
      schema: SUBAGENT_REVIEW_SCHEMA,
      phase: 'Review Loop',
      label: `review:PR#${prNumber} c${cycles} (${nextReview.model}/${nextReview.effort})`,
    })
    if (!review) {
      return { final_status: 'blocked', cycles_run: cycles, summary: notes.join('\n'), head_ref: head.ref, head_sha: head.sha, blocker: `cycle ${cycles} reviewer agent failed` }
    }
    head = { ref: review.head_ref, sha: review.head_sha }
    notes.push(`cycle ${cycles} review (${nextReview.model}/${nextReview.effort}): ${review.verdict}, ${review.blocking_count} blocking + ${review.nonblocking_count} non-blocking — ${review.summary}`)
    log(`PR #${prNumber}: cycle ${cycles} review (${nextReview.model}/${nextReview.effort}) → ${review.verdict}, ${review.blocking_count} blocking + ${review.nonblocking_count} non-blocking`)
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
      model: MODEL_IDS[ex.model] || 'fable',
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
    nextReview = review.blocking_count === 0 ? { model: 'sonnet', effort: 'high' } : firstReview
  }
  return { final_status: 'max_cycles_exhausted', cycles_run: cycles, summary: notes.join('\n'), head_ref: head.ref, head_sha: head.sha }
}

// ---- Prep: one agent reads every issue's Execution block ----
const prep = await agent(
  `You are a read-only prep agent in this repo. For each GitHub issue number in this list: ${ALL_ISSUES.join(', ')} — run \`gh issue view <n> --json title,body\` and extract:
- complexity: the integer from the [C<score>] title prefix (0 if absent)
- model: from the "## Execution" block's "**Build model:**" line — map "Fable 5"→fable, "Opus 5" (any Opus)→opus, Sonnet→sonnet, Haiku→haiku
- effort: from "**Effort:**" — one of low/medium/high/xhigh; low and medium are Fable-only tiers, preserve them verbatim (including on a non-Fable model) so the runtime can identify and normalize stale combinations
- plan_effort: from the optional "**Plan effort:**" line — one of low/medium/high/xhigh. When the line is absent, OMIT the field rather than filling in a default: the runtime applies high itself, and it treats the field's presence as "an operator stamped a tier", so a filled-in default would make every unstamped issue look stamped. The fableplan stage always runs on Fable 5, so low and medium are legal here even though they are Fable-only build tiers; preserve a stamped xhigh verbatim so the runtime can clamp and log it (Fable never runs at xhigh). Only the effort is stampable — never read a model from this line
- fableplan: true when "**fableplan first:**" starts with "Yes"
- first_review_model / first_review_effort: from the optional "**PR review:**" line — when it names a first-review trigger like \`@claude fable review effort:high\`, extract that model and effort; when the line is a standard \`@claude\` trigger or absent, OMIT both fields — the runtime derives the default from the [C..] band, and it treats presence as "an operator stamped a trigger"
- do NOT extract a "**Validate effort:**" or "**Validate model:**" line — validation is derived from the [C..] score band by the runtime and a legacy stamp is never read
If an issue has NO Execution block, set missing_block: true and fill the fields with conservative defaults (model fable, effort high, fableplan false). Do not modify anything anywhere.
Return via StructuredOutput.`,
  { schema: PREP_SCHEMA, phase: 'Prep', label: 'prep:execution-blocks', effort: 'low' }
)
if (!prep) throw new Error('prep agent failed — cannot resolve Execution blocks')
const normalizedIssues = prep.issues.map((issue) => {
  const normalized = { ...issue }
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

function blockIssues(track, startIndex, reason, skipped) {
  for (const issue of track.issues.slice(startIndex)) {
    addResult({ issue, status: 'dependency_blocked', blocker: reason })
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
    const ex = EX.get(issue) || { number: issue, title: `#${issue}`, complexity: 0, model: 'fable', effort: 'high', fableplan: false, missing_block: true }
    const completed = dedupeRecords([...inheritedCompleted, ...localCompleted])
    const skipped = dedupeRecords([...inheritedSkipped, ...localSkipped])

    const validationPrompt = validatePrompt(issue, completed, skipped, baseRefs)
    const validateBand = bandFor(ex.complexity)
    const validateRoute = validateBand.validate
    log(`#${issue}: ${ex.complexity > 0 ? `C${ex.complexity} (band ${validateBand.name})` : 'no [C..] prefix — unknown routes as the top band'} — validating on ${MODEL_NAMES[validateRoute.model]} @ ${validateRoute.effort}`)
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
    const rescored = Number.isInteger(validation.rescored_complexity) ? validation.rescored_complexity : 0
    let effectiveComplexity = ex.complexity > 0 ? ex.complexity : rescored
    if (rescored > 0 && BANDS.indexOf(bandFor(rescored)) > BANDS.indexOf(validateBand)) {
      effectiveComplexity = rescored
      const escalatedBand = bandFor(rescored)
      log(`#${issue}: validator re-scored ${ex.complexity > 0 ? `C${ex.complexity}` : 'the unprefixed issue'} → C${rescored} (band ${escalatedBand.name}) — re-validating on ${MODEL_NAMES[escalatedBand.validate.model]} @ ${escalatedBand.validate.effort}`)
      const escalatedDispatch = await validateWithRetry(issue, validationPrompt, { ...validationOptions, model: escalatedBand.validate.model, effort: escalatedBand.validate.effort })
      if (escalatedDispatch.validation) {
        validation = escalatedDispatch.validation
      } else {
        log(`#${issue}: escalated validation failed (${escalatedDispatch.blocker}) — the original ${MODEL_NAMES[validateRoute.model]} verdict stands`)
      }
    }
    ex.effective_complexity = effectiveComplexity
    if (validation.verdict === 'INVALID') {
      blocker = validation.invalid_reason || validation.summary
      log(`#${issue}: INVALID — ${blocker}; blocking later issues in track ${trackIndex + 1}`)
      addResult({ issue, status: 'invalid', reason: blocker })
      localSkipped.push({ issue, reason: `validated INVALID — ${blocker}` })
      status = 'blocked'
      blockIssues(track, issueIndex + 1, `unmet in-track hard prerequisite #${issue}: ${blocker}`, localSkipped)
      break
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
    const modelId = MODEL_IDS[ex.model] || 'fable'

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

    log(`#${issue} (C${ex.complexity}): ${validation.verdict} → implementing on ${MODEL_NAMES[modelId]} @ ${ex.effort}${plan ? ` (against Fable plan @ ${planEffort})` : ''}`)
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
      addResult({ issue, status: 'blocked', blocker })
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
    addResult(record)
    const reviewNote = REVIEW_LOOP
      ? REVIEW_MODE === 'subagent' ? ', dispatching subagent review; waiting for review readiness' : ', @claude review triggered; waiting for review readiness'
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
      let merge
      try {
        merge = await agent(mergePrompt(issue, impl.pr_number, head, REVIEW_MODE), {
          model: 'sonnet',
          effort: 'low',
          schema: MERGE_SCHEMA,
          phase: 'Merge',
          label: `merge:PR#${impl.pr_number}`,
        })
      } catch (error) {
        merge = { merged: false, blocker: `merge threw: ${error?.message || error}` }
      }
      if (!merge || !merge.merged) {
        blocker = merge?.blocker || `PR #${impl.pr_number} merge agent failed`
        record.status = 'merge_blocked'
        record.blocker = blocker
        log(`PR #${impl.pr_number}: merge blocked — ${blocker}`)
        localSkipped.push({ issue, reason: `PR #${impl.pr_number} did not merge — ${blocker}` })
        status = 'blocked'
        unresolved = true
        blockIssues(track, issueIndex + 1, `unmet in-track hard prerequisite #${issue}: PR #${impl.pr_number} did not merge — ${blocker}`, localSkipped)
        break
      }
      record.status = 'merged'
      record.merge_sha = merge.merge_sha
      record.issue_state = merge.issue_state
      log(`PR #${impl.pr_number}: merged; issue #${issue} ${merge.issue_state}`)
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

// ---- Release: only when every issue in the run reached merged — a partial
// milestone never publishes. ----
let release = null
if (RELEASE) {
  const mergedRecords = results.filter((result) => result.status === 'merged')
  if (results.length === 0 || mergedRecords.length !== results.length) {
    const summary = `release skipped — ${mergedRecords.length} of ${results.length} issues reached merged status`
    log(summary)
    release = { released: false, skipped: true, summary }
  } else {
    try {
      release = await agent(releasePrompt(mergedRecords), {
        model: 'sonnet',
        effort: 'medium',
        schema: RELEASE_SCHEMA,
        phase: 'Release',
        label: 'release:sync-docs-release',
      })
    } catch (error) {
      release = { released: false, summary: `release agent threw: ${error?.message || error}` }
    }
    release ||= { released: false, summary: 'release agent failed' }
    log(release.released
      ? `release published: ${release.tag}${release.release_url ? ` (${release.release_url})` : ''}`
      : `release not published — ${release.blocker || release.summary}`)
  }
}

return { results, release }
