export const meta = {
  name: 'milestone-pipeline',
  description: 'Implement a dependency graph of Execution-block-stamped GitHub issues — validate, plan, build from verified prerequisite heads, and review each pull request to a stable readiness boundary',
  whenToUse: 'When the user has approved a milestone-workflow run plan. args: { tracks: [[2,3]] } or { tracks: [{issues:[2,3]}, {issues:[9], after:[0]}, {issues:[12], runsAfter:[0]}], reviewLoop?: true, maxReviewCycles?: 5 }',
  phases: [
    { title: 'Prep', detail: 'read every issue\'s [C..] score and Execution block' },
    { title: 'Validate', detail: 'Fable validates each issue against its exact dependency base right before it starts', model: 'fable' },
    { title: 'Plan', detail: 'Fable plans the issues flagged fableplan: Yes; plans posted to the issues', model: 'fable' },
    { title: 'Implement', detail: 'build each issue on its assigned model/effort in a worktree, open PR, and trigger @claude review only when review loops are enabled' },
    { title: 'Review Loop', detail: 'fix-pr-review cycles per PR until LGTM; unrelated tracks stay concurrent while successors wait' },
  ],
}

// args.tracks accepts legacy issue-number arrays and dependency-aware objects.
// `after` is a hard code dependency; `runsAfter` is ordering only. Serial issues
// within every track are conservative hard dependencies because their edge kind
// is not explicit. The full graph is validated before any agent starts.
// Unlike issue-pipeline, there is no complexity-threshold model routing:
// model/effort/fableplan come from each issue's ## Execution block (stamped by
// prd-to-issues, revised by execution-plan-review). Prep preserves representable
// stale combinations so the runtime can normalize and log them before dispatch.
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
const MAX_REVIEW_CYCLES = ARGS.maxReviewCycles ?? 5
if (typeof REVIEW_LOOP !== 'boolean') throw new Error('reviewLoop must be a boolean')
if (!Number.isInteger(MAX_REVIEW_CYCLES) || MAX_REVIEW_CYCLES <= 0) throw new Error('maxReviewCycles must be a positive integer')
const ALL_ISSUES = TRACKS.flatMap((track) => track.issues)

const MODEL_IDS = { 'fable': 'fable', 'opus': 'opus', 'sonnet': 'sonnet', 'haiku': 'haiku' }
const MODEL_NAMES = { fable: 'Fable 5', opus: 'Opus 4.8', sonnet: 'Sonnet 5', haiku: 'Haiku 4.5' }

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
          model: { type: 'string', enum: ['fable', 'opus', 'sonnet', 'haiku'], description: 'From "Build model:" — Fable 5→fable, Opus 4.8→opus, etc.' },
          effort: { type: 'string', enum: ['medium', 'high', 'xhigh'], description: 'Raw tier from "Effort:" after low→medium; runtime normalizes non-Fable medium→high' },
          validate_effort: { type: 'string', enum: ['medium', 'high', 'xhigh'], description: 'Raw tier from optional "Validate effort:" after low→medium; default high when absent; runtime normalizes xhigh→high' },
          fableplan: { type: 'boolean', description: 'True when "fableplan first:" starts with Yes' },
          missing_block: { type: 'boolean', description: 'True when the issue has no ## Execution block (fields above are then your best-heuristic defaults)' },
        },
      },
    },
  },
}

