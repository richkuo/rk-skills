#!/usr/bin/env node
import {
	cpSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	realpathSync,
	rmSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const skillsSrc = join(pkgRoot, 'skills');
const workflowsSrc = join(pkgRoot, 'workflows');

// Every harness that auto-discovers `<home>/skills/<name>/SKILL.md`. `dir` is
// the harness home, relative to $HOME (user scope) or the repo root (--project).
// Only Claude Code runs the dynamic workflow scripts, so only it gets them.
// `alsoReadsFrom` lists other harnesses' skill roots this harness scans as well:
// Cursor discovers `.claude/skills` and `.codex/skills` for compatibility, so
// installing into all three roots would list every skill two or three times.
const HARNESSES = [
	{ id: 'claude', flag: '--claude', label: 'Claude Code', dir: '.claude', workflows: true, alsoReadsFrom: [] },
	{ id: 'codex', flag: '--codex', label: 'Codex', dir: '.codex', workflows: false, alsoReadsFrom: [] },
	{ id: 'cursor', flag: '--cursor', label: 'Cursor', dir: '.cursor', workflows: false, alsoReadsFrom: ['claude', 'codex'] },
];

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
	console.log(`rk-skills — install the workflow skills into your coding agents.

Usage: npx rk-skills [options]

Targets (repeatable; default: every harness already present on this machine)
  --claude      Claude Code   (~/.claude/skills)
  --codex       Codex         (~/.codex/skills)
  --cursor      Cursor        (~/.cursor/skills)
  --all         all three, creating the directories if they are missing

Scope
  --project     install into ./.claude, ./.codex, ./.cursor instead of $HOME

Cursor also discovers the Claude Code and Codex skill roots, so auto-detection
skips its own root when one of those is already installed. Skills already
symlinked to this package are left alone, so a development checkout keeps its
live links.`);
	process.exit(0);
}

const unknown = args.filter(
	(arg) =>
		!['--project', '--all', '--help', '-h'].includes(arg) &&
		!HARNESSES.some((h) => h.flag === arg),
);
if (unknown.length > 0) {
	console.error(`rk-skills: unknown option(s): ${unknown.join(', ')}`);
	console.error('Run `npx rk-skills --help` for the supported flags.');
	process.exit(1);
}

if (!existsSync(skillsSrc)) {
	console.error('rk-skills: could not find the skills/ directory in the package.');
	process.exit(1);
}

// Each skill is a directory under skills/ that contains a SKILL.md.
const skills = readdirSync(skillsSrc, { withFileTypes: true })
	.filter((entry) => entry.isDirectory())
	.map((entry) => entry.name)
	.filter((name) => existsSync(join(skillsSrc, name, 'SKILL.md')))
	.sort();

if (skills.length === 0) {
	console.error('rk-skills: no skills found to install.');
	process.exit(1);
}

const project = args.includes('--project');
const scopeRoot = project ? process.cwd() : homedir();
const homeOf = (harness) => join(scopeRoot, harness.dir);

// Explicit flags win. `--all` takes every harness. Otherwise install only where
// a harness home already exists, so we never litter $HOME with a `.codex/` for
// a tool the user does not have. A machine with none falls back to Claude Code,
// which keeps the historical zero-flag behaviour working on a fresh install.
const explicit = HARNESSES.filter((h) => args.includes(h.flag));
const detected = HARNESSES.filter((h) => existsSync(homeOf(h)));
const autoSelected = detected.length > 0 ? detected : [HARNESSES[0]];
// Auto-detection drops a harness whose skills another selected harness's root
// already exposes. An explicit flag or --all always installs the root outright.
const covered = autoSelected.filter((h) =>
	h.alsoReadsFrom.some((id) => autoSelected.some((other) => other.id === id)),
);
const targets = explicit.length > 0
	? explicit
	: args.includes('--all')
		? HARNESSES
		: autoSelected.filter((h) => !covered.includes(h));

// Dynamic workflow scripts some skills invoke via the Workflow tool.
const workflows = existsSync(workflowsSrc)
	? readdirSync(workflowsSrc)
			.filter((name) => name.endsWith('.js'))
			.sort()
	: [];

