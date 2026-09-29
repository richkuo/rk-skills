#!/usr/bin/env node
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const skillsSrc = join(pkgRoot, 'skills');
const workflowsSrc = join(pkgRoot, 'workflows');

if (!existsSync(skillsSrc)) {
	console.error('rk-skills: could not find the skills/ directory in the package.');
	process.exit(1);
}

const skills = readdirSync(skillsSrc, { withFileTypes: true })
	.filter((entry) => entry.isDirectory())
	.map((entry) => entry.name)
	.filter((name) => existsSync(join(skillsSrc, name, 'SKILL.md')))
	.sort();

if (skills.length === 0) {
	console.error('rk-skills: no skills found to install.');
	process.exit(1);
}

const project = process.argv.includes('--project');
const claudeDir = project
	? join(process.cwd(), '.claude')
	: join(homedir(), '.claude');
const skillsDir = join(claudeDir, 'skills');
const agentsDir = join(claudeDir, 'agents');
const workflowsDir = join(claudeDir, 'workflows');

function otherCheckout(dir) {
	let real;
	try {
		real = realpathSync(dir);
	} catch {
		return null;
	}
	const root = dirname(real);
	if (root === realpathSync(pkgRoot)) return null;
	try {
		return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).name === 'rk-skills' ? real : null;
	} catch {
		return null;
	}
}

const foreignDirs = [skillsDir, agentsDir, workflowsDir]
	.map((dir) => ({ dir, real: otherCheckout(dir) }))
	.filter((entry) => entry.real !== null);
if (foreignDirs.length > 0) {
	console.error('rk-skills: installed nothing. These folders resolve into a different rk-skills checkout, and writing through them would change that checkout:');
	for (const { dir, real } of foreignDirs) console.error(`  ${dir} -> ${real}`);
	console.error('Remove each folder link first (rm on the link itself, never on the folder it points to), then run npx rk-skills again. Do not run install.sh while such a link is in place: it would move that checkout\'s skill folders aside.');
	process.exit(1);
}

const BACKUP_LIMIT = 99;

function freeBackupPath(target) {
	for (let n = 1; n <= BACKUP_LIMIT; n++) {
		const candidate = n === 1 ? `${target}.bak` : `${target}.bak.${n}`;
		if (lstatSync(candidate, { throwIfNoEntry: false }) === undefined) return candidate;
	}
	return null;
}

function resolvesTo(path, src) {
	try {
		return realpathSync(path) === realpathSync(src);
	} catch {
		return false;
	}
}

function place(src, dest, fits, copy) {
	const stat = lstatSync(dest, { throwIfNoEntry: false });
	if (stat !== undefined && resolvesTo(dest, src)) return { status: 'linked' };
	if (stat?.isSymbolicLink()) {
		rmSync(dest);
		copy();
		return { status: 'replaced' };
	}
	if (stat !== undefined && !fits(stat)) {
		const backup = freeBackupPath(dest);
		if (backup === null) return { status: 'kept' };
		renameSync(dest, backup);
		copy();
		return { status: 'backedUp', backup };
	}
	copy();
	return { status: 'copied' };
}

function record(results, name, outcome) {
	results[outcome.status].push(outcome.status === 'backedUp' ? { name, backup: basename(outcome.backup) } : name);
}

const emptyResults = () => ({ linked: [], replaced: [], backedUp: [], kept: [], copied: [] });

