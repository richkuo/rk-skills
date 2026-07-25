import { describe, expect, test } from 'bun:test'

const root = new URL('../', import.meta.url)
const read = (path) => Bun.file(new URL(path, root)).text()

const [prdToIssues, executionPlanReview, milestoneWorkflow, milestoneplan, newAppPipeline, readme] = await Promise.all([
  read('skills/prd-to-issues/SKILL.md'),
  read('skills/execution-plan-review/SKILL.md'),
  read('skills/milestone-workflow/SKILL.md'),
  read('skills/milestoneplan/SKILL.md'),
  read('skills/new-app-pipeline/SKILL.md'),
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
})

describe('milestoneplan pre-flight contract', () => {
  const body = procedureBody(milestoneplan)

  test('is read-only — never edits issues or launches the run itself', () => {
    expect(body).toMatch(/never writes/i)
    expect(body).toMatch(/does not edit issue bodies.*post comments.*open PRs.*invoke the Workflow tool/is)
    expect(body).toMatch(/Do not launch either one unprompted/i)
  })

  test('audits stamps against the band table and separates overrides from slips', () => {
    expect(body).toMatch(/\| Capability \| Score \| Build model \| fableplan \|/)
    expect(body).toMatch(/deliberate override/i)
    expect(body).toMatch(/unexplained departure is a finding/i)
    // The pipeline silently raises non-Fable low/medium; the audit must say the stamp lies.
    expect(body).toMatch(/non-Fable build stamped `low`\/`medium`/i)
    expect(body).toMatch(/`Validate effort: xhigh`/)
    expect(body).toMatch(/`Plan effort` on a `fableplan: No` issue.*inert/is)
    // Band conformance runs in both directions: quiet overspend is a finding too,
    // since the per-model mix is what this skill uses to estimate run cost.
    expect(body).toMatch(/Band conformance is two-sided/i)
    expect(body).toMatch(/departs from its score's band in \*either\* direction/)
    expect(body).toMatch(/silent overspend/i)
    // Over-band is the pipeline's own default for a missing Execution block.
    expect(body).toMatch(/model fable, effort high/)
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

  test('never emits a verdict over a truncated milestone fetch', () => {
    expect(body).toMatch(/open_issues.*closed_issues/s)
    expect(body).toMatch(/blocking unknown/i)
    expect(body).toMatch(/never emit a verdict over an incomplete issue set/i)
  })

  test('classifies issues into the same buckets milestone-workflow uses', () => {
    expect(body).toMatch(/\*\*build\*\* \(open, no PR\)/)
    expect(body).toMatch(/\*\*resume\*\* \(open with an open PR that closes it\)/)
    expect(body).toMatch(/\*\*skip\*\* \(closed\)/)
    expect(body).toMatch(/confirm the PR actually closes the issue/i)
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
    expect(body).toMatch(/predecessor closed \*\*with\*\* a merged PR.*no finding/is)
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
