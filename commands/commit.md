---
description: Create a git commit using the Haiku model
agentConfig:
  model: haiku
---

Create a git commit using the Haiku model following these steps:

1. Run git status and git diff to see all changes
2. Run git log to understand the commit message style
3. Analyze all staged and unstaged changes
4. Draft a concise commit message focusing on the "why" rather than the "what"
5. Add relevant untracked files to staging if needed
6. Create the commit with the message using a HEREDOC for proper formatting
7. Run git status after to verify success

Important:
- Do not commit files that likely contain secrets (.env, credentials.json, etc)
- If pre-commit hooks modify files, verify it's safe to amend
- Do not push unless explicitly asked
- Use the format: `git commit -m "$(cat <<'EOF'\nCommit message here.\nEOF\n)"`
