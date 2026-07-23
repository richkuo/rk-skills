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
          validate_effort: 'high',
          fableplan: false,
          missing_block: false,
        })),
      }
    } else if (options.phase === 'Validate') {
      result = { verdict: 'VALID', summary: 'valid', corrections: [], implementation_constraints: [] }
    } else if (options.phase === 'Implement') {
      const issue = issueFromLabel(options.label)
      result = {
        pr_number: 1000 + issue,
        pr_url: `https://example.test/pr/${1000 + issue}`,
        head_ref: `codex/issue-${issue}`,
        head_sha: headSha(issue),
        summary: 'implemented',
        tests_passed: true,
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
          final_status: 'lgtm',
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
          validate_effort: 'high',
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
          validate_effort: 'high',
          fableplan: number === 2,
          missing_block: false,
        })),
      }),
      'plan:#2': () => { throw new Error('planner failed') },
      'implement:#3 (fable/high)': () => { throw new Error('implementation failed') },
      'review-loop:PR#1004': () => { throw new Error('review failed') },
    })

    expect(events.filter((event) => event.state === 'started' && event.label === 'plan:#2')).toHaveLength(1)
    expect(events.filter((event) => event.state === 'started' && event.label === 'implement:#3 (fable/high)')).toHaveLength(1)
    expect(events.filter((event) => event.state === 'started' && event.label === 'review-loop:PR#1004')).toHaveLength(1)
  })

  test('normalizes forbidden effort tiers before every dispatch', async () => {
    const { events, logs } = await executeWorkflow({
      tracks: [[2], [3], [4], [5], [6], [7], [8], [9], [10]],
      reviewLoop: true,
      reviewMode: 'github',
    }, {
      Prep: () => ({
        issues: [
          { number: 2, title: 'Fable medium', complexity: 20, model: 'fable', effort: 'medium', validate_effort: 'xhigh', fableplan: false, missing_block: false },
          { number: 3, title: 'Opus medium', complexity: 20, model: 'opus', effort: 'medium', validate_effort: 'medium', fableplan: false, missing_block: false },
          { number: 4, title: 'Sonnet medium', complexity: 20, model: 'sonnet', effort: 'medium', validate_effort: 'high', fableplan: false, missing_block: false },
          { number: 5, title: 'Haiku medium', complexity: 20, model: 'haiku', effort: 'medium', validate_effort: 'high', fableplan: false, missing_block: false },
          { number: 6, title: 'Valid defaults', complexity: 20, model: 'fable', effort: 'high', fableplan: false, missing_block: false },
          { number: 8, title: 'Valid xhigh', complexity: 20, model: 'opus', effort: 'xhigh', validate_effort: 'medium', fableplan: false, missing_block: false },
          { number: 9, title: 'Fable low', complexity: 20, model: 'fable', effort: 'low', validate_effort: 'high', fableplan: false, missing_block: false },
          { number: 10, title: 'Opus low', complexity: 20, model: 'opus', effort: 'low', validate_effort: 'high', fableplan: false, missing_block: false },
        ],
      }),
    })

    const effortFor = (label) => events.find((event) => event.state === 'started' && event.label === label)?.effort
    expect(effortFor('validate:#2')).toBe('high')
    expect(effortFor('implement:#2 (fable/medium)')).toBe('medium')
    expect(effortFor('review-loop:PR#1002')).toBe('medium')
    expect(effortFor('validate:#3')).toBe('medium')
    expect(effortFor('validate:#4')).toBe('high')
    expect(effortFor('validate:#5')).toBe('high')
    expect(effortFor('validate:#6')).toBe('high')
    expect(effortFor('validate:#7')).toBe('high')

    for (const [issue, model] of [[3, 'opus'], [4, 'sonnet'], [5, 'haiku']]) {
      expect(effortFor(`implement:#${issue} (${model}/high)`)).toBe('high')
      expect(effortFor(`review-loop:PR#${1000 + issue}`)).toBe('high')
    }
    expect(effortFor('implement:#6 (fable/high)')).toBe('high')
    expect(effortFor('review-loop:PR#1006')).toBe('high')
    expect(effortFor('implement:#7 (fable/high)')).toBe('high')
    expect(effortFor('review-loop:PR#1007')).toBe('high')
    expect(effortFor('validate:#8')).toBe('medium')
    expect(effortFor('implement:#8 (opus/xhigh)')).toBe('xhigh')
    expect(effortFor('review-loop:PR#1008')).toBe('xhigh')
    expect(effortFor('implement:#9 (fable/low)')).toBe('low')
    expect(effortFor('review-loop:PR#1009')).toBe('low')
    expect(effortFor('implement:#10 (opus/high)')).toBe('high')
    expect(effortFor('review-loop:PR#1010')).toBe('high')

    expect(promptFor(events, 'implement:#9 (fable/low)')).toContain('| low | Harness: milestone-pipeline')
    expect(promptFor(events, 'review-loop:PR#1009')).toContain('| low | Harness: milestone-pipeline')
    expect(promptFor(events, 'implement:#10 (opus/high)')).toContain('| high | Harness: milestone-pipeline')
    expect(promptFor(events, 'implement:#10 (opus/high)')).not.toContain('| low |')

    const normalizations = logs.filter((message) => message.includes('normalized'))
    expect(normalizations).toEqual([
      '#2: normalized validate effort xhigh → high',
      '#3: normalized build effort medium → high for Opus 4.8 (low/medium are Fable-only)',
      '#4: normalized build effort medium → high for Sonnet 5 (low/medium are Fable-only)',
      '#5: normalized build effort medium → high for Haiku 4.5 (low/medium are Fable-only)',
      '#10: normalized build effort low → high for Opus 4.8 (low/medium are Fable-only)',
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
    }, {
      'review-loop:PR#1002': () => review.promise,
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
      final_status: 'lgtm',
      cycles_run: 1,
      summary: 'approved',
      head_ref: 'codex/issue-2',
      head_sha: headSha(2, 'a'),
    })
    const result = await running
    const reviewFinished = result.events.findIndex((event) => event.state === 'finished' && event.label === 'review-loop:PR#1002')
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

    expect(prompt.includes('trigger the review bot')).toBe(mode === 'github')
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
      'review-loop:PR#1002': () => ({
        final_status: 'blocked',
        cycles_run: 1,
        summary: 'review failed',
        head_ref: 'codex/issue-2',
        head_sha: headSha(2, 'b'),
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
      'review-loop:PR#1002': () => ({ final_status: 'lgtm', cycles_run: 1, summary: 'approved' }),
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

describe('milestone-pipeline subagent review mode', () => {
  const prepIssue = (overrides = {}) => ({
    number: 2,
    title: 'Issue 2',
    complexity: 60,
    model: 'fable',
    effort: 'high',
    validate_effort: 'high',
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
    expect(record?.status).toBe('lgtm')
    expect(record?.review.final_status).toBe('lgtm')
    expect(record?.review.cycles_run).toBe(1)
  })

  test('defaults the first review to opus/high when the PR review line is standard or absent', async () => {
    const { events } = await executeWorkflow({ tracks: [[2]] }, {
      Prep: () => ({ issues: [prepIssue({ first_review_model: undefined, first_review_effort: undefined })] }),
    })

    expect(started(events, 'review:PR#1002 c1 (opus/high)')).toBeTrue()
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
    expect(record?.status).toBe('lgtm')
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
    expect(record?.status).toBe('lgtm')
    expect(record?.review.final_status).toBe('lgtm')
  })

  test('an LGTM with non-blocking findings on the final cycle stops as lgtm_with_nonblocking without a fixer', async () => {
    const { output, events } = await executeWorkflow({ tracks: [[2]], maxReviewCycles: 1 }, {
      Prep: () => ({ issues: [prepIssue()] }),
      'Review Loop': () => ({ verdict: 'lgtm', blocking_count: 0, nonblocking_count: 1, head_ref: 'codex/issue-2', head_sha: headSha(2), comment_url: 'https://example.test/pr/1002#r1', summary: 'one optional' }),
    })
    const record = output.results.find((result) => result.issue === 2)

    expect(events.filter((event) => event.state === 'started' && event.label.startsWith('fix:'))).toHaveLength(0)
    expect(record?.status).toBe('lgtm')
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

