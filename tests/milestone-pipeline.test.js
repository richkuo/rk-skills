import { describe, expect, test } from 'bun:test'

const workflowSource = await Bun.file(new URL('../workflows/milestone-pipeline.js', import.meta.url)).text()
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const workflowBody = workflowSource.replace('export const meta =', 'const meta =')

function issueNumbers(args) {
  const parsed = typeof args === 'string' ? JSON.parse(args) : args
  return parsed.tracks.flatMap((track) => Array.isArray(track) ? track : track.issues)
}

function issueFromLabel(label) {
  return Number(label.match(/#(\d+)/)?.[1])
}

function headSha(issue, fill = '0') {
  return issue.toString(16).padStart(40, fill)
}

function mergedRecord(issue, pr = 1000 + issue) {
  return { issue, pr, merge_sha: headSha(pr, 'e'), issue_state: 'closed' }
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return
    await Promise.resolve()
  }
  throw new Error('condition was not reached')
}

async function executeWorkflow(args, handlers = {}, budget = null) {
  const events = []
  const logs = []
  const parsedArgs = typeof args === 'string' ? JSON.parse(args) : args
  const githubReviewEnabled = (parsedArgs.reviewLoop ?? true) && (parsedArgs.reviewMode ?? 'github') === 'github'
  const budgetGlobal = budget ?? { total: null, spent: () => 0, remaining: () => Infinity }
  const agent = async (prompt, options) => {
    const event = { label: options.label, phase: options.phase, model: options.model, effort: options.effort, schema: options.schema, prompt }
    events.push({ ...event, state: 'started' })

    const custom = handlers[options.label] || handlers[options.phase]
    let result
    if (custom) {
      result = await custom(event)
    } else if (options.phase === 'Prep') {
      result = {
        issues: issueNumbers(args).map((number) => ({
          number,
          title: `Issue ${number}`,
          complexity: 20,
          model: 'fable',
          effort: 'high',
          fableplan: false,
          missing_block: false,
        })),
      }
    } else if (options.phase === 'Validate') {
      result = { verdict: 'VALID', summary: 'valid', corrections: [], implementation_constraints: [], rescored_complexity: 0 }
    } else if (options.phase === 'Plan') {
      result = { plan: `plan for #${issueFromLabel(options.label)}`, constraints: [] }
    } else if (options.phase === 'Implement') {
      const issue = issueFromLabel(options.label)
      result = {
        pr_number: 1000 + issue,
        pr_url: `https://example.test/pr/${1000 + issue}`,
        head_ref: `codex/issue-${issue}`,
        head_sha: headSha(issue),
        summary: 'implemented',
        tests_passed: true,
        github_review_status: githubReviewEnabled ? 'needs_updates' : 'not_run',
        github_review_nonblocking_remaining: 0,
        github_review_summary: githubReviewEnabled ? 'cycle 1 needs updates' : '',
        flags: [],
      }
    } else if (options.phase === 'Review Loop') {
      const issue = Number(options.label.match(/PR#(\d+)/)?.[1]) - 1000
      if (options.label.startsWith('review:')) {
        result = {
          verdict: 'lgtm',
          blocking_count: 0,
          nonblocking_count: 0,
          head_ref: `codex/issue-${issue}`,
          head_sha: headSha(issue),
          comment_url: `https://example.test/pr/${1000 + issue}#review`,
          summary: 'clean',
        }
      } else if (options.label.startsWith('fix:')) {
        result = {
          fixed_count: 1,
          refuted_count: 0,
          head_ref: `codex/issue-${issue}`,
          head_sha: headSha(issue),
          summary: 'fixed',
        }
      } else {
        result = {
          status: 'lgtm',
          nonblocking_remaining: 0,
          cycles_run: 1,
          summary: 'approved',
          head_ref: `codex/issue-${issue}`,
          head_sha: headSha(issue),
        }
      }
    } else {
      throw new Error(`unexpected phase: ${options.phase}`)
    }

    events.push({ ...event, state: 'finished', result })
    return result
  }
  const parallel = async (tasks) => Promise.all(tasks.map((task) => task()))
  const run = new AsyncFunction('args', 'agent', 'parallel', 'log', 'budget', workflowBody)
  const output = await run(args, agent, parallel, (message) => logs.push(message), budgetGlobal)
  return { output, events, logs }
}

function started(events, label) {
  return events.some((event) => event.state === 'started' && event.label === label)
}

function promptFor(events, label) {
  return events.find((event) => event.state === 'started' && event.label === label)?.prompt
}

describe('milestone-pipeline dependency scheduling', () => {
  test('dispatches a successful validation exactly once', async () => {
    const { output, events, logs } = await executeWorkflow({ tracks: [[2]], reviewLoop: false })

    expect(events.filter((event) => event.state === 'started' && event.label === 'validate:#2')).toHaveLength(1)
    expect(output.results.find((result) => result.issue === 2)?.status).toBe('pr_open')
    expect(logs.some((message) => message.includes('validation attempt'))).toBeFalse()
  })

  test.each([
    ['null', 'null', false],
    ['thrown error', 'throw', true],
  ])('retries a first %s validation failure once with identical dispatch inputs', async (_name, firstFailure, fableplan) => {
    let attempt = 0
    const { output, events, logs } = await executeWorkflow({ tracks: [[2]], reviewLoop: false }, {
      Prep: () => ({
        issues: [{
          number: 2,
          title: 'Issue 2',
          complexity: 20,
          model: 'fable',
          effort: 'high',
          fableplan,
          missing_block: false,
        }],
      }),
      'validate:#2': () => {
        attempt += 1
        if (attempt === 1) {
          if (firstFailure === 'null') return null
          throw new Error('transient validator crash')
        }
        return { verdict: 'VALID', summary: 'valid after retry', corrections: [], implementation_constraints: [] }
      },
    })
    const attempts = events.filter((event) => event.state === 'started' && event.label === 'validate:#2')

    expect(attempts).toHaveLength(2)
    expect(attempts[1]).toEqual(attempts[0])
    expect(started(events, 'plan:#2')).toBe(fableplan)
    expect(started(events, 'implement:#2 (fable/high)')).toBeTrue()
    expect(output.results.find((result) => result.issue === 2)?.status).toBe('pr_open')
    expect(logs.some((message) => message.includes('#2: validation attempt 1/2') && message.includes('retrying once'))).toBeTrue()
  })

  test.each([
    ['null then null', ['null', 'null'], 'validation agent failed'],
    ['null then throw', ['null', 'throw'], 'validation threw: failure 2'],
    ['throw then null', ['throw', 'null'], 'validation agent failed'],
    ['throw then throw', ['throw', 'throw'], 'validation threw: failure 2'],
  ])('preserves dependency behavior after retry exhaustion: %s', async (_name, failures, expectedBlocker) => {
    let attempt = 0
    const { output, events, logs } = await executeWorkflow({
      tracks: [
        { issues: [2, 3] },
        { issues: [9], after: [0] },
        { issues: [12], runsAfter: [0] },
      ],
      reviewLoop: false,
    }, {
      'validate:#2': () => {
        const failure = failures[attempt]
        attempt += 1
        if (failure === 'null') return null
        throw new Error(`failure ${attempt}`)
      },
    })
    const failed = output.results.find((result) => result.issue === 2)
    const orderingPrompt = promptFor(events, 'validate:#12')

    expect(events.filter((event) => event.state === 'started' && event.label === 'validate:#2')).toHaveLength(2)
    expect(failed?.status).toBe('validation_failed')
    expect(failed?.blocker).toBe(expectedBlocker)
    expect(output.results.find((result) => result.issue === 3)?.status).toBe('dependency_blocked')
    expect(output.results.find((result) => result.issue === 9)?.status).toBe('dependency_blocked')
    expect(started(events, 'validate:#3')).toBeFalse()
    expect(started(events, 'validate:#9')).toBeFalse()
    expect(output.results.find((result) => result.issue === 12)?.status).toBe('pr_open')
    expect(orderingPrompt.match(/Issue #2:/g)).toHaveLength(1)
    expect(orderingPrompt).toContain(expectedBlocker)
    expect(logs.some((message) => message.includes('#2: validation attempt 2/2') && message.includes('retries exhausted'))).toBeTrue()
  })

  test('keeps validation retry state isolated across concurrent tracks', async () => {
    const attempts = new Map([[2, 0], [3, 0]])
    const retryThenSucceed = (issue, failure) => () => {
      const attempt = attempts.get(issue) + 1
      attempts.set(issue, attempt)
      if (attempt === 1) {
        if (failure === 'null') return null
        throw new Error(`transient failure for #${issue}`)
      }
      return { verdict: 'VALID', summary: `valid #${issue}`, corrections: [], implementation_constraints: [] }
    }
    const { output, events, logs } = await executeWorkflow({ tracks: [[2], [3]], reviewLoop: false }, {
      'validate:#2': retryThenSucceed(2, 'null'),
      'validate:#3': retryThenSucceed(3, 'throw'),
    })

    expect(events.filter((event) => event.state === 'started' && event.label === 'validate:#2')).toHaveLength(2)
    expect(events.filter((event) => event.state === 'started' && event.label === 'validate:#3')).toHaveLength(2)
    expect(output.results.map((result) => result.status)).toEqual(['pr_open', 'pr_open'])
    expect(logs.some((message) => message.includes('#2: validation attempt 1/2 returned no result'))).toBeTrue()
    expect(logs.some((message) => message.includes('#3: validation attempt 1/2 threw — transient failure for #3'))).toBeTrue()
    expect(logs.some((message) => message.startsWith('#2:') && message.includes('#3'))).toBeFalse()
  })

  test('does not retry planning, implementation, or review-loop failures', async () => {
    const { events } = await executeWorkflow({ tracks: [[2], [3], [4]], reviewLoop: true, reviewMode: 'github' }, {
      Prep: () => ({
        issues: [2, 3, 4].map((number) => ({
          number,
          title: `Issue ${number}`,
          complexity: 20,
          model: 'fable',
          effort: 'high',
          fableplan: number === 2,
          missing_block: false,
        })),
      }),
      'plan:#2': () => { throw new Error('planner failed') },
      'implement:#3 (fable/high)': () => { throw new Error('implementation failed') },
      'review-loop:PR#1004 c2-c3': () => { throw new Error('review failed') },
    })

    expect(events.filter((event) => event.state === 'started' && event.label === 'plan:#2')).toHaveLength(1)
    expect(events.filter((event) => event.state === 'started' && event.label === 'implement:#3 (fable/high)')).toHaveLength(1)
    expect(events.filter((event) => event.state === 'started' && event.label === 'review-loop:PR#1004 c2-c3')).toHaveLength(1)
  })

  test('dispatches the plan stage at high and normalizes legacy stamps', async () => {
    const { events, logs } = await executeWorkflow({ tracks: [[2], [3], [4], [5], [6], [7], [8]], reviewLoop: false }, {
      Prep: () => ({
        issues: [
          { number: 2, title: '[C60] Stamped xhigh', complexity: 60, model: 'opus', effort: 'high', fableplan: true, plan_effort: 'xhigh', missing_block: false },
          { number: 3, title: '[C60] Stamped low', complexity: 60, model: 'opus', effort: 'high', fableplan: true, plan_effort: 'low', missing_block: false },
          { number: 4, title: '[C60] No stamp', complexity: 60, model: 'opus', effort: 'xhigh', fableplan: true, missing_block: false },
          { number: 5, title: '[C20] No plan stage, stamped xhigh', complexity: 20, model: 'opus', effort: 'high', fableplan: false, plan_effort: 'xhigh', missing_block: false },
          { number: 6, title: '[C20] No plan stage, stamped low', complexity: 20, model: 'opus', effort: 'high', fableplan: false, plan_effort: 'low', missing_block: false },
          { number: 7, title: '[C20] No plan stage, stamped medium', complexity: 20, model: 'opus', effort: 'high', fableplan: false, plan_effort: 'medium', missing_block: false },
          { number: 8, title: '[C20] No plan stage, stamped high', complexity: 20, model: 'opus', effort: 'high', fableplan: false, plan_effort: 'high', missing_block: false },
        ],
      }),
    })

    const planEvent = (issue) => events.find((event) => event.state === 'started' && event.label === `plan:#${issue}`)
    expect(planEvent(2).effort).toBe('high')
    expect(planEvent(2).model).toBe('fable')
    expect(planEvent(3).effort).toBe('high')
    expect(planEvent(3).model).toBe('fable')
    expect(planEvent(4).effort).toBe('high')
    expect(planEvent(5)).toBeUndefined()

    expect(planEvent(2).prompt).toContain('Created with LLM: Fable 5 | high | Harness: milestone-pipeline')
    expect(planEvent(3).prompt).toContain('Created with LLM: Fable 5 | high | Harness: milestone-pipeline')
    expect(planEvent(4).prompt).toContain('Created with LLM: Fable 5 | high | Harness: milestone-pipeline')

    expect(logs.some((message) => message.includes('#2') && message.includes('against Fable plan @ high'))).toBeTrue()
    expect(logs.some((message) => message.includes('#5') && message.includes('against Fable plan'))).toBeFalse()
    expect(logs.filter((message) => message.includes('normalized plan effort')).sort()).toEqual([
      '#2: normalized plan effort xhigh → high (fableplan always runs at high)',
      '#3: normalized plan effort low → high (fableplan always runs at high)',
      '#5: normalized plan effort xhigh → high (fableplan always runs at high)',
      '#6: normalized plan effort low → high (fableplan always runs at high)',
      '#7: normalized plan effort medium → high (fableplan always runs at high)',
    ].sort())

    expect(logs.filter((message) => message.includes('ignoring Plan effort')).sort()).toEqual([
      '#5: ignoring Plan effort xhigh — fableplan is false, so no plan stage runs',
      '#6: ignoring Plan effort low — fableplan is false, so no plan stage runs',
      '#7: ignoring Plan effort medium — fableplan is false, so no plan stage runs',
      '#8: ignoring Plan effort high — fableplan is false, so no plan stage runs',
    ].sort())
  })

  test('reports an inert Plan effort only when one was actually stamped', async () => {
    const { events, logs } = await executeWorkflow({ tracks: [[2], [3], [4], [5]], reviewLoop: false }, {
      Prep: () => ({
        issues: [
          { number: 2, title: '[C20] No plan stage, nothing stamped', complexity: 20, model: 'opus', effort: 'high', fableplan: false, missing_block: false },
          { number: 3, title: '[C20] No Execution block at all', complexity: 20, model: 'fable', effort: 'high', fableplan: false, plan_effort: 'xhigh', missing_block: true },
          { number: 4, title: '[C60] Plan stage, nothing stamped', complexity: 60, model: 'opus', effort: 'high', fableplan: true, missing_block: false },
          { number: 5, title: '[C20] No Execution block, nothing stamped', complexity: 20, model: 'fable', effort: 'high', fableplan: false, missing_block: true },
        ],
      }),
    })

    expect(logs.filter((message) => message.includes('ignoring Plan effort'))).toEqual([])
    expect(logs.some((message) => message.includes('no Execution block on #3, #5'))).toBeTrue()

    const planEvent = events.find((event) => event.state === 'started' && event.label === 'plan:#4')
    expect(planEvent.effort).toBe('high')
    expect(planEvent.prompt).toContain('Created with LLM: Fable 5 | high | Harness: milestone-pipeline')
  })

  test('prep is contracted to omit Plan effort when the issue stamps none', () => {
    const source = workflowSource
    const schemaLine = source.match(/^ +plan_effort: \{.*$/m)[0]
    expect(schemaLine).toMatch(/OMIT when absent/)
    expect(schemaLine).toMatch(/always runs fableplan at high/)

    const promptLine = source.match(/^- plan_effort: from an optional legacy.*$/m)[0]
    expect(promptLine).toMatch(/OMIT the field/)
    expect(promptLine).toMatch(/always runs at high/)

    expect(source).toContain("const planEffort = ex.plan_effort || 'high'")
  })

  test('prep is contracted to omit the stamps the band derives', () => {
    const source = workflowSource
    expect(source).not.toMatch(/validate_effort/)
    expect(source).toContain('do NOT extract a "**Validate effort:**"')
    const reviewSchemaLine = source.match(/^ +first_review_model: \{.*$/m)[0]
    expect(reviewSchemaLine).toMatch(/OMIT this field when the line is a standard/)
    const reviewPromptLine = source.match(/^- first_review_model \/ first_review_effort: from the optional.*$/m)[0]
    expect(reviewPromptLine).toMatch(/OMIT both fields/)
    expect(source).toContain('const bandReview = reviewBandFor(ex.review_complexity ?? ex.complexity).review')
    expect(source).toContain("const modelId = MODEL_IDS[ex.model] || 'opus'")
    expect(source).not.toContain("MODEL_IDS[ex.model] || 'fable'")
    expect(source).not.toMatch(/build: \{ model: 'fable'/)
    expect(source).toContain('const validateBand = bandFor(ex.complexity)')
  })

  test('a literal [C0] is a real score, and only an absent prefix routes as unknown', async () => {
    const { events, logs } = await executeWorkflow({ tracks: [[2], [3], [4], [5], [6], [7], [8]], reviewMode: 'github', merge: false }, {
      Prep: () => ({
        issues: [
          { number: 2, title: '[C0] Genuinely the smallest change', complexity: 0, model: 'sonnet', effort: 'high', fableplan: false, missing_block: false },
          { number: 3, title: 'No score anywhere in this title', model: 'sonnet', effort: 'high', fableplan: false, missing_block: false },
          { number: 4, title: '[Cx] Malformed prefix', model: 'sonnet', effort: 'high', fableplan: false, missing_block: false },
          { number: 5, title: 'Prep slipped and reported zero', complexity: 0, model: 'sonnet', effort: 'high', fableplan: false, missing_block: false },
          { number: 6, title: '[C50] Prep slipped on a mid-band title', complexity: 0, model: 'sonnet', effort: 'high', fableplan: false, missing_block: false },
          { number: 7, title: '[C90] Prep slipped on a heavy title', complexity: 5, model: 'sonnet', effort: 'high', fableplan: false, missing_block: false },
          { number: 8, title: '[C50] Prep omitted the score', model: 'sonnet', effort: 'high', fableplan: false, missing_block: false },
        ],
      }),
      Implement: (event) => {
        const issue = issueFromLabel(event.label)
        return {
          pr_number: 1000 + issue, pr_url: `https://example.test/pr/${1000 + issue}`, head_ref: `cc/issue-${issue}`, head_sha: headSha(issue),
          summary: 'implemented', tests_passed: true, github_review_status: 'lgtm', github_review_nonblocking_remaining: 0, github_review_summary: 'clean', flags: [],
        }
      },
    })

    const dispatch = (label) => events.find((event) => event.state === 'started' && event.label === label)
    expect(dispatch('validate:#2')).toMatchObject({ model: 'opus', effort: 'medium' })
    expect(promptFor(events, 'implement:#2 (sonnet/high)')).toContain('gh pr comment <num> --body "@claude sonnet review"')
    for (const issue of [3, 4, 5, 6, 7]) {
      expect(dispatch(`validate:#${issue}`), `#${issue}`).toMatchObject({ model: 'fable', effort: 'high' })
      expect(promptFor(events, `implement:#${issue} (sonnet/high)`), `#${issue}`)
        .toContain('gh pr comment <num> --body "@claude fable review effort:high"')
    }
    expect(logs).toContain('#2: C0 (band 0–9) — validating on Opus 5 @ medium')
    expect(logs).toContain('#3: no [C..] prefix — unknown routes as the top band — validating on Fable 5 @ high')
    expect(logs).toContain('#5: prep reported C0 but the title carries no [C<score>] prefix — routing as unscored (unknown), which takes the top band')
    expect(logs).toContain('#6: prep reported C0 but the title reads [C50] — routing as unscored (unknown), which takes the top band')
    expect(logs).toContain('#7: prep reported C5 but the title reads [C90] — routing as unscored (unknown), which takes the top band')
    expect(logs.filter((m) => m.includes('routing as unscored (unknown)'))).toHaveLength(3)
    expect(dispatch('validate:#8')).toMatchObject({ model: 'opus', effort: 'high' })
    expect(promptFor(events, 'implement:#8 (sonnet/high)')).toContain('gh pr comment <num> --body "@claude opus review"')
    expect(logs).toContain('#8: prep omitted the score but the title reads [C50] — routing on the title prefix')
  })

  test('the prep contract tells a real zero from a missing prefix', async () => {
    const source = await Bun.file(new URL('../workflows/milestone-pipeline.js', import.meta.url)).text()
    expect(source).toContain("required: ['number', 'title', 'model', 'effort', 'fableplan'],")
    const schemaLine = source.match(/^ +complexity: \{.*$/m)[0]
    expect(schemaLine).toMatch(/OMIT this field entirely when the title carries no \[C\.\.\] prefix/)
    const promptLine = source.match(/^- complexity: .*$/m)[0]
    expect(promptLine).toMatch(/OMIT the field rather than sending 0/)
    expect(source).toContain('function hasScore(complexity) {')
    expect(source).toContain('  if (!hasScore(complexity)) return BANDS[BANDS.length - 1]')
    expect(source).toContain('  if (!hasScore(complexity)) return REVIEW_BANDS[REVIEW_BANDS.length - 1]')
    expect(source).not.toMatch(/complexity <= 0\) return (?:BANDS|REVIEW_BANDS)/)
    expect(source).not.toMatch(/ex\.complexity > 0/)
  })

  test('derives validation entirely from the [C..] score band', async () => {
    const { events, logs } = await executeWorkflow({
      tracks: [[2], [3], [4], [5], [6], [7], [8], [9], [10], [11], [12], [13]],
      reviewLoop: false,
    }, {
      Prep: () => ({
        issues: [
          { number: 2, title: '[C2] Band 0 floor', complexity: 2, model: 'sonnet', effort: 'high', fableplan: false, missing_block: false },
          { number: 3, title: '[C9] Band 0 ceiling', complexity: 9, model: 'sonnet', effort: 'high', fableplan: false, missing_block: false },
          { number: 4, title: '[C10] Band 1 floor', complexity: 10, model: 'sonnet', effort: 'xhigh', fableplan: false, missing_block: false },
          { number: 5, title: '[C20] Band 1 ceiling', complexity: 20, model: 'sonnet', effort: 'xhigh', fableplan: false, missing_block: false },
          { number: 6, title: '[C21] Band 2 floor', complexity: 21, model: 'opus', effort: 'high', fableplan: false, missing_block: false },
          { number: 7, title: '[C50] Band 2 ceiling', complexity: 50, model: 'opus', effort: 'high', fableplan: false, missing_block: false },
          { number: 8, title: '[C51] Band 3 floor', complexity: 51, model: 'opus', effort: 'xhigh', fableplan: false, missing_block: false },
          { number: 9, title: '[C70] Band 3 ceiling', complexity: 70, model: 'opus', effort: 'xhigh', fableplan: false, missing_block: false },
          { number: 10, title: '[C71] Band 4 floor', complexity: 71, model: 'opus', effort: 'high', fableplan: false, missing_block: false },
          { number: 11, title: '[C80] Band 4 ceiling', complexity: 80, model: 'opus', effort: 'high', fableplan: false, missing_block: false },
          { number: 12, title: '[C81] Band 5', complexity: 81, model: 'opus', effort: 'xhigh', fableplan: false, missing_block: false },
          { number: 13, title: 'No [C..] prefix', complexity: 0, model: 'opus', effort: 'xhigh', fableplan: false, missing_block: false },
        ],
      }),
    })

    const dispatch = (label) => events.find((event) => event.state === 'started' && event.label === label)
    expect(dispatch('validate:#2')).toMatchObject({ model: 'opus', effort: 'medium' })
    expect(dispatch('validate:#3')).toMatchObject({ model: 'opus', effort: 'medium' })
    expect(dispatch('validate:#4')).toMatchObject({ model: 'opus', effort: 'high' })
    expect(dispatch('validate:#5')).toMatchObject({ model: 'opus', effort: 'high' })
    expect(dispatch('validate:#6')).toMatchObject({ model: 'opus', effort: 'high' })
    expect(dispatch('validate:#7')).toMatchObject({ model: 'opus', effort: 'high' })
    expect(dispatch('validate:#8')).toMatchObject({ model: 'opus', effort: 'xhigh' })
    expect(dispatch('validate:#9')).toMatchObject({ model: 'opus', effort: 'xhigh' })
    expect(dispatch('validate:#10')).toMatchObject({ model: 'fable', effort: 'medium' })
    expect(dispatch('validate:#11')).toMatchObject({ model: 'fable', effort: 'medium' })
    expect(dispatch('validate:#12')).toMatchObject({ model: 'fable', effort: 'high' })
    expect(dispatch('validate:#13')).toMatchObject({ model: 'fable', effort: 'high' })

    expect(logs.filter((message) => message.includes('validating on'))).toEqual([
      '#2: C2 (band 0–9) — validating on Opus 5 @ medium',
      '#3: C9 (band 0–9) — validating on Opus 5 @ medium',
      '#4: C10 (band 10–20) — validating on Opus 5 @ high',
      '#5: C20 (band 10–20) — validating on Opus 5 @ high',
      '#6: C21 (band 21–50) — validating on Opus 5 @ high',
      '#7: C50 (band 21–50) — validating on Opus 5 @ high',
      '#8: C51 (band 51–70) — validating on Opus 5 @ xhigh',
      '#9: C70 (band 51–70) — validating on Opus 5 @ xhigh',
      '#10: C71 (band 71–80) — validating on Fable 5 @ medium',
      '#11: C80 (band 71–80) — validating on Fable 5 @ medium',
      '#12: C81 (band 81+) — validating on Fable 5 @ high',
      '#13: no [C..] prefix — unknown routes as the top band — validating on Fable 5 @ high',
    ])
  })

  test('normalizes forbidden effort tiers before every dispatch', async () => {
    const { events, logs } = await executeWorkflow({
      tracks: [[2], [3], [4], [5], [6], [7], [8], [9], [10], [11]],
      reviewLoop: true,
      reviewMode: 'github',
    }, {
      Prep: () => ({
        issues: [
          { number: 2, title: '[C5] Fable medium', complexity: 5, model: 'fable', effort: 'medium', fableplan: false, missing_block: false },
          { number: 3, title: '[C5] Opus medium', complexity: 5, model: 'opus', effort: 'medium', fableplan: false, missing_block: false },
          { number: 4, title: '[C5] Sonnet medium', complexity: 5, model: 'sonnet', effort: 'medium', fableplan: false, missing_block: false },
          { number: 5, title: '[C5] Haiku medium', complexity: 5, model: 'haiku', effort: 'medium', fableplan: false, missing_block: false },
          { number: 6, title: '[C5] Valid defaults', complexity: 5, model: 'fable', effort: 'high', fableplan: false, missing_block: false },
          { number: 8, title: '[C5] Valid xhigh', complexity: 5, model: 'opus', effort: 'xhigh', fableplan: false, missing_block: false },
          { number: 9, title: '[C5] Fable low', complexity: 5, model: 'fable', effort: 'low', fableplan: false, missing_block: false },
          { number: 10, title: '[C5] Opus low', complexity: 5, model: 'opus', effort: 'low', fableplan: false, missing_block: false },
          { number: 11, title: '[C5] Fable xhigh', complexity: 5, model: 'fable', effort: 'xhigh', fableplan: false, missing_block: false },
        ],
      }),
    })

    const effortFor = (label) => events.find((event) => event.state === 'started' && event.label === label)?.effort
    expect(effortFor('validate:#2')).toBe('medium')
    expect(effortFor('implement:#2 (fable/medium)')).toBe('medium')
    expect(effortFor('review-loop:PR#1002 c2-c3')).toBe('medium')
    expect(effortFor('validate:#3')).toBe('medium')
    expect(effortFor('validate:#4')).toBe('medium')
    expect(effortFor('validate:#5')).toBe('medium')
    expect(effortFor('validate:#6')).toBe('medium')
    expect(effortFor('validate:#7')).toBe('high')
    expect(effortFor('implement:#7 (opus/xhigh)')).toBe('xhigh')
    expect(effortFor('review-loop:PR#1007 c2-c3')).toBe('xhigh')

    for (const [issue, model] of [[3, 'opus'], [4, 'sonnet'], [5, 'haiku']]) {
      expect(effortFor(`implement:#${issue} (${model}/high)`)).toBe('high')
      expect(effortFor(`review-loop:PR#${1000 + issue} c2-c3`)).toBe('high')
    }
    expect(effortFor('implement:#6 (fable/high)')).toBe('high')
    expect(effortFor('review-loop:PR#1006 c2-c3')).toBe('high')
    expect(effortFor('validate:#8')).toBe('medium')
    expect(effortFor('implement:#8 (opus/xhigh)')).toBe('xhigh')
    expect(effortFor('review-loop:PR#1008 c2-c3')).toBe('xhigh')
    expect(effortFor('implement:#9 (fable/low)')).toBe('low')
    expect(effortFor('review-loop:PR#1009 c2-c3')).toBe('low')
    expect(effortFor('implement:#10 (opus/high)')).toBe('high')
    expect(effortFor('review-loop:PR#1010 c2-c3')).toBe('high')
    expect(effortFor('implement:#11 (fable/high)')).toBe('high')
    expect(effortFor('review-loop:PR#1011 c2-c3')).toBe('high')

    expect(promptFor(events, 'implement:#9 (fable/low)')).toContain('| low | Harness: milestone-pipeline')
    expect(promptFor(events, 'review-loop:PR#1009 c2-c3')).toContain('| low | Harness: milestone-pipeline')
    expect(promptFor(events, 'implement:#10 (opus/high)')).toContain('| high | Harness: milestone-pipeline')
    expect(promptFor(events, 'implement:#10 (opus/high)')).not.toContain('| low |')

    const normalizations = logs.filter((message) => message.includes('normalized'))
    expect(normalizations).toEqual([
      '#3: normalized build effort medium → high for Opus 5 (low/medium are Fable-only)',
      '#4: normalized build effort medium → high for Sonnet 5 (low/medium are Fable-only)',
      '#5: normalized build effort medium → high for Haiku 4.5 (low/medium are Fable-only)',
      '#10: normalized build effort low → high for Opus 5 (low/medium are Fable-only)',
      '#11: normalized build effort xhigh → high (Fable never runs at xhigh)',
    ])
  })

  test('waits for reviewed hard prerequisites while independent tracks start immediately', async () => {
    const review = deferred()
    let independentStarted = false
    let dependentStarted = false
    const running = executeWorkflow({
      tracks: [
        { issues: [2] },
        { issues: [9], after: [0] },
        { issues: [12] },
      ],
      reviewLoop: true,
      reviewMode: 'github',
      merge: false,
    }, {
      'review-loop:PR#1002 c2-c3': () => review.promise,
      'validate:#9': () => {
        dependentStarted = true
        return { verdict: 'VALID', summary: 'valid', corrections: [], implementation_constraints: [] }
      },
      'validate:#12': () => {
        independentStarted = true
        return { verdict: 'VALID', summary: 'valid', corrections: [], implementation_constraints: [] }
      },
    })

    await waitFor(() => independentStarted)
    expect(dependentStarted).toBeFalse()

    review.resolve({
      status: 'lgtm',
      nonblocking_remaining: 0,
      cycles_run: 1,
      summary: 'approved',
      head_ref: 'codex/issue-2',
      head_sha: headSha(2, 'a'),
    })
    const result = await running
    const reviewFinished = result.events.findIndex((event) => event.state === 'finished' && event.label === 'review-loop:PR#1002 c2-c3')
    const dependentStartIndex = result.events.findIndex((event) => event.state === 'started' && event.label === 'validate:#9')
    const independentStartIndex = result.events.findIndex((event) => event.state === 'started' && event.label === 'validate:#12')

    expect(independentStartIndex).toBeGreaterThan(-1)
    expect(dependentStartIndex).toBeGreaterThan(reviewFinished)
    expect(promptFor(result.events, 'implement:#9 (fable/high)')).toContain(`"sha":"${headSha(2, 'a')}"`)
  })

  test('keeps legacy arrays and treats their serial edges as hard dependencies', async () => {
    const { output, events } = await executeWorkflow({ tracks: [[2, 3]], reviewLoop: false })

    expect(output.results.map((result) => result.issue)).toEqual([2, 3])
    expect(promptFor(events, 'implement:#3 (fable/high)')).toContain(`baseRefs: [{"pr":1002,"ref":"codex/issue-2","sha":"${headSha(2)}"}]`)
    expect(events.filter((event) => event.phase === 'Review Loop')).toHaveLength(0)
  })

  test('keeps string-encoded legacy arguments compatible', async () => {
    const { output } = await executeWorkflow(JSON.stringify({ tracks: [[2]], reviewLoop: false }))

    expect(output.results).toHaveLength(1)
    expect(output.results[0].status).toBe('pr_open')
  })

  test.each([
    ['disabled', { tracks: [[2]], reviewLoop: false }, 'off'],
    ['subagent-mode', { tracks: [[2]], reviewLoop: true, reviewMode: 'subagent' }, 'subagent'],
    ['enabled', { tracks: [[2]], reviewLoop: true }, 'github'],
    ['enabled by default', { tracks: [[2]] }, 'github'],
  ])('%s review loops control the initial review request and reporting', async (_name, args, mode) => {
    const { events, logs } = await executeWorkflow(args)
    const prompt = promptFor(events, 'implement:#2 (fable/high)')
    const pullRequestLog = logs.find((message) => message.startsWith('#2: PR #1002 open'))

    expect(prompt.toLowerCase().includes('trigger the review bot')).toBe(mode === 'github')
    expect(prompt.includes('reviews pull requests with in-session subagents')).toBe(mode === 'subagent')
    expect(prompt.includes('do not request or trigger any pull request review')).toBe(mode === 'off')
    expect(events.some((event) => event.phase === 'Review Loop')).toBe(mode !== 'off')
    expect(pullRequestLog.includes('@claude review triggered')).toBe(mode === 'github')
    expect(pullRequestLog.includes('dispatching subagent review')).toBe(mode === 'subagent')
  })

  test('rejects an unknown reviewMode before prep', async () => {
    let prepStarted = false
    const running = executeWorkflow({ tracks: [[2]], reviewMode: 'actions' }, {
      Prep: () => {
        prepStarted = true
        return { issues: [] }
      },
    })

    await expect(running).rejects.toThrow(/reviewMode must be 'subagent' or 'github'/)
    expect(prepStarted).toBeFalse()
  })

  test('surfaces issue-edit authorization only when validation corrections exist', async () => {
    const withCorrections = await executeWorkflow({ tracks: [[2]], reviewLoop: false }, {
      Validate: () => ({
        verdict: 'VALID_WITH_CORRECTIONS',
        summary: 'valid with corrections',
        corrections: ['Correct the stale file reference'],
        implementation_constraints: [],
      }),
    })
    const withoutCorrections = await executeWorkflow({ tracks: [[2]], reviewLoop: false })
    const authorization = 'The user approved this milestone run plan, which explicitly authorizes applying these validation corrections to this issue.'

    expect(promptFor(withCorrections.events, 'implement:#2 (fable/high)')).toContain(authorization)
    expect(promptFor(withoutCorrections.events, 'implement:#2 (fable/high)')).not.toContain(authorization)
  })

  test.each([
    ['empty track', { tracks: [[]] }, /track 1.*non-empty issues/i],
    ['duplicate issue', { tracks: [[2], [2]] }, /issue #2.*more than once/i],
    ['invalid predecessor', { tracks: [{ issues: [2], after: [1] }] }, /track 1.*invalid predecessor/i],
    ['self dependency', { tracks: [{ issues: [2], runsAfter: [0] }] }, /track 1.*itself/i],
    ['duplicate predecessor', { tracks: [{ issues: [2] }, { issues: [3], after: [0, 0] }] }, /track 2.*duplicate predecessor/i],
    ['conflicting edge types', { tracks: [{ issues: [2] }, { issues: [3], after: [0], runsAfter: [0] }] }, /track 2.*duplicate predecessor/i],
    ['misspelled ordering key', { tracks: [{ issues: [2] }, { issues: [9], runAfter: [0] }] }, /track 2.*unknown key.*runAfter/i],
    ['capitalized hard-edge key', { tracks: [{ issues: [2] }, { issues: [9], After: [0] }] }, /track 2.*unknown key.*After/i],
    ['cycle', { tracks: [{ issues: [2], after: [1] }, { issues: [3], runsAfter: [0] }] }, /cycle.*track/i],
  ])('rejects %s before prep', async (_name, args, message) => {
    let prepStarted = false
    const running = executeWorkflow(args, {
      Prep: () => {
        prepStarted = true
        return { issues: [] }
      },
    })

    await expect(running).rejects.toThrow(message)
    expect(prepStarted).toBeFalse()
  })

  test('blocks hard descendants when a prerequisite is skipped', async () => {
    const { output, events } = await executeWorkflow({
      tracks: [{ issues: [2] }, { issues: [9], after: [0] }],
      reviewLoop: false,
    }, {
      'validate:#2': () => ({
        verdict: 'INVALID',
        summary: 'invalid',
        invalid_reason: 'missing contract',
        corrections: [],
        implementation_constraints: [],
      }),
    })

    expect(started(events, 'validate:#9')).toBeFalse()
    expect(output.results.find((result) => result.issue === 9)?.status).toBe('dependency_blocked')
  })

  test('allows ordering-only descendants when a predecessor produced no pull request', async () => {
    const { output, events } = await executeWorkflow({
      tracks: [{ issues: [2] }, { issues: [9], runsAfter: [0] }],
      reviewLoop: false,
    }, {
      'validate:#2': () => ({
        verdict: 'INVALID',
        summary: 'invalid',
        invalid_reason: 'not applicable',
        corrections: [],
        implementation_constraints: [],
      }),
    })

    expect(started(events, 'implement:#9 (fable/high)')).toBeTrue()
    expect(output.results.find((result) => result.issue === 9)?.status).toBe('pr_open')
  })

  test('blocks ordering successors when an implementation failure leaves pull request state unknown', async () => {
    const { output, events } = await executeWorkflow({
      tracks: [{ issues: [2] }, { issues: [9], runsAfter: [0] }],
      reviewLoop: false,
    }, {
      'implement:#2 (fable/high)': () => { throw new Error('agent disconnected') },
    })

    expect(started(events, 'validate:#9')).toBeFalse()
    expect(output.results.find((result) => result.issue === 9)?.status).toBe('dependency_blocked')
  })

  test('deduplicates transitive context and passes deterministic hard base refs', async () => {
    const { events } = await executeWorkflow({
      tracks: [
        { issues: [2] },
        { issues: [3], after: [0] },
        { issues: [9], after: [0, 1] },
      ],
      reviewLoop: false,
    })
    const prompt = promptFor(events, 'implement:#9 (fable/high)')

    expect(prompt).toContain(`baseRefs: [{"pr":1002,"ref":"codex/issue-2","sha":"${headSha(2)}"},{"pr":1003,"ref":"codex/issue-3","sha":"${headSha(3)}"}]`)
    expect(prompt.match(/Issue #2/g)).toHaveLength(1)
    expect(prompt.match(/Issue #3/g)).toHaveLength(1)
  })

  test('blocks ordering and hard descendants behind an unresolved review', async () => {
    const { output, events } = await executeWorkflow({
      tracks: [
        { issues: [2] },
        { issues: [9], after: [0] },
        { issues: [12], runsAfter: [0] },
      ],
      reviewLoop: true,
      reviewMode: 'github',
    }, {
      'review-loop:PR#1002 c2-c3': () => ({
        status: 'blocked',
        nonblocking_remaining: 0,
        cycles_run: 1,
        summary: 'review failed',
        head_ref: 'codex/issue-2',
        head_sha: headSha(2, 'b'),
        blocker: 'review failed',
      }),
    })

    expect(started(events, 'validate:#9')).toBeFalse()
    expect(started(events, 'validate:#12')).toBeFalse()
    expect(output.results.filter((result) => result.status === 'dependency_blocked')).toHaveLength(2)
  })

  test('rejects an LGTM boundary that omits its verified head', async () => {
    const { output, events } = await executeWorkflow({
      tracks: [{ issues: [2] }, { issues: [9], after: [0] }],
      reviewLoop: true,
      reviewMode: 'github',
    }, {
      'review-loop:PR#1002 c2-c3': () => ({ status: 'lgtm', nonblocking_remaining: 0, cycles_run: 1, summary: 'approved', head_ref: '', head_sha: '' }),
    })

    expect(output.results.find((result) => result.issue === 2)?.status).toBe('review_invalid_head')
    expect(output.results.find((result) => result.issue === 9)?.status).toBe('dependency_blocked')
    expect(started(events, 'validate:#9')).toBeFalse()
  })

  test('contains thrown track failures and reports blocked descendants', async () => {
    const { output } = await executeWorkflow({
      tracks: [{ issues: [2] }, { issues: [9], after: [0] }, { issues: [12] }],
      reviewLoop: false,
    }, {
      'validate:#2': () => { throw new Error('validator crashed') },
    })

    expect(output.results.find((result) => result.issue === 2)?.status).toBe('validation_failed')
    expect(output.results.find((result) => result.issue === 9)?.status).toBe('dependency_blocked')
    expect(output.results.find((result) => result.issue === 12)?.status).toBe('pr_open')
  })

  test('stops hard descendants when dependency-base integration fails', async () => {
    const { output, events } = await executeWorkflow({
      tracks: [
        { issues: [2] },
        { issues: [3] },
        { issues: [9], after: [0, 1] },
        { issues: [12], after: [2] },
      ],
      reviewLoop: false,
    }, {
      'implement:#9 (fable/high)': () => ({
        pr_number: 0,
        pr_url: '',
        head_ref: '',
        head_sha: '',
        summary: 'blocked',
        tests_passed: false,
        blocker: 'dependency-base merge conflict',
      }),
    })

    expect(promptFor(events, 'implement:#9 (fable/high)')).toContain(`baseRefs: [{"pr":1002,"ref":"codex/issue-2","sha":"${headSha(2)}"},{"pr":1003,"ref":"codex/issue-3","sha":"${headSha(3)}"}]`)
    expect(output.results.find((result) => result.issue === 9)?.blocker).toContain('merge conflict')
    expect(output.results.find((result) => result.issue === 12)?.status).toBe('dependency_blocked')
  })

  test('defers every issue when the token budget is below the floor at start', async () => {
    const { output, events, logs } = await executeWorkflow(
      { tracks: [[2, 3]], reviewLoop: false },
      {},
      { total: 100_000, spent: () => 60_000, remaining: () => 40_000 },
    )

    expect(started(events, 'validate:#2')).toBeFalse()
    expect(output.results.find((result) => result.issue === 2)?.status).toBe('budget_deferred')
    expect(output.results.find((result) => result.issue === 3)?.status).toBe('budget_deferred')
    expect(logs.some((message) => message.includes('token budget floor reached'))).toBeTrue()
  })

  test('runs without a floor when no token target is set', async () => {
    const { output } = await executeWorkflow(
      { tracks: [[2]], reviewLoop: false },
      {},
      { total: null, spent: () => 5_000_000, remaining: () => Infinity },
    )

    expect(output.results.find((result) => result.issue === 2)?.status).toBe('pr_open')
  })

  test('defers remaining issues when spend crosses the floor mid-track and blocks hard successors', async () => {
    let spent = 0
    const { output, events } = await executeWorkflow({
      tracks: [
        { issues: [2, 3] },
        { issues: [9], after: [0] },
      ],
      reviewLoop: false,
    }, {
      'implement:#2 (fable/high)': () => {
        spent = 150_000
        return {
          pr_number: 1002,
          pr_url: 'https://example.test/pr/1002',
          head_ref: 'codex/issue-2',
          head_sha: headSha(2),
          summary: 'implemented',
          tests_passed: true,
          flags: [],
        }
      },
    }, { total: 200_000, spent: () => spent, remaining: () => Math.max(0, 200_000 - spent) })

    expect(output.results.find((result) => result.issue === 2)?.status).toBe('pr_open')
    expect(output.results.find((result) => result.issue === 3)?.status).toBe('budget_deferred')
    expect(started(events, 'validate:#3')).toBeFalse()
    expect(output.results.find((result) => result.issue === 9)?.status).toBe('dependency_blocked')
    expect(started(events, 'validate:#9')).toBeFalse()
  })

  test('honors a custom budgetFloor', async () => {
    const { output } = await executeWorkflow(
      { tracks: [[2]], reviewLoop: false, budgetFloor: 10_000 },
      {},
      { total: 100_000, spent: () => 60_000, remaining: () => 40_000 },
    )

    expect(output.results.find((result) => result.issue === 2)?.status).toBe('pr_open')
  })
})

describe('milestone-pipeline github review mode', () => {
  function implementationReview(status, nonblocking = 0, fill = '0') {
    return {
      pr_number: 1002,
      pr_url: 'https://example.test/pr/1002',
      head_ref: 'codex/issue-2',
      head_sha: headSha(2, fill),
      summary: 'implemented',
      tests_passed: true,
      github_review_status: status,
      github_review_nonblocking_remaining: nonblocking,
      github_review_summary: `cycle 1 ${status}`,
      flags: [],
    }
  }

  test('the implementation agent handles a clean first cycle without a fix agent', async () => {
    const { output, events } = await executeWorkflow({ tracks: [[2]], reviewMode: 'github', merge: false }, {
      Implement: () => implementationReview('lgtm'),
    })
    const record = output.results.find((result) => result.issue === 2)

    expect(events.filter((event) => event.phase === 'Review Loop')).toHaveLength(0)
    expect(promptFor(events, 'implement:#2 (fable/high)')).toContain('handle github review cycle 1 yourself')
    expect(record?.status).toBe('lgtm')
    expect(record?.review.cycles_run).toBe(1)
  })

  test('one later agent can complete two review cycles', async () => {
    const { output, events } = await executeWorkflow({ tracks: [[2]], reviewMode: 'github', merge: false }, {
      'review-loop:PR#1002 c2-c3': () => ({
        status: 'lgtm',
        nonblocking_remaining: 0,
        cycles_run: 2,
        summary: 'fixed two rounds',
        head_ref: 'codex/issue-2',
        head_sha: headSha(2, 'c'),
      }),
    })
    const record = output.results.find((result) => result.issue === 2)

    expect(events.filter((event) => event.state === 'started' && event.phase === 'Review Loop')).toHaveLength(1)
    expect(promptFor(events, 'review-loop:PR#1002 c2-c3')).toContain('Run at most 2 cycles')
    expect(record?.review.cycles_run).toBe(3)
    expect(record?.head_sha).toBe(headSha(2, 'c'))
  })

  test.each([
    ['one-cycle batch', { maxReviewCycles: 2 }, 'review-loop:PR#1002 c2', 1, 'Run at most 1 cycle', 'cycles_run (exactly 1, never above 1)', 'exactly 1'],
    ['two-cycle batch', {}, 'review-loop:PR#1002 c2-c3', 2, 'Run at most 2 cycles', 'cycles_run (1 or 2, never above 2)', '1 to 2'],
  ])('bounds a %s to the cycles it owns in both the prompt and the schema', async (_name, extraArgs, label, cycleLimit, runLine, returnLine, schemaGloss) => {
    const { events } = await executeWorkflow({ tracks: [[2]], reviewMode: 'github', merge: false, ...extraArgs })
    const batch = events.find((event) => event.state === 'started' && event.label === label)

    expect(batch.prompt).toContain(runLine)
    expect(batch.prompt).toContain(returnLine)
    expect(batch.prompt).not.toContain('1 or 2, never above 1')
    expect(batch.schema.properties.cycles_run.minimum).toBe(1)
    expect(batch.schema.properties.cycles_run.maximum).toBe(cycleLimit)
    expect(batch.schema.properties.cycles_run.description).toContain(schemaGloss)
  })

  test('starts a fresh agent after each two-cycle batch', async () => {
    const { output, events } = await executeWorkflow({ tracks: [[2]], reviewMode: 'github', merge: false }, {
      'review-loop:PR#1002 c2-c3': () => ({
        status: 'needs_updates',
        nonblocking_remaining: 0,
        cycles_run: 2,
        summary: 'more fixes needed',
        head_ref: 'codex/issue-2',
        head_sha: headSha(2, 'c'),
      }),
      'review-loop:PR#1002 c4-c5': () => ({
        status: 'lgtm',
        nonblocking_remaining: 0,
        cycles_run: 2,
        summary: 'clean',
        head_ref: 'codex/issue-2',
        head_sha: headSha(2, 'e'),
      }),
    })
    const record = output.results.find((result) => result.issue === 2)

    expect(started(events, 'review-loop:PR#1002 c2-c3')).toBeTrue()
    expect(started(events, 'review-loop:PR#1002 c4-c5')).toBeTrue()
    expect(record?.review.cycles_run).toBe(5)
    expect(record?.status).toBe('lgtm')
  })

  test('rejects a batch that reports more cycles than it owns', async () => {
    const { output } = await executeWorkflow({ tracks: [[2]], reviewMode: 'github', merge: false }, {
      'review-loop:PR#1002 c2-c3': () => ({
        status: 'lgtm',
        nonblocking_remaining: 0,
        cycles_run: 3,
        summary: 'invalid',
        head_ref: 'codex/issue-2',
        head_sha: headSha(2),
      }),
    })
    const record = output.results.find((result) => result.issue === 2)

    expect(record?.status).toBe('review_blocked')
    expect(record?.review.blocker).toContain('invalid cycles_run 3')
  })

  test.each([
    ['lgtm with non-blocking findings', 'lgtm', 1, 'lgtm_with_nonblocking'],
    ['needs updates', 'needs_updates', 0, 'max_cycles_exhausted'],
  ])('preserves the final-cycle boundary for %s', async (_name, status, nonblocking, finalStatus) => {
    const { output, events } = await executeWorkflow({ tracks: [[2]], reviewMode: 'github', maxReviewCycles: 1, merge: false }, {
      Implement: () => implementationReview(status, nonblocking),
    })
    const record = output.results.find((result) => result.issue === 2)

    expect(events.filter((event) => event.phase === 'Review Loop')).toHaveLength(0)
    expect(record?.review.final_status).toBe(finalStatus)
  })
})

describe('milestone-pipeline subagent review mode', () => {
  const prepIssue = (overrides = {}) => {
    const merged = {
      number: 2,
      complexity: 60,
      model: 'fable',
      effort: 'high',
      fableplan: false,
      missing_block: false,
      first_review_model: 'fable',
      first_review_effort: 'high',
      ...overrides,
    }
    if (merged.title === undefined) {
      merged.title = Number.isInteger(merged.complexity) ? `[C${merged.complexity}] Issue ${merged.number}` : `Issue ${merged.number}`
    }
    return merged
  }

  test('a clean first-cycle LGTM reviews once on the issue first-review spec and dispatches no fixer', async () => {
    const { output, events } = await executeWorkflow({ tracks: [[2]], reviewMode: 'subagent', merged: [mergedRecord(2)] }, {
      Prep: () => ({ issues: [prepIssue()] }),
    })
    const record = output.results.find((result) => result.issue === 2)

    expect(started(events, 'review:PR#1002 c1 (fable/high)')).toBeTrue()
    expect(events.filter((event) => event.state === 'started' && event.label.startsWith('fix:'))).toHaveLength(0)
    expect(record?.status).toBe('merged')
    expect(record?.review.final_status).toBe('lgtm')
    expect(record?.review.cycles_run).toBe(1)
  })

  test('defaults the first review to the [C..] band when the PR review line is standard or absent', async () => {
    const { events } = await executeWorkflow({ tracks: [[2], [3], [4], [5], [6], [7], [8]], reviewMode: 'subagent' }, {
      Prep: () => ({
        issues: [
          prepIssue({ number: 2, complexity: 10, first_review_model: undefined, first_review_effort: undefined }),
          prepIssue({ number: 3, complexity: 11, first_review_model: undefined, first_review_effort: undefined }),
          prepIssue({ number: 4, complexity: 40, first_review_model: undefined, first_review_effort: undefined }),
          prepIssue({ number: 5, complexity: 41, first_review_model: undefined, first_review_effort: undefined }),
          prepIssue({ number: 6, complexity: 80, first_review_model: undefined, first_review_effort: undefined }),
          prepIssue({ number: 7, complexity: 81, first_review_model: undefined, first_review_effort: undefined }),
          prepIssue({ number: 8, complexity: undefined, first_review_model: undefined, first_review_effort: undefined }),
        ],
      }),
    })

    expect(started(events, 'review:PR#1002 c1 (sonnet/high)')).toBeTrue()
    const bandZeroReview = events.find((event) => event.state === 'started' && event.label === 'review:PR#1003 c1 (claude/high)')
    expect(bandZeroReview).toBeTruthy()
    expect(bandZeroReview.model).toBeUndefined()
    const bandZeroTop = events.find((event) => event.state === 'started' && event.label === 'review:PR#1004 c1 (claude/high)')
    expect(bandZeroTop).toBeTruthy()
    expect(bandZeroTop.model).toBeUndefined()
    expect(started(events, 'review:PR#1005 c1 (opus/high)')).toBeTrue()
    expect(started(events, 'review:PR#1006 c1 (opus/high)')).toBeTrue()
    expect(started(events, 'review:PR#1007 c1 (fable/high)')).toBeTrue()
    expect(started(events, 'review:PR#1008 c1 (fable/high)')).toBeTrue()
  })

  test('github mode derives the cycle-1 trigger phrase from the band', async () => {
    const { events } = await executeWorkflow({ tracks: [[2], [3], [4], [5], [6]], reviewMode: 'github', merge: false }, {
      Prep: () => ({
        issues: [
          { number: 2, title: '[C10] Band 1', complexity: 10, model: 'sonnet', effort: 'xhigh', fableplan: false, missing_block: false },
          { number: 3, title: '[C60] Band 3', complexity: 60, model: 'opus', effort: 'high', fableplan: false, missing_block: false },
          { number: 4, title: '[C90] Band 5', complexity: 90, model: 'fable', effort: 'high', fableplan: false, missing_block: false },
          { number: 5, title: '[C10] Stamped trigger', complexity: 10, model: 'sonnet', effort: 'xhigh', fableplan: false, missing_block: false, first_review_model: 'fable', first_review_effort: 'high' },
          { number: 6, title: '[C20] Band 2', complexity: 20, model: 'sonnet', effort: 'high', fableplan: false, missing_block: false },
        ],
      }),
      Implement: (event) => {
        const issue = issueFromLabel(event.label)
        return {
          pr_number: 1000 + issue, pr_url: `https://example.test/pr/${1000 + issue}`, head_ref: `codex/issue-${issue}`, head_sha: headSha(issue),
          summary: 'implemented', tests_passed: true, github_review_status: 'lgtm', github_review_nonblocking_remaining: 0, github_review_summary: 'clean', flags: [],
        }
      },
    })

    expect(promptFor(events, 'implement:#2 (sonnet/xhigh)')).toContain('gh pr comment <num> --body "@claude sonnet review"')
    expect(promptFor(events, 'implement:#6 (sonnet/high)')).toContain('gh pr comment <num> --body "@claude review"')
    expect(promptFor(events, 'implement:#3 (opus/high)')).toContain('gh pr comment <num> --body "@claude opus review"')
    expect(promptFor(events, 'implement:#4 (fable/high)')).toContain('gh pr comment <num> --body "@claude fable review effort:high"')
    expect(promptFor(events, 'implement:#5 (sonnet/xhigh)')).toContain('gh pr comment <num> --body "@claude fable review effort:high"')
    for (const label of ['implement:#2 (sonnet/xhigh)', 'implement:#3 (opus/high)', 'implement:#4 (fable/high)']) {
      expect(promptFor(events, label), label).not.toContain('@codex')
    }
  })

  test('reviewBot codex routes every github-mode trigger to @codex', async () => {
    const { events } = await executeWorkflow({ tracks: [[2], [3], [4], [5], [6], [7]], reviewMode: 'github', reviewBot: 'codex', merge: false }, {
      Prep: () => ({
        issues: [
          { number: 2, title: '[C10] Band 1', complexity: 10, model: 'sonnet', effort: 'xhigh', fableplan: false, missing_block: false },
          { number: 3, title: '[C60] Band 3', complexity: 60, model: 'opus', effort: 'high', fableplan: false, missing_block: false },
          { number: 4, title: '[C90] Band 5', complexity: 90, model: 'fable', effort: 'high', fableplan: false, missing_block: false },
          { number: 5, title: '[C60] Stamped trigger', complexity: 60, model: 'sonnet', effort: 'xhigh', fableplan: false, missing_block: false, first_review_model: 'sonnet', first_review_effort: 'high' },
          { number: 6, title: '[C20] Band 2', complexity: 20, model: 'sonnet', effort: 'high', fableplan: false, missing_block: false },
          { number: 7, title: '[C5] Stamped fable on a tiny issue', complexity: 5, model: 'sonnet', effort: 'high', fableplan: false, missing_block: false, first_review_model: 'fable', first_review_effort: 'high' },
        ],
      }),
      Implement: (event) => {
        const issue = issueFromLabel(event.label)
        return {
          pr_number: 1000 + issue, pr_url: `https://example.test/pr/${1000 + issue}`, head_ref: `codex/issue-${issue}`, head_sha: headSha(issue),
          summary: 'implemented', tests_passed: true, github_review_status: 'lgtm', github_review_nonblocking_remaining: 0, github_review_summary: 'clean', flags: [],
        }
      },
    })

    expect(promptFor(events, 'implement:#2 (sonnet/xhigh)')).toContain('gh pr comment <num> --body "@codex luna review"')
    expect(promptFor(events, 'implement:#6 (sonnet/high)')).toContain('gh pr comment <num> --body "@codex review"')
    expect(promptFor(events, 'implement:#3 (opus/high)')).toContain('gh pr comment <num> --body "@codex review"')
    expect(promptFor(events, 'implement:#4 (fable/high)')).toContain('gh pr comment <num> --body "@codex review"')
    expect(promptFor(events, 'implement:#5 (sonnet/xhigh)')).toContain('gh pr comment <num> --body "@codex luna review effort:high"')
    expect(promptFor(events, 'implement:#7 (sonnet/high)')).toContain('gh pr comment <num> --body "@codex review effort:high"')
    expect(promptFor(events, 'implement:#7 (sonnet/high)')).not.toContain('@codex fable')
    for (const label of ['implement:#2 (sonnet/xhigh)', 'implement:#5 (sonnet/xhigh)']) {
      const prompt = promptFor(events, label)
      expect(prompt, label).toContain('.github/workflows/codex.yml')
      expect(prompt, label).toContain('never switch to @claude')
      expect(prompt, `${label}: re-trigger keys to cycle 1`).toContain(
        'keyed to the reviewer that actually ran cycle 1',
      )
      expect(prompt, `${label}: C81+ ladder never reaches luna`).toContain('never reaches luna')
    }
    const codexRetrigger = {
      'implement:#2 (sonnet/xhigh)': '@codex luna review',
      'implement:#6 (sonnet/high)': '@codex review',
      'implement:#3 (opus/high)': '@codex review',
      'implement:#4 (fable/high)': '@codex review',
      'implement:#5 (sonnet/xhigh)': '@codex luna review effort:high',
      'implement:#7 (sonnet/high)': '@codex review effort:high',
    }
    for (const [label, trigger] of Object.entries(codexRetrigger)) {
      expect(promptFor(events, label), `${label}: blocking re-trigger`).toContain(
        `the blocking re-trigger exactly \`${trigger}\``,
      )
    }
  })

  test('the github-mode cycle-1 prompt keys its Claude re-trigger to the cycle-1 reviewer', async () => {
    const { events } = await executeWorkflow({ tracks: [[2], [4], [5], [6], [7]], reviewMode: 'github', merge: false }, {
      Prep: () => ({
        issues: [
          { number: 2, title: '[C8] Cheap band', complexity: 8, model: 'sonnet', effort: 'xhigh', fableplan: false, missing_block: false },
          { number: 4, title: '[C90] Top band', complexity: 90, model: 'fable', effort: 'high', fableplan: false, missing_block: false },
          { number: 5, title: '[C5] Stamped opus on a tiny issue', complexity: 5, model: 'sonnet', effort: 'high', fableplan: false, missing_block: false, first_review_model: 'opus', first_review_effort: 'high' },
          { number: 6, title: '[C90] Stamped opus on a heavy issue', complexity: 90, model: 'opus', effort: 'high', fableplan: false, missing_block: false, first_review_model: 'opus', first_review_effort: 'high' },
          { number: 7, title: '[C5] Stamped haiku', complexity: 5, model: 'sonnet', effort: 'high', fableplan: false, missing_block: false, first_review_model: 'haiku', first_review_effort: 'high' },
        ],
      }),
      Implement: (event) => {
        const issue = issueFromLabel(event.label)
        return {
          pr_number: 1000 + issue, pr_url: `https://example.test/pr/${1000 + issue}`, head_ref: `cc/issue-${issue}`, head_sha: headSha(issue),
          summary: 'implemented', tests_passed: true, github_review_status: 'lgtm', github_review_nonblocking_remaining: 0, github_review_summary: 'clean', flags: [],
        }
      },
    })

    const expected = {
      'implement:#2 (sonnet/xhigh)': ['@claude sonnet review', '@claude sonnet review'],
      'implement:#4 (fable/high)': ['@claude fable review effort:high', '@claude opus review'],
      'implement:#5 (sonnet/high)': ['@claude opus review effort:high', '@claude opus review effort:high'],
      'implement:#6 (opus/high)': ['@claude opus review effort:high', '@claude opus review effort:high'],
      'implement:#7 (sonnet/high)': ['@claude sonnet review effort:high', '@claude sonnet review effort:high'],
    }
    for (const [label, [cycle1, blocking]] of Object.entries(expected)) {
      const prompt = promptFor(events, label)
      expect(prompt, `${label}: cycle-1 trigger`).toContain(`gh pr comment <num> --body "${cycle1}"`)
      expect(prompt, `${label}: blocking re-trigger`).toContain(`the blocking re-trigger exactly \`${blocking}\``)
      expect(prompt, `${label}: non-blocking re-trigger`).toContain('the non-blocking one `@claude sonnet review`')
      expect(prompt, `${label}: keyed to cycle 1, not the band`).toContain(
        'keyed to the reviewer that actually ran cycle 1',
      )
      expect(prompt, `${label}: fable never repeats`).toContain('its trigger is never repeated')
    }
  })

  test('a validator rescore never lowers a stamped first review', async () => {
    const stampedIssues = [
      { number: 2, title: '[C5] Stamped fable, rescored to a weaker review band', complexity: 5, model: 'sonnet', effort: 'high', fableplan: false, missing_block: false, first_review_model: 'fable', first_review_effort: 'high' },
      { number: 3, title: '[C5] Stamped sonnet, rescored past it', complexity: 5, model: 'sonnet', effort: 'high', fableplan: false, missing_block: false, first_review_model: 'sonnet', first_review_effort: 'high' },
      { number: 4, title: '[C5] Stamped opus, rescored to the bare trigger band', complexity: 5, model: 'sonnet', effort: 'high', fableplan: false, missing_block: false, first_review_model: 'opus', first_review_effort: 'high' },
    ]
    const rescores = {
      'validate:#2': 25,
      'validate:#3': 90,
      'validate:#4': 25,
    }
    const handlers = {
      Prep: () => ({ issues: stampedIssues }),
      Implement: (event) => {
        const issue = issueFromLabel(event.label)
        return {
          pr_number: 1000 + issue, pr_url: `https://example.test/pr/${1000 + issue}`, head_ref: `cc/issue-${issue}`, head_sha: headSha(issue),
          summary: 'implemented', tests_passed: true, github_review_status: 'lgtm', github_review_nonblocking_remaining: 0, github_review_summary: 'clean', flags: [],
        }
      },
    }
    for (const [label, rescored_complexity] of Object.entries(rescores)) {
      handlers[label] = () => ({ verdict: 'VALID', summary: 'valid', corrections: [], implementation_constraints: [], rescored_complexity })
    }

    const { events, logs } = await executeWorkflow({ tracks: [[2], [3], [4]], reviewMode: 'github', merge: false }, handlers)

    const two = promptFor(events, 'implement:#2 (opus/high)')
    expect(two, '#2 cycle-1 keeps the stamp').toContain('gh pr comment <num> --body "@claude fable review effort:high"')
    expect(two, '#2 blocking re-trigger steps down').toContain('the blocking re-trigger exactly `@claude opus review`')
    expect(logs.some((m) => m.includes('#2: keeping the stamped first review Fable 5'))).toBeTrue()

    const three = promptFor(events, 'implement:#3 (opus/xhigh)')
    expect(three, '#3 stamp is replaced by the stronger band default').toContain('gh pr comment <num> --body "@claude fable review effort:high"')
    expect(logs.some((m) => m.includes('#3: rescored review band 81+ outranks the stamped first review Sonnet 5'))).toBeTrue()

    const four = promptFor(events, 'implement:#4 (opus/high)')
    expect(four, '#4 cycle-1 keeps the stamp').toContain('gh pr comment <num> --body "@claude opus review effort:high"')
    expect(four, '#4 blocking re-trigger repeats it').toContain('the blocking re-trigger exactly `@claude opus review effort:high`')
  })

  test('a rescore across only the review boundary re-evaluates the stamped first review', async () => {
    const { events, logs } = await executeWorkflow({ tracks: [[2], [3], [4], [5]], reviewMode: 'github', merge: false }, {
      Prep: () => ({
        issues: [
          { number: 2, title: '[C10] Stamped sonnet, rescored past the review boundary', complexity: 10, model: 'sonnet', effort: 'xhigh', fableplan: false, missing_block: false, first_review_model: 'sonnet', first_review_effort: 'high' },
          { number: 3, title: '[C10] Stamped opus, rescored past the review boundary', complexity: 10, model: 'sonnet', effort: 'xhigh', fableplan: false, missing_block: false, first_review_model: 'opus', first_review_effort: 'high' },
          { number: 4, title: '[C10] Stamped sonnet, rescored downward', complexity: 10, model: 'sonnet', effort: 'xhigh', fableplan: false, missing_block: false, first_review_model: 'sonnet', first_review_effort: 'high' },
          { number: 5, title: '[C10] Unstamped, rescored past the review boundary', complexity: 10, model: 'sonnet', effort: 'xhigh', fableplan: false, missing_block: false },
        ],
      }),
      'validate:#2': () => ({ verdict: 'VALID', summary: 'valid', corrections: [], implementation_constraints: [], rescored_complexity: 15 }),
      'validate:#3': () => ({ verdict: 'VALID', summary: 'valid', corrections: [], implementation_constraints: [], rescored_complexity: 15 }),
      'validate:#4': () => ({ verdict: 'VALID', summary: 'valid', corrections: [], implementation_constraints: [], rescored_complexity: 8 }),
      'validate:#5': () => ({ verdict: 'VALID', summary: 'valid', corrections: [], implementation_constraints: [], rescored_complexity: 15 }),
      Implement: (event) => {
        const issue = issueFromLabel(event.label)
        return {
          pr_number: 1000 + issue, pr_url: `https://example.test/pr/${1000 + issue}`, head_ref: `cc/issue-${issue}`, head_sha: headSha(issue),
          summary: 'implemented', tests_passed: true, github_review_status: 'lgtm', github_review_nonblocking_remaining: 0, github_review_summary: 'clean', flags: [],
        }
      },
    })

    expect(promptFor(events, 'implement:#2 (sonnet/xhigh)'), '#2 takes the rescored band default')
      .toContain('gh pr comment <num> --body "@claude review"')
    expect(logs.some((m) => m.includes('#2: rescored review band 11–40 outranks the stamped first review Sonnet 5'))).toBeTrue()

    expect(promptFor(events, 'implement:#3 (sonnet/xhigh)'), '#3 keeps the stronger stamp')
      .toContain('gh pr comment <num> --body "@claude opus review effort:high"')
    expect(logs.some((m) => m.includes('#3: keeping the stamped first review Opus 5'))).toBeTrue()

    expect(promptFor(events, 'implement:#4 (sonnet/xhigh)'), '#4 keeps sonnet on a downward rescore')
      .toContain('gh pr comment <num> --body "@claude sonnet review effort:high"')
    expect(logs.some((m) => m.includes('#4:') && m.includes('review band'))).toBeFalse()

    expect(promptFor(events, 'implement:#5 (sonnet/xhigh)'), '#5 escalates without a stamp')
      .toContain('gh pr comment <num> --body "@claude review"')
  })

  test('a validator rescore never lowers a stamped first review on a Codex cycle', async () => {
    const { events } = await executeWorkflow({ tracks: [[4]], reviewMode: 'github', reviewBot: 'codex', merge: false }, {
      Prep: () => ({
        issues: [
          { number: 4, title: '[C5] Stamped opus, rescored to the bare trigger band', complexity: 5, model: 'sonnet', effort: 'high', fableplan: false, missing_block: false, first_review_model: 'opus', first_review_effort: 'high' },
        ],
      }),
      'validate:#4': () => ({ verdict: 'VALID', summary: 'valid', corrections: [], implementation_constraints: [], rescored_complexity: 25 }),
      Implement: (event) => {
        const issue = issueFromLabel(event.label)
        return {
          pr_number: 1000 + issue, pr_url: `https://example.test/pr/${1000 + issue}`, head_ref: `cc/issue-${issue}`, head_sha: headSha(issue),
          summary: 'implemented', tests_passed: true, github_review_status: 'lgtm', github_review_nonblocking_remaining: 0, github_review_summary: 'clean', flags: [],
        }
      },
    })

    const prompt = promptFor(events, 'implement:#4 (opus/high)')
    expect(prompt, 'codex cycle-1 keeps the stamped effort').toContain('gh pr comment <num> --body "@codex review effort:high"')
    expect(prompt, 'codex blocking re-trigger repeats it').toContain('the blocking re-trigger exactly `@codex review effort:high`')
  })

  test('rejects an unknown reviewBot', async () => {
    await expect(
      executeWorkflow({ tracks: [[2]], reviewBot: 'gemini' }, { Prep: () => ({ issues: [prepIssue()] }) }),
    ).rejects.toThrow("reviewBot must be 'claude' or 'codex'")
  })

  test('escalates validation when the validator re-scores into a higher band', async () => {
    const validations = []
    const { output, events, logs } = await executeWorkflow({ tracks: [[2]], reviewMode: 'subagent' }, {
      Prep: () => ({ issues: [prepIssue({ complexity: 10, model: 'sonnet', effort: 'xhigh', first_review_model: undefined, first_review_effort: undefined })] }),
      'validate:#2': (event) => {
        validations.push({ model: event.model, effort: event.effort })
        return { verdict: 'VALID', summary: 'valid', corrections: [], implementation_constraints: [], rescored_complexity: 70 }
      },
    })

    expect(validations).toEqual([
      { model: 'opus', effort: 'high' },
      { model: 'opus', effort: 'xhigh' },
    ])
    expect(logs.some((message) => message.includes('#2: validator re-scored C10 → C70 (band 51–70) — re-validating on Opus 5 @ xhigh'))).toBeTrue()
    expect(logs.some((message) => message.includes('#2: RESCORED C10 → C70 — re-routing build Sonnet 5 @ xhigh → Opus 5 @ xhigh (band 51–70); the issue needs a [C70] restamp'))).toBeTrue()
    expect(started(events, 'plan:#2')).toBeFalse()
    expect(started(events, 'implement:#2 (opus/xhigh)')).toBeTrue()
    expect(started(events, 'review:PR#1002 c1 (opus/high)')).toBeTrue()
    expect(output.results.find((result) => result.issue === 2)?.rescore).toEqual({
      from: 10,
      to: 70,
      previous: { model: 'sonnet', effort: 'xhigh', fableplan: false },
      rerouted: { model: 'opus', effort: 'xhigh', fableplan: false },
    })
  })

  test('a downward rescore never weakens routing and records no rescore', async () => {
    const validations = []
    const { output, events, logs } = await executeWorkflow({ tracks: [[2]] }, {
      Prep: () => ({ issues: [prepIssue({ complexity: 60, model: 'opus', effort: 'high', fableplan: true, first_review_model: undefined, first_review_effort: undefined })] }),
      'validate:#2': (event) => {
        validations.push({ model: event.model, effort: event.effort })
        return { verdict: 'VALID', summary: 'valid', corrections: [], implementation_constraints: [], rescored_complexity: 10 }
      },
    })

    expect(validations).toEqual([{ model: 'opus', effort: 'xhigh' }])
    expect(logs.some((message) => message.includes('RESCORED'))).toBeFalse()
    expect(started(events, 'plan:#2')).toBeTrue()
    expect(started(events, 'implement:#2 (opus/high)')).toBeTrue()
    expect(output.results.find((result) => result.issue === 2)?.rescore).toBeUndefined()
  })

  test('a rescore that crosses only a review boundary still escalates the first review', async () => {
    const trigger = async (rescored) => {
      const { events, logs } = await executeWorkflow({ tracks: [[2]], reviewMode: 'github', merge: false }, {
        Prep: () => ({ issues: [prepIssue({ complexity: 10, model: 'sonnet', effort: 'high', fableplan: false, first_review_model: undefined, first_review_effort: undefined })] }),
        'validate:#2': () => ({ verdict: 'VALID', summary: 'valid', corrections: [], implementation_constraints: [], rescored_complexity: rescored }),
        Implement: () => ({
          pr_number: 1002, pr_url: 'https://example.test/pr/1002', head_ref: 'cc/issue-2', head_sha: headSha(2),
          summary: 'implemented', tests_passed: true, github_review_status: 'lgtm', github_review_nonblocking_remaining: 0, github_review_summary: 'clean', flags: [],
        }),
      })
      return { prompt: promptFor(events, 'implement:#2 (sonnet/high)'), logs }
    }

    const up = await trigger(15)
    expect(up.prompt).toContain('gh pr comment <num> --body "@claude review"')
    expect(up.logs.some((m) => m.includes('across a review boundary'))).toBeTrue()
    const down = await trigger(8)
    expect(down.prompt).toContain('gh pr comment <num> --body "@claude sonnet review"')
    expect(down.logs.some((m) => m.includes('across a review boundary'))).toBeFalse()
  })

  test('derives build routing from the validated score when the Execution block is missing', async () => {
    const { events, logs } = await executeWorkflow({ tracks: [[2], [3], [4], [5], [6]], reviewLoop: false }, {
      Prep: () => ({
        issues: [
          { number: 2, title: 'Unprefixed, rescored trivial', model: 'opus', effort: 'high', fableplan: false, missing_block: true },
          { number: 3, title: 'Unprefixed, rescored hard', model: 'opus', effort: 'high', fableplan: false, missing_block: true },
          { number: 4, title: '[C6] Band 0–9 from the title', complexity: 6, model: 'opus', effort: 'high', fableplan: false, missing_block: true },
          { number: 5, title: '[C10] Band 10–20 floor', complexity: 10, model: 'opus', effort: 'high', fableplan: false, missing_block: true },
          { number: 6, title: '[C5] Scored low, rescored hard', complexity: 5, model: 'opus', effort: 'high', fableplan: false, missing_block: true },
        ],
      }),
      'validate:#2': () => ({ verdict: 'VALID', summary: 'valid', corrections: [], implementation_constraints: [], rescored_complexity: 6 }),
      'validate:#3': () => ({ verdict: 'VALID', summary: 'valid', corrections: [], implementation_constraints: [], rescored_complexity: 90 }),
      'validate:#4': () => ({ verdict: 'VALID', summary: 'valid', corrections: [], implementation_constraints: [], rescored_complexity: 6 }),
      'validate:#5': () => ({ verdict: 'VALID', summary: 'valid', corrections: [], implementation_constraints: [], rescored_complexity: 10 }),
      'validate:#6': () => ({ verdict: 'VALID', summary: 'valid', corrections: [], implementation_constraints: [], rescored_complexity: 90 }),
    })

    expect(started(events, 'implement:#2 (opus/xhigh)')).toBeTrue()
    expect(started(events, 'plan:#2')).toBeTrue()
    expect(logs.some((message) => message.includes('#2: no Execution block — deriving build Opus 5 @ xhigh with fableplan from band 81+ (complexity unknown'))).toBeTrue()
    expect(started(events, 'implement:#3 (opus/xhigh)')).toBeTrue()
    expect(started(events, 'plan:#3')).toBeTrue()

    expect(started(events, 'implement:#4 (sonnet/high)')).toBeTrue()
    expect(started(events, 'plan:#4')).toBeFalse()
    expect(logs.some((message) => message.includes('#4: no Execution block — deriving build Sonnet 5 @ high from band 0–9'))).toBeTrue()
    expect(logs.some((message) => message.includes('complexity unknown') && message.includes('#4:'))).toBeFalse()
    expect(started(events, 'implement:#5 (sonnet/xhigh)')).toBeTrue()

    expect(started(events, 'implement:#6 (opus/xhigh)')).toBeTrue()
    expect(started(events, 'plan:#6')).toBeTrue()
    expect(logs.some((message) => message.includes('#6: no Execution block — deriving build Opus 5 @ xhigh with fableplan from band 81+'))).toBeTrue()
  })

  test('needs_updates dispatches a fixer on the build model and re-reviews on the first-review spec', async () => {
    let reviewCycle = 0
    const { output, events } = await executeWorkflow({ tracks: [[2]], reviewMode: 'subagent', merged: [mergedRecord(2)] }, {
      Prep: () => ({ issues: [prepIssue({ model: 'sonnet', effort: 'high', first_review_model: 'opus', first_review_effort: 'xhigh' })] }),
      'Review Loop': (event) => {
        if (event.label.startsWith('fix:')) {
          return { fixed_count: 2, refuted_count: 1, head_ref: 'codex/issue-2', head_sha: headSha(2, 'c'), summary: 'fixed' }
        }
        reviewCycle += 1
        return reviewCycle === 1
          ? { verdict: 'needs_updates', blocking_count: 2, nonblocking_count: 1, head_ref: 'codex/issue-2', head_sha: headSha(2), comment_url: 'https://example.test/pr/1002#r1', summary: 'blocking findings' }
          : { verdict: 'lgtm', blocking_count: 0, nonblocking_count: 0, head_ref: 'codex/issue-2', head_sha: headSha(2, 'c'), comment_url: 'https://example.test/pr/1002#r2', summary: 'clean' }
      },
    })
    const record = output.results.find((result) => result.issue === 2)

    expect(started(events, 'review:PR#1002 c1 (opus/xhigh)')).toBeTrue()
    expect(started(events, 'fix:PR#1002 c1 (sonnet/high)')).toBeTrue()
    expect(started(events, 'review:PR#1002 c2 (opus/xhigh)')).toBeTrue()
    expect(record?.status).toBe('merged')
    expect(record?.review.cycles_run).toBe(2)
    expect(record?.head_sha).toBe(headSha(2, 'c'))
  })

  test('a fable first review never repeats: blocking re-reviews step down to opus, then to the standard reviewer', async () => {
    let reviewCycle = 0
    const { output, events } = await executeWorkflow({ tracks: [[2]], reviewMode: 'subagent', merged: [mergedRecord(2)] }, {
      Prep: () => ({ issues: [prepIssue({ first_review_model: 'fable', first_review_effort: 'high' })] }),
      'Review Loop': (event) => {
        if (event.label.startsWith('fix:')) {
          return { fixed_count: 1, refuted_count: 0, head_ref: 'codex/issue-2', head_sha: headSha(2, 'c'), summary: 'fixed' }
        }
        reviewCycle += 1
        return reviewCycle <= 2
          ? { verdict: 'needs_updates', blocking_count: 1, nonblocking_count: 0, head_ref: 'codex/issue-2', head_sha: headSha(2), comment_url: `https://example.test/pr/1002#r${reviewCycle}`, summary: 'blocking finding' }
          : { verdict: 'lgtm', blocking_count: 0, nonblocking_count: 0, head_ref: 'codex/issue-2', head_sha: headSha(2, 'c'), comment_url: 'https://example.test/pr/1002#r3', summary: 'clean' }
      },
    })
    const record = output.results.find((result) => result.issue === 2)

    expect(started(events, 'review:PR#1002 c1 (fable/high)')).toBeTrue()
    expect(started(events, 'review:PR#1002 c2 (opus/high)')).toBeTrue()
    expect(started(events, 'review:PR#1002 c3 (claude/high)')).toBeTrue()
    expect(record?.status).toBe('merged')
    expect(record?.review.final_status).toBe('lgtm')
  })

  test('the fable step-down bottoms out at the standard reviewer and never climbs back', async () => {
    let reviewCycle = 0
    const { output, events } = await executeWorkflow({ tracks: [[2]], maxReviewCycles: 4, reviewMode: 'subagent', merged: [mergedRecord(2)] }, {
      Prep: () => ({ issues: [prepIssue({ first_review_model: 'fable', first_review_effort: 'high' })] }),
      'Review Loop': (event) => {
        if (event.label.startsWith('fix:')) {
          return { fixed_count: 1, refuted_count: 0, head_ref: 'codex/issue-2', head_sha: headSha(2, 'c'), summary: 'fixed' }
        }
        reviewCycle += 1
        return reviewCycle <= 3
          ? { verdict: 'needs_updates', blocking_count: 1, nonblocking_count: 0, head_ref: 'codex/issue-2', head_sha: headSha(2), comment_url: `https://example.test/pr/1002#r${reviewCycle}`, summary: 'blocking finding' }
          : { verdict: 'lgtm', blocking_count: 0, nonblocking_count: 0, head_ref: 'codex/issue-2', head_sha: headSha(2, 'c'), comment_url: 'https://example.test/pr/1002#r4', summary: 'clean' }
      },
    })
    const record = output.results.find((result) => result.issue === 2)

    expect(started(events, 'review:PR#1002 c2 (opus/high)')).toBeTrue()
    expect(started(events, 'review:PR#1002 c3 (claude/high)')).toBeTrue()
    expect(started(events, 'review:PR#1002 c4 (claude/high)')).toBeTrue()
    expect(record?.review.final_status).toBe('lgtm')
  })

  test('a fable first review with only non-blocking findings drops to sonnet, then takes the first step-down rung once blocking returns', async () => {
    let reviewCycle = 0
    const { output, events } = await executeWorkflow({ tracks: [[2]], reviewMode: 'subagent', merged: [mergedRecord(2)] }, {
      Prep: () => ({ issues: [prepIssue({ first_review_model: 'fable', first_review_effort: 'high' })] }),
      'Review Loop': (event) => {
        if (event.label.startsWith('fix:')) {
          return { fixed_count: 1, refuted_count: 0, head_ref: 'codex/issue-2', head_sha: headSha(2, 'c'), summary: 'fixed' }
        }
        reviewCycle += 1
        if (reviewCycle === 1) {
          return { verdict: 'lgtm', blocking_count: 0, nonblocking_count: 1, head_ref: 'codex/issue-2', head_sha: headSha(2), comment_url: 'https://example.test/pr/1002#r1', summary: 'one optional' }
        }
        return reviewCycle === 2
          ? { verdict: 'needs_updates', blocking_count: 1, nonblocking_count: 0, head_ref: 'codex/issue-2', head_sha: headSha(2, 'c'), comment_url: 'https://example.test/pr/1002#r2', summary: 'blocking finding' }
          : { verdict: 'lgtm', blocking_count: 0, nonblocking_count: 0, head_ref: 'codex/issue-2', head_sha: headSha(2, 'c'), comment_url: 'https://example.test/pr/1002#r3', summary: 'clean' }
      },
    })
    const record = output.results.find((result) => result.issue === 2)

    expect(started(events, 'review:PR#1002 c1 (fable/high)')).toBeTrue()
    expect(started(events, 'review:PR#1002 c2 (sonnet/high)')).toBeTrue()
    expect(started(events, 'review:PR#1002 c3 (opus/high)')).toBeTrue()
    expect(record?.review.final_status).toBe('lgtm')
  })

  test('an LGTM with non-blocking findings fixes them and re-reviews on sonnet/high', async () => {
    let reviewCycle = 0
    const { output, events } = await executeWorkflow({ tracks: [[2]], reviewMode: 'subagent', merged: [mergedRecord(2)] }, {
      Prep: () => ({ issues: [prepIssue()] }),
      'Review Loop': (event) => {
        if (event.label.startsWith('fix:')) {
          return { fixed_count: 1, refuted_count: 0, head_ref: 'codex/issue-2', head_sha: headSha(2, 'd'), summary: 'optional fixed' }
        }
        reviewCycle += 1
        return reviewCycle === 1
          ? { verdict: 'lgtm', blocking_count: 0, nonblocking_count: 1, head_ref: 'codex/issue-2', head_sha: headSha(2), comment_url: 'https://example.test/pr/1002#r1', summary: 'one optional' }
          : { verdict: 'lgtm', blocking_count: 0, nonblocking_count: 0, head_ref: 'codex/issue-2', head_sha: headSha(2, 'd'), comment_url: 'https://example.test/pr/1002#r2', summary: 'clean' }
      },
    })
    const record = output.results.find((result) => result.issue === 2)

    expect(started(events, 'review:PR#1002 c1 (fable/high)')).toBeTrue()
    expect(started(events, 'fix:PR#1002 c1 (fable/high)')).toBeTrue()
    expect(started(events, 'review:PR#1002 c2 (sonnet/high)')).toBeTrue()
    expect(record?.status).toBe('merged')
    expect(record?.review.final_status).toBe('lgtm')
  })

  test('an LGTM with non-blocking findings on the final cycle stops as lgtm_with_nonblocking without a fixer', async () => {
    const { output, events } = await executeWorkflow({ tracks: [[2]], maxReviewCycles: 1, reviewMode: 'subagent', merged: [mergedRecord(2)] }, {
      Prep: () => ({ issues: [prepIssue()] }),
      'Review Loop': () => ({ verdict: 'lgtm', blocking_count: 0, nonblocking_count: 1, head_ref: 'codex/issue-2', head_sha: headSha(2), comment_url: 'https://example.test/pr/1002#r1', summary: 'one optional' }),
    })
    const record = output.results.find((result) => result.issue === 2)

    expect(events.filter((event) => event.state === 'started' && event.label.startsWith('fix:'))).toHaveLength(0)
    expect(record?.status).toBe('merged')
    expect(record?.review.final_status).toBe('lgtm_with_nonblocking')
  })

  test('needs_updates on the final cycle exhausts the loop unfixed and blocks descendants', async () => {
    const { output, events } = await executeWorkflow({
      tracks: [{ issues: [2] }, { issues: [9], after: [0] }],
      maxReviewCycles: 1,
      reviewMode: 'subagent',
    }, {
      Prep: () => ({ issues: [prepIssue(), prepIssue({ number: 9, title: 'Issue 9' })] }),
      'review:PR#1002 c1 (fable/high)': () => ({ verdict: 'needs_updates', blocking_count: 1, nonblocking_count: 0, head_ref: 'codex/issue-2', head_sha: headSha(2), comment_url: 'https://example.test/pr/1002#r1', summary: 'blocking' }),
    })
    const record = output.results.find((result) => result.issue === 2)

    expect(events.filter((event) => event.state === 'started' && event.label.startsWith('fix:'))).toHaveLength(0)
    expect(record?.status).toBe('review_max_cycles_exhausted')
    expect(output.results.find((result) => result.issue === 9)?.status).toBe('dependency_blocked')
    expect(started(events, 'validate:#9')).toBeFalse()
  })

  test('a fixer blocker ends the loop blocked and blocks descendants', async () => {
    const { output, events } = await executeWorkflow({
      tracks: [{ issues: [2] }, { issues: [9], after: [0] }],
      reviewMode: 'subagent',
    }, {
      Prep: () => ({ issues: [prepIssue(), prepIssue({ number: 9, title: 'Issue 9' })] }),
      'review:PR#1002 c1 (fable/high)': () => ({ verdict: 'needs_updates', blocking_count: 1, nonblocking_count: 0, head_ref: 'codex/issue-2', head_sha: headSha(2), comment_url: 'https://example.test/pr/1002#r1', summary: 'blocking' }),
      'fix:PR#1002 c1 (fable/high)': () => ({ fixed_count: 0, refuted_count: 0, head_ref: 'codex/issue-2', head_sha: headSha(2), summary: 'could not fix', blocker: 'tests fail on the unmodified base' }),
    })
    const record = output.results.find((result) => result.issue === 2)

    expect(record?.status).toBe('review_blocked')
    expect(record?.review.blocker).toBe('tests fail on the unmodified base')
    expect(output.results.find((result) => result.issue === 9)?.status).toBe('dependency_blocked')
  })

  test('subagent reviewer and fixer prompts carry the review contract', async () => {
    const { events } = await executeWorkflow({ tracks: [[2]], reviewMode: 'subagent' }, {
      Prep: () => ({ issues: [prepIssue()] }),
      'review:PR#1002 c1 (fable/high)': () => ({ verdict: 'needs_updates', blocking_count: 1, nonblocking_count: 0, head_ref: 'codex/issue-2', head_sha: headSha(2), comment_url: 'https://example.test/pr/1002#r1', summary: 'blocking' }),
      'review:PR#1002 c2 (opus/high)': () => ({ verdict: 'lgtm', blocking_count: 0, nonblocking_count: 0, head_ref: 'codex/issue-2', head_sha: headSha(2), comment_url: 'https://example.test/pr/1002#r2', summary: 'clean' }),
    })
    const reviewPrompt = promptFor(events, 'review:PR#1002 c1 (fable/high)')
    const reReviewPrompt = promptFor(events, 'review:PR#1002 c2 (opus/high)')
    const fixPrompt = promptFor(events, 'fix:PR#1002 c1 (fable/high)')

    expect(reviewPrompt).toContain('Load the `pr-review` skill')
    expect(reviewPrompt).not.toContain('pr-review-format')
    expect(reviewPrompt).toContain('do NOT trigger any `@claude` or `@codex` review comment')
    expect(reviewPrompt).not.toContain('re-review cycle')
    expect(reReviewPrompt).toContain('re-review cycle 2')
    expect(fixPrompt).toContain('fix-pr-review')
    expect(fixPrompt).toContain('https://example.test/pr/1002#r1')
    expect(fixPrompt).toContain('do NOT trigger, post, or wait for any `@claude` or `@codex` re-review')
  })
})

describe('milestone-pipeline merge and release', () => {
  test('records an orchestrator merge from args.merged and reports merged without dispatching any merge agent', async () => {
    const { output, events, logs } = await executeWorkflow({ tracks: [[2]], reviewMode: 'subagent', merged: [mergedRecord(2)] })
    const record = output.results.find((result) => result.issue === 2)

    expect(events.some((event) => event.phase === 'Merge')).toBeFalse()
    expect(record?.status).toBe('merged')
    expect(record?.merge_sha).toBe(headSha(1002, 'e'))
    expect(record?.issue_state).toBe('closed')
    expect(output.awaiting_merge).toEqual([])
    expect(logs.some((message) => message.includes('PR #1002: merged by the orchestrator; issue #2 closed'))).toBeTrue()
  })

  test('an LGTM PR without a merged record pauses as awaiting_merge and defers successors', async () => {
    const { output, events, logs } = await executeWorkflow({
      tracks: [
        { issues: [2, 3] },
        { issues: [9], after: [0] },
        { issues: [12], runsAfter: [0] },
      ],
    })
    const record = output.results.find((result) => result.issue === 2)

    expect(events.some((event) => event.phase === 'Merge')).toBeFalse()
    expect(record?.status).toBe('awaiting_merge')
    expect(record?.blocker).toContain('awaits orchestrator merge')
    expect(record?.blocker).toContain(headSha(2))
    expect(output.results.find((result) => result.issue === 3)?.status).toBe('merge_pending')
    expect(output.results.find((result) => result.issue === 9)?.status).toBe('dependency_blocked')
    expect(output.results.find((result) => result.issue === 12)?.status).toBe('dependency_blocked')
    expect(started(events, 'validate:#3')).toBeFalse()
    expect(started(events, 'validate:#9')).toBeFalse()
    expect(started(events, 'validate:#12')).toBeFalse()
    expect(output.awaiting_merge).toEqual([
      { issue: 2, pr: 1002, pr_url: 'https://example.test/pr/1002', head_ref: 'codex/issue-2', head_sha: headSha(2) },
    ])
    expect(output.release?.released).toBeFalse()
    expect(output.release?.skipped).toBeTrue()
    expect(logs.some((message) => message.includes('PR #1002: awaiting orchestrator merge'))).toBeTrue()
    expect(output.unmatched_merged_records).toEqual([])
  })

  test('a merged record naming the wrong PR blocks instead of counting as merged', async () => {
    const { output, events, logs } = await executeWorkflow({
      tracks: [{ issues: [2, 3] }, { issues: [9], after: [0] }],
      merged: [{ issue: 2, pr: 1003, merge_sha: headSha(1003, 'e'), issue_state: 'closed' }],
    })
    const record = output.results.find((result) => result.issue === 2)

    expect(events.some((event) => event.phase === 'Merge')).toBeFalse()
    expect(record?.status).toBe('merge_record_mismatch')
    expect(record?.blocker).toContain('names PR #1003, but this run opened PR #1002')
    expect(output.results.find((result) => result.issue === 3)?.status).toBe('dependency_blocked')
    expect(output.results.find((result) => result.issue === 9)?.status).toBe('dependency_blocked')
    expect(started(events, 'validate:#3')).toBeFalse()
    expect(output.awaiting_merge).toEqual([])
    expect(output.release?.skipped).toBeTrue()
    expect(output.unmatched_merged_records).toEqual([
      { issue: 2, pr: 1003, reason: 'record names a different PR than the run opened for this issue' },
    ])
    expect(logs.some((message) => message.includes('merged record for issue #2 (PR #1003) was not used'))).toBeTrue()
  })

  test('a merged record for an issue that never reached the merge gate is reported, never silently unused', async () => {
    const { output, logs } = await executeWorkflow({
      tracks: [[2], [3]],
      merged: [mergedRecord(2), mergedRecord(3)],
    }, {
      'validate:#3': () => ({
        verdict: 'INVALID',
        summary: 'invalid',
        invalid_reason: 'not applicable',
        corrections: [],
        implementation_constraints: [],
      }),
    })

    expect(output.results.find((result) => result.issue === 2)?.status).toBe('merged')
    expect(output.unmatched_merged_records).toEqual([
      { issue: 3, pr: 1003, reason: 'issue never reached the merge gate in this run' },
    ])
    expect(logs.some((message) => message.includes('merged record for issue #3 (PR #1003) was not used — issue never reached the merge gate in this run'))).toBeTrue()
  })

  test('the skill documents the orchestrator in-session merge procedure', async () => {
    const skill = await Bun.file(new URL('../skills/milestone-workflow/SKILL.md', import.meta.url)).text()

    expect(skill).toContain('--match-head-commit <verified-sha>')
    expect(skill).toContain('gh pr checks <num> --watch')
    expect(skill).toContain('gh pr update-branch')
    expect(skill).toContain('never resolve conflicts yourself')
    expect(skill).toContain('resumeFromRunId')
    expect(skill).toContain('`args.merged` extended by `{issue, pr, merge_sha, issue_state}`')
    expect(skill).toContain('no background subagent ever holds merge authority')
  })

  test('the skill defines <verified-sha> per review mode after a branch catch-up', async () => {
    const skill = await Bun.file(new URL('../skills/milestone-workflow/SKILL.md', import.meta.url)).text()

    expect(skill).toContain('This check is against the head **before** any catch-up this procedure performs')
    expect(skill).toContain('Fix `<verified-sha>`')
    expect(skill).toContain('or the head you re-captured after `gh pr update-branch` when it did')
    expect(skill).toContain('**Github review mode:** `<verified-sha>` is the reviewed readiness SHA only')
    expect(skill).toContain('re-apply this same rule to the newest head')
  })

  test('the skill keeps the full github-mode LGTM recency gate', async () => {
    const skill = await Bun.file(new URL('../skills/milestone-workflow/SKILL.md', import.meta.url)).text()

    expect(skill).toContain('`status == completed` and `conclusion == success`')
    expect(skill).toContain('Never fall back to an older LGTM')
    expect(skill).toContain('**Do not compare the Actions run\'s `head_sha` to the PR head.**')
    expect(skill).toContain('`issue_comment` run reports the last commit on the default branch')
    expect(skill).toContain('check-suites')
    expect(skill).toContain('`.commit.committer.date`')
    expect(skill).toContain('No other command may run between the gate and the pinned merge')
  })

  test('the skill tells the resume to carry the complete original args', async () => {
    const skill = await Bun.file(new URL('../skills/milestone-workflow/SKILL.md', import.meta.url)).text()

    expect(skill).toContain('passing the **complete original `args`**')
    expect(skill).toContain('`args.tracks` is required, so a resume that carries `merged` alone throws immediately')
  })

  test('the skill names both blocked statuses for descendants of an unmerged PR', async () => {
    const skill = await Bun.file(new URL('../skills/milestone-workflow/SKILL.md', import.meta.url)).text()

    expect(skill).toContain('in-track successors return `merge_pending`, and descendants in other tracks return `dependency_blocked`')
  })

  test('the workflow describes the release as deferred to the orchestrator, with no agent', async () => {
    expect(workflowSource).not.toContain('one Sonnet agent runs sync-docs-release')
  })

  test('merge and release default off when review loops are off', async () => {
    const { output, events } = await executeWorkflow({ tracks: [[2]], reviewLoop: false })

    expect(events.some((event) => event.phase === 'Merge')).toBeFalse()
    expect(events.some((event) => event.phase === 'Release')).toBeFalse()
    expect(output.results[0].status).toBe('pr_open')
    expect(output.release).toBeNull()
  })

  test.each([
    ['merge without review loops', { tracks: [[2]], reviewLoop: false, merge: true }, /merge requires reviewLoop/],
    ['release without merge', { tracks: [[2]], merge: false, release: true }, /release requires merge/],
    ['non-boolean merge', { tracks: [[2]], merge: 'yes' }, /merge must be a boolean/],
    ['non-boolean release', { tracks: [[2]], release: 'yes' }, /release must be a boolean/],
    ['non-array merged', { tracks: [[2]], merged: 'PR 1002' }, /merged must be an array/],
    ['merged record without a pr number', { tracks: [[2]], merged: [{ issue: 2, merge_sha: 'abc' }] }, /integer issue, an integer pr, and a non-empty merge_sha/],
    ['merged record without an issue number', { tracks: [[2]], merged: [{ pr: 1002, merge_sha: 'abc' }] }, /integer issue, an integer pr, and a non-empty merge_sha/],
    ['merged record without a merge sha', { tracks: [[2]], merged: [{ issue: 2, pr: 1002, merge_sha: '' }] }, /integer issue, an integer pr, and a non-empty merge_sha/],
    ['merged record for an issue outside the run', { tracks: [[2]], merged: [{ issue: 7, pr: 1007, merge_sha: 'a' }] }, /names an issue outside this run/],
    ['duplicate merged records for one issue', { tracks: [[2]], merged: [{ issue: 2, pr: 1002, merge_sha: 'a' }, { issue: 2, pr: 1003, merge_sha: 'b' }] }, /duplicate merged record for issue #2/],
    ['duplicate merged records for one PR', { tracks: [[2], [3]], merged: [{ issue: 2, pr: 1002, merge_sha: 'a' }, { issue: 3, pr: 1002, merge_sha: 'b' }] }, /duplicate merged record for PR #1002/],
  ])('rejects %s before prep', async (_name, args, message) => {
    let prepStarted = false
    const running = executeWorkflow(args, {
      Prep: () => {
        prepStarted = true
        return { issues: [] }
      },
    })

    await expect(running).rejects.toThrow(message)
    expect(prepStarted).toBeFalse()
  })

  test('merge: false preserves the lgtm boundary and unmerged-head stacking', async () => {
    const { output, events } = await executeWorkflow({ tracks: [[2, 3]], merge: false })

    expect(events.some((event) => event.phase === 'Merge')).toBeFalse()
    expect(output.results.map((result) => result.status)).toEqual(['lgtm', 'lgtm'])
    expect(promptFor(events, 'implement:#3 (fable/high)')).toContain(`baseRefs: [{"pr":1002,"ref":"codex/issue-2","sha":"${headSha(2)}"}]`)
    expect(output.release).toBeNull()
  })

  test('successors of a recorded merge build from the base branch with no baseRefs', async () => {
    const { events } = await executeWorkflow({
      tracks: [{ issues: [2, 3] }, { issues: [9], after: [0] }],
      merged: [mergedRecord(2), mergedRecord(3)],
    })
    const inTrackPrompt = promptFor(events, 'implement:#3 (fable/high)')
    const crossTrackPrompt = promptFor(events, 'implement:#9 (fable/high)')

    expect(inTrackPrompt).toContain('with args `{ issue: 3 }`')
    expect(inTrackPrompt).not.toContain('baseRefs: [')
    expect(inTrackPrompt).toContain('Issue #2 → PR #1002 (merged into the base branch)')
    expect(crossTrackPrompt).toContain('with args `{ issue: 9 }`')
    expect(crossTrackPrompt).not.toContain('baseRefs: [')
    expect(promptFor(events, 'validate:#9')).not.toContain('Hard dependency base refs')
  })

  test('release defers to the orchestrator when every issue merged', async () => {
    const { output, events, logs } = await executeWorkflow({
      tracks: [[2], [3]],
      merged: [mergedRecord(2), mergedRecord(3)],
    })

    expect(events.some((event) => event.phase === 'Release')).toBeFalse()
    expect(output.release.released).toBeFalse()
    expect(output.release.deferred).toBeTrue()
    expect(output.release.summary).toContain('sync-docs-release in-session')
    expect(logs.some((message) => message.includes('release deferred to the orchestrator'))).toBeTrue()
  })

  test('release is skipped when any issue did not merge', async () => {
    const { output, events, logs } = await executeWorkflow({ tracks: [[2], [3]], merged: [mergedRecord(2)] }, {
      'validate:#3': () => ({
        verdict: 'INVALID',
        summary: 'invalid',
        invalid_reason: 'not applicable',
        corrections: [],
        implementation_constraints: [],
      }),
    })

    expect(events.some((event) => event.phase === 'Release')).toBeFalse()
    expect(output.release?.released).toBeFalse()
    expect(output.release?.skipped).toBeTrue()
    expect(output.release?.deferred).toBeUndefined()
    expect(logs.some((message) => message.includes('release skipped — 1 of 2 issues reached merged status'))).toBeTrue()
  })

  test('release: false skips the deferred-release marker while merging stays on', async () => {
    const { output, events } = await executeWorkflow({ tracks: [[2]], release: false, merged: [mergedRecord(2)] })

    expect(output.results[0].status).toBe('merged')
    expect(events.some((event) => event.phase === 'Release')).toBeFalse()
    expect(output.release).toBeNull()
  })
})
