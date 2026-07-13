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

async function executeWorkflow(args, handlers = {}) {
  const events = []
  const logs = []
  const agent = async (prompt, options) => {
    const event = { label: options.label, phase: options.phase, model: options.model, effort: options.effort, prompt }
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
      result = {
        final_status: 'lgtm',
        cycles_run: 1,
        summary: 'approved',
        head_ref: `codex/issue-${issue}`,
        head_sha: headSha(issue),
      }
    } else {
      throw new Error(`unexpected phase: ${options.phase}`)
    }

    events.push({ ...event, state: 'finished', result })
    return result
  }
  const parallel = async (tasks) => Promise.all(tasks.map((task) => task()))
  const run = new AsyncFunction('args', 'agent', 'parallel', 'log', workflowBody)
  const output = await run(args, agent, parallel, (message) => logs.push(message))
  return { output, events, logs }
}

function started(events, label) {
  return events.some((event) => event.state === 'started' && event.label === label)
}

function promptFor(events, label) {
  return events.find((event) => event.state === 'started' && event.label === label)?.prompt
}

describe('milestone-pipeline dependency scheduling', () => {
  test('normalizes forbidden effort tiers before every dispatch', async () => {
    const { events, logs } = await executeWorkflow({
      tracks: [[2], [3], [4], [5], [6], [7], [8]],
      reviewLoop: true,
    }, {
      Prep: () => ({
        issues: [
          { number: 2, title: 'Fable medium', complexity: 20, model: 'fable', effort: 'medium', validate_effort: 'xhigh', fableplan: false, missing_block: false },
          { number: 3, title: 'Opus medium', complexity: 20, model: 'opus', effort: 'medium', validate_effort: 'medium', fableplan: false, missing_block: false },
          { number: 4, title: 'Sonnet medium', complexity: 20, model: 'sonnet', effort: 'medium', validate_effort: 'high', fableplan: false, missing_block: false },
          { number: 5, title: 'Haiku medium', complexity: 20, model: 'haiku', effort: 'medium', validate_effort: 'high', fableplan: false, missing_block: false },
          { number: 6, title: 'Valid defaults', complexity: 20, model: 'fable', effort: 'high', fableplan: false, missing_block: false },
          { number: 8, title: 'Valid xhigh', complexity: 20, model: 'opus', effort: 'xhigh', validate_effort: 'medium', fableplan: false, missing_block: false },
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

    const normalizations = logs.filter((message) => message.includes('normalized'))
    expect(normalizations).toEqual([
      '#2: normalized validate effort xhigh → high',
      '#3: normalized build effort medium → high for Opus 4.8',
      '#4: normalized build effort medium → high for Sonnet 5',
      '#5: normalized build effort medium → high for Haiku 4.5',
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
})
