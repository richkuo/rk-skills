import { describe, expect, test } from 'bun:test'

/**
 * Pins for the @codex GitHub Actions bundle that only a live YAML edit can
 * break. The routing SHELL is covered by
 * templates/codex-workflow/scripts/test_workflow_logic.py, which extracts and
 * executes the real classifier out of the TEMPLATE workflow. These tests cover
 * what that extractor cannot see: that this repo's vendored copy carries the
 * identical classifier, and that the permission / credential boundaries around
 * it stay where they are.
 */
const root = new URL('../', import.meta.url)
const read = (path) => Bun.file(new URL(path, root)).text()

const REPO_TRIGGER = '.github/workflows/codex.yml'
const TEMPLATE_TRIGGER = 'templates/codex-workflow/workflows/codex.yml'
const RUN_BODY = '.github/workflows/codex-run.yml'

const [repoTrigger, templateTrigger, runBody] = await Promise.all([
  read(REPO_TRIGGER),
  read(TEMPLATE_TRIGGER),
  read(RUN_BODY),
])

/** Dedented body of a step's `run: |` block, verbatim from the YAML. */
function stepRunBlock(source, stepName) {
  const lines = source.split('\n')
  const start = lines.findIndex((line) => line.trim() === `- name: ${stepName}`)
  if (start === -1) return null

  let runIdx = -1
  let runIndent = 0
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^\s*- name:/.test(lines[i])) break
    const m = lines[i].match(/^(\s*)run:\s*\|\s*$/)
    if (m) {
      runIdx = i
      runIndent = m[1].length
      break
    }
  }
  if (runIdx === -1) return null

  const body = []
  for (let i = runIdx + 1; i < lines.length; i += 1) {
    const line = lines[i]
    if (line.trim() === '') {
      body.push('')
      continue
    }
    if (line.length - line.trimStart().length <= runIndent) break
    body.push(line)
  }
  const nonBlank = body.filter((l) => l.trim() !== '')
  const min = Math.min(...nonBlank.map((l) => l.length - l.trimStart().length))
  return body.map((l) => (l.trim() === '' ? '' : l.slice(min))).join('\n')
}

const CLASSIFIER_STEPS = [
  'Verify @codex is an actual invocation (not in a code block or example)',
  'Resolve model from @codex invocation',
  'Classify invocation route (review, implement, or fix-pr)',
]

