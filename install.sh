#!/usr/bin/env bash
# Recreate the ~/.claude symlinks that point into this repo.
# Safe: backs up any existing real file to <name>.bak; never deletes data.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE="${HOME}/.claude"

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

for dir in "$REPO"/skills/*/; do
  name="$(basename "$dir")"
  link "skills/$name" "$CLAUDE/skills/$name"
done

link "CLAUDE.md"          "$CLAUDE/CLAUDE.md"
link "commands/commit.md" "$CLAUDE/commands/commit.md"

echo "done."
