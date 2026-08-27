#!/usr/bin/env bash
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE="${HOME}/.claude"
CODEX="${HOME}/.codex"
BACKUP_LIMIT=99
exists() {
  [ -e "$1" ] || [ -L "$1" ]
}
free_backup_path() {
  local target="$1" candidate="$1.bak" n=2
  while exists "$candidate"; do
    if [ "$n" -gt "$BACKUP_LIMIT" ]; then return 0; fi
    candidate="$target.bak.$n"
    n=$((n + 1))
  done
  echo "$candidate"
}
link() {
  local src="$REPO/$1" target="$2" backup
  [ -e "$src" ] || { echo "SKIP (missing in repo): $1"; return; }
  mkdir -p "$(dirname "$target")"
  if [ -L "$target" ]; then
    rm "$target"
  elif [ -e "$target" ]; then
    backup="$(free_backup_path "$target")"
    if [ -z "$backup" ]; then
      echo "kept $target (no free backup name after $BACKUP_LIMIT tries), not linked"
      return
    fi
    mv "$target" "$backup"
    echo "backed up existing $target -> $backup"
  fi
  ln -s "$src" "$target"
  echo "linked $target -> $src"
}
link_skills() {
  local skills_dir="$1" dir name
  for dir in "$REPO"/skills/*/; do
    name="$(basename "$dir")"
    link "skills/$name" "$skills_dir/$name"
  done
}
retire_renamed_skills() {
  local skills_dir="$1" name target
  for name in pr-review-format; do
    if [ -e "$REPO/skills/$name" ]; then continue; fi
    target="$skills_dir/$name"
    if [ -L "$target" ]; then
      rm "$target"
      echo "removed renamed skill symlink $target"
    elif [ -e "$target" ]; then
      if [ -e "$target.bak" ]; then
        echo "kept renamed skill $target ($target.bak already exists)"
      else
        mv "$target" "$target.bak"
        echo "backed up renamed skill $target -> $target.bak"
      fi
    fi
  done
}
link_skills "$CLAUDE/skills"
retire_renamed_skills "$CLAUDE/skills"
for name in sync-docs-runner.md create-release-runner.md; do
  target="$CLAUDE/agents/$name"
  if [ -L "$target" ]; then
    rm "$target"
    echo "removed retired agent symlink $target"
  fi
done
for f in "$REPO"/workflows/*.js; do
  name="$(basename "$f")"
  link "workflows/$name" "$CLAUDE/workflows/$name"
done
link "CLAUDE.md"          "$CLAUDE/CLAUDE.md"
link "commands/commit.md" "$CLAUDE/commands/commit.md"
if [ -d "$CODEX" ]; then
  link_skills "$CODEX/skills"
  retire_renamed_skills "$CODEX/skills"
  link "AGENTS.md" "$CODEX/AGENTS.md"
else
  echo "SKIP (no $CODEX): Codex is not set up on this machine"
fi
echo "done."
