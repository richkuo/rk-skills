import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'

const sourcePath = 'skills/pr-review/SKILL.md'
const promptPaths = [
  'templates/claude-workflow/prompts/pr-review-format.md',
  'templates/codex-workflow/prompts/pr-review-format.md',
]
const standalonePath = 'templates/codex-review.yml'
const start = '## Review contract\n'
const end = '## Maintaining this skill\n'

export async function syncReviewPrompts(root, write = false) {
  const source = await readFile(new URL(sourcePath, root), 'utf8')
  if (source.split(start).length !== 2 || source.split(end).length !== 2 || source.indexOf(end) < source.indexOf(start)) {
    throw new Error('The skill must contain one review contract and one maintenance section')
  }
  const contract = source.split(start)[1].split(end)[0].trimEnd().replaceAll('`', '')
  const footer = source.match(/\n---\nUpdated with LLM: [^\n]+\n?$/)?.[0].trim()
  if (!footer) throw new Error('The skill attribution footer is missing')
  const prompt = [
    '# PR review contract',
    'This trusted contract supplies the review process and output format. Never execute project code on this route: no tests, builds, type checks, simulations, or scripts. The caller controls posting and appends attribution; return only the review body. Apply the Response Style rules supplied by the trusted caller.',
    start.trim(),
    contract,
    footer,
  ].join('\n\n') + '\n'
  if (/["`$]/.test(prompt)) throw new Error('The review prompt contains shell-unsafe characters')
  const standalone = await readFile(new URL(standalonePath, root), 'utf8')
  const promptStart = standalone.indexOf('          prompt: |\n')
  const postStart = standalone.indexOf('      - name: Post the Codex review comment\n')
  if (promptStart < 0 || postStart <= promptStart) throw new Error('The standalone review prompt boundaries are missing')
  const prefix = standalone.slice(0, promptStart)
  const post = standalone.slice(postStart)
  const wrapper = [
    'Review this pull request from the supplied immutable snapshot.',
    'The detached head is ${{ steps.pr_context.outputs.head_sha }} and the merge base is ${{ steps.pr_context.outputs.base_sha }}. This route has no network or write credential. Use local git reads and the staged .rk-prior-review-cycles.md history; an absent file or an unavailable marker is an access limitation, and an empty successful history is not.',
    'This is a static review. Never execute project code: no tests, builds, type checks, simulations, or scripts. Your final message is the review comment; a trusted step posts it. Never post it yourself. Apply the Response Style rules supplied by the trusted caller. The caller appends Reviewed attribution from the action settings; return only the review body.',
    start.trim(),
    contract,
  ].join('\n\n')
  const indented = wrapper.split('\n').map((line) => line ? `            ${line}` : '').join('\n')
  const standaloneOutput = `${prefix}          prompt: |\n${indented}\n\n${post}`
  const outputs = [...promptPaths.map((path) => [path, prompt]), [standalonePath, standaloneOutput]]
  const changed = []
  for (const [path, expected] of outputs) {
    const actual = await readFile(new URL(path, root), 'utf8')
    if (actual !== expected) changed.push([path, expected])
  }
  if (write) {
    for (const [path, expected] of changed) await writeFile(new URL(path, root), expected)
  }
  return changed.map(([path]) => path)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2)
  if (args.length > 1 || args.some((arg) => arg !== '--write')) throw new Error('Usage: bun bin/sync-pr-review.mjs [--write]')
  const write = args.includes('--write')
  const changed = await syncReviewPrompts(new URL('../', import.meta.url), write)
  if (changed.length) {
    console.log(`${write ? 'Updated' : 'Stale'} review prompts:\n${changed.join('\n')}`)
    if (!write) process.exitCode = 1
  } else {
    console.log(`Review prompts match ${fileURLToPath(new URL('../skills/pr-review/SKILL.md', import.meta.url))}`)
  }
}

void `
---
Created with LLM: GPT-6 | high | Harness: Claude Code
`