/** Value of a `permissions:` block for a named top-level job. */
function jobPermissions(source, jobName) {
  const lines = source.split('\n')
  const start = lines.findIndex((line) => line === `  ${jobName}:`)
  if (start === -1) return null
  const permIdx = lines.findIndex(
    (line, i) => i > start && line === '    permissions:',
  )
  if (permIdx === -1) return null
  const grants = []
  for (let i = permIdx + 1; i < lines.length; i += 1) {
    const m = lines[i].match(/^ {6}([a-z-]+):\s*([a-z-]+)\s*$/)
    if (m) {
      grants.push(`${m[1]}: ${m[2]}`)
      continue
    }
    if (/^ {6}#/.test(lines[i])) continue
    break
  }
  return grants
}

describe('Codex workflow bundle', () => {
  test('the vendored trigger carries the template classifier verbatim', () => {
    // The Python routing tests extract from the TEMPLATE. Without this pin,
    // this repo's own copy could drift and run unpinned routing logic.
    for (const step of CLASSIFIER_STEPS) {
      const fromTemplate = stepRunBlock(templateTrigger, step)
      const fromRepo = stepRunBlock(repoTrigger, step)
      expect(fromTemplate, `${TEMPLATE_TRIGGER}: ${step}`).toBeTruthy()
      expect(fromRepo, `${REPO_TRIGGER}: ${step}`).toBeTruthy()
      expect(fromRepo, step).toBe(fromTemplate)
    }
  })

  test('the two trigger copies differ only by runner label', () => {
    const normalize = (source) =>
      source
        .split('\n')
        .filter((line) => line !== '      runs_on: self-hosted')
        .map((line) => (line === '    runs-on: self-hosted' ? '    runs-on: ubuntu-latest' : line))
        .join('\n')
    expect(normalize(templateTrigger)).toBe(normalize(repoTrigger))
  })

  test.each([REPO_TRIGGER, TEMPLATE_TRIGGER])(
    '%s keeps every job on contents: read and never grants id-token',
    async (path) => {
      const source = await read(path)
      // openai/codex-action mints no App token via OIDC, and a GITHUB_TOKEN
      // push would not retrigger CI — so the job token must never carry push
      // rights on ANY route. That makes "no GITHUB_TOKEN fallback for push" a
      // permission boundary rather than an intention.
      for (const job of ['review', 'implement', 'fix-pr']) {
        expect(jobPermissions(source, job), `${path}: ${job}`).toEqual([
          'contents: read',
          'pull-requests: write',
          'issues: write',
        ])
      }
      expect(source, path).not.toMatch(/^\s*id-token:\s*write/m)
      expect(source, path).not.toMatch(/^\s*contents:\s*write/m)
    },
  )

  test.each([REPO_TRIGGER, TEMPLATE_TRIGGER])(
    '%s never shares a concurrency group with the Claude bundle',
    async (path) => {
      const source = await read(path)
      expect(source, path).toMatch(
        /concurrency:\n {2}group: codex-\$\{\{ github\.event\.issue\.number \|\| github\.event\.pull_request\.number \}\}/,
      )
    },
  )

  test.each([REPO_TRIGGER, TEMPLATE_TRIGGER])(
    '%s routes every job through the published run body',
    async (path) => {
      const source = await read(path)
      const callers = source.match(/uses: richkuo\/rk-skills\/\.github\/workflows\/codex-run\.yml@main/g)
      expect(callers, path).toHaveLength(3)
    },
  )

  test.each([REPO_TRIGGER, TEMPLATE_TRIGGER])(
    '%s gives the review route no App credential',
    async (path) => {
      const source = await read(path)
      const reviewJob = source
        .slice(source.indexOf('\n  review:'), source.indexOf('\n  implement:'))
        .split('\n')
        .filter((line) => !/^\s*#/.test(line))
        .join('\n')
      expect(reviewJob, path).toContain('OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}')
      expect(reviewJob, path).not.toMatch(/CODEX_APP_ID|CODEX_APP_PRIVATE_KEY/)

      for (const job of ['implement', 'fix-pr']) {
        const marker = `\n  ${job}:`
        const body = source.slice(source.indexOf(marker))
        expect(body, `${path}: ${job}`).toContain('CODEX_APP_ID: ${{ secrets.CODEX_APP_ID }}')
        expect(body, `${path}: ${job}`).toContain(
          'CODEX_APP_PRIVATE_KEY: ${{ secrets.CODEX_APP_PRIVATE_KEY }}',
        )
      }
    },
  )

  test.each([REPO_TRIGGER, TEMPLATE_TRIGGER])(
    '%s re-asserts PR-author trust on the fix-pr job independently of classify',
    async (path) => {
      const source = await read(path)
      const fixPr = source.slice(source.indexOf('\n  fix-pr:'))
      expect(fixPr, path).toContain(
        "contains(fromJSON('[\"OWNER\", \"MEMBER\", \"COLLABORATOR\"]'), github.event.issue.author_association)",
      )
      // Bot-author trust must be gated on the variable being set, so an unset
      // CODEX_BOT_LOGIN cannot make an empty login match an empty variable.
      expect(fixPr, path).toContain(
        "vars.CODEX_BOT_LOGIN != '' && github.event.issue.user.login == vars.CODEX_BOT_LOGIN",
      )
    },
  )

  describe('run body', () => {
    test('fails closed when a write route has no App credential', () => {
      const block = stepRunBlock(runBody, 'Require GitHub App credentials on write routes')
      expect(block).toBeTruthy()
      expect(block).toContain('CODEX_APP_ID')
      expect(block).toContain('CODEX_APP_PRIVATE_KEY')
      expect(block).toContain('exit 1')
      expect(runBody).toContain('uses: actions/create-github-app-token@v2')
      // The mint step and the checkout token must both stay off the review route.
      expect(runBody).toMatch(
        /- name: Mint the GitHub App installation token\n\s+if: inputs\.mode != 'review'/,
      )
    })

    test('the review route posts through a trusted step, never the agent', () => {
      const block = stepRunBlock(runBody, 'Post the Codex review comment')
      expect(block).toBeTruthy()
      // --body-file keeps model output that read untrusted PR content out of
      // any shell evaluation; the run link is what RUN_ID selection matches.
      expect(block).toContain('--body-file')
      expect(block).not.toMatch(/--body\s+"/)
      expect(runBody).toContain(
        'RUN_URL: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}',
      )
    })

    test('worktree cleanup is scoped to the Codex subdirectory', () => {
      // A Claude run and a Codex run can share a persistent self-hosted runner;
      // neither may remove the other's worktree.
      for (const step of [
        'Prune stale Codex worktrees before Codex runs',
        'Clean up Codex worktrees after Codex runs',
      ]) {
        const block = stepRunBlock(runBody, step)
        expect(block, step).toBeTruthy()
        expect(block, step).toContain('"$GITHUB_WORKSPACE"/.claude/worktrees/codex/*')
      }
    })

    test('write routes enable sandbox network, review gets no config at all', () => {
      const block = stepRunBlock(runBody, 'Prepare the Codex home directory')
      expect(block).toBeTruthy()
      // git push and gh need outbound network; the workspace-write sandbox
      // denies it by default. Review must never receive this file.
      expect(block).toContain('[sandbox_workspace_write]')
      expect(block).toContain('network_access = true')
      expect(block).toMatch(/if \[ "\$MODE" = "review" \]; then[\s\S]*?else[\s\S]*?network_access/)
    })

    test('the harness identity is the Codex action', () => {
      expect(runBody).toContain('CLAUDE_HARNESS: openai/codex-action@v1')
    })

    test('comment patch steps are skipped when no bot login is configured', () => {
      // patch_claude_comment.sh defaults BOT_LOGIN to claude[bot]; running it
      // with an empty login would stamp a Claude comment on a Codex run.
      const guarded = runBody.match(/if:.*env\.BOT_LOGIN != ''/g)
      expect(guarded).not.toBeNull()
      expect(guarded.length).toBeGreaterThanOrEqual(3)
    })

    test('the prompt reaches Codex as a file, never as shell-evaluated args', () => {
      expect(runBody).toContain('prompt-file: ${{ runner.temp }}/rk-shared/prompt.md')
      expect(runBody).not.toMatch(/--append-system-prompt/)
    })
  })

  test('the Codex review contract is a byte-identical copy of the Claude one', async () => {
    const [claudePrompt, codexPrompt] = await Promise.all([
      read('templates/claude-workflow/prompts/pr-review-format.md'),
      read('templates/codex-workflow/prompts/pr-review-format.md'),
    ])
    // Harness-specific framing (final message is the comment, no network) is
    // appended by codex-run.yml, so the shared contract text stays one file's
    // worth of wording in two places and cannot drift.
    expect(codexPrompt).toBe(claudePrompt)
  })

  test('the minimal review template appends the run link the merge gates key on', async () => {
    // fix-pr-review-loop / work-on-issue-loop select a Codex review comment by
    // its /actions/runs/<run-id> link, and milestone-workflow's merge recency
    // gate only accepts comments carrying one — a template without it makes
    // every merge unapprovable.
    const minimalReview = await read('templates/codex-review.yml')
    expect(minimalReview).toContain(
      'RUN_URL: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}',
    )
    const block = stepRunBlock(minimalReview, 'Post the Codex review comment')
    expect(block).toBeTruthy()
    expect(block).toContain("printf '\\n\\n[Codex run log](%s)\\n' \"$RUN_URL\"")
    expect(block).toContain('--body-file "$BODY_FILE"')
  })
})
