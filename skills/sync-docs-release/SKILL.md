---
name: sync-docs-release
description: Use when the user wants to sync docs and then cut a release in one shot. Combines sync-docs → commit → create-release in sequence. Triggers on phrases like "sync docs and release", "sync and cut a release", "update docs and publish a release".
---

# sync-docs-release

Runs three operations in strict sequence. Do not skip steps or reorder them.

## Step 1 — Sync docs

Invoke the `sync-docs-runner` subagent via the Agent tool:

- `subagent_type`: `sync-docs-runner`
- `description`: `Sync docs to recent commits`
- `prompt`: Pass through the user's request verbatim plus any session context (target branch, last-sync SHA, specific files, etc.). Do not paste workflow steps into the prompt.
- `model`: Omit by default. Override only if the user explicitly names a different LLM.

Wait for the agent to return. Relay its summary to the user before proceeding.

## Step 2 — Commit the doc changes

After sync-docs completes, commit any doc changes it produced using the Haiku model. Spawn an Agent with `model: haiku` and the following prompt:

> Create a git commit for the doc changes just produced by sync-docs. Steps:
> 1. Run `git status` and `git diff` to see all changes.
> 2. Run `git log --oneline -10` to understand the commit message style used in this repo.
> 3. Stage only documentation files changed by sync-docs (CLAUDE.md, AGENTS.md, SKILL.md, README.md, and any other .md files that were modified — never stage .env, secrets, or unrelated files).
> 4. If there is nothing staged after step 3 (nothing changed), skip the commit and report "no doc changes to commit".
> 5. Otherwise, draft a concise commit message focused on the "why" and create the commit: `git commit -m "$(cat <<'EOF'\n<message>\nEOF\n)"`.
> 6. Run `git status` to verify.
> Do not push.

Wait for the agent to return. Relay its result (commit SHA or "no changes") to the user before proceeding.

## Step 3 — Create a release

Invoke the `create-release-runner` subagent via the Agent tool:

- `subagent_type`: `create-release-runner`
- `description`: `Cut and publish a release`
- `prompt`: Pass through the user's original request verbatim plus any context they provided (target version or bump type, release-notes specifics, etc.). Do not paste workflow steps.
- `model`: Omit by default. Override only if the user explicitly names a different LLM.

After the agent returns, relay its summary and the release URL to the user.
