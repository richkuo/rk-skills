import { describe, expect, test } from 'bun:test'

const root = new URL('../', import.meta.url)
const read = (path) => Bun.file(new URL(path, root)).text()

const [
  prdToIssues,
  executionPlanReview,
  milestoneWorkflow,
  milestoneplan,
  newAppPipeline,
  fableplan,
  validateIssue,
  readme,
] = await Promise.all([
  read('skills/prd-to-issues/SKILL.md'),
  read('skills/execution-plan-review/SKILL.md'),
  read('skills/milestone-workflow/SKILL.md'),
  read('skills/milestoneplan/SKILL.md'),
  read('skills/new-app-pipeline/SKILL.md'),
  read('skills/fableplan/SKILL.md'),
  read('skills/validate-issue/SKILL.md'),
  read('README.md'),
])

/** Strip YAML frontmatter so a description: keyword cannot satisfy a procedure rule. */
function procedureBody(markdown) {
  const match = markdown.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/)
  return match ? match[1] : markdown
}

/** The fenced code blocks of a procedure — where its actual instructions live. */
function fencedBlocks(markdown) {
  return [...markdown.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map(([, code]) => code)
}

/**
 * Every `gh` invocation in a chunk of text as `<subcommand> <verb>` pairs. Matches
 * ANY subcommand, not a fixed list: the read-only guarantee is open-world, so a
 * command the guard does not recognize has to reach the allowlist check and fail
 * there rather than slip past extraction.
 */
function ghInvocations(text) {
  // \b is load-bearing: without it the trailing "gh" of "through" matches and the
  // next prose word reads as a subcommand.
  return [...text.matchAll(/\bgh\s+([a-z][a-z-]*)(?:\s+([a-z][a-z-]*))?/g)].map(
    ([whole, sub, verb]) => ({ sub, verb: verb ?? '', whole: whole.trim() }),
  )
}

/** gh verbs that write. Present anywhere in a read-only procedure — instruction or aside — is a failure. */
const MUTATING_GH = /gh\s+(?:issue|pr)\s+(edit|create|comment|close|reopen|delete|merge|review|lock|transfer|develop)\b/

/** Subcommand verbs that only read. Anything outside this set mutates and must fail a read-only claim. */
const READ_ONLY_GH = {
  api: [], // GET by default; the verb slot is a path, so writes are caught by method/field instead
  issue: ['list', 'view', 'status'],
  pr: ['list', 'view', 'checks', 'diff', 'status'],
  run: ['list', 'view'],
  repo: ['view'],
  auth: ['status'],
  search: ['issues', 'prs', 'repos', 'code'],
}

/**
 * `gh api` turns into a write via an explicit method, or via any parameter form —
 * gh switches to POST as soon as a parameter is attached. -f/--field is not the only
 * one: -F/--raw-field and --input POST just as surely, so all of them belong here.
 * Checked in prose as well as in fenced blocks.
 */
const WRITING_GH_API = [
  /gh api[^\n`]*(?:-X|--method)\s*(POST|PATCH|PUT|DELETE)/gi,
  /gh api[^\n`]*\s(?:-f|--field|-F|--raw-field)\s/g,
  /gh api[^\n`]*\s--input\s/g,
]

/**
 * `gh api graphql` is always an HTTP POST and always carries -f/-F parameters, so the
 * parameter forms above cannot distinguish a read from a write there. For GraphQL the
 * operation keyword is what decides: a `query` reads, a `mutation` writes.
 */
const GRAPHQL_CALL = /gh api graphql[^\n`]*/g
const GRAPHQL_MUTATION = /\bmutation\b/

/**
 * Every reason a chunk of text fails a read-only claim, as human-readable strings.
 * Returning the violations (rather than asserting inline) is what makes the guard
 * itself testable: a seeded `gh release create` must produce a violation, and
 * today's commands must produce none.
 */
function readOnlyViolations(text) {
  const violations = []
  for (const { sub, verb, whole } of ghInvocations(text)) {
    const readOnlyVerbs = READ_ONLY_GH[sub]
    if (!readOnlyVerbs) violations.push(`unknown gh subcommand: ${whole}`)
    // `gh api`'s next token is a path, not a verb — its writes are the method/field forms below.
    else if (sub !== 'api' && !readOnlyVerbs.includes(verb)) violations.push(`mutating gh command: ${whole}`)
  }
  // A GraphQL operation reads or writes by keyword, not by parameter form, so judge those
  // calls separately and keep them out of the parameter scans below.
  for (const match of text.matchAll(GRAPHQL_CALL)) {
    const rest = text.slice(match.index)
    const statement = rest.slice(0, Math.min(...[rest.indexOf('```'), rest.indexOf('\n\n'), rest.length].filter((i) => i >= 0)))
    if (GRAPHQL_MUTATION.test(statement)) violations.push(`graphql mutation: ${match[0].trim()}`)
  }
  const withoutGraphql = text.replace(GRAPHQL_CALL, 'gh api graphql')
  for (const form of WRITING_GH_API) {
    for (const [whole] of withoutGraphql.matchAll(form)) violations.push(`writing gh api call: ${whole.trim()}`)
  }
  return violations
}

/**
 * Normalize either document's band table into comparable per-band tuples. The two
 * tables carry different columns (milestoneplan splits fableplan into its own
 * column; validate-issue folds it into the model cell and appends prose
 * parentheticals), so compare the semantic cells: capability, score band, model
 * family, whether fableplan is prescribed, and the three effort tertiles.
 */
function bandTable(markdown) {
  // Cell patterns exclude newlines: `[^|]` alone would let a row match run past its line.
  const rows = [...markdown.matchAll(/^\|\s*([0-3])\s*\|\s*(\d+–\d+)\s*\|([^|\n]+)\|([^|\n]+)\|([^|\n]*)\|?[ \t]*$/gm)]
  if (!rows.length) return null
  return rows.map((row) => {
    // milestoneplan has 5 columns (fableplan is its own); validate-issue has 4.
    const cells = row.slice(3).map((cell) => cell.trim())
    const fiveColumn = cells[2] !== ''
    const model = cells[0]
    const fableplanCell = fiveColumn ? cells[1] : model
    const effort = fiveColumn ? cells[2] : cells[1]
    return {
      capability: Number(row[1]),
      scoreBand: row[2],
      // Model family only — "Cheap/fast (Sonnet-class)" and "Sonnet-class" agree.
      model: (model.match(/Sonnet|Opus|Fable/) || [null])[0],
      // validate-issue writes "+ fableplan first" in the model cell; milestoneplan uses a Yes/No column.
      fableplan: /fableplan first|^\*\*Yes\*\*|^Yes/.test(fableplanCell),
      // Strip trailing parentheticals, which are prose and phrased differently in each document.
      effort: effort.replace(/\s*\(.*$/, '').replace(/\s+/g, ' ').trim(),
    }
  })
}

describe('Execution block ordering contract', () => {
  test('prd-to-issues stamps typed direct predecessors', () => {
    expect(prdToIssues).toContain('- **Depends on:** #<n>[, #<n>…] | none')
    expect(prdToIssues).toContain('- **Runs after:** #<n>[, #<n>…] | none')
    expect(prdToIssues).toMatch(/same-package.*Runs after/i)
    expect(prdToIssues).toContain("In the later issue's `Runs after`, list the earlier issue")
  })

  test('execution-plan-review exposes revisions and validates their combined graph', () => {
    expect(executionPlanReview).toContain('| Issue | C | Depends on | Runs after |')
    expect(executionPlanReview).toMatch(/revision.*Depends on.*Runs after/is)
    expect(executionPlanReview).toMatch(/reject.*cycle.*union/is)
  })

  test('milestone-workflow preserves explicit values and labels legacy inference', () => {
    expect(milestoneWorkflow).toMatch(/explicit `none`.*authoritative/i)
    expect(milestoneWorkflow).toMatch(/inferred.*hard.*ordering/is)
  })

  test('milestone-workflow surfaces direct-agent and token size risk before launch', () => {
    expect(milestoneWorkflow).toMatch(/Run size/i)
    expect(milestoneWorkflow).toMatch(/1 prep.*1 validate.*fableplan.*1 plan.*1 implement.*reviewLoop.*1 review-loop/is)
    expect(milestoneWorkflow).toMatch(/effective Dynamic workflow size guideline.*more than 25/is)
    expect(milestoneWorkflow).toMatch(/projected token total.*1\.5 million/i)
    expect(milestoneWorkflow).toMatch(/not a total-agent guarantee/i)
    expect(milestoneWorkflow).toMatch(/nested fix agents/i)
    expect(milestoneWorkflow).toMatch(/retry-aware direct ceiling.*planned direct-agent count \+ number of issues/is)
    expect(milestoneWorkflow).toMatch(/warning counts all scheduled agents/i)
    expect(milestoneWorkflow).toMatch(/never label.*safe/i)
    expect(milestoneWorkflow).toMatch(/maxReviewCycles.*not.*guaranteed cap/is)
  })

  test('README publishes both ordering fields', () => {
    expect(readme).toContain('`Depends on`')
    expect(readme).toContain('`Runs after`')
  })
})

describe('Execution block Plan effort contract', () => {
  test('prd-to-issues stamps an optional Plan effort defaulting to high', () => {
    expect(prdToIssues).toContain('- **Plan effort:** <low | medium | high | xhigh>')
    expect(prdToIssues).toMatch(/Plan effort.*omit for the default, high/is)
    expect(prdToIssues).toMatch(/\*\*Plan effort\*\*.*only on `fableplan first: Yes` issues/is)
    expect(prdToIssues).toMatch(/\*\*Plan effort\*\*.*planner is always Fable 5.*every tier is legal/is)
    expect(prdToIssues).toMatch(/\*\*Plan effort\*\*.*sets effort only, never a model/is)
  })

  test('execution-plan-review surfaces Plan effort and guards inert or model-bearing revisions', () => {
    expect(executionPlanReview).toContain('| fableplan first? | Plan effort |')
    expect(executionPlanReview).toMatch(/Validate effort and Plan effort both default to high/i)
    expect(executionPlanReview).toMatch(/Plan effort revision on a `fableplan first: No` issue is inert/i)
    expect(executionPlanReview).toMatch(/Revision names a plan model.*Only the effort is stampable/is)
    expect(executionPlanReview).toMatch(/plan effort at `low` or `medium`.*Allowed/is)
  })

  test('milestone-workflow documents the plan stage running at the issue Plan effort', () => {
    expect(milestoneWorkflow).toMatch(/`Plan effort`.*default high/is)
    expect(milestoneWorkflow).toMatch(/Plan effort on every `fableplan: Yes` issue/i)
  })

  test('README publishes the plan effort field', () => {
    expect(readme).toMatch(/the effort that plan runs at/i)
  })

  test('fableplan consumes the same field name every other document publishes', () => {
    // A rename in one document must fail here rather than pass file-by-file.
    const blockLine = '- **Plan effort:**'
    expect(prdToIssues).toContain(blockLine)
    expect(fableplan).toContain(blockLine)
    // README describes the field in prose rather than naming the block line.
    for (const doc of [prdToIssues, executionPlanReview, milestoneWorkflow, fableplan]) {
      expect(doc).toContain('Plan effort')
    }
  })

  test('every document that states the plan effort default states high', () => {
    expect(prdToIssues).toMatch(/Plan effort.*omit for the default, high/is)
    expect(executionPlanReview).toMatch(/Validate effort and Plan effort both default to high/i)
    expect(milestoneWorkflow).toMatch(/`Plan effort`.*default high/is)
    expect(fableplan).toMatch(/Plan effort.*absent.*dispatches at `high` — the repo attribution default/is)
  })

  test('fableplan dispatches at the stamped tier and never advertises a constant one', () => {
    expect(fableplan).toMatch(/`effort`.*stamped \*\*Plan effort\*\*/is)
    // (a) re-hardcoding the posted-plan footer to a literal tier must fail here.
    expect(fableplan).toContain('Created with LLM: <model that actually ran> | <effort that actually ran> |')
    expect(fableplan).not.toMatch(/Created with LLM: Fable 5 \| (low|medium|high|xhigh) \|/)
    expect(fableplan).toMatch(/never a constant/i)
  })

  test('fableplan degrades gracefully when the harness Agent tool has no effort parameter', () => {
    expect(fableplan).toMatch(/Not every harness's Agent tool accepts `effort`/i)
    expect(fableplan).toMatch(/re-dispatch once without `effort`/i)
    expect(fableplan).toMatch(/degradation, not an error/i)
    // The footer must then name what actually ran, not the tier that was requested.
    expect(fableplan).toMatch(/Record the model and effort the subagent actually ran at/i)
  })

  test('fableplan tells the operator when a stamped tier could not be honored', () => {
    // The degradation is common (Claude Code's Agent tool has no `effort` parameter),
    // so it must reach the person who stamped the tier, not just the footer.
    expect(fableplan).toMatch(/report it to the user in step 5/i)
    expect(fableplan).toMatch(/could not honor an effort tier and the issue had stamped one, say so here/i)
    expect(fableplan).toMatch(/not a notice/i)
    // …and stay silent when there is nothing to correct.
    expect(fableplan).toMatch(/when the tier \*was\* honored \(no notice/i)
    expect(fableplan).toMatch(/make no claim about a stamped tier in either direction/i)
  })

  test('fableplan passes an explicit tier rather than inheriting the session effort', () => {
    // Passing `high` when nothing is stamped makes the footer's value observed
    // rather than conventional, and floors the plan at high on a low-effort session.
    expect(fableplan).toMatch(/otherwise `high`.*Pass it explicitly even in the unstamped case/is)
    expect(fableplan).toMatch(/may be \*below\* `high`/i)
    expect(fableplan).not.toMatch(/otherwise omit the parameter and let the subagent inherit/i)
    expect(fableplan).not.toMatch(/the subagent inherits the session effort/i)
  })

  test('execution-plan-review never leaves or masks an inert Plan effort', () => {
    expect(executionPlanReview).toMatch(/flips fableplan `Yes` → `No`.*strip that line during write-back/is)
    expect(executionPlanReview).toMatch(/only when that band puts fableplan at `Yes`/i)
    expect(executionPlanReview).toMatch(/show that tier marked `ignored`.*never a bare `—`/is)
  })

  test('fableplan falls back to the documented default, never a guessed session tier', () => {
    // An agent cannot observe its own effort tier, so the unhonored-stamp fallback
    // must name the repo attribution default rather than invent a value.
    expect(fableplan).toMatch(/record the repo attribution default `high`/i)
    expect(fableplan).toMatch(/do not try to name the session's own tier/i)
    expect(fableplan).toMatch(/falls back to the repo attribution default `high`/i)
    expect(fableplan).not.toMatch(/footer names the session effort/i)
  })
})

describe('milestoneplan pre-flight contract', () => {
  const body = procedureBody(milestoneplan)

  test('is read-only — never edits issues or launches the run itself', () => {
    expect(body).toMatch(/never writes/i)
    expect(body).toMatch(/does not edit issue bodies.*post comments.*open PRs.*invoke the Workflow tool/is)
    expect(body).toMatch(/Do not launch either one unprompted/i)
  })

  test('the procedure itself contains no mutating command', () => {
    // The prose assertions above are about what the document claims; these are about
    // what it instructs. A later step running `gh issue edit` must fail here.
    expect(ghInvocations(body).length, 'no gh commands found — extraction is vacuous').toBeGreaterThan(0)
    expect(readOnlyViolations(body), 'read-only procedure contains a writing command').toEqual([])
    // A write verb has no place even in an aside — this doc names sibling skills, not their commands.
    expect(body).not.toMatch(MUTATING_GH)
  })

  test('the read-only guard fails on gh commands it does not recognize', () => {
    // The guarantee is open-world: a step added later that runs some gh subcommand
    // nobody listed must fail the guard, not pass it by being unrecognized. Seed the
    // failures here rather than trusting the guard's shape.
    for (const written of [
      'gh release create v1.0.0',
      'gh workflow run ci.yml',
      'gh label create blocked',
      'gh secret set TOKEN',
      'gh api --method POST /repos/o/r/issues',
      'gh api -X PATCH /repos/o/r/issues/1',
      'gh api /repos/o/r/issues -f title=x ',
      // gh POSTs as soon as any parameter is attached, so the raw-field and input
      // forms write exactly as surely as -f does.
      'gh api /repos/o/r/issues -F title=x ',
      'gh api /repos/o/r/issues --raw-field title=x ',
      'gh api /repos/o/r/issues --input body.json ',
      "gh api graphql -f query='mutation { addComment(input: {}) { clientMutationId } }'",
    ]) {
      expect(readOnlyViolations(written), `should fail the read-only guard: ${written}`).not.toEqual([])
    }
    // …and every command this procedure legitimately uses must still pass.
    for (const read of [
      'gh api "repos/{owner}/{repo}/milestones?state=all&per_page=100" --paginate --jq \'.[]\'',
      'gh issue list --milestone "M" --state all --limit 500 --json number',
      'gh issue view 42 --json body',
      // A GraphQL *query* reads, even though it POSTs and carries -f parameters.
      "gh api graphql -F pr=77 -f query='query($pr:Int!){ repository { pullRequest(number:$pr){ title } } }'",
    ]) {
      expect(readOnlyViolations(read), `should pass the read-only guard: ${read}`).toEqual([])
    }
  })

  test('paginates the milestone lookup instead of taking the first page', () => {
    const blocks = fencedBlocks(body)
    expect(blocks.some((code) => /milestones\?state=all&per_page=100" --paginate/.test(code))).toBe(true)
    expect(body).toMatch(/returns 30 per page by default/)
    // A closed milestone must stay findable.
    expect(body).toMatch(/state=all/)
    expect(body).toMatch(/would read as not found/)
  })

  test('marks a missing field as missing rather than inferring it', () => {
    // "missing" and "none" produce different recommendations, so the parse must
    // carry the distinction instead of collapsing absence into a default.
    expect(body).toMatch(/Parse, never infer, when the field is present/)
    expect(body).toMatch(/explicit `none` is authoritative/)
    expect(body).toMatch(/"missing" and "none" are different cells/)
    expect(body).toMatch(/never blank, never a guessed default/)
  })

  test('derives Capability and Volume from the score rather than the rationale line', () => {
    expect(body).toMatch(/Capability = floor\(score \/ 25\)/)
    expect(body).toMatch(/Volume = score mod 25/)
    expect(body).toMatch(/never suppresses the effort check/i)
  })

  test('recommends against the band table and separates overrides from slips', () => {
    expect(body).toMatch(/\| Capability \| Score \| Build model \| fableplan \|/)
    expect(body).toMatch(/deliberate override/i)
    expect(body).toMatch(/unexplained departure gets a recommendation/i)
    // The pipeline silently raises non-Fable low/medium; the check must say the stamp lies.
    expect(body).toMatch(/non-Fable build stamped `low`\/`medium`/i)
    expect(body).toMatch(/`Validate effort: xhigh`/)
    expect(body).toMatch(/`Plan effort` on a `fableplan: No` issue.*inert/is)
    // Band conformance runs in both directions: quiet overspend gets flagged too.
    expect(body).toMatch(/Band conformance is two-sided/i)
    expect(body).toMatch(/departs from its score's band in \*either\* direction/)
    expect(body).toMatch(/silent overspend/i)
    // Over-band is the pipeline's own default for a missing Execution block.
    expect(body).toMatch(/model fable, effort high/)
  })

  test('the band table agrees with validate-issue, the canonical source it copies', () => {
    const canonical = bandTable(validateIssue)
    const copy = bandTable(milestoneplan)
    expect(canonical, 'validate-issue publishes no extractable band table').not.toBeNull()
    expect(copy, 'milestoneplan publishes no extractable band table').not.toBeNull()
    // The recommendations' entire correctness basis is this table. Compare it to its
    // source rather than pinning a literal in each, so either copy drifting fails.
    expect(copy).toEqual(canonical)
    // Guard the extraction itself: a silently-empty match would make the compare vacuous.
    expect(canonical).toHaveLength(4)
    expect(canonical.map((band) => band.capability)).toEqual([0, 1, 2, 3])
    expect(canonical.find((band) => band.capability === 2).fableplan).toBe(true)
    expect(canonical.find((band) => band.capability === 3).model).toBe('Fable')
  })

  test('publishes the per-issue routing table with every Execution-block field', () => {
    // The table is the deliverable: every field the pipeline reads has a column.
    const header = fencedBlocks(body).find((code) => code.includes('1st review'))
    expect(header, 'no per-issue table header found').toBeDefined()
    for (const column of ['State', 'Depends on', 'Runs after', 'Build', 'Effort', 'Validate', 'fableplan', 'Plan', '1st review']) {
      expect(header, `routing table is missing the ${column} column`).toContain(column)
    }
  })

  test('routes each recommendation to a skill whose write scope covers it', () => {
    // execution-plan-review edits only Execution block lines, so body-content
    // recommendations routed there would be handed to a skill that cannot clear them.
    expect(body).toMatch(/Body-content items.*`validate-issue`/s)
    expect(body).toMatch(/`execution-plan-review` cannot clear any of these/)
    expect(body).toMatch(/Editing issue body prose or the title's `\[C<score>\]` prefix \| `validate-issue`/)
  })

  test('is wired into the pipeline as the stage before milestone-workflow', () => {
    expect(newAppPipeline).toMatch(/\| 6 \| Pre-flight a milestone \| `milestoneplan` \|/)
    expect(newAppPipeline).toMatch(/\| 7 \| Run a milestone \| `milestone-workflow` \|/)
    expect(readme).toMatch(/\| `milestoneplan` \|/)
    expect(milestoneWorkflow).toMatch(/`milestoneplan`/)
    expect(executionPlanReview).toMatch(/`milestoneplan`/)
  })

  test('defers per-issue correctness to validate-issue instead of duplicating it', () => {
    expect(body).toMatch(/Verifying an issue's claims against the code.*validate-issue/is)
    expect(body).toMatch(/do not duplicate it here/i)
  })
})

describe('new-app-pipeline stage numbering contract', () => {
  /** The stage table is the single source of truth for the pipeline's order. */
  const stageRows = [...newAppPipeline.matchAll(/^\|\s*(\d+)\s*\|[^|]+\|\s*(?:`([a-z-]+)`|—)\s*\|/gm)].map(
    ([, number, skill]) => ({ number: Number(number), skill: skill ?? null }),
  )
  const stagedSkills = stageRows.filter((row) => row.skill)

  test('the table numbers its stages consecutively from 1', () => {
    expect(stageRows.length).toBeGreaterThan(0)
    expect(stageRows.map((row) => row.number)).toEqual(stageRows.map((_, index) => index + 1))
  })

  test("each staged skill's own description declares its table stage number", async () => {
    expect(stagedSkills.length).toBeGreaterThan(0)
    for (const { number, skill } of stagedSkills) {
      const declared = (await read(`skills/${skill}/SKILL.md`)).match(/Stage ([^ ]+) of the new-app-pipeline/)
      expect(declared, `${skill} declares no new-app-pipeline stage`).not.toBeNull()
      expect(declared[1], `${skill} declares stage ${declared[1]}, table says ${number}`).toBe(String(number))
    }
  })

  test('the README diagram walks the staged skills in table order', () => {
    const diagram = readme.match(/```mermaid\nflowchart LR\n {4}A\(\[app-prd\]\)[\s\S]*?```/)
    expect(diagram, 'README has no app-pipeline mermaid diagram').not.toBeNull()
    const drawn = [...diagram[0].matchAll(/\(\[([a-z-]+)\]\)/g)].map(([, name]) => name)
    expect(drawn).toEqual(stagedSkills.map((row) => row.skill))
  })
})
