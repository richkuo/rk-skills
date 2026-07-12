export const meta = {
  name: 'milestone-pipeline',
  description: 'Implement a milestone of Execution-block-stamped GitHub issues — Fable-validate each issue against the current code, optional Fable plan, build on the assigned model/effort, open PRs, @claude review loops until LGTM — parallel across dependency tracks, sequential within',
  whenToUse: 'When the user has approved a milestone-workflow run plan over issues that already carry ## Execution blocks (build model, effort, fableplan). args: { tracks: [[2,3,4],[9],[12]], reviewLoop?: true, maxReviewCycles?: 5 }',
  phases: [
    { title: 'Prep', detail: 'read every issue\'s [C..] score and Execution block' },
    { title: 'Validate', detail: 'Fable validates each issue against the current code right before it starts', model: 'fable' },
    { title: 'Plan', detail: 'Fable plans the issues flagged fableplan: Yes; plans posted to the issues', model: 'fable' },
    { title: 'Implement', detail: 'build each issue on its assigned model/effort in a worktree, open PR, trigger @claude review' },
    { title: 'Review Loop', detail: 'fix-pr-review cycles per PR until LGTM; runs concurrently with later issues in the track' },
  ],
}

// args.tracks: array of tracks; each track is an ordered array of issue numbers.
// Tracks run in parallel; issues within a track run sequentially (later issues
// get earlier issues' PR numbers as in-flight context). Cross-track dependencies
// are NOT expressible here — chain separate workflow invocations per phase.
// Unlike issue-pipeline, there is no complexity-threshold model routing:
// model/effort/fableplan come from each issue's ## Execution block (stamped by
// prd-to-issues, revised by execution-plan-review). Validation still runs as the
// first step of every issue — even freshly-authored issues go stale as earlier
// PRs in the milestone change the ground truth, so each issue is re-checked
// against the current code immediately before it starts.
if (!args || !Array.isArray(args.tracks) || args.tracks.length === 0) {
  throw new Error('milestone-pipeline requires args.tracks: an array of issue-number arrays, e.g. { tracks: [[2,3,4],[9],[12]] }')
}
const TRACKS = args.tracks
const REVIEW_LOOP = args.reviewLoop ?? true
const MAX_REVIEW_CYCLES = args.maxReviewCycles ?? 5
const ALL_ISSUES = TRACKS.flat()

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
          effort: { type: 'string', enum: ['medium', 'high', 'xhigh'], description: 'From "Effort:" — clamp low→medium' },
          validate_effort: { type: 'string', enum: ['medium', 'high', 'xhigh'], description: 'From the optional "Validate effort:" line; default high when absent; clamp low→medium' },
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
  required: ['pr_number', 'pr_url', 'summary', 'tests_passed'],
  properties: {
    pr_number: { type: 'integer', description: '0 if blocked / no PR opened' },
    pr_url: { type: 'string' },
    summary: { type: 'string' },
    tests_passed: { type: 'boolean' },
    blocker: { type: 'string', description: 'Only if blocked: what stopped you' },
    flags: { type: 'array', items: { type: 'string' }, description: 'Anything the operator should know (pre-existing flakes, unfiled follow-ons)' },
  },
}

const REVIEW_LOOP_SCHEMA = {
  type: 'object',
  required: ['final_status', 'cycles_run', 'summary'],
  properties: {
    final_status: { type: 'string', enum: ['lgtm', 'lgtm_with_nonblocking', 'max_cycles_exhausted', 'blocked'] },
    cycles_run: { type: 'integer' },
    summary: { type: 'string', description: 'Per-cycle findings fixed/rejected, and why the loop stopped' },
    blocker: { type: 'string', description: 'Only when final_status is blocked' },
  },
}

