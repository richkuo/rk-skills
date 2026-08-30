import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = new URL('../', import.meta.url)
const read = (path) => Bun.file(new URL(path, root)).text()

const SCANNED_ROOTS = ['.github/workflows', '.github/actions', 'templates']
const OWN_REPO = 'richkuo/rk-skills'
const USES = /^\s*(?:-\s+)?uses:\s*(\S+)/gm
const PINNED = /^[^@]+@[0-9a-f]{40}$/

function walk(relDir) {
	const absolute = fileURLToPath(new URL(relDir, root))
	const found = []
	let entries
	try {
		entries = readdirSync(absolute, { withFileTypes: true })
	} catch (err) {
		if (err.code === 'ENOENT') return found
		throw err
	}
	for (const entry of entries) {
		const child = `${relDir}/${entry.name}`
		if (entry.isDirectory()) found.push(...walk(child))
		else if (/\.ya?ml$/.test(entry.name)) found.push(child)
	}
	return found.sort()
}

const workflowFiles = SCANNED_ROOTS.flatMap((dir) => walk(dir))

const references = (
	await Promise.all(
		workflowFiles.map(async (path) => {
			const source = await read(path)
			return [...source.matchAll(USES)].map((match) => ({ path, ref: match[1] }))
		}),
	)
).flat()

const isOwnWorkflow = (ref) => ref.startsWith(`${OWN_REPO}/`)

describe('GitHub Actions pinning contract', () => {
	test('finds references under the workflow and template roots', () => {
		expect(workflowFiles.length).toBeGreaterThan(0)
		for (const dir of ['.github/workflows', 'templates']) {
			expect(references.some(({ path }) => path.startsWith(`${dir}/`))).toBe(true)
		}
	})

	test('the scanner flags a mutable ref and walks nested .yml and .yaml files', () => {
		const fixture = mkdtempSync(join(tmpdir(), 'rk-pinning-'))
		try {
			mkdirSync(join(fixture, 'nested'), { recursive: true })
			writeFileSync(join(fixture, 'nested/action.yml'), 'runs:\n  using: composite\n  steps:\n    - uses: actions/checkout@v7\n')
			writeFileSync(join(fixture, 'pinned.yaml'), `jobs:\n  a:\n    steps:\n      - uses: actions/checkout@${'0'.repeat(40)} # v7\n      - uses: actions/setup-node@${'a'.repeat(7)}\n`)
			writeFileSync(join(fixture, 'ignored.txt'), 'uses: actions/checkout@v1\n')
			const base = pathToFileURL(fixture).href
			const files = walk(base)
			expect(files.map((path) => path.slice(base.length + 1))).toEqual(['nested/action.yml', 'pinned.yaml'])
			const refs = files.flatMap((path) => [...readFileSync(fileURLToPath(path), 'utf8').matchAll(USES)].map((match) => match[1]))
			const mutable = refs.filter((ref) => !isOwnWorkflow(ref) && !PINNED.test(ref))
			expect(mutable).toEqual(['actions/checkout@v7', `actions/setup-node@${'a'.repeat(7)}`])
		} finally {
			rmSync(fixture, { recursive: true, force: true })
		}
	})

	test('pins every third-party action to a full commit SHA', () => {
		const mutable = references
			.filter(({ ref }) => !isOwnWorkflow(ref))
			.filter(({ ref }) => !PINNED.test(ref))
			.map(({ path, ref }) => `${path}: ${ref}`)

		expect(mutable).toEqual([])
	})

	test('labels every pinned SHA with the version it came from', async () => {
		const unlabelled = []
		for (const path of workflowFiles) {
			const source = await read(path)
			for (const line of source.split('\n')) {
				const match = /^\s*(?:-\s+)?uses:\s*(\S+)(.*)$/.exec(line)
				if (match === null || isOwnWorkflow(match[1])) continue
				if (!/^\s+#\s*\S/.test(match[2])) unlabelled.push(`${path}: ${line.trim()}`)
			}
		}

		expect(unlabelled).toEqual([])
	})

	test('keeps the reusable-workflow self-references on a branch ref', () => {
		const own = references.filter(({ ref }) => isOwnWorkflow(ref))

		expect(own.length).toBeGreaterThan(0)
		for (const { ref } of own) expect(ref.endsWith('@main')).toBe(true)
	})

	test('keeps the harness attribution strings on a readable tag', async () => {
		const harnesses = [
			['.github/workflows/claude-run.yml', 'anthropics/claude-code-action'],
			['.github/workflows/codex-run.yml', 'openai/codex-action'],
		]

		for (const [path, action] of harnesses) {
			expect(await read(path)).toMatch(new RegExp(`^\\s*CLAUDE_HARNESS: ${action.replace('/', '\\/')}@v\\d+(?:\\.\\d+)*$`, 'm'))
		}
	})
})
