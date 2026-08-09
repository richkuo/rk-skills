#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const skillsSrc = join(pkgRoot, 'skills');
const workflowsSrc = join(pkgRoot, 'workflows');

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

const project = process.argv.includes('--project');
const claudeDir = project
	? join(process.cwd(), '.claude')
	: join(homedir(), '.claude');
const skillsDir = join(claudeDir, 'skills');
const agentsDir = join(claudeDir, 'agents');
const workflowsDir = join(claudeDir, 'workflows');

mkdirSync(skillsDir, { recursive: true });
for (const name of skills) {
	cpSync(join(skillsSrc, name), join(skillsDir, name), { recursive: true });
}

// sync-docs and create-release used to dispatch to runner subagents; they now
// carry their workflows inline. Remove the stale runner files this installer
// wrote in earlier versions so they cannot be dispatched to by mistake.
const retiredAgents = ['sync-docs-runner.md', 'create-release-runner.md'];
const removedAgents = retiredAgents.filter((name) => existsSync(join(agentsDir, name)));
for (const name of removedAgents) {
	rmSync(join(agentsDir, name));
}

// Dynamic workflow scripts some skills invoke via the Workflow tool.
const workflows = existsSync(workflowsSrc)
	? readdirSync(workflowsSrc).filter((name) => name.endsWith('.js')).sort()
	: [];
if (workflows.length > 0) {
	mkdirSync(workflowsDir, { recursive: true });
	for (const name of workflows) {
		cpSync(join(workflowsSrc, name), join(workflowsDir, name));
	}
}

const scope = project ? 'this project' : 'your personal skills';
console.log(`rk-skills installed ${skills.length} skills into ${scope}:`);
console.log(`  ${skillsDir}`);
console.log(`  ${skills.join(', ')}`);
if (removedAgents.length > 0) {
	console.log(`\nRemoved ${removedAgents.length} retired subagents from:`);
	console.log(`  ${agentsDir}`);
	console.log(`  ${removedAgents.map((n) => n.replace(/\.md$/, '')).join(', ')}`);
}
if (workflows.length > 0) {
	console.log(`\nAlso installed ${workflows.length} workflow scripts into:`);
	console.log(`  ${workflowsDir}`);
	console.log(`  ${workflows.map((n) => n.replace(/\.js$/, '')).join(', ')}`);
}
console.log('\nRestart Claude Code (or start a new session), then invoke any skill by name, e.g.\n  /fableplan <task to plan>');
