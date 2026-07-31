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
  // Space-separated and `--flag=value` / `-X=VERB` forms — gh accepts both.
  // Put `=` before `\s*` so `--method=POST` is not eaten by an empty `\s*` match.
  /gh api[^\n`]*(?:-X|--method)(?:=\s*|\s*)(POST|PATCH|PUT|DELETE)/gi,
  /gh api[^\n`]*(?:(?:\s(?:-f|--field|-F|--raw-field)\s)|(?:(?:-f|--field|-F|--raw-field)=))/g,
  /gh api[^\n`]*(?:(?:\s--input\s)|(?:--input=))/g,
]

/**
 * `gh api graphql` is always an HTTP POST and always carries -f/-F parameters, so the
 * parameter forms above cannot distinguish a read from a write there. For GraphQL the
 * operation keyword is what decides: a `query` reads, a `mutation` writes.
 */
const GRAPHQL_CALL = /gh api graphql[^\n`]*/g
const GRAPHQL_MUTATION = /\bmutation\b/

function joinContinuedLines(text) {
  // Shell line continuations: `\\\n` joins physical lines into one logical command
  // so a write flag on the second line cannot hide from single-line scanners.
  return text.replace(/\\\r?\n/g, ' ')
}

/** Non-gh write forms — the read-only guarantee is open-world across binaries, not only `gh`. */
const NON_GH_WRITES = [
  /\bgit\s+(?:commit|push|amend|tag|rebase|merge|cherry-pick|reset|stash\s+push|branch\s+-D)\b/g,
  /\bcurl\b[^\n`]*(?:(?:\s(?:-X|--request)\s)|(?:(?:-X|--request)=))(?:POST|PUT|PATCH|DELETE)/gi,
  /\bcurl\b[^\n`]*(?:(?:\s(?:-d|--data|--data-raw|--data-binary)\s)|(?:(?:-d|--data|--data-raw|--data-binary)=))/g,
]

/**
 * Every reason a chunk of text fails a read-only claim, as human-readable strings.
 * Returning the violations (rather than asserting inline) is what makes the guard
 * itself testable: a seeded `gh release create` must produce a violation, and
 * today's commands must produce none.
 */
function readOnlyViolations(text) {
  text = joinContinuedLines(text)
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
  for (const form of NON_GH_WRITES) {
    for (const [whole] of text.matchAll(form)) violations.push(`non-gh write command: ${whole.trim()}`)
  }
  return violations
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

describe('milestoneplan table contract', () => {
  const body = procedureBody(milestoneplan)

  test('is read-only — never edits issues or launches the run itself', () => {
    expect(body).toMatch(/never writes/i)
    expect(body).toMatch(/does not edit issue bodies.*post comments.*open PRs.*invoke the Workflow tool/is)
    expect(body).toMatch(/Do not launch either one unprompted/i)
  })

  test('the procedure itself contains no mutating command', () => {
    expect(ghInvocations(body).length, 'no gh commands found — extraction is vacuous').toBeGreaterThan(0)
    expect(readOnlyViolations(body), 'read-only procedure contains a writing command').toEqual([])
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
      'gh api /repos/o/r/issues -F title=x ',
      'gh api /repos/o/r/issues --raw-field title=x ',
      'gh api /repos/o/r/issues --input body.json ',
      'gh api --method=POST /repos/o/r/issues',
      'gh api -X=PATCH /repos/o/r/issues/1',
      'gh api /repos/o/r/issues --field=title=x',
      'gh api /repos/o/r/issues -f=title=x',
      'gh api /repos/o/r/issues -F=title=x',
      'gh api /repos/o/r/issues --raw-field=title=x',
      'gh api /repos/o/r/issues --input=body.json',
      "gh api graphql -f query='mutation { addComment(input: {}) { clientMutationId } }'",
      'gh api /repos/o/r/issues/1/comments \\\n  -f body=x',
      "gh api graphql \\\n  -f query='mutation { addComment(input: {}) { clientMutationId } }'",
      'git push origin HEAD',
      'git commit -m x',
      'curl -X POST https://api.github.com/repos/o/r/issues',
      'curl --request PATCH https://api.github.com/repos/o/r/issues/1',
      'curl -d body=x https://api.github.com/repos/o/r/issues/1/comments',
    ]) {
      expect(readOnlyViolations(written), `should fail the read-only guard: ${written}`).not.toEqual([])
    }
    // …and every command this procedure legitimately uses must still pass.
    for (const read of [
      'gh api "repos/{owner}/{repo}/milestones?state=all&per_page=100" --paginate --jq \'.[]\'',
      'gh issue list --milestone "M" --state all --limit 500 --json number',
      'git log -1 --oneline',
      'curl https://api.github.com/repos/o/r/issues/1',
    ]) {
      expect(readOnlyViolations(read), `should pass the read-only guard: ${read}`).toEqual([])
    }
  })

  test('fetches the whole milestone before rendering', () => {
    const blocks = fencedBlocks(body)
    expect(blocks.some((code) => /milestones\?state=all&per_page=100" --paginate/.test(code))).toBe(true)
    expect(body).toMatch(/returns 30 per page by default/)
    expect(body).toMatch(/strictly below its own limit/)
    expect(body).toMatch(/never render the table over a possibly-partial milestone/)
    expect(body).toMatch(/\| Fetched issue count equals `--limit` \|/)
  })

  test('renders exactly one table with the agreed columns', () => {
    expect(body).toMatch(/exactly one markdown table/i)
    expect(body).toContain('| # | Description | C | Deps/After | Validate | Build | Plan | Review |')
    expect(body).toMatch(/No verdict, no findings list, no wave plan, no cost projection/)
  })

  test('marks absent fields as missing and names the pipeline default', () => {
    expect(body).toMatch(/\*missing\* — never blank, never a guessed default/i)
    expect(body).toMatch(/`model fable, effort high`/)
    expect(body).toMatch(/never infer edges from prose/i)
  })

  test('attributes validation to Fable 5 regardless of the Build model', () => {
    expect(body).toMatch(/it is always Fable 5/)
    expect(body).toMatch(/regardless of the Build model/)
  })

  test('hands off to the skills that own the writes and the run', () => {
    expect(body).toMatch(/`execution-plan-review`.*Execution-block edits/is)
    expect(body).toMatch(/`milestone-workflow`.*run plan before dispatching/is)
  })

  test('is wired into the pipeline as the stage before milestone-workflow', () => {
    expect(newAppPipeline).toMatch(/\| 6 \| Show the plan \| `milestoneplan` \|/)
    expect(newAppPipeline).toMatch(/\| 7 \| Run a milestone \| `milestone-workflow` \|/)
    expect(readme).toMatch(/\| `milestoneplan` \|/)
    expect(milestoneWorkflow).toMatch(/`milestoneplan`/)
    expect(executionPlanReview).toMatch(/`milestoneplan`/)
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
