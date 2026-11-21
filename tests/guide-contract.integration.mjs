import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const FIXTURES = join(root, 'tests/fixtures/guide-contract')
const WORKFLOWS = {
  claude: join(root, '.github/workflows/claude-run.yml'),
  codex: join(root, '.github/workflows/codex-run.yml'),
}
const LEGACY_BASE = 'c3aaea7b01c3885ff7d73850f577bf0e6aa3c6b6'
const HEADING = '## Agent guide contract'
const REGENERATE = 'bash scripts/gen-guide.sh'
const VERIFY = 'bash scripts/check-guide.sh'
const PERMIT = `Bash(${REGENERATE}),Bash(${VERIFY})`
const OTHER_EXTRA = 'Bash(gofmt *)'
const SLUG = 'fixture-owner/fixture-repo'
const HARNESS = 'anthropics/claude-code-action@v1'
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'rk-guide-contract-')))

let checks = 0
const failures = []
let section = ''
function check(condition, message) {
  checks += 1
  if (!condition) failures.push(`${section}: ${message}`)
}

function run(cmd, args, options = {}) {
  const proc = Bun.spawnSync([cmd, ...args], {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdin: options.input === undefined ? 'ignore' : Buffer.from(options.input),
  })
  return { status: proc.exitCode, stdout: proc.stdout.toString(), stderr: proc.stderr.toString() }
}

function git(cwd, ...args) {
  const result = run('git', ['-C', cwd, ...args])
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${result.stderr}`)
  return result.stdout.trim()
}

let counter = 0
function fresh(name) {
  counter += 1
  const dir = join(scratch, `${counter}-${name}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

const fakeBin = join(scratch, 'bin')
mkdirSync(fakeBin)
writeFileSync(join(fakeBin, 'gh'), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$RK_GH_LOG/argv.log"
[ "$1" = api ] || exit 1
shift
path=""
field=""
while [ $# -gt 0 ]; do
  case "$1" in
    --method|--jq) shift 2 ;;
    -F|-f|--raw-field|--field) field="$2"; shift 2 ;;
    *) path="$1"; shift ;;
  esac
done
case "$path" in
  repos/*/git/ref/heads/*)
    git -C "$RK_GH_ORIGIN" rev-parse --verify -q "refs/heads/\${path#*/git/ref/heads/}^{commit}" || exit 1
    ;;
  repos/*/issues/*/comments)
    n=$(find "$RK_GH_LOG" -name 'comment-*.md' | wc -l | tr -d ' ')
    case "$field" in
      body=@*) cp "\${field#body=@}" "$RK_GH_LOG/comment-$n.md" ;;
      body=*) printf '%s' "\${field#body=}" > "$RK_GH_LOG/comment-$n.md" ;;
    esac
    echo '{}'
    ;;
  *) exit 1 ;;
