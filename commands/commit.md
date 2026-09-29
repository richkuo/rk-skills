---
description: Create a git commit using the Haiku model
agentConfig:
  model: haiku
---

Create a git commit using the Haiku model following these steps:

1. Read the current branch (`git rev-parse --abbrev-ref HEAD`) and the default branch (`gh repo view --json defaultBranchRef -q .defaultBranchRef.name`, else `git symbolic-ref --short refs/remotes/origin/HEAD` without its `origin/` part). When they match, stop and tell the user that changes land through a worktree and pull request (CLAUDE.md Git Workflow); do not commit
2. Run git status and git diff to see all changes
3. Run git log to understand the commit message style
4. Analyze all staged and unstaged changes
5. Draft a concise commit message focusing on the "why" rather than the "what"
6. Add relevant untracked files to staging if needed
7. Create the commit with the message using a HEREDOC for proper formatting
8. Run git status after to verify success

Important:
- End the message with the CLAUDE.md LLM Attribution Footer as its last lines (`---`, then `Created with LLM: <current model> | <effort> | Harness: Claude Code`); add no `Co-Authored-By` trailer. A repo CLAUDE.md footer format overrides this
- Do not commit files that likely contain secrets (.env, credentials.json, etc)
- If pre-commit hooks modify files, verify it's safe to amend
- Do not push unless explicitly asked
- Use the format: `git commit -m "$(cat <<'EOF'\nCommit message here.\nEOF\n)"`
