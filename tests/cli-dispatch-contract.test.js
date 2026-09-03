import { describe, expect, test } from 'bun:test'

const root = new URL('../', import.meta.url)
const read = (path) => Bun.file(new URL(path, root)).text()

const [skill, pipeline, prdToIssues, planReview, milestoneplan, milestoneWorkflow, validateIssue, readme] = await Promise.all([
  read('skills/cli-dispatch/SKILL.md'),
  read('workflows/milestone-pipeline.js'),
  read('skills/prd-to-issues/SKILL.md'),
  read('skills/execution-plan-review/SKILL.md'),
  read('skills/milestoneplan/SKILL.md'),
  read('skills/milestone-workflow/SKILL.md'),
  read('skills/validate-issue/SKILL.md'),
  read('README.md'),
])

const DANGEROUS = ['--dangerously-bypass-approvals-and-sandbox', '--yolo', '--dangerously-skip-permissions', 'danger-full-access']

describe('cli dispatch contract', () => {
  test('the two shims carry the sandbox, effort, and data-only prompt flags and no dangerous flag', () => {
    const codeBlocks = skill.match(/```[\s\S]*?```/g) ?? []
    const codexShim = codeBlocks.find((block) => block.includes('codex exec'))
    const cursorShim = codeBlocks.find((block) => block.includes('agent -p'))
    expect(codexShim, 'a fenced codex exec shim exists').toBeDefined()
    expect(cursorShim, 'a fenced agent -p shim exists').toBeDefined()
    for (const flag of ['-C "$REPO"', "-m '<model-id>'", '-c model_reasoning_effort=<tier>', '-s workspace-write', '--json', '-o "$RESULT"', '< "$PROMPT"']) {
      expect(codexShim, flag).toContain(flag)
    }
    for (const flag of ['--output-format json', "--model '<model-id>'", '--force', '--trust', '--workspace "$REPO"', '"$(cat "$PROMPT")"']) {
      expect(cursorShim, flag).toContain(flag)
    }
    for (const block of codeBlocks) {
      for (const flag of DANGEROUS) expect(block, `no code block carries ${flag}`).not.toContain(flag)
    }
    const flat = skill.replace(/\s+/g, ' ')
    expect(flat).toMatch(/--dangerously-bypass-approvals-and-sandbox[\s\S]{0,120}never/i)
    expect(flat, 'the prompt is passed as data').toMatch(/never interpolate the prompt/i)
    expect(flat, 'the shim runs in the background').toMatch(/background[\s\S]{0,120}poll/i)
    expect(flat, 'a substitution is reported').toMatch(/substitution[\s\S]{0,200}never present/i)
    expect(flat, 'no Claude fallback').toMatch(/never falls back to a Claude build/i)
    expect(flat, 'the model id is allowlisted').toContain('^[A-Za-z0-9][A-Za-z0-9._:-]*$')
    expect(flat, 'the Cursor shim is documented as unsandboxed').toMatch(/Cursor shim has no write boundary/i)
    expect(flat, 'the Cursor model list uses the preflighted binary').toContain('`agent --list-models`')
    expect(skill).not.toContain('cursor-agent --list-models')
    expect(flat, 'the driver owns every trigger').toMatch(/CLI agent[^.]*never posts a trigger/i)
    expect(flat, 'a retry checks for landed work first').toMatch(/Before any retry, check for work the failed run already landed/)
    expect(flat, 'the result parse and substitution check run after every exit').toMatch(/after every run, pass or fail/i)
    expect(flat, 'the stray-write diff ignores concurrent worktrees').toContain('ignoring every path under `.claude/worktrees/`')
    expect(flat, 'the bracket carries the fableplan marker').toContain('`, fableplan` appended')
  })

  test('the pipeline driver prompt embeds the same shim shape and forbids the dangerous flags', () => {
    expect(pipeline).toContain("const CLI_DRIVER = { model: 'opus', effort: 'high' }")
    expect(pipeline).toContain("const CLI_MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/")
    expect(pipeline).toContain(`codex exec -C "$REPO" -m '\${cliModel}' -c model_reasoning_effort=\${effort} -s workspace-write`)
    expect(pipeline).toContain(`agent -p --output-format json --model '\${cliModel}' --force --trust --workspace "$REPO" "$(cat "$PROMPT")"`)
    expect(pipeline).toContain('Load the \\`cli-dispatch\\` skill BEFORE doing anything else')
    expect(pipeline).toMatch(/Never add \\`--dangerously-bypass-approvals-and-sandbox\\`, \\`--yolo\\`/)
    expect(pipeline).toContain("enum: ['fable', 'opus', 'sonnet', 'haiku', 'codex', 'cursor']")
    expect(pipeline).toContain("enum: ['low', 'medium', 'high', 'xhigh', 'max']")
    expect(pipeline).toMatch(/do NOT extract a "\*\*Validate model:\*\*" line/)
  })

  test('every skill that stamps, renders, or runs a Build model documents the CLI harness form', () => {
    expect(prdToIssues).toContain('<Name> (Codex CLI[, <model-id>])')
    expect(prdToIssues).toContain('Never stamp an external CLI harness as the Build model')
    expect(planReview).toContain('build 275 with luna on codex at max')
    expect(planReview).toContain('`max` is a Codex CLI-only tier')
    expect(milestoneplan).toContain('Luna · max (Codex CLI)')
    expect(milestoneWorkflow).toContain('`codex login status`')
    expect(milestoneWorkflow).toContain('`agent status`')
    expect(validateIssue).toContain('The Build column is the Claude default')
    expect(readme).toContain('**External build harnesses.**')
    expect(readme).toContain('Cursor has no sandbox')
    expect(readme).not.toContain('sandboxed to the workspace')
    expect(readme).toContain('only when the CLI names one')
    expect(readme).not.toContain('reports any model the CLI substituted')
    expect(milestoneWorkflow).toContain('**External CLI spend is outside every number above.**')
    expect(readme).toContain('| `cli-dispatch` |')
  })

  test('the default model ids the skill documents match the pipeline resolver', () => {
    expect(skill).toContain('`gpt-5.6-luna`')
    expect(skill).toContain('`cursor-grok-4.6-<effort>`')
    expect(pipeline).toContain("luna: () => 'gpt-5.6-luna'")
    expect(pipeline).toContain('grok: (effort) => `cursor-grok-4.6-${effort}`')
  })
})