esac
`)
chmodSync(join(fakeBin, 'gh'), 0o755)

const yamlCache = new Map()
function stepOf(flavor, name, source = 'current') {
  const key = `${flavor}:${source}`
  if (!yamlCache.has(key)) {
    const text = source === 'current' ? readFileSync(WORKFLOWS[flavor], 'utf8') : git(root, 'show', `${source}:.github/workflows/${flavor}-run.yml`)
    yamlCache.set(key, Bun.YAML.parse(text))
  }
  const steps = Object.values(yamlCache.get(key).jobs).flatMap((job) => job.steps ?? [])
  const matches = steps.filter((step) => step.name === name)
  if (matches.length !== 1) throw new Error(`expected one step named ${name} in ${flavor} (${source}), found ${matches.length}`)
  return matches[0]
}

function stepFile(flavor, name, source = 'current') {
  const file = join(scratch, `step-${(counter += 1)}.sh`)
  writeFileSync(file, stepOf(flavor, name, source).run)
  return file
}

function parseOutputs(text) {
  const outputs = {}
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const heredoc = line.match(/^([A-Za-z0-9_]+)<<(.+)$/)
    if (heredoc) {
      const body = []
      i += 1
      while (i < lines.length && lines[i] !== heredoc[2]) body.push(lines[(i += 1) - 1])
      outputs[heredoc[1]] = body.join('\n')
      continue
    }
    const eq = line.indexOf('=')
    if (eq > 0) outputs[line.slice(0, eq)] = line.slice(eq + 1)
  }
  return outputs
}

function project(kind, { mutate, layout } = {}) {
  const dir = fresh(kind)
  const src = join(dir, 'src')
  cpSync(join(FIXTURES, kind), src, { recursive: true })
  if (layout === 'symlink') symlinkSync('CLAUDE.md', join(src, 'AGENTS.md'))
  if (layout === 'hand-mirror') cpSync(join(src, 'CLAUDE.md'), join(src, 'AGENTS.md'))
  mutate?.(src)
  if (kind === 'contract') {
    const render = run('bash', ['scripts/render-guide.sh'], { cwd: src })
    if (render.status !== 0) throw new Error(`fixture render failed: ${render.stderr}`)
    writeFileSync(join(src, 'AGENTS.md'), render.stdout)
  }
  git(dir, 'init', '-q', '-b', 'main', src)
  git(src, 'config', 'user.name', 'Fixture Author')
  git(src, 'config', 'user.email', 'fixture@example.invalid')
  git(src, 'add', '-A')
  git(src, 'commit', '-q', '-m', 'initial fixture')
  const bare = join(dir, 'origin.git')
  git(dir, 'clone', '-q', '--bare', src, bare)
  const ws = join(dir, 'ws')
  git(dir, 'clone', '-q', bare, ws)
  git(ws, 'config', 'user.name', 'claude[bot]')
  git(ws, 'config', 'user.email', 'bot@example.invalid')
  const rt = join(dir, 'runner-temp')
  const ghLog = join(dir, 'gh-log')
  mkdirSync(ghLog, { recursive: true })
  return { dir, src, bare, ws, rt, ghLog }
}

function stage(p, flavor) {
  rmSync(join(p.rt, 'rk-shared'), { recursive: true, force: true })
  mkdirSync(join(p.rt, 'rk-shared'), { recursive: true })
  cpSync(join(root, `templates/${flavor}-workflow/prompts`), join(p.rt, 'rk-shared/prompts'), { recursive: true })
  cpSync(join(root, 'templates/claude-workflow/scripts'), join(p.rt, 'rk-shared/scripts'), { recursive: true })
  mkdirSync(join(p.rt, 'rk-shared/skills'), { recursive: true })
}

function runStep(p, flavor, name, env = {}, source = 'current') {
  const outFile = join(p.dir, `output-${(counter += 1)}.txt`)
  writeFileSync(outFile, '')
  const home = join(p.dir, 'home')
  mkdirSync(home, { recursive: true })
  const result = run('bash', ['--noprofile', '--norc', '-eo', 'pipefail', stepFile(flavor, name, source)], {
    cwd: p.ws,
    env: {
      PATH: `${fakeBin}:${process.env.PATH}`,
      HOME: home,
      RUNNER_TEMP: p.rt,
      GITHUB_WORKSPACE: p.ws,
      GITHUB_OUTPUT: outFile,
      GITHUB_REF: 'refs/heads/main',
      GITHUB_SERVER_URL: 'https://github.com',
      CLAUDE_HARNESS: flavor === 'claude' ? HARNESS : 'openai/codex-action@v1',
      RK_GH_ORIGIN: p.bare,
      RK_GH_LOG: p.ghLog,
      RK_FIXTURE_SECRET: 'fixture-secret-value',
      ...env,
    },
  })
  return { ...result, outputs: parseOutputs(readFileSync(outFile, 'utf8')), log: result.stdout + result.stderr }
}

function composeEnv(flavor, p, flow, extra, mode = 'implement') {
  const base = { MODE: mode, FLOW: flow, DEFAULT_BRANCH: 'main', EXTRA_ALLOWED: extra, GH_TOKEN: 'fixture-token' }
  if (flavor === 'claude') return { ...base, MODEL_ID: 'claude-opus-5-5', EFFORT: 'high', HEAD_SHA: '', BASE_SHA: '', SETTINGS_FILE: join(p.rt, 'settings.json') }
  return {
    ...base,
    REPO: SLUG,
    EVENT_NAME: 'issue_comment',
    TARGET_NUMBER: '7',
    TRIGGER_BODY: '@codex sync-docs',
    PR_BASE_SHA: '',
    PR_HEAD_SHA: '',
    SKILLS_DIR: join(p.rt, 'rk-shared/skills'),
    PR_METADATA_FILE: join(p.rt, 'rk-shared/pr-metadata.json'),
    PROMPT_OUT: join(p.rt, 'rk-shared/prompt.md'),
    BOT_LOGIN: '',
  }
}

const COMPOSE = { claude: 'Compose Claude prompt', codex: 'Compose the Codex prompt' }
const RECORD = { claude: 'Record PR head sha before Claude runs', codex: 'Record PR head sha before Codex runs' }
const PREPARE = 'Prepare the guide contract revise pass'
const SETTLE = { claude: 'Regenerate, verify, and commit the agent guides', codex: 'Regenerate, verify, commit, and push the agent guides' }
const REPORT = 'Report the guide contract result'
const REVISE_LEGACY = { claude: 'Revise CLAUDE.md with session learnings', codex: 'Revise AGENTS.md with session learnings' }

function compose(flavor, p, flow, extra, source = 'current') {
  stage(p, flavor)
  const result = runStep(p, flavor, COMPOSE[flavor], composeEnv(flavor, p, flow, extra), source)
  const prompt = flavor === 'claude' ? result.outputs.claude_args ?? '' : existsSync(join(p.rt, 'rk-shared/prompt.md')) ? readFileSync(join(p.rt, 'rk-shared/prompt.md'), 'utf8') : ''
  return { ...result, prompt, dir: p.dir }
}

function runner(p, args, env = {}) {
  return run('python3', ['-I', join(p.rt, 'rk-guide/guide_contract.py'), ...args], { cwd: p.ws, env: { PATH: process.env.PATH, RK_FIXTURE_SECRET: 'fixture-secret-value', ...env } })
}

function bracketed(text) {
  return [...text.matchAll(/\[\[(python3 [^\]]+)\]\]/g)].map((m) => m[1])
}

function runBracketed(p, line) {
  if (!line) return { status: -1, stdout: 'no runner command was given', stderr: '' }
  const parts = line.split(' ')
  return run(parts[0], parts.slice(1), { cwd: p.ws, env: { PATH: process.env.PATH, RK_FIXTURE_SECRET: 'fixture-secret-value' } })
}

function replaceIn(dir, file, from, to) {
  const path = join(dir, file)
  const text = readFileSync(path, 'utf8')
  if (!text.includes(from)) throw new Error(`fixture text not found in ${file}: ${from}`)
  writeFileSync(path, text.replace(from, to))
}

function useVariant(name, target) {
  return (src) => cpSync(join(FIXTURES, 'variants', name), join(src, 'scripts', target))
}

function statusPaths(cwd) {
  return run('git', ['-C', cwd, 'status', '--porcelain', '--untracked-files=all']).stdout.split('\n').filter(Boolean).map((line) => line.slice(3)).sort()
}

const legacyAvailable = run('git', ['-C', root, 'cat-file', '-e', `${LEGACY_BASE}^{commit}`]).status === 0

for (const flavor of ['claude', 'codex']) {
  section = `${flavor} compose, no statement`
  for (const layout of ['symlink', 'hand-mirror']) {
    for (const flow of ['sync-docs', 'sync-release']) {
      const now = compose(flavor, project('plain', { layout }), flow, `${OTHER_EXTRA},${PERMIT}`)
      check(now.status === 0, `${layout} ${flow}: compose exits 0 (${now.log})`)
      check(!now.prompt.includes('Agent guide contract'), `${layout} ${flow}: the prompt holds no contract fragment`)
      check(/^[0-9a-f]{40}$/.test(now.outputs.trusted_sha ?? ''), `${layout} ${flow}: compose records the trusted commit`)
      if (legacyAvailable) {
        const before = compose(flavor, project('plain', { layout }), flow, `${OTHER_EXTRA},${PERMIT}`, LEGACY_BASE)
        check(before.status === 0, `${layout} ${flow}: the legacy compose step exits 0`)
        const strip = (result) => result.prompt.replaceAll(result.dir, '<project>').replace(/RK_TRIGGER_[0-9a-f]+/g, 'RK_TRIGGER_X')
        check(strip(before) === strip(now), `${layout} ${flow}: the composed ${flavor === 'claude' ? 'claude_args' : 'prompt'} equals the ${LEGACY_BASE.slice(0, 7)} result`)
      } else {
        failures.push(`${section}: commit ${LEGACY_BASE} is not in this clone, so the no-statement equality cannot be proved (fetch full history)`)
      }
    }
  }

  section = `${flavor} compose, statement on the default branch`
  {
    const p = project('contract')
    const c = compose(flavor, p, 'sync-docs', `${OTHER_EXTRA},${PERMIT}`)
    check(c.status === 0, `compose exits 0 (${c.log})`)
    check(c.prompt.includes('Agent guide contract.'), 'the prompt holds the contract fragment')
    check(c.prompt.includes(`state for this run is ready, read from the default-branch commit ${git(p.bare, 'rev-parse', 'main')}`), 'the prompt names the ready state and the 40-character trusted commit')
    check(!c.prompt.includes('Command files:') && !c.prompt.includes(REGENERATE), 'the prompt holds no statement text and no project command')
    const lines = bracketed(c.prompt)
    check(lines.length === 2 && lines[0].includes(' check --state-file ') && lines[1].includes(' run --state-file '), 'the prompt gives the two runner command lines')
    if (flavor === 'claude') {
      const allowed = c.prompt.match(/--allowedTools "([^"]*)"/)?.[1] ?? ''
      const entries = allowed.split(',')
      check(entries.includes(`Bash(${lines[0]})`) && entries.includes(`Bash(${lines[1]})`), 'the allowlist holds the two exact runner entries')
      check(!entries.includes(`Bash(${REGENERATE})`) && !entries.includes(`Bash(${VERIFY})`), 'the allowlist drops the raw project commands')
      check(entries.includes(OTHER_EXTRA), 'the allowlist keeps the other caller entries')
      check(!/["`$]/.test(c.prompt.match(/--append-system-prompt "([^"]*)"/)?.[1] ?? '"'), 'the appended prompt holds no double quote, backtick, or dollar sign')
    }

    const check1 = runBracketed(p, lines[0])
    check(check1.status === 0 && check1.stdout.includes('result=ok'), `the runner check passes before any edit (${check1.stdout}${check1.stderr})`)
    replaceIn(p.ws, '.claude/rules/area.md', '- Area rule one.', '- Area rule one.\n- Area rule two from the sync.')
    const run1 = runBracketed(p, lines[1])
    check(run1.status === 0 && run1.stdout.includes('result=ok'), `the runner run passes (${run1.stdout}${run1.stderr})`)
    check(!run1.stdout.includes('the secret reached'), 'the project command does not see a secret from the caller environment')
    check(run1.stdout.includes('gen: home entries 0'), 'the project command runs with an empty HOME')
    check(JSON.stringify(statusPaths(p.ws)) === JSON.stringify(['.claude/rules/area.md', 'AGENTS.md']), `the sync leaves only the edited source and the regenerated guide (${statusPaths(p.ws)})`)
    check(readFileSync(join(p.ws, 'AGENTS.md'), 'utf8').includes('Area rule two from the sync.'), 'the regenerated guide holds the source edit')
    check(run('bash', [VERIFY.split(' ')[1]], { cwd: p.ws }).status === 0, 'the project verify command passes on the result')

    const tampered = lines[1].replace(/--state [0-9a-f]+/, `--state ${'0'.repeat(64)}`)
    const bad = runBracketed(p, tampered)
    check(bad.status !== 0 && bad.stdout.includes('does not match the digest'), 'a wrong state digest is refused')

    writeFileSync(join(p.ws, 'scripts/gen-guide.sh'), 'echo pwned > pwned.txt\n')
    const changedGen = runBracketed(p, lines[1])
    check(changedGen.status !== 0 && changedGen.stdout.includes('command file scripts/gen-guide.sh differs'), 'a changed command file is refused')
    check(!existsSync(join(p.ws, 'pwned.txt')), 'a changed command file never runs')
    git(p.ws, 'checkout', '--', 'scripts/gen-guide.sh')
    writeFileSync(join(p.ws, 'scripts/helper.sh'), 'echo planted\n')
    const planted = runBracketed(p, lines[0])
    check(planted.status !== 0 && planted.stdout.includes('scripts/helper.sh'), 'an untracked file planted under a command directory is refused')
    rmSync(join(p.ws, 'scripts/helper.sh'))
    replaceIn(p.ws, 'CLAUDE.md', `- Verify: \`${VERIFY}\``, '- Verify: `bash scripts/other.sh`')
    const block = runBracketed(p, lines[1])
    check(block.status !== 0 && block.stdout.includes('contract block in the work tree'), 'a changed contract block in the work tree is refused')
  }

  section = `${flavor} compose, denied and malformed statements`
  {
    const denied = compose(flavor, project('contract'), 'sync-docs', OTHER_EXTRA)
    check(denied.status === 0, 'compose exits 0 with no permit')
    check(denied.prompt.includes('state for this run is denied') && denied.prompt.includes(`Bash(${REGENERATE})`), 'the prompt names the denied state and the missing entry')
    check(bracketed(denied.prompt).length === 0, 'a denied state gives no runner command')
    const wildcard = compose(flavor, project('contract'), 'sync-docs', 'Bash(bash *)')
    check(wildcard.prompt.includes('state for this run is denied'), 'a wildcard entry does not permit a project command')
    const releaseFlow = compose(flavor, project('contract'), 'create-release', `${OTHER_EXTRA},${PERMIT}`)
    check(!releaseFlow.prompt.includes('Agent guide contract'), 'the create-release flow reads no contract')
    const malformed = [
      ['a missing label', (s) => replaceIn(s, 'CLAUDE.md', '- Verify: `bash scripts/check-guide.sh`\n', '')],
      ['a stray line', (s) => replaceIn(s, 'CLAUDE.md', '- Command files: `scripts/`', '- Command files: `scripts/`\nSome prose.')],
      ['a repeated label', (s) => replaceIn(s, 'CLAUDE.md', '- Command files: `scripts/`', '- Command files: `scripts/`\n- Sources: `README.md`')],
      ['a parent segment', (s) => replaceIn(s, 'CLAUDE.md', '`.claude/rules/*.md`', '`../rules/*.md`')],
      ['a shell character', (s) => replaceIn(s, 'CLAUDE.md', '`bash scripts/gen-guide.sh`', '`bash scripts/gen-guide.sh; true`')],
      ['a generated glob', (s) => replaceIn(s, 'CLAUDE.md', '- Generated: `AGENTS.md`', '- Generated: `*.md`')],
      ['a generated source', (s) => replaceIn(s, 'CLAUDE.md', '- Generated: `AGENTS.md`', '- Generated: `AGENTS.md`, `.claude/rules/area.md`')],
      ['a second heading', (s) => replaceIn(s, 'CLAUDE.md', '## Area notes', `${HEADING}\n- Generated: \`AGENTS.md\`\n\n## Area notes`)],
    ]
    for (const [label, mutate] of malformed) {
      const c = compose(flavor, project('contract', { mutate }), 'sync-docs', PERMIT)
      check(c.status === 0 && c.prompt.includes('state for this run is malformed'), `${label}: the state is malformed (${c.log.slice(0, 400)})`)
      check(bracketed(c.prompt).length === 0, `${label}: no runner command is given`)
      if (flavor === 'claude') check(!(c.prompt.match(/--allowedTools "([^"]*)"/)?.[1] ?? '').split(',').includes(`Bash(${REGENERATE})`), `${label}: the raw command stays off the allowlist`)
    }
    const fencedText = `# Plain\n\n\`\`\`\n${HEADING}\n- Generated: \`AGENTS.md\`\n\`\`\`\n`
    const fence = (s) => writeFileSync(join(s, 'CLAUDE.md'), fencedText)
    for (const flow of ['sync-docs', 'sync-release']) {
      const fenced = compose(flavor, project('plain', { mutate: fence }), flow, OTHER_EXTRA)
      check(fenced.status === 0 && !fenced.prompt.includes('state for this run') && !fenced.prompt.includes('runner check command'), `${flow}: a heading inside a code fence adds no fragment and no state sentence (${fenced.log.slice(0, 300)})`)
      if (flavor === 'claude') check((fenced.prompt.match(/--allowedTools "([^"]*)"/)?.[1] ?? '').split(',').includes(OTHER_EXTRA), `${flow}: a fenced heading keeps the caller entry ${OTHER_EXTRA}`)
      if (legacyAvailable) {
        const before = compose(flavor, project('plain', { mutate: fence }), flow, OTHER_EXTRA, LEGACY_BASE)
        const strip = (result) => result.prompt.replaceAll(result.dir, '<project>').replace(/RK_TRIGGER_[0-9a-f]+/g, 'RK_TRIGGER_X')
        check(before.status === 0 && strip(before) === strip(fenced), `${flow}: with a fenced heading the composed output equals the ${LEGACY_BASE.slice(0, 7)} result`)
      }
    }
    const both = compose(flavor, project('contract', { mutate: (s) => writeFileSync(join(s, 'CLAUDE.md'), `${readFileSync(join(s, 'CLAUDE.md'), 'utf8')}\n## Example\n\n\`\`\`\n${HEADING}\n- Generated: \`OTHER.md\`\n\`\`\`\n`) }), 'sync-docs', PERMIT)
    check(both.status === 0 && both.prompt.includes('state for this run is ready') && bracketed(both.prompt).length === 2, `a fenced example beside a valid statement reads the statement outside the fence (${both.log.slice(0, 300)})`)
  }

  section = `${flavor} compose, statement only in pull request content`
  {
    const p = project('plain')
    git(p.ws, 'checkout', '-q', '-b', 'feature')
    cpSync(join(FIXTURES, 'contract/CLAUDE.md'), join(p.ws, 'CLAUDE.md'))
    git(p.ws, 'commit', '-q', '-am', 'add a contract on a branch')
    const c = compose(flavor, p, 'sync-docs', PERMIT)
    check(c.status === 0 && !c.prompt.includes('Agent guide contract'), 'a statement on the checked-out branch alone is ignored')
    const fallback = compose(flavor, p, 'sync-docs', PERMIT)
    check(fallback.outputs.trusted_sha === git(p.bare, 'rev-parse', 'main'), 'the trusted commit is the default-branch tip')
  }

  section = `${flavor} compose, default branch unreachable`
  {
    const p = project('contract')
    stage(p, flavor)
    const env = { ...composeEnv(flavor, p, 'sync-docs', PERMIT), DEFAULT_BRANCH: 'missing-branch', GITHUB_REF: 'refs/heads/feature' }
    const c = runStep(p, flavor, COMPOSE[flavor], env)
    const prompt = flavor === 'claude' ? c.outputs.claude_args ?? '' : readFileSync(join(p.rt, 'rk-shared/prompt.md'), 'utf8')
    check(c.status === 0 && c.outputs.trusted_sha === '' && !prompt.includes('Agent guide contract'), 'off the default branch with no fetch, the contract is not read')
  }
}

function postImplement(flavor, { kind = 'contract', mutate, extra = `${OTHER_EXTRA},${PERMIT}`, session, edit, flow = '', reviseOutcome = 'success' } = {}) {
  const p = project(kind, { mutate })
  stage(p, flavor)
  const record = runStep(p, flavor, RECORD[flavor], { GH_TOKEN: 'fixture-token', PR_NUMBER: '', REPO: SLUG })
  const composed = runStep(p, flavor, COMPOSE[flavor], composeEnv(flavor, p, flow, extra))
  const wt = join(p.ws, '.claude/worktrees/cc/issue-1-session')
  git(p.ws, 'worktree', 'add', '-q', '-b', 'cc/issue-1-session', wt)
  writeFileSync(join(wt, 'feature.txt'), 'implemented\n')
  git(wt, 'add', 'feature.txt')
  git(wt, 'commit', '-q', '-m', 'feat: implement the fixture issue')
  session?.(wt, p)
  git(wt, 'push', '-q', 'origin', 'cc/issue-1-session')
  const sessionTip = git(wt, 'rev-parse', 'HEAD')
  const env = {
    FLOW: flow,
    TRUSTED_SHA: composed.outputs.trusted_sha,
    RUNNER_SHA: composed.outputs.guide_runner_sha,
    REFS_SHA: record.outputs.refs_sha,
    START_SHA: record.outputs.head_sha,
    DEFAULT_BRANCH: 'main',
    REPO: SLUG,
    RK_EXTRA_ALLOWED: extra,
    GH_TOKEN: 'fixture-token',
  }
  const prepare = runStep(p, flavor, PREPARE, env)
  const result = { p, record, composed, prepare, sessionTip, revise: join(p.ws, '.claude/worktrees/rk-guide-revise') }
  if (prepare.outputs.state === 'ready') {
    edit?.(result.revise, p)
    result.settle = runStep(p, flavor, SETTLE[flavor], { DIGEST: prepare.outputs.digest, RUNNER_SHA: composed.outputs.guide_runner_sha, MODEL_ID: 'fixture-model', EFFORT: 'high' })
    result.pwned = existsSync(join(result.revise, 'pwned')) || existsSync(join(p.ws, 'pwned'))
    if (flavor === 'claude' && result.settle.outputs.result === 'committed') {
      result.push = run('git', ['-C', '.claude/worktrees/rk-guide-revise', 'push'], { cwd: p.ws })
    }
  }
  if (['ready', 'stop'].includes(prepare.outputs.state)) {
    result.report = runStep(p, flavor, REPORT, {
      GH_TOKEN: 'fixture-token',
      STATE: prepare.outputs.state,
      REASON: prepare.outputs.reason ?? '',
      DIGEST: prepare.outputs.digest ?? '',
      REVISE_OUTCOME: reviseOutcome,
      RUNNER_SHA: composed.outputs.guide_runner_sha,
      REPO: SLUG,
      ISSUE_NUMBER: '1',
      RUN_URL: 'https://github.com/fixture-owner/fixture-repo/actions/runs/1',
    })
  }
  result.remoteTip = git(p.bare, 'rev-parse', 'refs/heads/cc/issue-1-session')
  result.comments = readdirSync(p.ghLog).filter((name) => name.startsWith('comment-')).sort().map((name) => readFileSync(join(p.ghLog, name), 'utf8'))
  return result
}

function addRule(revise) {
  replaceIn(revise, '.claude/rules/area.md', '- Area rule one.', '- Area rule one.\n- Area rule learned in the session.')
}

for (const flavor of ['claude', 'codex']) {
  section = `${flavor} post-implementation, success`
  {
    const r = postImplement(flavor, { edit: (wt) => { addRule(wt); writeFileSync(join(wt, '.rk-guide-commit-message.txt'), 'docs: record the session rule\n\nThe session learned one area rule.\n') } })
    check(r.prepare.outputs.state === 'ready', `prepare is ready (${r.prepare.log})`)
    check(r.prepare.outputs.prompt === undefined || flavor === 'claude', 'only the Claude prepare step emits the prompt as an output')
    if (flavor === 'claude') check((r.prepare.outputs.prompt ?? '').includes('The work tree for this pass is'), 'the Claude prepare step emits the revise prompt')
    const settled = flavor === 'claude' ? 'committed' : 'pushed'
    check(r.settle?.outputs.result === settled, `settle reports ${settled} (${r.settle?.log})`)
    if (flavor === 'claude') check(r.push?.status === 0, `the exact push-only command pushes to the session branch (${r.push?.stderr})`)
    check(r.remoteTip !== r.sessionTip, 'the session branch on the remote moved')
    const files = git(r.p.bare, 'show', '--name-only', '--format=', r.remoteTip).split('\n').sort()
    check(JSON.stringify(files) === JSON.stringify(['.claude/rules/area.md', 'AGENTS.md']), `one commit holds the source edit and the regenerated guide (${files})`)
    check(git(r.p.bare, 'rev-parse', `${r.remoteTip}^`) === r.sessionTip, 'the guide commit sits on the session tip')
    const message = git(r.p.bare, 'log', '-1', '--format=%B', r.remoteTip)
    check(message.startsWith('docs: record the session rule') && message.includes('Updated with LLM: fixture-model | high'), `the commit uses the validated message and the footer (${message})`)
    const verify = fresh('verify-clone')
    git(verify, 'clone', '-q', '--branch', 'cc/issue-1-session', r.p.bare, 'c')
    check(run('bash', ['scripts/check-guide.sh'], { cwd: join(verify, 'c') }).status === 0, 'the project verify command passes on the pushed branch')
    check(r.comments.length === 0, 'a successful pass posts no comment')
    check(!existsSync(r.revise), 'the report step removes the revise work tree')
  }

  section = `${flavor} post-implementation, nothing learned`
  {
    const r = postImplement(flavor, {})
    check(r.settle?.outputs.result === 'none' && r.remoteTip === r.sessionTip && r.comments.length === 0, 'no source edit makes no commit and no comment')
    const failed = postImplement(flavor, { reviseOutcome: 'failure' })
    check(failed.settle?.outputs.result === 'none' && failed.remoteTip === failed.sessionTip, 'a failed revise step with no edit makes no commit')
    check(failed.comments.length === 1 && failed.comments[0].includes('the revise step ended with the outcome failure'), `a failed revise step with no edit posts one comment that names the failed step (${failed.comments.join(' | ')})`)
    const edited = postImplement(flavor, { reviseOutcome: 'failure', edit: addRule })
    check(['committed', 'pushed'].includes(edited.settle?.outputs.result) && edited.comments.length === 0, `a failed revise step that left a valid source edit still lands the commit with no comment (${edited.settle?.log})`)
  }

  const failing = [
    ['no permit', { extra: OTHER_EXTRA }, 'prepare', `Bash(${REGENERATE})`],
    ['a wildcard permit', { extra: 'Bash(bash *)' }, 'prepare', `Bash(${REGENERATE})`],
    ['a failing regenerate', { mutate: useVariant('gen-fail.sh', 'gen-guide.sh'), edit: addRule }, 'settle', REGENERATE],
    ['a failing verify', { mutate: useVariant('check-fail.sh', 'check-guide.sh'), edit: addRule }, 'settle', VERIFY],
    ['a verify that writes', { mutate: useVariant('check-writes.sh', 'check-guide.sh'), edit: addRule }, 'settle', VERIFY],
    ['a generator that writes an extra file', { mutate: useVariant('gen-extra.sh', 'gen-guide.sh'), edit: addRule }, 'settle', 'stray-output.txt'],
    ['an edit outside the sources', { edit: (wt) => writeFileSync(join(wt, 'README.md'), 'new\n') }, 'settle', 'README.md'],
    ['an edit of a generated file', { edit: (wt) => writeFileSync(join(wt, 'AGENTS.md'), 'hand edit\n') }, 'settle', 'AGENTS.md'],
    ['an edit of the contract block', { edit: (wt) => replaceIn(wt, 'CLAUDE.md', '- Command files: `scripts/`', '- Command files: `scripts/`, `tools/`') }, 'settle', 'contract block'],
    ['an edit of a command file', { edit: (wt) => { addRule(wt); writeFileSync(join(wt, 'scripts/gen-guide.sh'), 'touch pwned\n') } }, 'settle', 'scripts/gen-guide.sh'],
    ['a commit by the revise agent', { edit: (wt) => { addRule(wt); git(wt, 'commit', '-q', '-am', 'agent commit') } }, 'settle', 'session commit'],
    ['a session that changed the generator', { session: (wt) => { writeFileSync(join(wt, 'scripts/gen-guide.sh'), 'touch pwned\n'); git(wt, 'commit', '-q', '-am', 'change the generator') } }, 'prepare', 'scripts/gen-guide.sh'],
    ['a session that changed the statement', { session: (wt) => { replaceIn(wt, 'CLAUDE.md', '- Command files: `scripts/`', '- Command files: `scripts/`, `tools/`'); git(wt, 'commit', '-q', '-am', 'change the contract') } }, 'prepare', 'contract block'],
    ['a filter driver added to the git configuration', { edit: (wt) => { addRule(wt); git(wt, 'config', 'filter.fixture.clean', 'touch pwned'); writeFileSync(join(wt, '.claude/rules/.gitattributes'), '*.md filter=fixture\n') } }, 'settle', 'configuration key'],
    ['a changed push target', { edit: (wt) => { addRule(wt); git(wt, 'config', 'branch.rk-guide/revise.merge', 'refs/heads/main') } }, 'settle', 'configuration key'],
    ['an ignored file under a source path', { mutate: (s) => writeFileSync(join(s, '.gitignore'), '.claude/rules/local-*.md\n'), edit: (wt) => { addRule(wt); writeFileSync(join(wt, '.claude/rules/local-notes.md'), 'hidden\n') } }, 'settle', 'ignored file'],
    ['an ignored file outside the sources', { mutate: (s) => writeFileSync(join(s, '.gitignore'), 'vendor/\n'), edit: (wt) => { addRule(wt); mkdirSync(join(wt, 'vendor'), { recursive: true }); writeFileSync(join(wt, 'vendor/planted.sh'), 'touch pwned\n') } }, 'settle', 'vendor/planted.sh'],
    ['an ignored file with no source edit', { mutate: (s) => writeFileSync(join(s, '.gitignore'), 'vendor/\n'), edit: (wt) => { mkdirSync(join(wt, 'vendor'), { recursive: true }); writeFileSync(join(wt, 'vendor/planted.sh'), 'touch pwned\n') } }, 'settle', 'vendor/planted.sh'],
    ['two session branches', { session: (wt) => git(wt, 'branch', 'cc/issue-1-other') }, 'prepare', '2 new or moved'],
  ]
  for (const [label, options, where, needle] of failing) {
    section = `${flavor} post-implementation, ${label}`
    const r = postImplement(flavor, options)
    if (where === 'prepare') {
      check(r.prepare.outputs.state === 'stop', `prepare stops (${JSON.stringify(r.prepare.outputs)} ${r.prepare.log})`)
      check(r.settle === undefined, 'no settle runs')
      check(!existsSync(join(r.p.ws, 'pwned')) && !existsSync(r.revise), 'the generator never runs and no revise work tree exists')
      check(!existsSync(join(r.p.ws, '.claude/worktrees/cc/issue-1-session/pwned')), 'the changed session generator never runs')
    } else {
      check(r.prepare.outputs.state === 'ready', `prepare is ready (${r.prepare.log})`)
      check(r.settle?.outputs.result === 'stop', `settle stops (${r.settle?.log})`)
      check(r.pwned === false, 'no planted program runs')
    }
    check(r.remoteTip === r.sessionTip, 'the session branch tip is unchanged')
    check(r.comments.length === 1 && r.comments[0].includes(needle), `one comment names ${needle} (${r.comments.join(' | ')})`)
    check(r.report?.status === 0, 'the report step exits 0')
  }

  section = `${flavor} post-implementation, unpushed session branch`
  {
    const p = project('contract')
    stage(p, flavor)
    const record = runStep(p, flavor, RECORD[flavor], { GH_TOKEN: 'x', PR_NUMBER: '', REPO: SLUG })
    const composed = runStep(p, flavor, COMPOSE[flavor], composeEnv(flavor, p, '', PERMIT))
    git(p.ws, 'branch', 'cc/issue-1-local')
    git(p.ws, 'update-ref', 'refs/heads/cc/issue-1-local', git(p.ws, 'commit-tree', '-p', 'HEAD', '-m', 'local', 'HEAD^{tree}'))
    const prepare = runStep(p, flavor, PREPARE, { FLOW: '', TRUSTED_SHA: composed.outputs.trusted_sha, RUNNER_SHA: composed.outputs.guide_runner_sha, REFS_SHA: record.outputs.refs_sha, DEFAULT_BRANCH: 'main', REPO: SLUG, RK_EXTRA_ALLOWED: PERMIT, GH_TOKEN: 'x' })
    check(prepare.outputs.state === 'stop' && (prepare.outputs.reason ?? '').includes('not on the remote'), `an unpushed branch stops the pass (${JSON.stringify(prepare.outputs)})`)
  }

  section = `${flavor} post-implementation, tampered branch snapshot`
  {
    const r = postImplement(flavor, { session: (_wt, p) => writeFileSync(join(p.rt, 'rk-shared/refs-before.txt'), '') })
    check(r.prepare.outputs.state === 'stop' && (r.prepare.outputs.reason ?? '').includes('branch list'), 'a changed branch snapshot stops the pass')
  }

  section = `${flavor} post-implementation, no statement`
  for (const layout of ['symlink', 'hand-mirror']) {
    const r = postImplement(flavor, { kind: 'plain', mutate: (s) => { if (layout === 'symlink') symlinkSync('CLAUDE.md', join(s, 'AGENTS.md')); else cpSync(join(s, 'CLAUDE.md'), join(s, 'AGENTS.md')) } })
    check(r.prepare.outputs.state === 'none' && r.comments.length === 0 && r.report === undefined, `${layout}: the state is none, so only the legacy revise step runs`)
  }
  {
    for (const flow of ['sync-docs', 'sync-release']) {
      const r = postImplement(flavor, { flow })
      check(r.prepare.outputs.state === 'skip' && r.report === undefined && !existsSync(r.revise), `${flow}: a documentation flow with a contract skips the revise pass`)
    }
    const fencedOnly = '# Plain\n\n```\n' + HEADING + '\n- Generated: `AGENTS.md`\n```\n'
    const fencedFlow = postImplement(flavor, { kind: 'plain', mutate: (s) => writeFileSync(join(s, 'CLAUDE.md'), fencedOnly), flow: 'sync-docs' })
    check(fencedFlow.prepare.outputs.state === 'none' && fencedFlow.report === undefined, `a fenced heading with a documentation flow gives the state none, so the legacy revise step runs (${JSON.stringify(fencedFlow.prepare.outputs)})`)
    const fencedPlain = postImplement(flavor, { kind: 'plain', mutate: (s) => writeFileSync(join(s, 'CLAUDE.md'), fencedOnly) })
    check(fencedPlain.prepare.outputs.state === 'none', 'a fenced heading with no flow gives the state none')
    const fencedBeside = postImplement(flavor, { mutate: (s) => writeFileSync(join(s, 'CLAUDE.md'), `${readFileSync(join(s, 'CLAUDE.md'), 'utf8')}\n## Example\n\n\`\`\`\n${HEADING}\n- Generated: \`OTHER.md\`\n\`\`\`\n`) })
    check(fencedBeside.prepare.outputs.state === 'ready', `a fenced example beside a valid statement with no flow gives the state ready (${JSON.stringify(fencedBeside.prepare.outputs)})`)
    const promptOf = (r) => readFileSync(join(r.p.rt, 'rk-guide-revise/prompt.md'), 'utf8')
    const withRoot = postImplement(flavor, {})
    check(promptOf(withRoot).includes('The root CLAUDE.md is a stated source, so the rule 3 fallback to CLAUDE.md applies.'), 'the revise prompt keeps the CLAUDE.md fallback when CLAUDE.md is a stated source')
    const rulesOnly = postImplement(flavor, { mutate: (s) => replaceIn(s, 'CLAUDE.md', '- Sources: `CLAUDE.md`, `.claude/rules/*.md`', '- Sources: `.claude/rules/*.md`'), edit: (wt) => writeFileSync(join(wt, '.claude/rules/area.md'), `${readFileSync(join(wt, '.claude/rules/area.md'), 'utf8')}- A learned area rule.\n`) })
    check(rulesOnly.prepare.outputs.state === 'ready' && promptOf(rulesOnly).includes('The root CLAUDE.md is not a stated source, so never edit it') && !promptOf(rulesOnly).includes('fallback to CLAUDE.md applies'), `with rule files as the only sources the revise prompt forbids a CLAUDE.md edit (${JSON.stringify(rulesOnly.prepare.outputs)})`)
    check(['committed', 'pushed'].includes(rulesOnly.settle?.outputs.result) && rulesOnly.comments.length === 0, `with rule files as the only sources a rule-file edit lands (${rulesOnly.settle?.log})`)
  }
  {
    const p = project('plain')
    stage(p, flavor)
    const record = runStep(p, flavor, RECORD[flavor], { GH_TOKEN: 'x', PR_NUMBER: '', REPO: SLUG })
    const composed = runStep(p, flavor, COMPOSE[flavor], composeEnv(flavor, p, '', PERMIT))
    git(p.ws, 'checkout', '-q', '-b', 'cc/issue-1-session')
    cpSync(join(FIXTURES, 'contract/CLAUDE.md'), join(p.ws, 'CLAUDE.md'))
    git(p.ws, 'commit', '-q', '-am', 'add a contract in the session')
    git(p.ws, 'push', '-q', 'origin', 'cc/issue-1-session')
    const prepare = runStep(p, flavor, PREPARE, { FLOW: '', TRUSTED_SHA: composed.outputs.trusted_sha, RUNNER_SHA: composed.outputs.guide_runner_sha, REFS_SHA: record.outputs.refs_sha, DEFAULT_BRANCH: 'main', REPO: SLUG, RK_EXTRA_ALLOWED: PERMIT, GH_TOKEN: 'x' })
    check(prepare.outputs.state === 'none', 'a statement only on the session branch is ignored')
  }

  section = `${flavor} revise step wiring`
  {
    const revise = stepOf(flavor, 'Revise the guide sources')
    const report = stepOf(flavor, REPORT)
    check(revise.id === 'guide_revise' && revise['continue-on-error'] === true, 'the revise step has the id that the report step reads')
    check(report.env.REVISE_OUTCOME === '${{ steps.guide_revise.outcome }}' && report.run.includes('--revise-outcome "$REVISE_OUTCOME"'), 'the report step passes the revise step outcome to the runner')
    if (flavor === 'claude') {
      const main = stepOf(flavor, 'Push the agent guide commit')
      check(revise.with.allowed_bots === 'claude' && main.with.allowed_bots === 'claude', 'both new action steps admit the claude bot actor')
    }
  }

  section = `${flavor} legacy revise step`
  {
    const step = stepOf(flavor, REVISE_LEGACY[flavor])
    check(step.if.endsWith(" && steps.guide_contract.outputs.state == 'none'"), 'the legacy revise step runs only when the state is none')
    if (legacyAvailable) {
      const old = stepOf(flavor, REVISE_LEGACY[flavor], LEGACY_BASE)
      check(JSON.stringify(step.with) === JSON.stringify(old.with) && step.uses === old.uses && JSON.stringify(step.env) === JSON.stringify(old.env), 'the legacy revise step keeps its action, inputs, and environment')
      check(step.if === `${old.if} && steps.guide_contract.outputs.state == 'none'`, 'the legacy condition is unchanged apart from the state test')
    }
  }
}

section = 'Claude allowlist'
const claudeBin = process.env.RK_CLAUDE_BIN
if (claudeBin) {
  const p = project('contract')
  const c = compose('claude', p, 'sync-docs', `${OTHER_EXTRA},${PERMIT}`)
  const allowed = c.prompt.match(/--allowedTools "([^"]*)"/)?.[1] ?? ''
  const [checkLine, runLine] = bracketed(c.prompt)
  const pushOnly = 'Bash(git -C .claude/worktrees/rk-guide-revise push)'
  git(p.ws, 'worktree', 'add', '-q', '-b', 'rk-guide/revise', '.claude/worktrees/rk-guide-revise')
  git(p.ws, 'config', 'branch.rk-guide/revise.remote', 'origin')
  git(p.ws, 'config', 'branch.rk-guide/revise.merge', 'refs/heads/allowlist-target')
  git(p.ws, 'config', 'push.default', 'upstream')
  const mainBefore = git(p.bare, 'rev-parse', 'main')
  const cases = [
    [allowed, checkLine, true, 'the exact runner check command'],
    [allowed, runLine, true, 'the exact runner run command'],
    [allowed, REGENERATE, false, 'the raw regenerate command'],
    [allowed, VERIFY, false, 'the raw verify command'],
    [allowed, `${checkLine} && touch allowlist-pwned`, false, 'the runner command with a compound tail'],
    [allowed, `RK_X=1 ${checkLine}`, false, 'the runner command with an environment prefix'],
    [allowed, `${checkLine} --extra`, false, 'the runner command with an extra argument'],
    [allowed, 'touch allowlist-pwned', false, 'an arbitrary command'],
    [pushOnly.slice(5, -1), 'git -C .claude/worktrees/rk-guide-revise push', true, 'the exact push-only command'],
    [pushOnly.slice(5, -1), 'git -C .claude/worktrees/rk-guide-revise push --force', false, 'a forced push'],
    [pushOnly.slice(5, -1), 'git -C .claude/worktrees/rk-guide-revise push origin HEAD:refs/heads/main', false, 'a push to another branch'],
  ]
  const groups = new Map()
  for (const [list, command, expected, label] of cases) {
    const key = list.startsWith('git -C') ? pushOnly : list
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push({ command, expected, label })
  }
  for (const [list, items] of groups) {
    const dir = fresh('allowlist')
    const script = join(dir, 'commands.json')
    writeFileSync(script, JSON.stringify(items.map((item) => item.command)))
    const portFile = join(dir, 'port')
    const log = join(dir, 'mock.jsonl')
    const mock = Bun.spawn(['python3', '-I', join(root, 'docs/review-sandbox-probe/mock_messages_api.py'), '--port-file', portFile, '--script', script, '--log', log], { stdout: 'ignore', stderr: 'ignore' })
    for (let i = 0; i < 100 && !(existsSync(portFile) && readFileSync(portFile, 'utf8')); i += 1) await Bun.sleep(100)
    const port = readFileSync(portFile, 'utf8')
    const home = join(dir, 'home')
    mkdirSync(home)
    const claude = run(claudeBin, ['-p', 'run the allowlist probe', '--output-format', 'stream-json', '--verbose', '--model', 'claude-sonnet-5-5', '--permission-mode', 'default', '--allowedTools', list], {
      cwd: p.ws,
      env: { PATH: process.env.PATH, HOME: home, ANTHROPIC_API_KEY: 'sk-ant-fixture', ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`, DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1', DISABLE_AUTOUPDATER: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' },
    })
    mock.kill()
    const records = existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : []
    items.forEach((item, index) => {
      const record = records.find((entry) => entry.event === 'tool_result' && entry.index === index)
      const permitted = record && (!record.is_error || /result=|usage: guide_contract\.py|fatal:|^error:|gen: |check: /m.test(record.text ?? ''))
      check(record !== undefined, `${item.label}: Claude Code returned a tool result (exit ${claude.status}, ${claude.stderr.slice(0, 300)})`)
      check(Boolean(permitted) === item.expected, `${item.label}: ${item.expected ? 'permitted' : 'denied'} (${record?.text?.slice(0, 200)})`)
    })
    check(!existsSync(join(p.ws, 'allowlist-pwned')), 'no denied command ran')
  }
  check(run('git', ['-C', p.bare, 'rev-parse', '--verify', '-q', 'refs/heads/allowlist-target']).status === 0, 'the permitted push-only command pushed to the upstream branch')
  check(git(p.bare, 'rev-parse', 'main') === mainBefore, 'the denied push to another branch did not run')
  console.log(`Claude allowlist cases ran with ${run(claudeBin, ['--version']).stdout.trim()}.`)
} else {
  console.log('Claude allowlist cases skipped: set RK_CLAUDE_BIN to a Claude Code binary to run them.')
}

run('chmod', ['-R', 'u+w', scratch])
rmSync(scratch, { recursive: true, force: true })
if (failures.length) {
  console.log(`Guide contract integration: ${failures.length} of ${checks} checks failed:\n${failures.join('\n')}`)
  process.exit(1)
}
console.log(`Guide contract integration: all ${checks} checks passed.`)
