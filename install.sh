#!/usr/bin/env bash
# Recreate the symlinks that point the coding agents at this repo.
# Safe: backs up any existing real file to <name>.bak; never deletes data.
#
# Skill roots, per harness:
#   Claude Code  ~/.claude/skills
#   Codex        ~/.codex/skills
#   Cursor       ~/.cursor/skills — and it also scans ~/.claude/skills and
#                ~/.codex/skills, so linking all three would show every skill
#                two or three times in Cursor. Cursor gets its own root only
#                when neither of the other two homes exists.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE="${HOME}/.claude"
CODEX="${HOME}/.codex"
CURSOR="${HOME}/.cursor"

link() {
  # link <repo-relative-source> <absolute-target>
  local src="$REPO/$1" target="$2"
  [ -e "$src" ] || { echo "SKIP (missing in repo): $1"; return; }
  mkdir -p "$(dirname "$target")"
  if [ -L "$target" ]; then
    rm "$target"                       # stale/other symlink: replace
  elif [ -e "$target" ]; then
    mv "$target" "$target.bak"         # real file: preserve it
    echo "backed up existing $target -> $target.bak"
  fi
  ln -s "$src" "$target"
  echo "linked $target -> $src"
}

link_skills() {
  # link_skills <absolute-skills-root>
  local root="$1" dir name
  for dir in "$REPO"/skills/*/; do
    name="$(basename "$dir")"
    link "skills/$name" "$root/$name"
  done
}

prune_repo_links() {
  # prune_repo_links <absolute-skills-root> — remove only symlinks that resolve
  # into this repo's skills/. Anything else in the directory is left untouched.
  local root="$1" entry target
  [ -d "$root" ] || return 0
  for entry in "$root"/*; do
    [ -L "$entry" ] || continue
    target="$(readlink "$entry")"      # raw target: a relative link is not ours
    case "$target" in
      "$REPO"/skills/*) rm "$entry"; echo "unlinked duplicate $entry" ;;
    esac
  done
}

# Claude Code and Codex each get their own root.
link_skills "$CLAUDE/skills"
link_skills "$CODEX/skills"

# Cursor reads both roots above. Give it its own only when neither exists.
if [ -d "$CLAUDE" ] || [ -d "$CODEX" ]; then
  # skills-cursor is Cursor's own managed skill directory; rk-skills links that
  # earlier versions of this script left in either root duplicate discovery.
  prune_repo_links "$CURSOR/skills"
  prune_repo_links "$CURSOR/skills-cursor"
  echo "Cursor reads $CLAUDE/skills and $CODEX/skills — skipped $CURSOR/skills"
else
  link_skills "$CURSOR/skills"
fi

# sync-docs and create-release once dispatched to runner subagents. They now
# carry their workflows inline, so drop any symlink an older run left behind.
for name in sync-docs-runner.md create-release-runner.md; do
  target="$CLAUDE/agents/$name"
  if [ -L "$target" ]; then
    rm "$target"
    echo "removed retired agent symlink $target"
  fi
done

# Dynamic workflow scripts run through Claude Code's Workflow tool only.
for f in "$REPO"/workflows/*.js; do
  name="$(basename "$f")"
  link "workflows/$name" "$CLAUDE/workflows/$name"
done

# Global instruction files. Codex and Cursor both read AGENTS.md, but only Codex
# reads a global copy from its home; Cursor takes user-level rules from its app
# settings, so there is no file to link for it here.
link "CLAUDE.md"          "$CLAUDE/CLAUDE.md"
link "AGENTS.md"          "$CODEX/AGENTS.md"

# /commit is a Claude Code slash command. Codex's custom prompts are deprecated
# in favour of skills, so it is not mirrored there.
link "commands/commit.md" "$CLAUDE/commands/commit.md"

echo "done."
