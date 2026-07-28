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

/**
 * Pull the run-size formula out of a skill document, split into the summation
 * scope and the agent terms. Anchored on the sole `1 prep` code span, so prose
 * around the formula can be reworded freely while the terms stay comparable —
 * the parity tests compare two documents' extractions instead of pinning a
 * literal in each, which is what makes independent drift fail.
 */
function runSizeFormula(markdown) {
  const spans = markdown.match(/`[^`]*1 prep[^`]*`/g)
  if (!spans || spans.length !== 1) return null
  const parts = spans[0].match(/^`1 prep \+ sum over (.+?) of \((.+)\)`$/)
  if (!parts) return null
  return { scope: parts[1].trim(), terms: parts[2].replace(/\s+/g, ' ').trim() }
}

/** The per-issue subagent-mode review worst case, extracted for the same parity comparison. */
function reviewWorstCase(markdown) {
  const match = markdown.match(/(2×maxReviewCycles\s*[−-]\s*1)/)
  return match ? match[1].replace(/\s+/g, ' ') : null
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

/**
 * Normalize either document's band table into comparable per-band tuples. The two
 * tables carry different columns (milestoneplan splits fableplan into its own
 * column; validate-issue folds it into the model cell and appends prose
 * parentheticals), so compare the semantic cells: capability, score band, model
 * family, whether fableplan is prescribed, and the three effort tertiles.
 */
// The findings table's Severity column vocabulary — the row classes every audited
// severity has to land in. Extracted from the bullet that defines the column, so a
// severity added to the verdict table fails the contract until this list gains it.
function findingsSeverities(markdown) {
  const bullet = markdown.match(/^- \*\*Severity\*\* — exactly one of ([^\n]+?), spelled that way\./m)
  if (!bullet) return null
  return [...bullet[1].matchAll(/`([^`]+)`/g)].map(([, name]) => name)
}

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
      // `--flag=value` / `-X=VERB` spellings — gh accepts these too.
      'gh api --method=POST /repos/o/r/issues',
      'gh api -X=PATCH /repos/o/r/issues/1',
      'gh api /repos/o/r/issues --field=title=x',
      'gh api /repos/o/r/issues -f=title=x',
      'gh api /repos/o/r/issues -F=title=x',
      'gh api /repos/o/r/issues --raw-field=title=x',
      'gh api /repos/o/r/issues --input=body.json',
      "gh api graphql -f query='mutation { addComment(input: {}) { clientMutationId } }'",
      // Line-continued writes — the guard must join `\\\n` before scanning.
      'gh api /repos/o/r/issues/1/comments \\\n  -f body=x',
      "gh api graphql \\\n  -f query='mutation { addComment(input: {}) { clientMutationId } }'",
      // Non-gh write binaries — the guard is open-world across tools, not only `gh`.
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
      'gh pr list --state open --limit 500 --json number',
      "gh api graphql -F owner='{owner}' -F repo='{repo}' -f query='query($owner:String!,$repo:String!){ repository(owner:$owner,name:$repo){ pr101: pullRequest(number:101){ number state mergedAt } } }'",
      "gh api graphql -F owner='{owner}' -F repo='{repo}' -F after=null -f query='query($owner:String!,$repo:String!,$after:String){ repository(owner:$owner,name:$repo){ i42: issue(number:42){ timelineItems(first:100, after:$after, itemTypes:[CROSS_REFERENCED_EVENT]){ pageInfo{hasNextPage endCursor} nodes{ ... on CrossReferencedEvent { source { ... on PullRequest { number state mergedAt } } } } } } } }'",
      'gh pr view 42 -R owner/repo --json number,state,mergedAt',
      'gh issue view 42 --json number,title,state,stateReason,milestone,body,closedByPullRequestsReferences',
      'gh issue view 42 --json number,state,stateReason,milestone',
      'gh issue view 42 --json body',
      // A GraphQL *query* reads, even though it POSTs and carries -f parameters.
      "gh api graphql -F pr=77 -f query='query($pr:Int!){ repository { pullRequest(number:$pr){ title } } }'",
      // Non-gh reads must not trip the write deny-list.
      'git log -1 --oneline',
      'curl https://api.github.com/repos/o/r/issues/1',
    ]) {
      expect(readOnlyViolations(read), `should pass the read-only guard: ${read}`).toEqual([])
    }
  })

  test('proves fetch completeness from the fetch, not from cross-endpoint counts', () => {
    // Milestone counters include PRs assigned to the milestone; gh issue list does not.
    expect(body).toMatch(/do not gate this on the milestone object's `open_issues` \/ `closed_issues`/i)
    expect(body).toMatch(/strictly below\*\* the limit/i)
    expect(body).toMatch(/equal to\*\* the limit is indistinguishable from truncation/i)
    expect(body).toMatch(/blocking unknown/i)
    // A closed milestone must stay auditable.
    expect(body).toMatch(/state=all/)
    // Truncation is disclosed, and a proven-complete fetch prints no caveat at all.
    expect(body).toMatch(/never present a count equal to the limit as the complete milestone/i)
    expect(body).toMatch(/Proceed, and print no truncation caveat/i)
    expect(body).toMatch(/\| Fetched issue count equals `--limit` \|/)
  })

  test('classifies buckets in one query and never reads a failed lookup as no PR', () => {
    // The instruction is the fenced command; the per-issue --search form may still be
    // named in prose as the thing not to do, so assert over fenced blocks only.
    const blocks = fencedBlocks(body)
    expect(blocks.some((code) => /gh pr list --state open --limit \d+/.test(code))).toBe(true)
    expect(blocks.some((code) => /gh pr list[^\n]*--search/.test(code))).toBe(false)
    expect(body).toMatch(/A failed lookup is not "no PR found\."/)
  })

  test("the documented closing-keyword pattern matches what GitHub itself closes on", () => {
    // Run the pattern the document publishes rather than grepping for keyword names:
    // a pattern that misses `Fixed #12` sends an issue that already has a PR back
    // through a fresh build. JS has no inline (?i), so strip it and pass the flag.
    const fenced = fencedBlocks(body).find((code) => code.includes('close[sd]?'))
    expect(fenced, 'no closing-keyword pattern found in the procedure').toBeDefined()
    const pattern = new RegExp(fenced.trim().replace(/^\(\?i\)/, ''), 'gi')
    const matchClosing = (text) => {
      pattern.lastIndex = 0
      const match = pattern.exec(text)
      if (!match) return null
      // Group 2 = optional owner/repo; group 3 = issue number (pattern captures prefix).
      return { repo: match[2] ?? null, issue: Number(match[3]) }
    }
    const firstIssueNumber = (text, thisRepo = null) => {
      const hit = matchClosing(text)
      if (!hit) return null
      // A foreign owner/repo prefix must not classify a local issue.
      if (hit.repo && thisRepo && hit.repo !== thisRepo) return null
      return hit.issue
    }
    // All nine GitHub closing keywords must resolve to the issue they close.
    for (const keyword of ['close', 'closes', 'closed', 'fix', 'fixes', 'fixed', 'resolve', 'resolves', 'resolved']) {
      expect(firstIssueNumber(`${keyword} #12`), `lowercase "${keyword}" missed`).toBe(12)
      const capitalized = keyword[0].toUpperCase() + keyword.slice(1)
      expect(firstIssueNumber(`${capitalized} #12`), `capitalized "${capitalized}" missed`).toBe(12)
    }
    // Same-repo fully-qualified form resolves; a foreign prefix must not.
    expect(firstIssueNumber('fixes richkuo/rk-skills#12', 'richkuo/rk-skills')).toBe(12)
    expect(firstIssueNumber('closes otherorg/other#12', 'richkuo/rk-skills')).toBeNull()
    expect(matchClosing('fixes otherorg/other#12').repo).toBe('otherorg/other')
    // A bare mention is not a closing relationship.
    expect(firstIssueNumber('see #12 for context')).toBeNull()
    expect(firstIssueNumber('reverts #12')).toBeNull()
    // #12 must never match #123 — the whole number is captured, so 123 stays 123.
    expect(firstIssueNumber('closes #123')).toBe(123)
  })

  test('resolves closed-predecessor merge state instead of assuming it', () => {
    // The severity table distinguishes closed-with-merged-PR from closed-without,
    // so step 1 must actually fetch the data that decides it.
    expect(body).toMatch(/closedByPullRequestsReferences/)
    expect(fencedBlocks(body).some((code) => /gh pr view <n> -R <owner>\/<repo> --json number,state,mergedAt/.test(code))).toBe(true)
    // Merge state decides, not the close reason.
    expect(body).toMatch(/Merge state is the deciding fact, not `stateReason`/)
    expect(body).toMatch(/NOT_PLANNED.*closing PR merged is still satisfied/is)
    // An undecidable edge is an unknown, never silently the blocking branch.
    expect(body).toMatch(/Never resolve an undecidable merge state to the blocking branch/i)
    expect(body).toMatch(/\| Merge state of a closed predecessor a \*\*runnable\*\* issue hard-depends on could not be determined \| \*\*NO-GO\*\*/)
  })

  test('targets the closing PR own repository, never a same-numbered local PR', () => {
    // `gh pr view 42` with no -R resolves THIS repo's PR 42, so a cross-repo closing
    // PR would be decided by an unrelated PR — a confident wrong verdict either way.
    const lookups = fencedBlocks(body).flatMap((code) => code.match(/gh pr view[^\n]*/g) ?? [])
    expect(lookups.length, 'no PR lookup found in the procedure').toBeGreaterThan(0)
    for (const lookup of lookups) {
      expect(lookup, `PR lookup with no -R: ${lookup}`).toMatch(/\s-R\s/)
    }
    // The repo has to come from the reference itself, not be guessed.
    expect(body).toMatch(/repository\.owner\.login.*repository\.name/is)
    // An unreadable cross-repo PR is an unknown, not a merge verdict.
    expect(body).toMatch(/cannot read is a \*\*blocking unknown\*\*/i)
    expect(body).toMatch(/\| A closed predecessor's closing PR lives in another repo \|/)
  })

  test('scopes blocking severity to the buckets the run actually dispatches', () => {
    // milestone-workflow drops closed issues and runs resume issues outside the
    // pipeline, so neither bucket's Execution block is ever read — a finding there
    // cannot decide the verdict, or one pre-convention closed issue blocks every re-run.
    expect(body).toMatch(/derive severity from the bucket the finding's owning issue sits in/i)
    expect(body).toMatch(/\| A \*\*runnable\*\* issue with no `## Execution` block \| \*\*NO-GO\*\*/)
    expect(body).toMatch(/\| \*\*Any row above whose owning issue sits in the skip bucket\*\*[^|]*\| \*\*Informational\*\*/)
    expect(body).toMatch(/\| \*\*Any NO-GO-class finding whose owning issue sits in the resume bucket or a \*Blocked — excluded\* subtree\*\*/)
    // The audit itself still covers the whole milestone — buckets are not decidable otherwise.
    expect(body).toMatch(/Audit every issue in the milestone/i)
    expect(body).toMatch(/every step-1 \*\*blocking unknown\*\*/)
    expect(body).toMatch(/incomplete fetch stays NO-GO regardless of buckets|those stay NO-GO regardless of buckets/i)
    // A resume finding is deferred, not resolved: it returns if the PR closes unmerged.
    expect(body).toMatch(/becomes blocking if that PR closes unmerged/i)
    // A cycle only forces NO-GO when every edge in it survives into the run.
    expect(body).toMatch(/\| A cycle across the union of both edge kinds, every issue in it runnable \| \*\*NO-GO\*\*/)
    expect(body).toMatch(/\| A cycle that includes any node the run will not dispatch \(skip, resume, \*Blocked — excluded\*, or \*\*out-of-milestone\*\*\) \| \*\*Informational\*\*/)
    expect(body).toMatch(/finding confined to the skip bucket, the resume bucket, or a \*Blocked — excluded\* subtree never produces this verdict/)
  })

  test('owns an edge finding by the endpoint the run dispatches, so demotion never claims cross-bucket edge rows', () => {
    // The cross-bucket edge rows (hard edge into resume, hard edge to a closed-unmerged
    // predecessor, open hard cross-milestone prerequisite) have a predecessor in skip or
    // resume BY DEFINITION — reading the predecessor as the finding's issue would demote
    // Blocked — excluded to Informational and dispatch the dependent against missing code.
    expect(body).toMatch(/An edge finding has two endpoints, and its owner is the endpoint this run would dispatch/)
    expect(body).toMatch(/[Nn]ever a cross-bucket edge row/)
    // The cross-bucket edge rows keep their severity under the demotion rule.
    expect(body).toMatch(/\| A hard edge into the resume bucket[^|]*\| \*\*Blocked — excluded\*\*/)
    expect(body).toMatch(/\| A \*\*hard\*\* edge to a predecessor closed with \*\*no\*\* PR, or with one closed unmerged \| \*\*Blocked — excluded\*\*/)
    expect(body).toMatch(/\| An open \*\*hard\*\* cross-milestone prerequisite \| \*\*Blocked — excluded\*\*/)
    // A single-issue finding on a skip- or resume-bucket issue still demotes.
    expect(body).toMatch(/A \*\*closed or resume-bucket\*\* issue has no Execution block \| Informational/)
    // Both endpoints in the build bucket: no finding exists for the demotion to touch.
    expect(body).toMatch(/both sit in the \*\*runnable\*\* build bucket is ordering the waves already handle/)
  })

  test('gives each closed-predecessor edge kind exactly one severity row', () => {
    // A hard edge needs the predecessor's code; an ordering-only edge only prevents
    // overlapping work, and a closed issue has no work left to overlap. An unqualified
    // duplicate row would exclude runnable issues over a constraint already met.
    const severityRows = [...body.matchAll(/^\| ([^|\n]*closed[^|\n]*) \| ([^|\n]+) \|/gm)].map(
      ([, finding, severity]) => ({ finding, severity: severity.trim() }),
    )
    // In-milestone closed-unmerged / no-PR rows only — cross-milestone closed rows are a
    // separate class and must not inflate this count.
    const closedUnmerged = severityRows.filter(
      (r) =>
        /no\*\* PR|closed unmerged|without a merged PR/.test(r.finding) &&
        !/cross-milestone/i.test(r.finding),
    )
    expect(closedUnmerged.length, 'expected one row per edge kind').toBe(2)
    expect(closedUnmerged.filter((r) => /\*\*Blocked — excluded\*\*/.test(r.severity)).length).toBe(1)
    expect(closedUnmerged.every((r) => /\*\*hard\*\*|\*\*ordering-only\*\*/i.test(r.finding))).toBe(true)
    // Closed predecessor whose closing PR is still open — its own pair of rows, not
    // routed through resume (the predecessor is skip-bucket).
    expect(body).toMatch(/\| A \*\*hard\*\* edge to a closed predecessor whose closing PR is still \*\*open\*\* \| \*\*Blocked — excluded\*\*/)
    expect(body).toMatch(/with a closing PR still open \| \*no finding\*/)
    expect(body).toMatch(/do \*\*not\*\* route this through the resume-bucket rows/)
    expect(body).toMatch(/An ordering-only edge to a closed predecessor is satisfied whether or not its PR merged/)
    expect(body).toMatch(/none of them falls through the rules, and none of them lands in two/)
  })

  test('fetches out-of-milestone referenced issues before scoring their edges', () => {
    // Absence from the milestone fetch must not be scored as "does not exist".
    expect(body).toMatch(/Fetch every referenced issue that is not already in the milestone set/)
    expect(body).toMatch(/gh issue view <n> --json number,title,state,stateReason,milestone,body,closedByPullRequestsReferences/)
    expect(body).toMatch(/repeat until no new numbers appear/)
    expect(body).toMatch(/closed dependency closure reachable from this milestone/)
    expect(body).toMatch(/never treat absence-from-the-milestone-fetch as "does not exist"/)
    expect(body).toMatch(/\| An out-of-milestone referenced issue could not be fetched[^|]*\| \*\*NO-GO\*\*/)
    expect(body).toMatch(/never score an unfetched reference as nonexistent/)
  })

  test('does not flag fableplan: No on Cap-2 when the build is already Fable 5', () => {
    expect(body).toMatch(/`fableplan: No` on a Capability-2 issue \*\*whose build model is not already Fable 5\*\*/)
    expect(body).toMatch(/planning inherent — the same "No \(planning inherent\)"/)
    expect(body).toMatch(/Cap-2 \+ Opus with `fableplan: No` stays a finding/)
  })

  test('routes stamp recommendations for excluded build-bucket issues, not only runnable ones', () => {
    expect(body).toMatch(/runnable, \*Blocked — excluded\*, or resume-bucket/)
    expect(body).toMatch(/Excluded issues re-enter the runnable set once their blocker clears/)
    expect(body).toMatch(
      /Field contradictions on \*\*skip\*\*-bucket issues take severity `Informational` and `Recommended fix: none — never re-enters`/,
    )
  })

  test('prints the per-model agent mix in the report template', () => {
    const template = body.match(/```\n<milestone> — [\s\S]*?\n```/)
    expect(template, 'no report template found').not.toBeNull()
    expect(template[0]).toMatch(/^Per-model mix/m)
    expect(body).toMatch(/Report the per-model agent mix/)
  })

  test('prints concurrency and the token threshold in the report template', () => {
    const template = body.match(/```\n<milestone> — [\s\S]*?\n```/)
    expect(template, 'no report template found').not.toBeNull()
    expect(template[0]).toMatch(/^Concurrency:/m)
    expect(template[0]).toMatch(/token Large-workflow at 1\.5M/)
    expect(template[0]).toMatch(/token target:/)
    expect(template[0]).toMatch(/<worst> <worst-label>/)
    expect(body).toMatch(/widest wave, which is roughly the peak parallel agent count/)
    expect(body).toMatch(/1\.5 million/)
  })

  test('defines the template worst slot under every review mode', () => {
    expect(body).toMatch(/labeled `subagent review worst case`/)
    expect(body).toMatch(/labeled `github \(= planned\)`/)
    expect(body).toMatch(/labeled `review off \(= planned\)`/)
    expect(body).toMatch(/Never leave the third slot blank and never fill it with the subagent figure/)
  })

  test('projects the token-target deferral milestone-workflow enforces', () => {
    expect(body).toMatch(/Token-target deferral/)
    expect(body).toMatch(/budgetFloor/)
    expect(body).toMatch(/budget_deferred/)
    expect(body).toMatch(/including the token-target \/ `budgetFloor` deferral bullet/)
    expect(milestoneWorkflow).toMatch(/budgetFloor/)
  })

  test('scopes Fable low the same way in execution-plan-review as milestoneplan', () => {
    expect(executionPlanReview).toMatch(
      /Revision would put a Fable build's effort at `low` \| Allowed only on Capability 3 with Volume ≤ 7 \(`\[C75\]`–`\[C82\]`\)/,
    )
    expect(body).toMatch(/Fable build stamped `low` is the discretionary Fable-only tier only on \*\*Capability 3\*\* with Volume ≤ 7/)
    expect(body).toMatch(/\| A Fable build is stamped `low` outside Capability 3, or at Capability 3 with Volume > 7 \| Under-tertile finding/)
  })

  test('covers cycles through out-of-milestone nodes and ordering-only edges into excluded predecessors', () => {
    expect(body).toMatch(/out-of-milestone\*\*\) \| \*\*Informational\*\*/)
    expect(body).toMatch(
      /\| An \*\*ordering-only\*\* edge into a \*Blocked — excluded\* build-bucket predecessor \| \*no finding\*/,
    )
    expect(body).toMatch(/An ordering-only edge into a \*Blocked — excluded\* build-bucket predecessor \| Satisfied/)
  })

  test('marks excluded build rows distinctly from runnable ones in the table', () => {
    expect(body).toMatch(/`build` for runnable, `build \(excluded\)` for a \*Blocked — excluded\* subtree member/)
    expect(body).toMatch(/never present a closed, resume, excluded, or external row as pending pipeline work/i)
  })

  test('treats a missing ordering field with no implied edge as Non-blocking, not NO-GO', () => {
    expect(body).toMatch(
      /\| `Depends on` \/ `Runs after` missing, and the prose implies \*\*no\*\* edge of that kind \| \*\*Non-blocking\*\*/,
    )
    expect(body).toMatch(
      /\| `Depends on` \/ `Runs after` missing, and the prose gestures at a dependency but does not establish the edge \*\*kind\*\* \| \*\*Non-blocking\*\*/,
    )
    expect(body).toMatch(/satisfied empty graph/)
    expect(body).toMatch(/Ordering fields missing and prose implies no edge of that kind/)
    expect(body).toMatch(/flag for plan review the same way `milestone-workflow` step 1 does; never NO-GO/)
  })

  test('disposes closed cross-milestone predecessors instead of treating them as satisfied', () => {
    expect(body).toMatch(
      /\| A \*\*closed\*\* \*\*hard\*\* cross-milestone predecessor whose PR \*\*merged\*\* \| \*\*Non-blocking\*\*/,
    )
    expect(body).toMatch(
      /\| A \*\*closed\*\* \*\*hard\*\* cross-milestone predecessor with \*\*no\*\* merged PR/,
    )
    expect(body).toMatch(
      /\| A \*\*closed\*\* \*\*ordering-only\*\* cross-milestone predecessor \(merged or not\) \| \*\*Non-blocking\*\*/,
    )
    expect(body).toMatch(
      /\| A predecessor \*\*inside this milestone\*\* closed \*\*with\*\* a merged PR[^|]*\| \*no finding\*/,
    )
    expect(body).toMatch(/Never exclude: ordinary v1\+ milestones/)
    expect(body).toMatch(/A hard `Depends on` names a closed issue outside this milestone whose PR \*\*merged\*\*/)
  })

  test('treats ambiguous-kind edges as ordering-only until stamped', () => {
    expect(body).toMatch(/ambiguous-kind edge[\s\S]*enters the union as \*\*ordering-only\*\*/i)
    expect(body).toMatch(/Ambiguous-kind edges are not hard edges/)
    expect(body).toMatch(/Until stamped, step 3 treats the edge as \*\*ordering-only\*\*/)
  })

  test('prints external predecessors in the per-issue table', () => {
    expect(body).toMatch(/plus one context row per distinct out-of-milestone predecessor/)
    expect(body).toMatch(/`external` for an out-of-milestone predecessor/)
  })

  test('routes resume-bucket stamp findings as recommendations, not only notes', () => {
    expect(body).toMatch(/runnable, \*Blocked — excluded\*, or resume-bucket/)
    expect(body).toMatch(/resume issues return to the build bucket if their PR closes unmerged/)
    expect(body).toMatch(/\*\*Resume bucket\*\* → \*\*Informational\*\* for any finding that would be \*\*NO-GO\*\*/)
    // Non-blocking findings never escalate on re-entry, so no bullet may attach a
    // "becomes blocking" note to them — re-entry notes belong to demoted NO-GO-class
    // findings only (the Informational row's effect column).
    expect(body).toMatch(/Stamp\/band contradictions and other Non-blocking findings keep \*\*Non-blocking\*\* so step 6's recommendations still land\. Its PR runs through/)
    expect(body).not.toMatch(/`Non-blocking` with the re-entry named/)
    expect(body).not.toMatch(/for resume, name the re-entry/)
    expect(body).not.toMatch(/keep the recommendation \(step 6\) and name the re-entry/)
    expect(body).toMatch(/A \*\*resume-bucket\*\* stamp\/band contradiction \| Non-blocking/)
    expect(body).toMatch(
      /Field contradictions on \*\*skip\*\*-bucket issues take severity `Informational` and `Recommended fix: none — never re-enters`/,
    )
  })

  test('labels the per-model mix with the run-size bound it covers', () => {
    const template = body.match(/```\n<milestone> — [\s\S]*?\n```/)
    expect(template, 'no report template found').not.toBeNull()
    expect(template[0]).toMatch(/^Per-model mix \(<bound: planned \| retry-aware \| worst>\):/m)
    expect(body).toMatch(/Compute and label the mix over the same bound/)
    expect(body).toMatch(/retry-aware ceiling's validate retries place under \*\*Fable 5\*\*/)
  })

  test('exempts every step-1 blocking unknown from bucket demotion', () => {
    expect(body).toMatch(/every step-1 \*\*blocking unknown\*\*/)
    expect(body).toMatch(/step-1 blocking unknowns excepted \(incomplete fetch, failed\/throttled\/truncated open-PR query, undecidable linked-reference openness, unfetched out-of-milestone reference\)/)
    expect(body).toMatch(/demotion conditioned on a bucket must never apply to a finding that says the bucket cannot be known/)
  })

  test('gives Blocked-excluded findings a stated deferred severity', () => {
    expect(body).toMatch(/\*\*Blocked — excluded build-bucket issue\*\* → \*\*Informational\*\* for any finding that would be \*\*NO-GO\*\*/)
    expect(body).toMatch(
      /\| \*\*Any NO-GO-class finding whose owning issue sits in the resume bucket or a \*Blocked — excluded\* subtree\*\*/,
    )
    expect(body).toMatch(/A \*\*Blocked — excluded\*\* issue has no Execution block/)
    expect(body).toMatch(/finding confined to the skip bucket, the resume bucket, or a \*Blocked — excluded\* subtree never produces this verdict/)
  })

  test('gives both resume-bucket edge kinds a disposition and sequences their cost', () => {
    // milestone-workflow runs resume loops to completion BEFORE the pipeline, which
    // is what satisfies an ordering-only edge into that bucket.
    expect(body).toMatch(/\| An \*\*ordering-only\*\* edge into the resume bucket \| \*\*Informational\*\*/)
    expect(body).toMatch(/ordering-only edge into resume is \*satisfied by sequencing\*, not blocked/)
    expect(body).toMatch(/to completion before the pipeline starts|to completion \*\*before invoking the pipeline\*\*/)
    // The reported cost must carry that sequencing, or the number reads as concurrent.
    expect(body).toMatch(/sequenced ahead of it/)
  })

  test('the model-attribution table names a model for every row, prep included', () => {
    // Scope to the attribution table itself — other two-column tables in this doc
    // legitimately name skills rather than models.
    const table = body.match(/\| Projected agent \| Model it actually runs on \|\n\|[-| ]+\|\n((?:\|.*\n)+)/)
    expect(table, 'no model-attribution table found').not.toBeNull()
    const rows = [...table[1].matchAll(/^\| ([^|]+?) \| (.+?) \|$/gm)]
    expect(rows.length).toBeGreaterThanOrEqual(7)
    for (const [, agent, model] of rows) {
      expect(model, `"${agent.trim()}" names no model`).toMatch(/Fable|Opus|Sonnet|Build model|session model/)
    }
    // Prep passes no model, so it inherits the session model — say so, don't call it cheap.
    expect(body).toMatch(/\| Prep \(once for the whole run\) \| \*\*the session model\*\*/)
    expect(body).toMatch(/the pipeline passes no `model`/)
  })

  test('attributes each projected agent to the model the pipeline dispatches it on', () => {
    // Validate and plan are always Fable; the first review defaults to Opus. None
    // of those come from the issue's Build model, which the mix used to assume.
    expect(body).toMatch(/\| Validate \(every issue\) \| \*\*always Fable 5\*\*/)
    expect(body).toMatch(/\| Plan \(`fableplan: Yes` issues\) \| \*\*always Fable 5\*\*/)
    expect(body).toMatch(/First review, `reviewMode: 'subagent'`.*\*\*defaulting to Opus\*\*/)
    expect(body).toMatch(/Re-review after a fix pass that cleared only non-blocking findings, subagent mode \| \*\*Sonnet\*\*/)
    expect(body).toMatch(/\| Implement \| the issue's \*\*Build model\*\* \|/)
    expect(body).toMatch(/reviewLoop: false.*no reviewer or fixer model enters the mix/is)
  })

  test('attributes the github-mode review loop to the Build model, not to Opus', () => {
    // In github mode the pipeline dispatches the single review-loop agent with the
    // issue's Build model, so a per-term attribution that names Opus for every review
    // misreports the whole mix on that mode.
    expect(body).toMatch(/\| The single `review-loop` agent, `reviewMode: 'github'` \| the issue's \*\*Build model\*\*/)
    expect(body).toMatch(/`PR review:` model is \*never read\* in this mode/)
    // The mode has to be named before the model, and the step 4 term has to carry it too.
    expect(body).toMatch(/name the mode before naming the model/i)
    expect(body).toMatch(/attribute that single agent to the issue's \*\*Build model\*\*, not to Opus/)
    // The @claude Action is not a pipeline agent, so it is outside the projected counts.
    expect(body).toMatch(/`@claude` GitHub Action, which is not a pipeline agent/)
    // The two modes must not report the same mix.
    expect(body).toMatch(/no Opus reviewer in the mix at all/)
  })

  test('derives Capability and Volume from the score rather than the rationale line', () => {
    expect(body).toMatch(/Capability = floor\(score \/ 25\)/)
    expect(body).toMatch(/Volume = score mod 25/)
    expect(body).toMatch(/never suppresses the effort check/i)
  })

  test('marks a missing field as missing rather than inferring it', () => {
    // "missing" and "none" produce different findings, so the parse must carry the
    // distinction instead of collapsing absence into a default.
    expect(body).toMatch(/Parse, never infer, when the field is present/)
    expect(body).toMatch(/explicit `none` is authoritative/)
    expect(body).toMatch(/"missing" and "none" are different cells, and they produce different findings/)
    expect(body).toMatch(/never blank, never a guessed default/)
  })

  test('routes each finding class to a skill whose write scope covers it', () => {
    // execution-plan-review edits only Execution block lines, so body-content
    // findings routed there would be handed to a skill that cannot clear them.
    expect(body).toMatch(/Body-content findings.*`validate-issue`/s)
    expect(body).toMatch(/`execution-plan-review` cannot clear any of these/)
    expect(body).toMatch(/Editing issue body prose or the title's `\[C<score>\]` prefix \| `validate-issue`/)
  })

  test('audits stamps against the band table and separates overrides from slips', () => {
    expect(body).toMatch(/\| Capability \| Score \| Build model \| fableplan \|/)
    expect(body).toMatch(/deliberate override/i)
    expect(body).toMatch(/unexplained under-band departure is a finding/i)
    // The pipeline raises non-Fable low/medium and logs it; the audit must say the stamp lies.
    expect(body).toMatch(/non-Fable build stamped `low`\/`medium`/i)
    expect(body).toMatch(/pipeline raises these to `high` and \*\*logs\*\* the normalization/i)
    expect(body).toMatch(/`Plan effort` on a `fableplan: No` issue.*inert/is)
    // Build-effort tertile is one-sided: under = finding, over = observation.
    expect(body).toMatch(/\*\*build\*\* effort \*below\* the Volume tertile/i)
    expect(body).toMatch(/never above — over-tertile is an observation/i)
    expect(body).toMatch(/Validate effort and Plan effort are judged by their own rules/i)
    // A Fable build at `low` is the sanctioned discretionary tier — never a finding.
    expect(body).toMatch(/Fable build stamped `low` is the discretionary Fable-only tier only on \*\*Capability 3\*\* with Volume ≤ 7/i)
    expect(body).toMatch(/`\[C75\]`–`\[C82\]`/)
    expect(body).toMatch(/Fable `low` on any other Capability band or on Capability 3 at higher Volume is under-tertile/)
    expect(body).toMatch(/\| A Fable build is stamped `low` at Capability 3 with Volume ≤ 7/)
    expect(body).toMatch(/\| A Fable build is stamped `low` outside Capability 3, or at Capability 3 with Volume > 7 \| Under-tertile finding/)
    // Over-band is the pipeline's own default for a missing Execution block.
    expect(body).toMatch(/model fable, effort high/)
  })

  test('treats the band as a floor — under-band is a finding, over-band never a downgrade', () => {
    expect(body).toMatch(/The band is a floor, not a ceiling/i)
    expect(body).toMatch(/no hard ceilings — the band \*is\* the floor/)
    expect(body).toMatch(/under-band build model.*is a finding/is)
    expect(body).toMatch(/under-tertile \*\*build\*\* effort is a finding/i)
    expect(body).toMatch(/over-band build model or an over-tertile build effort is an \*\*observation\*\*, never a downgrade recommendation/i)
    // Quiet overspend is deliberately NOT a finding — the per-model mix already carries the cost.
    expect(body).toMatch(/quiet overspend on a non-safety issue already shows up in the per-model mix/i)
    // Safety carve-outs force the capable path, so a downgrade is never recommended there.
    expect(body).toMatch(/Never recommend dropping the model \*\*or\*\* the build effort on an issue whose body touches those surfaces/i)
    // An observation is not a severity: it needs a report section and must own no table row.
    expect(body).toMatch(/over-band build model or over-tertile build effort is not in this table at all/i)
    const severityTable = body.match(/\| Finding \| Severity \| Because \|\n\|[-| ]+\|\n((?:\|.*\n)+)/)
    expect(severityTable, 'no severity table found').not.toBeNull()
    expect(severityTable[1], 'over-band must not carry a severity').not.toMatch(/over-band/i)
    // Over-band and annotated overrides print NOTHING — not a finding, not a row class.
    expect(findingsSeverities(body), 'over-band must not be a findings row class').not.toContain('Over-band')
    expect(findingsSeverities(body), 'override must not be a findings row class').not.toContain('Override')
    expect(body).toMatch(/Over-band observations and annotated deliberate overrides are not in this table at all/)
    expect(body).toMatch(/print nothing for it — never a finding, never a row/)
    // The two no-stamp row classes have defined Recommended-fix values, never improvised.
    expect(body).toMatch(/`none — unblocks when PR #X merges`/)
    expect(body).toMatch(/`none — never re-enters`/)
    expect(body).toMatch(/`none — satisfied by sequencing`/)
    expect(body).toMatch(/`none — not dispatched this run` plus the re-entry condition/)
    // The failure-mode table must agree with the floor rule, not call it a defect.
    expect(body).toMatch(/\| An issue is stamped a model or build effort above its band \/ Volume tertile \| Observation, never a downgrade recommendation/)
  })

  test('applies the documented Validate effort rules, not only the xhigh ban', () => {
    // Vocabulary, default, Cap-0 Volume≤7 medium, and unlogged low→medium coercion.
    expect(body).toMatch(/vocabulary is only `medium \| high`/i)
    expect(body).toMatch(/never `xhigh`/i)
    expect(body).toMatch(/`low` is outside the vocabulary/i)
    expect(body).toMatch(/prep schema maps `low→medium` with no runtime log/i)
    expect(body).toMatch(/default is high/i)
    expect(body).toMatch(/`medium` is on-rule only for Capability 0 with Volume ≤ 7/i)
    expect(body).toMatch(/`\[C90\]` at `medium` is off-rule/)
    // Logged vs unlogged distinction: xhigh/non-Fable raise log; Validate low→medium does not.
    expect(body).toMatch(/runtime \*\*logs\*\* those two normalizations to `high`/)
    expect(body).toMatch(/Validate-effort `low` is mapped `low→medium` by the prep schema with no runtime log/)
    // The severity table still carries the stamp-lies class the ban belongs to.
    expect(body).toMatch(/`Validate effort: xhigh`/)
  })

  test('the band table agrees with validate-issue and prd-to-issues copies', () => {
    const canonical = bandTable(validateIssue)
    const planCopy = bandTable(milestoneplan)
    const stampCopy = bandTable(prdToIssues)
    expect(canonical, 'validate-issue publishes no extractable band table').not.toBeNull()
    expect(planCopy, 'milestoneplan publishes no extractable band table').not.toBeNull()
    expect(stampCopy, 'prd-to-issues publishes no extractable band table').not.toBeNull()
    // The audit's entire correctness basis is this table. Compare each consumer
    // copy to the canonical source — either drifting fails, including the copy
    // that stamps every issue this skill later audits.
    expect(planCopy).toEqual(canonical)
    expect(stampCopy).toEqual(canonical)
    // Guard the extraction itself: a silently-empty match would make the compare vacuous.
    expect(canonical).toHaveLength(4)
    expect(canonical.map((band) => band.capability)).toEqual([0, 1, 2, 3])
    expect(canonical.find((band) => band.capability === 2).fableplan).toBe(true)
    expect(canonical.find((band) => band.capability === 3).model).toBe('Fable')
    // Floor + carve-out qualifiers must travel with the table, or a future edit to
    // validate-issue's carve-out leaves a stale copy green.
    const carveOut =
      /Safety carve-outs \(money, data integrity, security, auto-protective\) remain absolute overrides in consumers that already have them — they force the capable path when flagged even if Risk was under-scored\./
    expect(validateIssue, 'validate-issue lost its carve-out sentence').toMatch(carveOut)
    expect(milestoneplan, 'milestoneplan must copy the carve-out sentence verbatim').toMatch(carveOut)
    expect(milestoneplan).toMatch(/no hard ceilings — the band \*is\* the floor/)
    expect(validateIssue).toMatch(/no hard ceilings — the band \*is\* the floor/)
  })

  test('derives waves and projects run size on the same accounting as milestone-workflow', () => {
    const workflowFormula = runSizeFormula(milestoneWorkflow)
    const planFormula = runSizeFormula(milestoneplan)
    expect(workflowFormula, 'milestone-workflow publishes no extractable run-size formula').not.toBeNull()
    expect(planFormula, 'milestoneplan publishes no extractable run-size formula').not.toBeNull()
    // Parity, not two independent literals: adding a term to either formula fails here.
    expect(planFormula.terms).toBe(workflowFormula.terms)
    // milestoneplan sums the build bucket, not the milestone's full issue list.
    expect(planFormula.scope).toMatch(/build.bucket/i)
    expect(body).toMatch(/retry-aware ceiling.*runnable-set issue count/is)
    expect(body).toMatch(/more than 25 scheduled agents/i)
    expect(body).toMatch(/critical path/i)
    expect(body).toMatch(/waves/i)
  })

  test('carries milestone-workflow\'s review worst case and states what it projected under', () => {
    const workflowWorstCase = reviewWorstCase(milestoneWorkflow)
    const planWorstCase = reviewWorstCase(milestoneplan)
    expect(workflowWorstCase, 'milestone-workflow publishes no review worst case').not.toBeNull()
    // The happy-path `1 review-loop` term alone understates a subagent-mode run.
    expect(planWorstCase, 'milestoneplan omits the subagent review worst case').toBe(workflowWorstCase)
    // github mode nests that work in one agent, so the worst case must not be applied there.
    expect(body).toMatch(/reviewMode: 'github'[\s\S]*?must \*\*not\*\* be applied/)
    expect(body).toMatch(/reviewLoop: false.*review term is zero/is)
    // Assumptions are part of the answer — a bound without them is unreadable.
    expect(body).toMatch(/reviewLoop: true.*reviewMode: 'subagent'.*maxReviewCycles: 5/s)
    // Resume-bucket fix-pr-review-loop agents fall outside the build-bucket sums but still cost.
    expect(body).toMatch(/resume-bucket[\s\S]*?fix-pr-review-loop[\s\S]*?outside the build-bucket sums/)
    // The token trigger milestone-workflow reports, which this projection must not omit.
    expect(body).toMatch(/1\.5 million/)
  })

  test('classifies issues into the same buckets milestone-workflow uses', () => {
    expect(body).toMatch(/\*\*build\*\* \(open, no PR\)/)
    expect(body).toMatch(/\*\*resume\*\* \(open with an open PR that closes it\)/)
    expect(body).toMatch(/\*\*skip\*\* \(closed\)/)
    // A mention is not a resume-bucket PR — only a closing relationship is.
    expect(body).toMatch(/A bare mention with no keyword is not a resume-bucket PR/i)
  })

  test('maps every finding class to one severity matching what milestone-workflow does', () => {
    expect(body).toMatch(/GO \| GO WITH FINDINGS \| NO-GO/)
    expect(body).toMatch(/maps to exactly one severity/i)
    expect(body).toMatch(/NO-GO.*Never offer the run/is)
    // A blocked subtree is excluded and run around — milestone-workflow runs the rest.
    expect(body).toMatch(/Blocked — excluded/)
    expect(body).toMatch(/blocked subtree never suppresses the rest of the run/i)
    // NO-GO survives only where nothing is runnable, or a real NO-GO class is present.
    expect(body).toMatch(/exclusions empty the runnable set/i)
    expect(body).toMatch(/independent cycle still forces NO-GO/i)
    // Cross-milestone prerequisites get a named severity per edge kind, not silence.
    expect(body).toMatch(/open \*\*hard\*\* cross-milestone prerequisite/i)
    expect(body).toMatch(/open \*\*ordering-only\*\* cross-milestone prerequisite/i)
    // A merged predecessor PR is a satisfied edge, not a finding.
    expect(body).toMatch(/predecessor \*\*inside this milestone\*\* closed \*\*with\*\* a merged PR.*no finding/is)
  })

  test('every severity the table can assign has a row class in the findings table', () => {
    // Structural, not a grep for the claim: a severity added to the table later must
    // fail here until the findings table's Severity vocabulary gains somewhere to print
    // it. Without this, the Informational severity the bucket-scoping rule emits
    // vanished from the report.
    const table = body.match(/\| Finding \| Severity \| Because \|\n\|[-| ]+\|\n((?:\|.*\n)+)/)
    expect(table, 'no severity table found').not.toBeNull()
    const severities = new Set(
      [...table[1].matchAll(/^\|[^|\n]+\|([^|\n]+)\|/gm)].map(([, cell]) => cell.replace(/\*/g, '').trim()),
    )
    expect(severities.size, 'severity extraction is vacuous').toBeGreaterThan(2)
    const rowClasses = findingsSeverities(body)
    expect(rowClasses, 'no findings-table severity vocabulary found').not.toBeNull()
    expect(rowClasses.length, 'row-class extraction is vacuous').toBeGreaterThan(2)
    // A NO-GO finding prints as Blocking; a *no finding* row prints nowhere.
    const classFor = { 'NO-GO': 'Blocking', 'no finding': null }
    for (const severity of severities) {
      const expected = severity in classFor ? classFor[severity] : severity
      if (expected === null) continue
      expect(
        rowClasses.includes(expected),
        `severity "${severity}" has no row class in the findings table (classes: ${rowClasses.join(' / ')})`,
      ).toBe(true)
    }
    expect(body).toMatch(/A severity with no row class is a finding that silently vanishes/)
  })

  test('mandates both tables in every report', () => {
    // The report is a decision aid: findings and per-issue rows are scanned by column,
    // never reconstructed from prose. A clean milestone still prints both.
    expect(body).toMatch(/Every report renders two markdown tables, always, with no exceptions/)
    expect(body).toMatch(/Never render either as prose, as bullet lists, or as a code block/)
    expect(body).toMatch(/A milestone with no findings still prints the findings table's header/)
    expect(body).toMatch(/Then the \*\*per-issue table\*\*, always, even when the findings table is empty/)
    // Column contracts, so a table cannot be printed with the columns silently dropped.
    // Each template must be a REAL markdown table (header + separator row, edge pipes),
    // never a fenced single-line header — the example must render as what the prose mandates.
    expect(body).toMatch(/^\| Severity \| # \| Finding \| Recommended fix \| Route \|\n\|(?:---\|){5}$/m)
    expect(body).toMatch(/^\| # \| State \| Bucket \| C \| Depends on \| Runs after \| Build \| Effort \| Validate \| fableplan \| Plan \| 1st review \|\n\|(?:---\|){12}$/m)
    // A clean milestone prints the header and separator with NO rows beneath — never a
    // placeholder row, which would have to violate its own columns' value contracts.
    expect(body).toMatch(/header and separator row with no rows beneath/)
    expect(body, 'a placeholder row cannot satisfy the column contracts').not.toMatch(/\| — \| — \| none \| — \| — \|/)
    // The all-clear is carried by the no-rows line instead, which is prose.
    expect(body).toMatch(/When the table is empty, that line names all four/)
    // Routing sentences must point at destinations that exist — the report has no
    // *Deliberate overrides* or bare *Blocked* section; excluded subtrees route to
    // `Blocked — excluded` rows and annotated overrides print nothing at all.
    expect(body).not.toMatch(/Deliberate overrides/)
    expect(body).not.toMatch(/report them under \*Blocked\*/)
    expect(body).toMatch(/report them as findings-table `Blocked — excluded` rows/)
    // Every score-derived recommendation carries its derivation, so the fix is
    // checkable without recomputing the score.
    expect(body).toMatch(/followed in parentheses by the band\/tertile derivation/)
    // The empty-table line's "names all N" count must track the live vocabulary size,
    // not a number that can go stale when a severity is added or removed.
    const spelledOut = { four: 4, five: 5, six: 6, seven: 7 }
    const emptyLine = body.match(/that line names all (four|five|six|seven)/)
    expect(emptyLine, 'empty-table no-rows sentence not found').not.toBeNull()
    expect(
      spelledOut[emptyLine[1]],
      `line says "all ${emptyLine[1]}" but the Severity vocabulary has ${findingsSeverities(body).length} entries`,
    ).toBe(findingsSeverities(body).length)
    // Every no-value cell has a defined form — `add — …` or `none — …`, never improvised.
    expect(body).toMatch(/`add — <what is missing>`/)
    expect(body).toMatch(/`add — acceptance criteria`/)
    expect(body).toMatch(/`none — <what disposes of the finding>`/)
    // The Route vocabulary is exactly step 6's fix owners — no third destination.
    expect(body).toMatch(/- \*\*Route\*\* — the skill that owns the fix, per step 6: `execution-plan-review`, `validate-issue`, or `—`/)
    expect(body).toMatch(/step 6's only two fix owners; never route a finding anywhere else/)
    for (const column of ['Severity', '#', 'Finding', 'Recommended fix', 'Route']) {
      expect(body, `findings-table column "${column}" is undefined`).toMatch(
        new RegExp(`^- \\*\\*${column.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\*\\* —`, 'm'),
      )
    }
  })

  test('every finding class step 2 enumerates has a severity row — derived from step 2, not restated', () => {
    // Derive the class list from step 2's own flag lists, so a class added later is
    // visible to this test without anyone remembering to append it here. Matching is by
    // shared distinctive stems between a flag item and a single table row (or the
    // documented exemption paragraph) — coarse, but a new finding class introduces new
    // vocabulary, and a hardcoded pattern list is blind to it by construction.
    const stepTwo = body.match(/### 2\. Audit each issue([\s\S]*?)### 3\./)
    expect(stepTwo, 'no step 2 section found').not.toBeNull()
    const flagLists = [
      stepTwo[1].match(/\*\*\(a\) Completeness\.\*\* ([^\n]+)/)?.[1],
      ...[...stepTwo[1].matchAll(/(?:Also flag|Flag): ([^\n]+)/g)].map(([, items]) => items),
    ].filter(Boolean)
    expect(flagLists.length, 'no flag lists found in step 2').toBeGreaterThanOrEqual(3)
    // Split on top-level semicolons only — a parenthetical may contain `;` without
    // ending a finding class (e.g. step 2(b)'s over-band observation clause).
    const splitTopLevel = (list) => {
      const items = []
      let depth = 0
      let start = 0
      for (let i = 0; i < list.length; i++) {
        const c = list[i]
        if (c === '(' || c === '[' || c === '{') depth++
        else if (c === ')' || c === ']' || c === '}') depth = Math.max(0, depth - 1)
        else if (c === ';' && depth === 0 && /^\s+\S/.test(list.slice(i + 1))) {
          items.push(list.slice(start, i).trim())
          const ws = list.slice(i + 1).match(/^\s+/)[0].length
          start = i + 1 + ws
          i = start - 1
        }
      }
      items.push(list.slice(start).trim())
      return items.filter(Boolean)
    }
    const items = flagLists
      .flatMap(splitTopLevel)
      .map((item) => item.trim().replace(/\.$/, ''))
      // An item that disposes of itself inline is not a class in need of a row.
      .filter((item) => !/not a finding|informational/i.test(item))
    // Exact count pins the split: a mid-parenthetical chop or a dropped class moves it.
    expect(items).toHaveLength(24)
    const stem = (word) => word.toLowerCase().replace(/(?:ing|ed|es|s)$/, '').replace(/e$/, '')
    const STOP = new Set(['issu', 'that', 'with', 'whos', 'from', 'either', 'both', 'what', 'will'])
    const tokens = (text) => [
      ...new Set(
        text.replace(/[`*_#]/g, ' ').split(/[^a-zA-Z]+/).map(stem).filter((t) => t.length >= 4 && !STOP.has(t)),
      ),
    ]
    const tableMatch = body.match(/\| Finding \| Severity \| Because \|\n\|[-| ]+\|\n((?:\|.*\n)+)/)
    expect(tableMatch, 'no severity table found').not.toBeNull()
    const exemption = body.match(/Two classes from step 2[^\n]+/)
    expect(exemption, 'no exemption paragraph found').not.toBeNull()
    const rows = [...tableMatch[1].split('\n').filter(Boolean), exemption[0]].map(tokens)
    for (const item of items) {
      const itemTokens = tokens(item)
      const needed = Math.min(2, itemTokens.length)
      const matched = rows.some((row) => itemTokens.filter((t) => row.includes(t)).length >= needed)
      expect(matched, `no severity row shares ${needed} stems with the step-2 class: "${item}"`).toBe(true)
    }
    // The two classes that intentionally resolve through other rows say so.
    expect(body).toMatch(/hard predecessors all sit in a \*\*later\*\* milestone is the open-hard-cross-milestone row/)
    expect(body).toMatch(/reported through those dependents' own closed-predecessor edge rows/)
    // The two rationale-line classes used to fall through with no row at all.
    expect(body).toMatch(/\| A runnable issue with no complexity rationale line \| \*\*Non-blocking\*\*/)
    expect(body).toMatch(/\| A rationale line whose published Volume contradicts `score mod 25` \| \*\*Non-blocking\*\*/)
  })

  test('never reads an empty closing-PR reference as proof there was no PR', () => {
    // Absence of a record is not evidence of the negative — the same rule the rest of
    // step 1 already applies to a failed lookup.
    expect(body).toMatch(/An empty `closedByPullRequestsReferences` is not proof that no PR closed the issue/)
    // The field does report merged PRs — that part was checked, so say which way it went.
    expect(body).toMatch(/field \*does\* report merged closing PRs — verified/)
    // Corroborate from the issue's own timeline before excluding — bounded per issue.
    expect(fencedBlocks(body).some((code) => /CROSS_REFERENCED_EVENT/.test(code))).toBe(true)
    expect(body).toMatch(/Nothing in a \*\*complete\*\* cross-reference sweep names a merged PR → "closed with no PR" is now \*established\*/)
    expect(body).toMatch(/could not be paged to completion → \*\*indeterminate\*\*/)
    expect(body).toMatch(/Never exclude a subtree on an absence you could not verify/)
  })

  test("bounds merge-state resolution by the milestone, never the repository's history", () => {
    const blocks = fencedBlocks(body)
    // The repo-wide merged-PR list is the thing being avoided: merged PRs accumulate
    // monotonically, so its cost grows with the repository's total history, and a repo
    // the limit escalation cannot cover turns "too much history" into NO-GO.
    expect(blocks.some((code) => /gh pr list --state merged/.test(code))).toBe(false)
    expect(body).toMatch(/No fetch in this step grows with the repository's history/)
    expect(body).toMatch(/never declared unrunnable because the repository has too many merged pull requests/)
    // The bounded substitute: distinct closing PRs on hard-edge closed predecessors,
    // resolved in one batched aliased GraphQL query per ~50.
    expect(body).toMatch(/distinct closing PR numbers\*\* across the closed predecessors that build-bucket issues hard-depend on/)
    expect(blocks.some((code) => /pullRequest\(number:\d+\)\{ number state mergedAt \}/.test(code))).toBe(true)
    // Cross-repo references still need their own lookup, and it still carries -R.
    expect(body).toMatch(/cross-repo closing PR still needs its own targeted lookup/)
    expect(body).toMatch(/bounded by the number of \*cross-repo\* closing references/)
    // A failed or partial lookup stays an unknown — never a verdict, never a fallback
    // to the repo-wide list.
    expect(body).toMatch(/missing PR node in the response is an \*\*indeterminate\*\* edge/)
    expect(body).toMatch(/never a reason to fall back to a repo-wide list/)
  })

  test("uses GitHub's own PR linkage before the keyword scan", () => {
    // A sidebar-linked PR carries no keyword, so a keyword-only scan puts an issue that
    // already has a PR into the build bucket and opens a duplicate.
    expect(body).toMatch(/Use GitHub's own linkage first and the keyword scan as the fallback/)
    expect(body).toMatch(/linked by hand through the Development sidebar with no keyword/)
    // Openness is established by intersecting references with the open-PR list — the
    // field itself carries no state. Cross-repo uses the targeted -R lookup.
    expect(body).toMatch(/Establish "open" by intersecting with the open-PR list/i)
    expect(body).toMatch(/field carries no PR state/i)
    expect(body).toMatch(/same-repo reference numbers appears in the open-PR list/i)
    expect(body).toMatch(/cross-repo.*targeted lookup/is)
    expect(body).toMatch(/`state: OPEN` → \*\*resume\*\*/)
    expect(body).toMatch(/cannot read, or a lookup that errors\/throttles, is a \*\*blocking unknown\*\*/i)
    expect(body).toMatch(/never assumed open and never assumed closed/i)
    expect(body).toMatch(/\| A linked closing-PR reference's openness could not be established/)
    // Closing refs must name this repo — foreign owner/repo prefixes are discarded.
    expect(body).toMatch(/A closing reference counts only when it names this repository/i)
    expect(body).toMatch(/foreign `otherorg\/other#12` must be discarded/i)
    // The published pattern must not re-introduce the capture-group trap.
    expect(body).toMatch(/fix\(\?:es\|ed\)\?/)
    expect(body).toMatch(/group 3 is the issue number/)
  })

  test('maps every step-1 blocking unknown to a NO-GO severity row', () => {
    // Bucket-classification unknowns used to halt in prose with no verdict mapping,
    // so a literal reader could still emit GO. Every step-1 blocking unknown must
    // appear in the severity table and in the NO-GO trigger list.
    expect(body).toMatch(/\| The open-PR query errored, throttled, or returned a truncated page \(step 1\) \| \*\*NO-GO\*\*/)
    expect(body).toMatch(/\| A linked closing-PR reference's openness could not be established[^|]*\| \*\*NO-GO\*\*/)
    expect(body).toMatch(/\| A fetch that did not cover the whole milestone \(step 1\) \| \*\*NO-GO\*\*/)
    expect(body).toMatch(/any step-1 \*\*blocking unknown\*\*/i)
    expect(body).toMatch(/incomplete issue fetch, failed\/throttled\/truncated open-PR query, a linked reference whose openness could not be established, or an out-of-milestone referenced issue that could not be fetched/)
  })

  test('publishes one gh api placeholder spelling — brace form throughout', () => {
    // fix-pr-review documents that gh api auto-fills {owner}/{repo}; colon forms
    // must not appear as -F values or unsubstituted literals become repo names.
    const blocks = fencedBlocks(body)
    expect(blocks.some((code) => /repos\/\{owner\}\/\{repo\}\//.test(code))).toBe(true)
    expect(blocks.some((code) => /-F owner='\{owner\}' -F repo='\{repo\}'/.test(code))).toBe(true)
    expect(blocks.some((code) => /-F owner=':owner'|-F repo=':repo'/.test(code))).toBe(false)
  })

  test('pages the cross-reference query with an after cursor', () => {
    const blocks = fencedBlocks(body)
    expect(blocks.some((code) => /timelineItems\(first:100, after:\$after/.test(code))).toBe(true)
    expect(body).toMatch(/query\(\$owner:String!,\$repo:String!,\$after:String\)/)
    expect(body).toMatch(/re-query \*\*that issue\*\* with `-F after="<endCursor>"`/i)
    expect(body).toMatch(/page that issue alone with its own cursor/i)
  })

  test('publishes the per-issue routing table with every Execution-block field', () => {
    // The table is the deliverable: every field the pipeline reads has a column, and
    // the bucket column is what keeps a non-dispatched row from reading as pending work.
    const header = body.match(/^\| # \| State \|.*\| 1st review \|$/m)?.[0]
    expect(header, 'no per-issue table header row found').toBeDefined()
    // The header is a markdown table row, never a fenced code block.
    expect(fencedBlocks(body).some((code) => code.includes('1st review'))).toBe(false)
    for (const column of ['State', 'Bucket', 'Depends on', 'Runs after', 'Build', 'Effort', 'Validate', 'fableplan', 'Plan', '1st review']) {
      expect(header, `routing table is missing the ${column} column`).toContain(column)
    }
  })

  test('claims execution only for the rows the run would dispatch', () => {
    // Closed and resume rows stay visible — a closed predecessor named in a runnable
    // issue's Depends on has to be readable — but neither is pending pipeline work.
    expect(body).toMatch(/one row per issue in the milestone/i)
    expect(body).toMatch(/Only the runnable build-bucket rows are what the run will execute/i)
    expect(body).toMatch(/never present a closed, resume, excluded, or external row as pending pipeline work/i)
    expect(body).toMatch(/v0 number in a v1 `Depends on` is look-up-able|closed predecessor named in a runnable issue's `Depends on`/i)
    expect(body).toMatch(/on a \*\*build-bucket issue that is runnable, \*Blocked — excluded\*, or resume-bucket\*\*/i)
    expect(body).toMatch(
      /Field contradictions on \*\*skip\*\*-bucket issues take severity `Informational` and `Recommended fix: none — never re-enters`/,
    )
    expect(body).toMatch(/would edit a body this run never reads/i)
    // An all-closed milestone is complete, not a wall of findings.
    expect(body).toMatch(/no open issues.*complete.*do not emit a wall of closed-issue findings/is)
  })

  test('paginates the milestone lookup instead of taking the first page', () => {
    const blocks = fencedBlocks(body)
    expect(blocks.some((code) => /milestones\?state=all&per_page=100" --paginate/.test(code))).toBe(true)
    expect(body).toMatch(/returns 30 per page by default/)
    expect(body).toMatch(/would read as not found/)
    expect(body).toMatch(/the milestone list does not get an exemption/)
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