function validatePrompt(issue, trackContext, skippedContext) {
  return [
    `You are a read-only validation agent in this repo. Invoke the \`validate-issue\` skill with args \`${issue}\` and follow its procedure exactly:`,
    `fetch GitHub issue #${issue} with \`gh issue view ${issue}\`, verify every factual claim (including PRD section references) against the actual code and PRD with file:line citations,`,
    `check architectural feasibility and self-consistency of the approach, and check for staleness: whether code merged since the issue was filed changes its best approach.`,
    trackContext ? `\nRelevant in-flight context from earlier issues in this dependency chain (account for these landing first):\n${trackContext}` : '',
    skippedContext ? `\nEarlier issues in this track were SKIPPED (blocked or invalid) — their code does NOT exist anywhere:\n${skippedContext}\nDetermine whether issue #${issue} hard-depends on any skipped issue's work (would build on code that was never written). If it does, return verdict INVALID with invalid_reason naming the unmet dependency (e.g. "unmet in-track dependency #N: <why>"). If it is independent of the skipped work (e.g. merely same-package), proceed normally.` : '',
    `\nDo NOT modify any files, do NOT comment on the issue, do NOT start implementing.`,
    `Return via StructuredOutput: verdict (VALID / VALID_WITH_CORRECTIONS / INVALID), a verdict summary, the concrete issue-body corrections needed,`,
    `and the implementation constraints an implementer must honor (repo invariants at risk, refuted approaches, the preferred approach, merge-order notes).`,
  ].join(' ')
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

function implementPrompt(issue, ex, validation, plan, trackContext, skippedContext) {
  const footerModel = MODEL_NAMES[ex.model]
  const corrections = validation.corrections.length
    ? validation.corrections.map((c) => `- ${c}`).join('\n')
    : ''
  const constraints = (validation.implementation_constraints || []).concat(plan ? plan.constraints : [])
  return `You are an implementation agent in this repo. Your job: implement GitHub issue #${issue} end-to-end and open a PR.

Validation summary (from a Fable review of the issue against the current code): ${validation.summary}
${trackContext ? `\nIn-flight context from earlier issues in this dependency chain (their PRs are open, not merged — branch off the dependency's PR branch when your work hard-requires its code, and note merge order in your PR body):\n${trackContext}\n` : ''}${skippedContext ? `\nEarlier issues in this track were SKIPPED (blocked or invalid) — their code does NOT exist anywhere:\n${skippedContext}\nIf during implementation you find issue #${issue} hard-requires a skipped issue's work, STOP and return blocked (pr_number 0) with the unmet dependency as the blocker — never improvise the missing base yourself.\n` : ''}${corrections ? `\nStep 1 — Update the issue body first. Load the \`github-issue-format\` skill BEFORE editing (mandatory), then apply these validation corrections to issue #${issue} (preserve the rest of the body — including the ## Execution block — and the [C..] title unless a correction says otherwise):\n${corrections}\nFooter: \`Updated with LLM: ${footerModel} | ${ex.effort} | Harness: milestone-pipeline\`.\n` : ''}${plan ? `\nA Fable 5 implementation plan was posted on the issue — implement against it. Deviating is allowed only with a stated reason in the PR body.\n` : ''}${constraints.length ? `\nHard requirements from validation${plan ? ' and the plan' : ''} (violating any is a correctness failure):\n${constraints.map((c) => `- ${c}`).join('\n')}\n` : ''}
Invoke the \`work-on-issue\` skill with args \`${issue}\`: isolated worktree off latest origin/main, implement per the ${corrections ? 'corrected ' : ''}issue body (its Acceptance criteria are the contract — including the negative ones), follow repo conventions in CLAUDE.md. Add tests for every behavior you introduce. Run the project's full test and build suites; if a test fails, verify whether it also fails on unmodified main before dismissing it as pre-existing, and say so. Commit + open a PR closing #${issue}, footer \`Created with LLM: ${footerModel} | ${ex.effort} | Harness: milestone-pipeline\`.

After the PR is open, trigger the review bot with its own one-line comment, no footer: \`gh pr comment <num> --body "@claude review"\`. (If the repo's .github/workflows/claude.yml uses a different trigger phrase, match it.)

Return via StructuredOutput: pr_number, pr_url, summary, tests_passed, any blocker, and flags the operator should know about. If blocked, return the blocker instead of guessing.`
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

Return via StructuredOutput: final_status (lgtm / lgtm_with_nonblocking / max_cycles_exhausted / blocked), cycles_run, a per-cycle summary of findings fixed vs rejected, and any blocker.`
}

// ---- Prep: one agent reads every issue's Execution block ----
const prep = await agent(
  `You are a read-only prep agent in this repo. For each GitHub issue number in this list: ${ALL_ISSUES.join(', ')} — run \`gh issue view <n> --json title,body\` and extract:
- complexity: the integer from the [C<score>] title prefix (0 if absent)
- model: from the "## Execution" block's "**Build model:**" line — map "Fable 5"→fable, "Opus 4.8" (any Opus)→opus, Sonnet→sonnet, Haiku→haiku
- effort: from "**Effort:**" — one of medium/high/xhigh; clamp "low" to medium
- validate_effort: from the optional "**Validate effort:**" line — same values; when the line is absent, use high
- fableplan: true when "**fableplan first:**" starts with "Yes"
If an issue has NO Execution block, set missing_block: true and fill the fields with conservative defaults (model fable, effort high, fableplan false). Do not modify anything anywhere.
Return via StructuredOutput.`,
  { schema: PREP_SCHEMA, phase: 'Prep', label: 'prep:execution-blocks', effort: 'low' }
)
if (!prep) throw new Error('prep agent failed — cannot resolve Execution blocks')
const EX = new Map(prep.issues.map((i) => [i.number, i]))
const missing = prep.issues.filter((i) => i.missing_block).map((i) => `#${i.number}`)
if (missing.length) log(`WARNING: no Execution block on ${missing.join(', ')} — running them on conservative defaults (fable/high)`)

// ---- Tracks: parallel across, sequential within ----
const results = []
const reviewLoops = []

await parallel(
  TRACKS.map((track, ti) => async () => {
    const done = [] // { issue, prNumber }
    const skipped = [] // { issue, reason } — in-track issues that never produced a PR
    for (const issue of track) {
      const ex = EX.get(issue) || { number: issue, title: `#${issue}`, complexity: 0, model: 'fable', effort: 'high', fableplan: false }
      const modelId = MODEL_IDS[ex.model] || 'fable'
      const trackContext = done.map((d) => `- Issue #${d.issue} → PR #${d.prNumber} (open, not yet merged)`).join('\n')
      const skippedContext = skipped.map((s) => `- Issue #${s.issue}: ${s.reason}`).join('\n')

      const validation = await agent(validatePrompt(issue, trackContext, skippedContext), {
        model: 'fable',
        effort: ex.validate_effort || 'high',
        schema: VALIDATION_SCHEMA,
        phase: 'Validate',
        label: `validate:#${issue}`,
      })
      if (!validation) {
        log(`#${issue}: validation agent failed — skipping issue, continuing track ${ti + 1}`)
        results.push({ issue, status: 'validation_failed' })
        skipped.push({ issue, reason: 'validation agent failed — issue never validated or implemented' })
        continue
      }
      if (validation.verdict === 'INVALID') {
        log(`#${issue}: INVALID — ${validation.invalid_reason || validation.summary}; not implementing, continuing track ${ti + 1}`)
        results.push({ issue, status: 'invalid', reason: validation.invalid_reason || validation.summary })
        skipped.push({ issue, reason: `validated INVALID — ${validation.invalid_reason || validation.summary}` })
        continue
      }

      let plan = null
      if (ex.fableplan) {
        plan = await agent(planPrompt(issue, validation), {
          model: 'fable',
          effort: 'high',
          schema: PLAN_SCHEMA,
          phase: 'Plan',
          label: `plan:#${issue}`,
        })
        if (!plan) log(`#${issue}: fableplan agent failed — building without a posted plan`)
      }

      log(`#${issue} (C${ex.complexity}): ${validation.verdict} → implementing on ${MODEL_NAMES[modelId]} @ ${ex.effort}${plan ? ' (against Fable plan)' : ''}`)
      const impl = await agent(implementPrompt(issue, ex, validation, plan, trackContext, skippedContext), {
        model: modelId,
        effort: ex.effort,
        schema: IMPLEMENT_SCHEMA,
        phase: 'Implement',
        label: `implement:#${issue} (${modelId}/${ex.effort})`,
      })
      if (!impl || !impl.pr_number) {
        log(`#${issue}: implementation ${impl ? `blocked — ${impl.blocker || 'no PR opened'}` : 'agent failed'}; continuing track ${ti + 1}`)
        results.push({ issue, status: 'blocked', blocker: impl?.blocker })
        skipped.push({ issue, reason: `implementation ${impl ? `blocked — ${impl.blocker || 'no PR opened'}` : 'agent failed'}` })
        continue
      }

      log(`#${issue}: PR #${impl.pr_number} open, @claude review triggered`)
      const rec = { issue, status: 'pr_open', pr: impl.pr_number, pr_url: impl.pr_url, tests_passed: impl.tests_passed, flags: impl.flags || [] }
      results.push(rec)
      done.push({ issue, prNumber: impl.pr_number })

      // Review loop runs concurrently — the track moves on to its next issue
      // while this PR is driven to LGTM. Same model/effort as the build.
      if (REVIEW_LOOP) {
        reviewLoops.push(
          agent(reviewLoopPrompt(issue, impl.pr_number, ex, validation, plan), {
            model: modelId,
            effort: ex.effort,
            schema: REVIEW_LOOP_SCHEMA,
            phase: 'Review Loop',
            label: `review-loop:PR#${impl.pr_number}`,
          }).then(
            (review) => review || { final_status: 'blocked', cycles_run: 0, summary: 'review-loop agent failed' },
            // Catch throws (e.g. token-budget exhaustion) so one failed loop
            // can't reject Promise.all below and discard every collected result.
            (err) => ({ final_status: 'blocked', cycles_run: 0, summary: `review-loop threw: ${err?.message || err}` })
          ).then((review) => {
            rec.review = review
            rec.status = review.final_status === 'lgtm' || review.final_status === 'lgtm_with_nonblocking' ? 'lgtm' : 'review_' + review.final_status
            log(`PR #${impl.pr_number}: review loop ${review.final_status} after ${review.cycles_run} cycle(s)`)
          })
        )
      }
    }
  })
)

if (reviewLoops.length) {
  log(`all tracks done; waiting on ${reviewLoops.length} review loop(s)`)
  await Promise.all(reviewLoops)
}

return { results }
