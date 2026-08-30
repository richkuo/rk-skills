import { describe, expect, test } from 'bun:test'
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

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
	test('scans every declared root and finds references where they exist', () => {
		expect(workflowFiles.length).toBeGreaterThan(0)
		for (const dir of ['.github/workflows', 'templates']) {
			expect(references.some(({ path }) => path.startsWith(`${dir}/`))).toBe(true)
		}
	})

	test('catches a mutable ref added under a scanned-but-currently-empty root', () => {
		const fixtureDir = fileURLToPath(new URL('.github/actions/_pinning-test-fixture', root))
		mkdirSync(fixtureDir, { recursive: true })
		writeFileSync(`${fixtureDir}/action.yml`, 'runs:\n  using: composite\n  steps:\n    - uses: actions/checkout@v7\n')
		try {
			const fixtureFiles = walk('.github/actions')
			expect(fixtureFiles).toContain('.github/actions/_pinning-test-fixture/action.yml')

			const fixtureRefs = fixtureFiles.flatMap((path) => {
				const source = readFileSync(fileURLToPath(new URL(path, root)), 'utf8')
				return [...source.matchAll(USES)].map((match) => match[1])
			})
			const mutable = fixtureRefs.filter((ref) => !isOwnWorkflow(ref) && !PINNED.test(ref))
			expect(mutable).toEqual(['actions/checkout@v7'])
		} finally {
			rmSync(fixtureDir, { recursive: true, force: true })
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
			['.github/workflows/claude-run.yml', 'anthropics/claude-code-action@v1'],
			['.github/workflows/codex-run.yml', 'openai/codex-action@v1'],
		]

		for (const [path, expected] of harnesses) {
			expect(await read(path)).toContain(`CLAUDE_HARNESS: ${expected}\n`)
		}
	})
})
