import { describe, expect, test } from 'bun:test'

const root = new URL('../', import.meta.url)
const read = (path) => Bun.file(new URL(path, root)).text()

const [prdToIssues, milestoneplan, newAppPipeline, readme, pipeline] = await Promise.all([
  read('skills/prd-to-issues/SKILL.md'),
  read('skills/milestoneplan/SKILL.md'),
  read('skills/new-app-pipeline/SKILL.md'),
  read('README.md'),
  read('workflows/milestone-pipeline.js'),
])

function procedureBody(markdown) {
  const match = markdown.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/)
  return match ? match[1] : markdown
}

function ghInvocations(text) {
  return [...text.matchAll(/\bgh\s+([a-z][a-z-]*)(?:\s+([a-z][a-z-]*))?/g)].map(
    ([whole, sub, verb]) => ({ sub, verb: verb ?? '', whole: whole.trim() }),
  )
}

const READ_ONLY_GH = {
  api: [],
  issue: ['list', 'view', 'status'],
  pr: ['list', 'view', 'checks', 'diff', 'status'],
  run: ['list', 'view'],
  repo: ['view'],
  auth: ['status'],
  search: ['issues', 'prs', 'repos', 'code'],
}

const WRITING_GH_API = [
  /gh api[^\n`]*(?:-X|--method)(?:=\s*|\s*)(POST|PATCH|PUT|DELETE)/gi,
  /gh api[^\n`]*(?:(?:\s(?:-f|--field|-F|--raw-field)\s)|(?:(?:-f|--field|-F|--raw-field)=))/g,
  /gh api[^\n`]*(?:(?:\s--input\s)|(?:--input=))/g,
]

const GRAPHQL_CALL = /gh api graphql[^\n`]*/g
const GRAPHQL_MUTATION = /\bmutation\b/

const NON_GH_WRITES = [
  /\bgit\s+(?:commit|push|amend|tag|rebase|merge|cherry-pick|reset|stash\s+push|branch\s+-D)\b/g,
  /\bcurl\b[^\n`]*(?:(?:\s(?:-X|--request)\s)|(?:(?:-X|--request)=))(?:POST|PUT|PATCH|DELETE)/gi,
  /\bcurl\b[^\n`]*(?:(?:\s(?:-d|--data|--data-raw|--data-binary)\s)|(?:(?:-d|--data|--data-raw|--data-binary)=))/g,
]

function readOnlyViolations(text) {
  text = text.replace(/\\\r?\n/g, ' ')
  const violations = []
  for (const { sub, verb, whole } of ghInvocations(text)) {
    const readOnlyVerbs = READ_ONLY_GH[sub]
    if (!readOnlyVerbs) violations.push(`unknown gh subcommand: ${whole}`)
    else if (sub !== 'api' && !readOnlyVerbs.includes(verb)) violations.push(`mutating gh command: ${whole}`)
  }
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

describe('Execution block fields', () => {
  test('prd-to-issues documents every routing field the pipeline prep reads, including the optional effort stamps', () => {
    for (const field of ['Depends on', 'Runs after', 'Build model', 'Effort', 'fableplan first', 'PR review', 'Validate effort', 'Plan effort']) {
      expect(prdToIssues, `prd-to-issues documents ${field}`).toContain(`**${field}:**`)
    }
    expect(prdToIssues, 'prd-to-issues never stamps a validate model').not.toContain('**Validate model:**')
    for (const field of ['Build model', 'Effort', 'fableplan first', 'PR review', 'Validate effort', 'Plan effort']) {
      expect(pipeline, `pipeline prep reads ${field}`).toMatch(new RegExp(`"\\*{0,2}${field}:`))
    }
    expect(pipeline, 'pipeline prep never reads a validate model').toMatch(/do NOT extract a "\*\*Validate model:\*\*" line/)
    expect(prdToIssues, 'prd-to-issues documents the external CLI Build model form').toContain('(Codex CLI[, <model-id>])')
    expect(pipeline, 'pipeline prep maps the external CLI Build model form').toContain('map "(Codex CLI…)"→codex and "(Cursor CLI…)"→cursor')
  })
})

describe('milestoneplan is read-only', () => {
  const body = procedureBody(milestoneplan)

  test('the procedure itself contains no mutating command', () => {
    expect(ghInvocations(body).length, 'no gh commands found — extraction is vacuous').toBeGreaterThan(0)
    expect(readOnlyViolations(body), 'read-only procedure contains a writing command').toEqual([])
  })

  test('the read-only guard fails on gh commands it does not recognize', () => {
    for (const written of [
      'gh release create v1.0.0',
      'gh workflow run ci.yml',
      'gh api --method POST /repos/o/r/issues',
      'gh api -X=PATCH /repos/o/r/issues/1',
      'gh api /repos/o/r/issues -f title=x ',
      'gh api /repos/o/r/issues --raw-field=title=x',
      'gh api /repos/o/r/issues --input body.json ',
      "gh api graphql -f query='mutation { addComment(input: {}) { clientMutationId } }'",
      'gh api /repos/o/r/issues/1/comments \\\n  -f body=x',
      'git push origin HEAD',
      'curl -X POST https://api.github.com/repos/o/r/issues',
      'curl -d body=x https://api.github.com/repos/o/r/issues/1/comments',
    ]) {
      expect(readOnlyViolations(written), `should fail the read-only guard: ${written}`).not.toEqual([])
    }
    for (const read of [
      'gh api "repos/{owner}/{repo}/milestones?state=all&per_page=100" --paginate --jq \'.[]\'',
      'gh issue list --milestone "M" --state all --limit 500 --json number',
      'git log -1 --oneline',
      'curl https://api.github.com/repos/o/r/issues/1',
    ]) {
      expect(readOnlyViolations(read), `should pass the read-only guard: ${read}`).toEqual([])
    }
  })
})

describe('new-app-pipeline stage numbering contract', () => {
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
