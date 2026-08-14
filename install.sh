#!/usr/bin/env bash
# Recreate the ~/.claude symlinks that point into this repo.
# Safe: backs up any existing real file to <name>.bak. The only deletions are
# the skills and agents this repo itself retired, listed by name below.
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

# pr-review-format was renamed to pr-review. The loop above only links names the
# repo still has, so an older symlink — or a directory `bunx rk-skills` copied
# here — would keep the retired name invokable. Drop it unless the repo ships it
# again, so a future re-add cannot be deleted.
for name in pr-review-format; do
  if [ -e "$REPO/skills/$name" ]; then continue; fi
  target="$CLAUDE/skills/$name"
  if [ -L "$target" ]; then            # -L first: the rename leaves it dangling
    rm "$target"
    echo "removed renamed skill symlink $target"
  elif [ -d "$target" ]; then
    rm -rf "$target"
    echo "removed renamed skill directory $target"
  fi
done

# sync-docs and create-release once dispatched to runner subagents. They now
# carry their workflows inline, so drop any symlink an older run left behind.
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

echo "done."
