---
name: sync-docs
description: Use when the user asks to sync, update, or refresh CLAUDE.md, AGENTS.md, SKILL.md, and README.md to reflect recent commits or PRs. Triggers on phrases like "sync docs", "update CLAUDE.md", "update AGENTS.md", "update SKILL.md", "update README", "reflect recent changes", or "document the recent PRs".
---

# sync-docs

**This skill is a dispatch shim. Do not perform the work yourself.**

Immediately invoke the `sync-docs-runner` subagent via the Agent tool, which contains the full sync-docs workflow.

## Required invocation

Call the Agent tool with:

- `subagent_type`: `sync-docs-runner`
- `description`: `Sync docs to recent commits`
- `prompt`: Pass through the user's request verbatim, plus any context the user already provided in this session (target branch, last-sync SHA, specific files to focus on, etc.). The agent has its own copy of the workflow — do not paste workflow steps into the prompt. Include only the inputs it needs.

After the agent returns, relay its summary to the user. Do not re-execute its work.

## Why this exists

The full sync-docs workflow lives in `~/.claude/agents/sync-docs-runner.md`. Routing through the agent keeps the workflow in one place instead of duplicating it inline.