const VALIDATION_SCHEMA = {
  type: 'object',
  required: ['verdict', 'summary', 'corrections', 'implementation_constraints'],
  properties: {
    verdict: { type: 'string', enum: ['VALID', 'VALID_WITH_CORRECTIONS', 'INVALID'] },
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
  required: ['pr_number', 'pr_url', 'head_ref', 'head_sha', 'summary', 'tests_passed'],
  properties: {
    pr_number: { type: 'integer', description: '0 if blocked / no PR opened' },
    pr_url: { type: 'string' },
    head_ref: { type: 'string', description: 'Verified pull request head branch; empty if blocked / no PR opened' },
    head_sha: { type: 'string', description: 'Verified pull request head commit at implementation completion; empty if blocked / no PR opened' },
    summary: { type: 'string' },
    tests_passed: { type: 'boolean' },
    blocker: { type: 'string', description: 'Only if blocked: what stopped you' },
    flags: { type: 'array', items: { type: 'string' }, description: 'Anything the operator should know (pre-existing flakes, unfiled follow-ons)' },
  },
}

const REVIEW_LOOP_SCHEMA = {
  type: 'object',
  required: ['final_status', 'cycles_run', 'summary', 'head_ref', 'head_sha'],
  properties: {
    final_status: { type: 'string', enum: ['lgtm', 'lgtm_with_nonblocking', 'max_cycles_exhausted', 'blocked'] },
    cycles_run: { type: 'integer' },
    summary: { type: 'string', description: 'Per-cycle findings fixed/rejected, and why the loop stopped' },
    head_ref: { type: 'string', description: 'Exact pull request head branch at the review readiness boundary' },
    head_sha: { type: 'string', description: 'Exact pull request head commit at the review readiness boundary' },
    blocker: { type: 'string', description: 'Only when final_status is blocked' },
  },
}

function completedContext(completed) {
  return completed.map((record) => `- Issue #${record.issue} → PR #${record.prNumber} (head: ${record.head.ref} @ ${record.head.sha})`).join('\n')
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
    `and the implementation constraints an implementer must honor (repo invariants at risk, refuted approaches, the preferred approach, merge-order notes).`,
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

function planPrompt(issue, validation) {
  const corrections = validation.corrections.length
    ? `\nA Fable validation pass found these issue-body corrections (a later agent applies them — plan as if they were already applied):\n${validation.corrections.map((c) => `- ${c}`).join('\n')}\n`
    : ''
  const constraints = (validation.implementation_constraints || []).length
    ? `\nHard constraints from validation:\n${validation.implementation_constraints.map((c) => `- ${c}`).join('\n')}\n`
    : ''
  return `You are a read-only planning agent on Fable 5 in this repo. GitHub issue #${issue} is flagged "fableplan first" — the design is the hard part and a separate builder will implement your plan.

Validation summary: ${validation.summary}
${corrections}${constraints}
Fetch the issue (\`gh issue view ${issue}\`), read the referenced PRD sections and any relevant code, and produce a concrete implementation plan: files to create/modify, data shapes, control flow, edge cases, and the test list. Plan the absolute-best solution — cost and code volume are not constraints; only correctness and safety are.

Post the plan as a comment on issue #${issue} (footer: \`Created with LLM: Fable 5 | high | Harness: milestone-pipeline\`). Do NOT modify any files or start implementing.

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
  const reviewDirective = reviewLoop
    ? '\n\nAfter the PR is open, trigger the review bot with its own one-line comment, no footer: `gh pr comment <num> --body "@claude review"`. (If the repo\'s .github/workflows/claude.yml uses a different trigger phrase, match it.)'
    : '\n\nThis run has reviewLoop disabled: do not request or trigger any pull request review.'
  return `You are an implementation agent in this repo. Your job: implement GitHub issue #${issue} end-to-end and open a PR.

Validation summary (from a Fable review of the issue against the current code): ${validation.summary}
${predecessorContext ? `\nStable predecessor results (deduplicated):\n${predecessorContext}\n` : ''}${missingContext ? `\nSkipped predecessor results whose code does not exist:\n${missingContext}\n` : ''}${corrections ? `\nStep 1 — Update the issue body first. Load the \`github-issue-format\` skill BEFORE editing (mandatory), then apply these validation corrections to issue #${issue} (preserve the rest of the body — including the ## Execution block — and the [C..] title unless a correction says otherwise):\n${corrections}\nFooter: \`Updated with LLM: ${footerModel} | ${ex.effort} | Harness: milestone-pipeline\`.\n` : ''}${plan ? `\nA Fable 5 implementation plan was posted on the issue — implement against it. Deviating is allowed only with a stated reason in the PR body.\n` : ''}${constraints.length ? `\nHard requirements from validation${plan ? ' and the plan' : ''} (violating any is a correctness failure):\n${constraints.map((c) => `- ${c}`).join('\n')}\n` : ''}
Invoke the \`work-on-issue\` skill with args \`${workOnIssueArgs}\`. When baseRefs are present, validate them and prepare the dependency base exactly as that skill requires before changing product files; never fall back to the default branch or omit a ref after an integration conflict. Implement per the ${corrections ? 'corrected ' : ''}issue body (its Acceptance criteria are the contract — including the negative ones), follow repo conventions in CLAUDE.md, and note dependency merge order in the PR body. Add tests for every behavior you introduce. Run the project's full test and build suites; if a test fails, verify whether it also fails on the unmodified base before dismissing it as pre-existing, and say so. Commit + open a PR closing #${issue}, footer \`Created with LLM: ${footerModel} | ${ex.effort} | Harness: milestone-pipeline\`.${reviewDirective}

Verify the opened PR with \`gh pr view <num> --json headRefName,headRefOid\`. Return via StructuredOutput: pr_number, pr_url, head_ref (exact headRefName), head_sha (exact headRefOid), summary, tests_passed, any blocker, and flags the operator should know about. If blocked, return pr_number 0, empty head fields, and the blocker instead of guessing.`
}

function reviewLoopPrompt(issue, prNumber, ex, validation, plan) {
  const footerModel = MODEL_NAMES[ex.model]
  const constraints = (validation.implementation_constraints || []).concat(plan ? plan.constraints : [])
  return `You are a PR review-resolution agent in this repo. Invoke the \`fix-pr-review-loop\` skill with args \`${prNumber}\` and follow it exactly, with ONE override: this run's review-cycle cap is ${MAX_REVIEW_CYCLES} — everywhere the skill says 5 cycles, read ${MAX_REVIEW_CYCLES} instead:
fetch the latest @claude review on PR #${prNumber}, RE-VALIDATE every finding against the actual code before changing anything, fix what survives validation, resolve any merge conflicts with main, commit/push (footer \`Updated with LLM: ${footerModel} | ${ex.effort} | Harness: milestone-pipeline\`), post a per-finding disposition comment, re-trigger per the fix-pr-review skill's step-7 routing (\`@claude review\`, or \`@claude sonnet review\` when only non-blocking items were addressed — its own one-line comment, no footer), wait for the re-review (find the Actions run and \`gh run watch\` it rather than sleeping), and repeat.

Stop on a bare LGTM with nothing left to fix; past ${MAX_REVIEW_CYCLES} cycles stop at the first LGTM even with non-blocking findings remaining (this is the cap override above, not the skill's default). If the current review is already a clean LGTM with no actionable findings, stop immediately and say so (0 cycles).

The issue's Acceptance criteria${constraints.length ? ' and these hard requirements from validation' + (plan ? ' and the Fable plan' : '') : ''} OUTRANK any reviewer suggestion — reject findings that would weaken them and say why in the disposition.
${constraints.length ? constraints.map((c) => `- ${c}`).join('\n') + '\n' : ''}

Work ONLY in the PR branch's existing worktree (or add a worktree for the branch if missing) — never the main checkout.

At the stopping boundary, verify \`gh pr view ${prNumber} --json headRefName,headRefOid\`. Return via StructuredOutput: final_status (lgtm / lgtm_with_nonblocking / max_cycles_exhausted / blocked), cycles_run, a per-cycle summary, the exact head_ref and head_sha at that boundary, and any blocker.`
}

// ---- Prep: one agent reads every issue's Execution block ----
const prep = await agent(
  `You are a read-only prep agent in this repo. For each GitHub issue number in this list: ${ALL_ISSUES.join(', ')} — run \`gh issue view <n> --json title,body\` and extract:
- complexity: the integer from the [C<score>] title prefix (0 if absent)
- model: from the "## Execution" block's "**Build model:**" line — map "Fable 5"→fable, "Opus 4.8" (any Opus)→opus, Sonnet→sonnet, Haiku→haiku
- effort: from "**Effort:**" — one of medium/high/xhigh; clamp "low" to medium, but preserve medium on any model so the runtime can identify stale combinations
- validate_effort: from the optional "**Validate effort:**" line — same values; when the line is absent, use high; preserve xhigh so the runtime can identify and log it
- fableplan: true when "**fableplan first:**" starts with "Yes"
If an issue has NO Execution block, set missing_block: true and fill the fields with conservative defaults (model fable, effort high, fableplan false). Do not modify anything anywhere.
Return via StructuredOutput.`,
  { schema: PREP_SCHEMA, phase: 'Prep', label: 'prep:execution-blocks', effort: 'low' }
)
if (!prep) throw new Error('prep agent failed — cannot resolve Execution blocks')
const normalizedIssues = prep.issues.map((issue) => {
  const normalized = { ...issue }
  if (normalized.effort === 'medium' && normalized.model !== 'fable') {
    log(`#${normalized.number}: normalized build effort medium → high for ${MODEL_NAMES[normalized.model] || normalized.model}`)
    normalized.effort = 'high'
  }
  if (normalized.validate_effort === 'xhigh') {
    log(`#${normalized.number}: normalized validate effort xhigh → high`)
    normalized.validate_effort = 'high'
  }
  return normalized
})
const EX = new Map(normalizedIssues.map((i) => [i.number, i]))
const missing = normalizedIssues.filter((i) => i.missing_block).map((i) => `#${i.number}`)
if (missing.length) log(`WARNING: no Execution block on ${missing.join(', ')} — running them on conservative defaults (fable/high)`)

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
  let baseRefs = dedupeBaseRefs(hardPredecessors.map(({ outcome }) => outcome.head))
  let head = null
  let status = 'ready'
  let blocker = null
  let unresolved = false

  for (let issueIndex = 0; issueIndex < track.issues.length; issueIndex += 1) {
    const issue = track.issues[issueIndex]
    const ex = EX.get(issue) || { number: issue, title: `#${issue}`, complexity: 0, model: 'fable', effort: 'high', fableplan: false }
    const modelId = MODEL_IDS[ex.model] || 'fable'
    const completed = dedupeRecords([...inheritedCompleted, ...localCompleted])
    const skipped = dedupeRecords([...inheritedSkipped, ...localSkipped])

    const validationPrompt = validatePrompt(issue, completed, skipped, baseRefs)
    const validationOptions = {
      model: 'fable',
      effort: ex.validate_effort || 'high',
      schema: VALIDATION_SCHEMA,
      phase: 'Validate',
      label: `validate:#${issue}`,
    }
    const validationDispatch = await validateWithRetry(issue, validationPrompt, validationOptions)
    const validation = validationDispatch.validation
    blocker = validationDispatch.blocker
    if (!validation) {
      log(`#${issue}: ${blocker}; blocking later issues in track ${trackIndex + 1}`)
      addResult({ issue, status: 'validation_failed', blocker })
      localSkipped.push({ issue, reason: `${blocker} — issue never implemented` })
      status = 'blocked'
      blockIssues(track, issueIndex + 1, `unmet in-track hard prerequisite #${issue}: ${blocker}`, localSkipped)
      break
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

    let plan = null
    if (ex.fableplan) {
      try {
        plan = await agent(planPrompt(issue, validation), {
          model: 'fable',
          effort: 'high',
          schema: PLAN_SCHEMA,
          phase: 'Plan',
          label: `plan:#${issue}`,
        })
      } catch (error) {
        log(`#${issue}: fableplan threw — ${error?.message || error}; building without a posted plan`)
      }
      if (!plan) log(`#${issue}: fableplan agent failed — building without a posted plan`)
    }

    log(`#${issue} (C${ex.complexity}): ${validation.verdict} → implementing on ${MODEL_NAMES[modelId]} @ ${ex.effort}${plan ? ' (against Fable plan)' : ''}`)
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
    log(`#${issue}: PR #${impl.pr_number} open on ${impl.head_ref}${REVIEW_LOOP ? ', @claude review triggered; waiting for review readiness' : ''}`)

    if (REVIEW_LOOP) {
      let review
      try {
        review = await agent(reviewLoopPrompt(issue, impl.pr_number, ex, validation, plan), {
          model: modelId,
          effort: ex.effort,
          schema: REVIEW_LOOP_SCHEMA,
          phase: 'Review Loop',
          label: `review-loop:PR#${impl.pr_number}`,
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

    localCompleted.push({ issue, prNumber: impl.pr_number, prUrl: impl.pr_url, head })
    baseRefs = [head]
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
return { results }