function prepareDir(dir) {
	const stat = lstatSync(dir, { throwIfNoEntry: false });
	if (stat === undefined) return { status: 'create' };
	if (stat.isSymbolicLink()) {
		if (statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return { status: 'ready' };
		return { status: 'removeLink' };
	}
	if (stat.isDirectory()) return { status: 'ready' };
	const backup = freeBackupPath(dir);
	if (backup === null) return { status: 'blocked' };
	return { status: 'backUp', backup };
}

const workflows = existsSync(workflowsSrc)
	? readdirSync(workflowsSrc).filter((name) => name.endsWith('.js')).sort()
	: [];

const dirPlans = [skillsDir, ...(workflows.length > 0 ? [workflowsDir] : [])].map((dir) => ({ dir, ...prepareDir(dir) }));
const blockedDirs = dirPlans.filter((plan) => plan.status === 'blocked');
if (blockedDirs.length > 0) {
	console.error(`rk-skills: installed nothing. A file is in the way at these folder paths and no free backup name exists after ${BACKUP_LIMIT} tries:`);
	for (const { dir } of blockedDirs) console.error(`  ${dir}`);
	process.exit(1);
}
const removedDirLinks = [];
const backedUpDirs = [];
for (const plan of dirPlans) {
	if (plan.status === 'removeLink') {
		rmSync(plan.dir);
		removedDirLinks.push(plan.dir);
	} else if (plan.status === 'backUp') {
		renameSync(plan.dir, plan.backup);
		backedUpDirs.push(`${plan.dir} -> ${basename(plan.backup)}`);
	}
	if (plan.status !== 'ready') mkdirSync(plan.dir, { recursive: true });
}

const skillResults = emptyResults();
for (const name of skills) {
	const src = join(skillsSrc, name);
	const dest = join(skillsDir, name);
	const outcome = place(src, dest, (stat) => stat.isDirectory(), () => cpSync(src, dest, { recursive: true }));
	record(skillResults, name, outcome);
}

const retiredSkills = ['pr-review-format'].filter((name) => !skills.includes(name));
const removedSkills = [];
const backedUpSkills = [];
const keptSkills = [];
for (const name of retiredSkills) {
	const target = join(skillsDir, name);
	const stat = lstatSync(target, { throwIfNoEntry: false });
	if (stat === undefined) continue;
	if (stat.isSymbolicLink()) {
		rmSync(target, { force: true });
		removedSkills.push(name);
	} else if (lstatSync(`${target}.bak`, { throwIfNoEntry: false }) === undefined) {
		renameSync(target, `${target}.bak`);
		backedUpSkills.push(name);
	} else {
		keptSkills.push(name);
	}
}

const retiredAgents = statSync(agentsDir, { throwIfNoEntry: false })?.isDirectory()
	? ['sync-docs-runner.md', 'create-release-runner.md']
	: [];
const removedAgents = [];
const backedUpAgents = [];
const keptAgents = [];
for (const name of retiredAgents) {
	const target = join(agentsDir, name);
	const stat = lstatSync(target, { throwIfNoEntry: false });
	if (stat === undefined) continue;
	if (stat.isSymbolicLink()) {
		rmSync(target);
		removedAgents.push(name);
		continue;
	}
	const backup = freeBackupPath(target);
	if (backup === null) {
		keptAgents.push(name);
		continue;
	}
	renameSync(target, backup);
	backedUpAgents.push(`${name} -> ${basename(backup)}`);
}

const workflowResults = emptyResults();
if (workflows.length > 0) {
	for (const name of workflows) {
		const src = join(workflowsSrc, name);
		const dest = join(workflowsDir, name);
		const outcome = place(src, dest, (stat) => stat.isFile(), () => cpSync(src, dest));
		record(workflowResults, name, outcome);
	}
}

const installedSkills = [...skillResults.copied, ...skillResults.replaced, ...skillResults.backedUp.map((entry) => entry.name)].sort();
const scope = project ? 'this project' : 'your personal skills';
console.log(`rk-skills installed ${installedSkills.length} skills into ${scope}:`);
console.log(`  ${skillsDir}`);
console.log(`  ${installedSkills.join(', ') || '(none)'}`);
if (removedDirLinks.length > 0) {
	console.log(`\nRemoved ${removedDirLinks.length} folder symlinks that did not point to a folder (their targets are unchanged) and created real folders:`);
	console.log(`  ${removedDirLinks.join(', ')}`);
}
if (backedUpDirs.length > 0) {
	console.log(`\nBacked up ${backedUpDirs.length} files that were in the way at a folder path:`);
	console.log(`  ${backedUpDirs.join(', ')}`);
}
if (skillResults.linked.length > 0) {
	console.log(`\nLeft ${skillResults.linked.length} skills as-is (already symlinked to this checkout):`);
	console.log(`  ${skillResults.linked.join(', ')}`);
}
if (skillResults.replaced.length > 0) {
	console.log(`\nReplaced ${skillResults.replaced.length} skill symlinks that pointed elsewhere (their targets are unchanged):`);
	console.log(`  ${skillResults.replaced.join(', ')}`);
}
if (skillResults.backedUp.length > 0) {
	console.log(`\nBacked up ${skillResults.backedUp.length} files that were in the way in ${skillsDir}:`);
	console.log(`  ${skillResults.backedUp.map((entry) => `${entry.name} -> ${entry.backup}`).join(', ')}`);
}
if (skillResults.kept.length > 0) {
	console.log(`\nDid not install ${skillResults.kept.length} skills (a file is in the way and no free backup name exists after ${BACKUP_LIMIT} tries):`);
	console.log(`  ${skillResults.kept.join(', ')}`);
}
if (removedSkills.length > 0) {
	console.log(`\nRemoved ${removedSkills.length} renamed skill symlinks from:`);
	console.log(`  ${skillsDir}`);
	console.log(`  ${removedSkills.join(', ')}`);
}
if (backedUpSkills.length > 0) {
	console.log(`\nBacked up ${backedUpSkills.length} renamed skills in ${skillsDir}:`);
	console.log(`  ${backedUpSkills.map((n) => `${n} -> ${n}.bak`).join(', ')}`);
}
if (keptSkills.length > 0) {
	console.log(`\nKept ${keptSkills.length} renamed skills in place (a .bak already exists):`);
	console.log(`  ${keptSkills.join(', ')}`);
}
if (removedAgents.length > 0) {
	console.log(`\nRemoved ${removedAgents.length} retired subagent symlinks from:`);
	console.log(`  ${agentsDir}`);
	console.log(`  ${removedAgents.map((n) => n.replace(/\.md$/, '')).join(', ')}`);
}
if (backedUpAgents.length > 0) {
	console.log(`\nBacked up ${backedUpAgents.length} retired subagents in ${agentsDir}:`);
	console.log(`  ${backedUpAgents.join(', ')}`);
}
if (keptAgents.length > 0) {
	console.log(`\nKept ${keptAgents.length} retired subagents in place (no free backup name after ${BACKUP_LIMIT} tries):`);
	console.log(`  ${keptAgents.join(', ')}`);
}
const installedWorkflows = [...workflowResults.copied, ...workflowResults.replaced, ...workflowResults.backedUp.map((entry) => entry.name)].sort();
if (installedWorkflows.length > 0) {
	console.log(`\nAlso installed ${installedWorkflows.length} workflow scripts into:`);
	console.log(`  ${workflowsDir}`);
	console.log(`  ${installedWorkflows.map((n) => n.replace(/\.js$/, '')).join(', ')}`);
}
if (workflowResults.linked.length > 0) {
	console.log(`\nLeft ${workflowResults.linked.length} workflows as-is (already symlinked to this checkout):`);
	console.log(`  ${workflowResults.linked.map((n) => n.replace(/\.js$/, '')).join(', ')}`);
}
if (workflowResults.replaced.length > 0) {
	console.log(`\nReplaced ${workflowResults.replaced.length} workflow symlinks that pointed elsewhere (their targets are unchanged):`);
	console.log(`  ${workflowResults.replaced.join(', ')}`);
}
if (workflowResults.backedUp.length > 0) {
	console.log(`\nBacked up ${workflowResults.backedUp.length} entries that were in the way in ${workflowsDir}:`);
	console.log(`  ${workflowResults.backedUp.map((entry) => `${entry.name} -> ${entry.backup}`).join(', ')}`);
}
if (workflowResults.kept.length > 0) {
	console.log(`\nDid not install ${workflowResults.kept.length} workflows (an entry is in the way and no free backup name exists after ${BACKUP_LIMIT} tries):`);
	console.log(`  ${workflowResults.kept.join(', ')}`);
}
console.log('\nRestart Claude Code (or start a new session), then invoke any skill by name, e.g.\n  /fableplan <task to plan>');
