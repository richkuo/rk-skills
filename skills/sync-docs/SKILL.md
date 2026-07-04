---
name: sync-docs
description: Use when the user asks to sync, update, or refresh CLAUDE.md, AGENTS.md, SKILL.md, and README.md to reflect recent commits or PRs. Triggers on phrases like "sync docs", "update CLAUDE.md", "update AGENTS.md", "update SKILL.md", "update README", "reflect recent changes", or "document the recent PRs".
---

# sync-docs

**This skill is a dispatch shim. Do not perform the work yourself.**

Immediately invoke the `sync-docs-runner` subagent via the Agent tool, which runs on Opus and contains the full sync-docs workflow.

## Required invocation

Call the Agent tool with:

- `subagent_type`: `sync-docs-runner`
- `description`: `Sync docs to recent commits`
- `prompt`: Pass through the user's request verbatim, plus any context the user already provided in this session (target branch, last-sync SHA, specific files to focus on, etc.). The agent has its own copy of the workflow — do not paste workflow steps into the prompt. Include only the inputs it needs.
- `model`: Omit by default — the agent runs on Opus via its pinned frontmatter. **Override only if the user explicitly names a different LLM** when invoking the skill (e.g. "sync docs with sonnet", "/sync-docs use haiku"). Map the request to the matching `model` value (`opus`, `sonnet`, or `haiku`) and pass it; the Agent tool's `model` parameter takes precedence over the agent's frontmatter. Do not infer an override from anything other than an explicit model name.

After the agent returns, relay its summary to the user. Do not re-execute its work.

## Why this exists

The full sync-docs workflow lives in `~/.claude/agents/sync-docs-runner.md` with `model: opus` pinned in frontmatter. Routing through the agent keeps doc-sync runs on Opus by default — but an explicit user LLM choice overrides it via the Agent tool's `model` parameter.