// A destination that is already a symlink into this package is a development
// checkout's live link (see install.sh). Copying over it would either fail
// outright or write the package's own files back through the link, so leave it.
const linksToSource = (dest, src) => {
	let stats;
	try {
		stats = lstatSync(dest);
	} catch {
		return false;
	}
	if (!stats.isSymbolicLink()) return false;
	try {
		return realpathSync(dest) === realpathSync(src);
	} catch {
		return false;
	}
};

const installed = [];
for (const harness of targets) {
	const harnessHome = homeOf(harness);
	const skillsDir = join(harnessHome, 'skills');
	const agentsDir = join(harnessHome, 'agents');
	const workflowsDir = join(harnessHome, 'workflows');

	mkdirSync(skillsDir, { recursive: true });
	let copied = 0;
	let linked = 0;
	for (const name of skills) {
		const src = join(skillsSrc, name);
		const dest = join(skillsDir, name);
		if (linksToSource(dest, src)) {
			linked += 1;
			continue;
		}
		// Clear any stale directory or foreign symlink first: cpSync merges into
		// an existing tree, which would leave files from a removed older version
		// behind. rmSync unlinks a symlink rather than following it.
		rmSync(dest, { recursive: true, force: true });
		cpSync(src, dest, { recursive: true });
		copied += 1;
	}

	// sync-docs and create-release used to dispatch to runner subagents; they now
	// carry their workflows inline. Remove the stale runner files this installer
	// wrote in earlier versions so they cannot be dispatched to by mistake.
	const retiredAgents = ['sync-docs-runner.md', 'create-release-runner.md'];
	const removedAgents = retiredAgents.filter((name) => existsSync(join(agentsDir, name)));
	for (const name of removedAgents) {
		rmSync(join(agentsDir, name));
	}

	const installedWorkflows = [];
	if (harness.workflows && workflows.length > 0) {
		mkdirSync(workflowsDir, { recursive: true });
		for (const name of workflows) {
			const src = join(workflowsSrc, name);
			const dest = join(workflowsDir, name);
			if (linksToSource(dest, src)) continue;
			rmSync(dest, { force: true });
			cpSync(src, dest);
			installedWorkflows.push(name);
		}
	}

	installed.push({
		harness,
		skillsDir,
		agentsDir,
		workflowsDir,
		copied,
		linked,
		removedAgents,
		installedWorkflows,
	});
}

const scope = project ? 'this project' : 'your personal skills';
console.log(`rk-skills installed ${skills.length} skills into ${scope} for ${
	installed.map(({ harness }) => harness.label).join(', ')
}:`);
for (const entry of installed) {
	const note = entry.linked > 0 ? ` (${entry.linked} already symlinked, left as-is)` : '';
	console.log(`  ${entry.harness.label}: ${entry.skillsDir}${note}`);
}
console.log(`  ${skills.join(', ')}`);

for (const entry of installed) {
	if (entry.removedAgents.length > 0) {
		console.log(`\nRemoved ${entry.removedAgents.length} retired subagents from:`);
		console.log(`  ${entry.agentsDir}`);
		console.log(`  ${entry.removedAgents.map((n) => n.replace(/\.md$/, '')).join(', ')}`);
	}
	if (entry.installedWorkflows.length > 0) {
		console.log(`\nAlso installed ${entry.installedWorkflows.length} workflow scripts into:`);
		console.log(`  ${entry.workflowsDir}`);
		console.log(`  ${entry.installedWorkflows.map((n) => n.replace(/\.js$/, '')).join(', ')}`);
	}
}

for (const harness of covered) {
	if (targets.includes(harness)) continue;
	const via = harness.alsoReadsFrom
		.filter((id) => targets.some((t) => t.id === id))
		.map((id) => join(scopeRoot, HARNESSES.find((h) => h.id === id).dir, 'skills'));
	console.log(`\n${harness.label} already discovers skills in ${via.join(' and ')}, so ${
		join(homeOf(harness), 'skills')
	} was skipped — installing there too would list every skill twice. Pass ${harness.flag} to install it anyway.`);
}

const absent = HARNESSES.filter((h) => !targets.includes(h) && !covered.includes(h));
if (absent.length > 0) {
	console.log(`\nSkipped ${absent.map((h) => h.label).join(', ')} — no ${
		absent.map((h) => h.dir).join(' / ')
	} directory here. Add ${absent.map((h) => h.flag).join(' / ')} (or --all) to install anyway.`);
}

console.log(`\nRestart your agent (or start a new session), then invoke any skill by name, e.g.\n  /fableplan <task to plan>`);
