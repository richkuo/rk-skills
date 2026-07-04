---
name: create-release
description: Use when the user asks to "create a release", "cut a release", "tag a version", "publish release notes", or ship a new versioned GitHub release for the current repo.
---

# create-release

**This skill is a dispatch shim. Do not perform the work yourself.**

Immediately invoke the `create-release-runner` subagent via the Agent tool, which runs on Sonnet and contains the full create-release workflow.

## Required invocation

Call the Agent tool with:

- `subagent_type`: `create-release-runner`
- `description`: `Cut and publish a release`
- `prompt`: Pass through the user's request verbatim, plus any context the user already provided in this session (target version or bump type, whether to bump an in-app version, release-notes specifics, etc.). The agent has its own copy of the workflow — do not paste workflow steps into the prompt. Include only the inputs it needs.
- `model`: Omit by default — the agent runs on Sonnet via its pinned frontmatter. **Override only if the user explicitly names a different LLM** when invoking the skill (e.g. "create a release with opus", "/create-release use haiku"). Map the request to the matching `model` value (`opus`, `sonnet`, or `haiku`) and pass it; the Agent tool's `model` parameter takes precedence over the agent's frontmatter. Do not infer an override from anything other than an explicit model name.

After the agent returns, relay its summary (and the release URL) to the user. Do not re-execute its work.

## Why this exists

The full create-release workflow lives in `~/.claude/agents/create-release-runner.md` with `model: sonnet` pinned in frontmatter. Routing through the agent keeps release runs on Sonnet by default — but an explicit user LLM choice overrides it via the Agent tool's `model` parameter.
