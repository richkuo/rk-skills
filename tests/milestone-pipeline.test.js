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
  const githubReviewEnabled = (parsedArgs.reviewLoop ?? true) && parsedArgs.reviewMode === 'github'
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
        // github-mode bounded review batch: stop early after its first clean cycle.
        result = {
          status: 'lgtm',
          nonblocking_remaining: 0,
          cycles_run: 1,
          summary: 'approved',
          head_ref: `codex/issue-${issue}`,
          head_sha: headSha(issue),
        }
      }
    } else if (options.phase === 'Merge') {
      const pr = Number(options.label.match(/PR#(\d+)/)?.[1])
      result = { merged: true, merge_sha: headSha(pr, 'e'), issue_state: 'closed', branch_deleted: true, summary: 'merged' }
    } else if (options.phase === 'Release') {
      result = { released: true, tag: 'v1.0.0', release_url: 'https://example.test/releases/v1.0.0', docs_change: 'pr_merged', summary: 'released' }
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

  test('dispatches the plan stage at the stamped Plan effort and defaults it to high', async () => {
    const { events, logs } = await executeWorkflow({ tracks: [[2], [3], [4], [5]], reviewLoop: false }, {
      Prep: () => ({
        issues: [
          { number: 2, title: 'Stamped xhigh', complexity: 60, model: 'opus', effort: 'high', fableplan: true, plan_effort: 'xhigh', missing_block: false },
          { number: 3, title: 'Stamped low', complexity: 60, model: 'opus', effort: 'high', fableplan: true, plan_effort: 'low', missing_block: false },
          { number: 4, title: 'No stamp', complexity: 60, model: 'opus', effort: 'xhigh', fableplan: true, missing_block: false },
          { number: 5, title: 'No plan stage', complexity: 20, model: 'opus', effort: 'high', fableplan: false, plan_effort: 'xhigh', missing_block: false },
        ],
      }),
    })

    const planEvent = (issue) => events.find((event) => event.state === 'started' && event.label === `plan:#${issue}`)
    // A stamped xhigh Plan effort is clamped: the planner is always Fable 5, and Fable never runs at xhigh.
    expect(planEvent(2).effort).toBe('high')
    expect(planEvent(2).model).toBe('fable')
    expect(planEvent(3).effort).toBe('low')
    expect(planEvent(3).model).toBe('fable')
    expect(planEvent(4).effort).toBe('high')
    expect(planEvent(5)).toBeUndefined()

    // The posted-plan footer must advertise the effort the planner actually ran at.
    expect(planEvent(2).prompt).toContain('Created with LLM: Fable 5 | high | Harness: milestone-pipeline')
    expect(planEvent(3).prompt).toContain('Created with LLM: Fable 5 | low | Harness: milestone-pipeline')
    expect(planEvent(4).prompt).toContain('Created with LLM: Fable 5 | high | Harness: milestone-pipeline')

    expect(logs.some((message) => message.includes('#2') && message.includes('against Fable plan @ high'))).toBeTrue()
    expect(logs.some((message) => message.includes('#5') && message.includes('against Fable plan'))).toBeFalse()
    // The clamp is logged for the stamped-xhigh issues (the fableplan: false one is
    // clamped too — the log names the reason either way); no other normalization fires.
    expect(logs.filter((message) => message.includes('normalized plan effort xhigh → high'))).toEqual([
      '#2: normalized plan effort xhigh → high (the planner is Fable 5; Fable never runs at xhigh)',
      '#5: normalized plan effort xhigh → high (the planner is Fable 5; Fable never runs at xhigh)',
    ])

    // A stamped Plan effort on a fableplan: false issue is reported once, not dropped silently.
    expect(logs.filter((message) => message.includes('ignoring Plan effort'))).toEqual([
      '#5: ignoring Plan effort high — fableplan is false, so no plan stage runs',
    ])
  })

  test('reports an inert Plan effort only when one was actually stamped', async () => {
    const { events, logs } = await executeWorkflow({ tracks: [[2], [3], [4], [5]], reviewLoop: false }, {
      Prep: () => ({
        issues: [
          { number: 2, title: 'No plan stage, nothing stamped', complexity: 20, model: 'opus', effort: 'high', fableplan: false, missing_block: false },
          // plan_effort present despite the omit contract: a prep agent that fills it in
          // anyway is exactly what the missing_block half of the guard defends against,
          // so this fixture fails if `&& !normalized.missing_block` is removed.
          { number: 3, title: 'No Execution block at all', complexity: 20, model: 'fable', effort: 'high', fableplan: false, plan_effort: 'xhigh', missing_block: true },
          { number: 4, title: 'Plan stage, nothing stamped', complexity: 60, model: 'opus', effort: 'high', fableplan: true, missing_block: false },
          { number: 5, title: 'No Execution block, nothing stamped', complexity: 20, model: 'fable', effort: 'high', fableplan: false, missing_block: true },
        ],
      }),
    })

    // Nothing stamped → no log; a missing block is reported once by the block-missing
    // warning, not compounded by an inert-field warning for the defaults it filled in.
    expect(logs.filter((message) => message.includes('ignoring Plan effort'))).toEqual([])
    expect(logs.some((message) => message.includes('no Execution block on #3, #5'))).toBeTrue()

    // An unstamped fableplan issue still plans at the dispatch-side default.
    const planEvent = events.find((event) => event.state === 'started' && event.label === 'plan:#4')
    expect(planEvent.effort).toBe('high')
    expect(planEvent.prompt).toContain('Created with LLM: Fable 5 | high | Harness: milestone-pipeline')
  })

  test('prep is contracted to omit Plan effort when the issue stamps none', () => {
    // The inert-tier log reads presence as "an operator stamped a tier". That only
    // holds while prep omits the field instead of filling in a default — a fill-in
    // default would make every unstamped issue log a tier nobody set.
    const source = workflowSource
    const schemaLine = source.match(/^ +plan_effort: \{.*$/m)[0]
    expect(schemaLine).toMatch(/OMIT this field entirely when the line is absent/)
    expect(schemaLine).not.toMatch(/default high when absent/)

    const promptLine = source.match(/^- plan_effort: from the optional.*$/m)[0]
    expect(promptLine).toMatch(/OMIT the field rather than filling in a default/)
    expect(promptLine).not.toMatch(/when the line is absent, use high/)

    // The dispatch-side default is what makes omission safe.
    expect(source).toContain("const planEffort = ex.plan_effort || 'high'")
  })

  test('prep is contracted to omit the stamps the band derives', () => {
    const source = workflowSource
    // Validation is fully band-derived — prep must not parse a legacy Validate stamp back in.
    expect(source).not.toMatch(/validate_effort/)
    expect(source).toContain('do NOT extract a "**Validate effort:**"')
    // First review defaults to the band; presence of the fields means "an operator stamped a trigger".
    const reviewSchemaLine = source.match(/^ +first_review_model: \{.*$/m)[0]
    expect(reviewSchemaLine).toMatch(/OMIT this field when the line is a standard/)
    const reviewPromptLine = source.match(/^- first_review_model \/ first_review_effort: from the optional.*$/m)[0]
    expect(reviewPromptLine).toMatch(/OMIT both fields/)
    // The dispatch-side band defaults are what make omission safe.
    expect(source).toContain('const bandReview = bandFor(ex.effective_complexity ?? ex.complexity).review')
    // Fable is never a build fallback — unknown or unmapped models dispatch on Opus.
    expect(source).toContain("const modelId = MODEL_IDS[ex.model] || 'opus'")
    expect(source).not.toContain("MODEL_IDS[ex.model] || 'fable'")
    expect(source).not.toMatch(/build: \{ model: 'fable'/)
    expect(source).toContain('const validateBand = bandFor(ex.complexity)')
  })

  test('derives validation entirely from the [C..] score band', async () => {
    const { events, logs } = await executeWorkflow({
      tracks: [[2], [3], [4], [5], [6], [7], [8], [9]],
      reviewLoop: false,
    }, {
      Prep: () => ({
        issues: [
          { number: 2, title: 'Band 0 floor', complexity: 2, model: 'sonnet', effort: 'xhigh', fableplan: false, missing_block: false },
          { number: 3, title: 'Band 0 ceiling', complexity: 24, model: 'sonnet', effort: 'xhigh', fableplan: false, missing_block: false },
          { number: 4, title: 'Band 1 floor', complexity: 25, model: 'opus', effort: 'xhigh', fableplan: false, missing_block: false },
          { number: 5, title: 'Band 1 ceiling', complexity: 49, model: 'opus', effort: 'xhigh', fableplan: false, missing_block: false },
          { number: 6, title: 'Band 2 floor', complexity: 50, model: 'opus', effort: 'high', fableplan: false, missing_block: false },
          { number: 7, title: 'Band 2 ceiling', complexity: 74, model: 'opus', effort: 'high', fableplan: false, missing_block: false },
          { number: 8, title: 'Band 3', complexity: 75, model: 'fable', effort: 'high', fableplan: false, missing_block: false },
          { number: 9, title: 'No [C..] prefix', complexity: 0, model: 'fable', effort: 'high', fableplan: false, missing_block: false },
        ],
      }),
    })

    const dispatch = (label) => events.find((event) => event.state === 'started' && event.label === label)
    // The score alone decides — the Build model never leaks in, and nothing is stampable.
    expect(dispatch('validate:#2')).toMatchObject({ model: 'opus', effort: 'medium' })
    expect(dispatch('validate:#3')).toMatchObject({ model: 'opus', effort: 'medium' })
    // Band boundaries are inclusive at 25/50/75.
    expect(dispatch('validate:#4')).toMatchObject({ model: 'opus', effort: 'high' })
    expect(dispatch('validate:#5')).toMatchObject({ model: 'opus', effort: 'high' })
    expect(dispatch('validate:#6')).toMatchObject({ model: 'fable', effort: 'high' })
    expect(dispatch('validate:#7')).toMatchObject({ model: 'fable', effort: 'high' })
    expect(dispatch('validate:#8')).toMatchObject({ model: 'fable', effort: 'high' })
    // complexity 0 means "no prefix" — unknown, not small.
    expect(dispatch('validate:#9')).toMatchObject({ model: 'fable', effort: 'high' })

    expect(logs.filter((message) => message.includes('validating on'))).toEqual([
      '#2: C2 (band 0–24) — validating on Opus 5 @ medium',
      '#3: C24 (band 0–24) — validating on Opus 5 @ medium',
      '#4: C25 (band 25–49) — validating on Opus 5 @ high',
      '#5: C49 (band 25–49) — validating on Opus 5 @ high',
      '#6: C50 (band 50–74) — validating on Fable 5 @ high',
      '#7: C74 (band 50–74) — validating on Fable 5 @ high',
      '#8: C75 (band 75+) — validating on Fable 5 @ high',
      '#9: no [C..] prefix — unknown routes as the top band — validating on Fable 5 @ high',
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
          { number: 2, title: 'Fable medium', complexity: 20, model: 'fable', effort: 'medium', fableplan: false, missing_block: false },
          { number: 3, title: 'Opus medium', complexity: 20, model: 'opus', effort: 'medium', fableplan: false, missing_block: false },
          { number: 4, title: 'Sonnet medium', complexity: 20, model: 'sonnet', effort: 'medium', fableplan: false, missing_block: false },
          { number: 5, title: 'Haiku medium', complexity: 20, model: 'haiku', effort: 'medium', fableplan: false, missing_block: false },
          { number: 6, title: 'Valid defaults', complexity: 20, model: 'fable', effort: 'high', fableplan: false, missing_block: false },
          { number: 8, title: 'Valid xhigh', complexity: 20, model: 'opus', effort: 'xhigh', fableplan: false, missing_block: false },
          { number: 9, title: 'Fable low', complexity: 20, model: 'fable', effort: 'low', fableplan: false, missing_block: false },
          { number: 10, title: 'Opus low', complexity: 20, model: 'opus', effort: 'low', fableplan: false, missing_block: false },
          { number: 11, title: 'Fable xhigh', complexity: 20, model: 'fable', effort: 'xhigh', fableplan: false, missing_block: false },
        ],
      }),
    })

    const effortFor = (label) => events.find((event) => event.state === 'started' && event.label === label)?.effort
    // All stamped issues here are C20 (band 0) → validation is band-derived opus/medium.
    expect(effortFor('validate:#2')).toBe('medium')
    expect(effortFor('implement:#2 (fable/medium)')).toBe('medium')
    expect(effortFor('review-loop:PR#1002 c2-c3')).toBe('medium')
    expect(effortFor('validate:#3')).toBe('medium')
    expect(effortFor('validate:#4')).toBe('medium')
    expect(effortFor('validate:#5')).toBe('medium')
    expect(effortFor('validate:#6')).toBe('medium')
    // #7 has no prep entry — the fallback has complexity 0, which routes as the top band.
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
    // Fable never runs at xhigh — high is its ceiling.
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
    ['github-mode', { tracks: [[2]], reviewLoop: true, reviewMode: 'github' }, 'github'],
    ['enabled', { tracks: [[2]], reviewLoop: true }, 'subagent'],
    ['enabled by default', { tracks: [[2]] }, 'subagent'],
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
  const prepIssue = (overrides = {}) => ({
    number: 2,
    title: 'Issue 2',
    complexity: 60,
    model: 'fable',
    effort: 'high',
    fableplan: false,
    missing_block: false,
    first_review_model: 'fable',
    first_review_effort: 'high',
    ...overrides,
  })

  test('a clean first-cycle LGTM reviews once on the issue first-review spec and dispatches no fixer', async () => {
    const { output, events } = await executeWorkflow({ tracks: [[2]] }, {
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
    const { events } = await executeWorkflow({ tracks: [[2], [3], [4], [5], [6]] }, {
      Prep: () => ({
        issues: [
          prepIssue({ number: 2, complexity: 10, first_review_model: undefined, first_review_effort: undefined }),
          prepIssue({ number: 3, complexity: 30, first_review_model: undefined, first_review_effort: undefined }),
          prepIssue({ number: 4, complexity: 60, first_review_model: undefined, first_review_effort: undefined }),
          prepIssue({ number: 5, complexity: 80, first_review_model: undefined, first_review_effort: undefined }),
          prepIssue({ number: 6, complexity: 0, first_review_model: undefined, first_review_effort: undefined }),
        ],
      }),
    })

    // Band 0 is the bare-@claude equivalent: no model override, the reviewer
    // inherits the session default.
    const bandZeroReview = events.find((event) => event.state === 'started' && event.label === 'review:PR#1002 c1 (claude/high)')
    expect(bandZeroReview).toBeTruthy()
    expect(bandZeroReview.model).toBeUndefined()
    expect(started(events, 'review:PR#1003 c1 (opus/high)')).toBeTrue()
    expect(started(events, 'review:PR#1004 c1 (opus/high)')).toBeTrue()
    expect(started(events, 'review:PR#1005 c1 (fable/high)')).toBeTrue()
    // No [C..] prefix is unknown, not small — the first review keeps the top band.
    expect(started(events, 'review:PR#1006 c1 (fable/high)')).toBeTrue()
  })

  test('github mode derives the cycle-1 trigger phrase from the band', async () => {
    const { events } = await executeWorkflow({ tracks: [[2], [3], [4], [5]], reviewMode: 'github', merge: false }, {
      Prep: () => ({
        issues: [
          { number: 2, title: 'Band 0', complexity: 10, model: 'sonnet', effort: 'xhigh', fableplan: false, missing_block: false },
          { number: 3, title: 'Band 2', complexity: 60, model: 'opus', effort: 'high', fableplan: false, missing_block: false },
          { number: 4, title: 'Band 3', complexity: 80, model: 'fable', effort: 'high', fableplan: false, missing_block: false },
          { number: 5, title: 'Stamped trigger', complexity: 10, model: 'sonnet', effort: 'xhigh', fableplan: false, missing_block: false, first_review_model: 'fable', first_review_effort: 'high' },
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

    expect(promptFor(events, 'implement:#2 (sonnet/xhigh)')).toContain('gh pr comment <num> --body "@claude review"')
    expect(promptFor(events, 'implement:#3 (opus/high)')).toContain('gh pr comment <num> --body "@claude opus review"')
    expect(promptFor(events, 'implement:#4 (fable/high)')).toContain('gh pr comment <num> --body "@claude fable review effort:high"')
    // A stamped PR review line overrides the band trigger.
    expect(promptFor(events, 'implement:#5 (sonnet/xhigh)')).toContain('gh pr comment <num> --body "@claude fable review effort:high"')
  })

  test('escalates validation when the validator re-scores into a higher band', async () => {
    const validations = []
    const { output, events, logs } = await executeWorkflow({ tracks: [[2]] }, {
      Prep: () => ({ issues: [prepIssue({ complexity: 10, model: 'sonnet', effort: 'xhigh', first_review_model: undefined, first_review_effort: undefined })] }),
      'validate:#2': (event) => {
        validations.push({ model: event.model, effort: event.effort })
        return { verdict: 'VALID', summary: 'valid', corrections: [], implementation_constraints: [], rescored_complexity: 60 }
      },
    })

    // C10 validated on the band-0 route first, then re-validated once on band 2's.
    expect(validations).toEqual([
      { model: 'opus', effort: 'medium' },
      { model: 'fable', effort: 'high' },
    ])
    expect(logs.some((message) => message.includes('#2: validator re-scored C10 → C60 (band 50–74) — re-validating on Fable 5 @ high'))).toBeTrue()
    // The stale stamp is re-routed to the escalated band: build, plan, and review all follow C60.
    expect(logs.some((message) => message.includes('#2: RESCORED C10 → C60 — re-routing build Sonnet 5 @ xhigh → Opus 5 @ high with fableplan (band 50–74); the issue needs a [C60] restamp'))).toBeTrue()
    expect(started(events, 'plan:#2')).toBeTrue()
    expect(started(events, 'implement:#2 (opus/high)')).toBeTrue()
    expect(started(events, 'review:PR#1002 c1 (opus/high)')).toBeTrue()
    // The rescore rides on the result record so the orchestrator can restamp the issue.
    expect(output.results.find((result) => result.issue === 2)?.rescore).toEqual({
      from: 10,
      to: 60,
      previous: { model: 'sonnet', effort: 'xhigh', fableplan: false },
      rerouted: { model: 'opus', effort: 'high', fableplan: true },
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

    expect(validations).toEqual([{ model: 'fable', effort: 'high' }])
    expect(logs.some((message) => message.includes('RESCORED'))).toBeFalse()
    expect(started(events, 'plan:#2')).toBeTrue()
    expect(started(events, 'implement:#2 (opus/high)')).toBeTrue()
    expect(output.results.find((result) => result.issue === 2)?.rescore).toBeUndefined()
  })

  test('derives build routing from the validated score when the Execution block is missing', async () => {
    const { events, logs } = await executeWorkflow({ tracks: [[2], [3]], reviewLoop: false }, {
      Prep: () => ({
        issues: [
          { number: 2, title: 'Unprefixed, rescored trivial', complexity: 0, model: 'fable', effort: 'high', fableplan: false, missing_block: true },
          { number: 3, title: 'Unprefixed, rescored hard', complexity: 0, model: 'fable', effort: 'high', fableplan: false, missing_block: true },
        ],
      }),
      'validate:#2': () => ({ verdict: 'VALID', summary: 'valid', corrections: [], implementation_constraints: [], rescored_complexity: 6 }),
      'validate:#3': () => ({ verdict: 'VALID', summary: 'valid', corrections: [], implementation_constraints: [], rescored_complexity: 80 }),
    })

    // Both validate on the top band (no prefix), then build from the validated score:
    // C6 is a trivial band-0 issue (score ≤ 7 → high, not xhigh); C80 builds Opus 5 xhigh with a plan first.
    expect(started(events, 'implement:#2 (sonnet/high)')).toBeTrue()
    expect(started(events, 'plan:#2')).toBeFalse()
    expect(started(events, 'implement:#3 (opus/xhigh)')).toBeTrue()
    expect(started(events, 'plan:#3')).toBeTrue()
    expect(logs.some((message) => message.includes('#2: no Execution block — deriving build Sonnet 5 @ high from band 0–24'))).toBeTrue()
    expect(logs.some((message) => message.includes('#3: no Execution block — deriving build Opus 5 @ xhigh with fableplan from band 75+'))).toBeTrue()
  })

  test('needs_updates dispatches a fixer on the build model and re-reviews on the first-review spec', async () => {
    let reviewCycle = 0
    const { output, events } = await executeWorkflow({ tracks: [[2]] }, {
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

  test('an LGTM with non-blocking findings fixes them and re-reviews on sonnet/high', async () => {
    let reviewCycle = 0
    const { output, events } = await executeWorkflow({ tracks: [[2]] }, {
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
    const { output, events } = await executeWorkflow({ tracks: [[2]], maxReviewCycles: 1 }, {
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
    const { events } = await executeWorkflow({ tracks: [[2]] }, {
      Prep: () => ({ issues: [prepIssue()] }),
      'review:PR#1002 c1 (fable/high)': () => ({ verdict: 'needs_updates', blocking_count: 1, nonblocking_count: 0, head_ref: 'codex/issue-2', head_sha: headSha(2), comment_url: 'https://example.test/pr/1002#r1', summary: 'blocking' }),
      'review:PR#1002 c2 (fable/high)': () => ({ verdict: 'lgtm', blocking_count: 0, nonblocking_count: 0, head_ref: 'codex/issue-2', head_sha: headSha(2), comment_url: 'https://example.test/pr/1002#r2', summary: 'clean' }),
    })
    const reviewPrompt = promptFor(events, 'review:PR#1002 c1 (fable/high)')
    const reReviewPrompt = promptFor(events, 'review:PR#1002 c2 (fable/high)')
    const fixPrompt = promptFor(events, 'fix:PR#1002 c1 (fable/high)')

    expect(reviewPrompt).toContain('pr-review-format')
    expect(reviewPrompt).toContain('do NOT trigger any `@claude` review comment')
    expect(reviewPrompt).not.toContain('re-review cycle')
    expect(reReviewPrompt).toContain('re-review cycle 2')
    expect(fixPrompt).toContain('fix-pr-review')
    expect(fixPrompt).toContain('https://example.test/pr/1002#r1')
    expect(fixPrompt).toContain('do NOT trigger, post, or wait for any `@claude` re-review')
  })
})

describe('milestone-pipeline merge and release', () => {
  test('merges each PR at review readiness on sonnet/low and reports merged', async () => {
    const { output, events, logs } = await executeWorkflow({ tracks: [[2]] })
    const record = output.results.find((result) => result.issue === 2)
    const mergeEvent = events.find((event) => event.state === 'started' && event.label === 'merge:PR#1002')

    expect(mergeEvent.model).toBe('sonnet')
    expect(mergeEvent.effort).toBe('low')
    expect(mergeEvent.phase).toBe('Merge')
    expect(mergeEvent.prompt).toContain('--match-head-commit <verified-sha>')
    expect(mergeEvent.prompt).toContain('ALWAYS pin')
    expect(mergeEvent.prompt).toContain(`<verified-sha> is ${headSha(2)} when step 3 did not update the branch`)
    expect(mergeEvent.prompt).toContain('Never run the merge unpinned')
    expect(mergeEvent.prompt).toContain('gh pr checks 1002 --watch')
    expect(mergeEvent.prompt).toContain('If the branch is behind the base at all')
    expect(mergeEvent.prompt).toContain('never merge a behind branch untested')
    expect(mergeEvent.prompt).toContain('never resolve merge conflicts')
    expect(mergeEvent.prompt).not.toContain('github-actions[bot]')
    expect(record?.status).toBe('merged')
    expect(record?.merge_sha).toBe(headSha(1002, 'e'))
    expect(record?.issue_state).toBe('closed')
    expect(logs.some((message) => message.includes('PR #1002: merged; issue #2 closed'))).toBeTrue()
  })

  test('github mode independently verifies the standing review on the final head', async () => {
    const { events } = await executeWorkflow({ tracks: [[2]], reviewMode: 'github' })
    const mergePrompt = promptFor(events, 'merge:PR#1002')

    expect(mergePrompt).toContain('Independent review gate (the FINAL read before merge)')
    expect(mergePrompt).toContain(`live head must still equal the reviewed readiness SHA ${headSha(2)}`)
    expect(mergePrompt).toContain('newest exact one-line `@claude [model] review [effort]` trigger')
    expect(mergePrompt).toContain('newest completed review output from `github-actions[bot]`')
    expect(mergePrompt).toContain('`status == completed` and `conclusion == success`')
    expect(mergePrompt).toContain("output's `created_at` to be later than the trigger's `created_at`")
    expect(mergePrompt).toContain('exactly one standalone verdict line that is `LGTM`')
    expect(mergePrompt).toContain('without a completed matching output blocks the merge')
    expect(mergePrompt).toContain('`Needs Updates`')
    expect(mergePrompt).toContain('an `issue_comment` run reports the default-branch SHA, not the PR head')
    expect(mergePrompt).toContain(`commits/${headSha(2)}/check-suites`)
    expect(mergePrompt).toContain('`.commit.committer.date` when it has no check suite')
    expect(mergePrompt).toContain("require the LGTM output's `created_at` to be strictly later")
    expect(mergePrompt).toContain('An LGTM that predates the head it would merge reviewed older code: STOP')
    expect(mergePrompt).toContain('if step 3 changed the head, step 4 blocks until a fresh review reaches readiness')
    expect(mergePrompt).toContain('no command may run between this final validation and the pinned merge')
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

  test('successors of a merged predecessor build from the base branch with no baseRefs', async () => {
    const { events } = await executeWorkflow({
      tracks: [{ issues: [2, 3] }, { issues: [9], after: [0] }],
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

  test('a blocked merge blocks hard and ordering descendants and skips the release', async () => {
    const { output, events } = await executeWorkflow({
      tracks: [
        { issues: [2] },
        { issues: [9], after: [0] },
        { issues: [12], runsAfter: [0] },
      ],
    }, {
      'merge:PR#1002': () => ({ merged: false, merge_sha: '', issue_state: 'open', branch_deleted: false, summary: 'ci failed', blocker: 'required check test-suite failed' }),
    })
    const record = output.results.find((result) => result.issue === 2)

    expect(record?.status).toBe('merge_blocked')
    expect(record?.blocker).toBe('required check test-suite failed')
    expect(output.results.find((result) => result.issue === 9)?.status).toBe('dependency_blocked')
    expect(output.results.find((result) => result.issue === 12)?.status).toBe('dependency_blocked')
    expect(started(events, 'validate:#9')).toBeFalse()
    expect(started(events, 'validate:#12')).toBeFalse()
    expect(output.release?.released).toBeFalse()
    expect(output.release?.skipped).toBeTrue()
  })

  test('release dispatches one sonnet/medium sync-docs-release agent when every issue merged', async () => {
    const { output, events } = await executeWorkflow({ tracks: [[2], [3]] })
    const releaseEvent = events.find((event) => event.state === 'started' && event.label === 'release:sync-docs-release')

    expect(releaseEvent.model).toBe('sonnet')
    expect(releaseEvent.effort).toBe('medium')
    expect(releaseEvent.phase).toBe('Release')
    expect(releaseEvent.prompt).toContain('sync-docs-release')
    expect(releaseEvent.prompt).toContain('- Issue #2 → PR #1002')
    expect(releaseEvent.prompt).toContain('- Issue #3 → PR #1003')
    expect(releaseEvent.prompt).toContain('Created with LLM: Sonnet 5 | medium | Harness: milestone-pipeline')
    expect(output.release.released).toBeTrue()
    expect(output.release.tag).toBe('v1.0.0')
  })

  test('release is skipped when any issue did not merge', async () => {
    const { output, events, logs } = await executeWorkflow({ tracks: [[2], [3]] }, {
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
    expect(logs.some((message) => message.includes('release skipped — 1 of 2 issues reached merged status'))).toBeTrue()
  })

  test('release: false skips the release stage while merging stays on', async () => {
    const { output, events } = await executeWorkflow({ tracks: [[2]], release: false })

    expect(output.results[0].status).toBe('merged')
    expect(events.some((event) => event.phase === 'Release')).toBeFalse()
    expect(output.release).toBeNull()
  })

  test('a release agent failure is reported without failing the run', async () => {
    const { output, logs } = await executeWorkflow({ tracks: [[2]] }, {
      'release:sync-docs-release': () => { throw new Error('release crashed') },
    })

    expect(output.results[0].status).toBe('merged')
    expect(output.release.released).toBeFalse()
    expect(output.release.summary).toContain('release crashed')
    expect(logs.some((message) => message.includes('release not published'))).toBeTrue()
  })
})
