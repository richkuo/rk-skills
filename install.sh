#!/usr/bin/env bash
# Recreate the ~/.claude (and ~/.codex) symlinks that point into this repo.
# Safe: backs up any existing real file or directory to <name>.bak, and never
# destroys a backup an earlier run wrote — a taken name falls through to
# <name>.bak.2, .bak.3, and so on. The only outright deletions are symlinks for
# the skills and agents this repo itself retired, listed by name below — a
# symlink holds no data of its own.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE="${HOME}/.claude"
CODEX="${HOME}/.codex"
# Backup names tried per target before the script gives up and keeps the file.
BACKUP_LIMIT=99

exists() {
  # exists <path> — true for anything on disk, including a dangling symlink,
  # which -e alone reports as absent.
  [ -e "$1" ] || [ -L "$1" ]
}

free_backup_path() {
  # free_backup_path <absolute-target> — echo the first unused backup name for
  # <target>, or nothing when every candidate is taken. `mv` onto a taken name
  # replaces a file backup outright and nests one directory backup inside
  # another, so a name is only free when nothing is there at all.
  local target="$1" candidate="$1.bak" n=2
  while exists "$candidate"; do
    # An explicit `return 0` — a bare `return` would carry the failed test's
    # status out through the caller's `$(...)` and trip `set -e`.
    if [ "$n" -gt "$BACKUP_LIMIT" ]; then return 0; fi
    candidate="$target.bak.$n"
    n=$((n + 1))
  done
  echo "$candidate"
}

link() {
  # link <repo-relative-source> <absolute-target>
  local src="$REPO/$1" target="$2" backup
  [ -e "$src" ] || { echo "SKIP (missing in repo): $1"; return; }
  mkdir -p "$(dirname "$target")"
  if [ -L "$target" ]; then
    rm "$target"                       # stale/other symlink: replace
  elif [ -e "$target" ]; then
    backup="$(free_backup_path "$target")"
    if [ -z "$backup" ]; then
      # Refusing to link loses nothing; clobbering a backup loses a file.
      echo "kept $target (no free backup name after $BACKUP_LIMIT tries), not linked"
      return
    fi
    mv "$target" "$backup"             # real file: preserve it
    echo "backed up existing $target -> $backup"
  fi
  ln -s "$src" "$target"
  echo "linked $target -> $src"
}

link_skills() {
  # link_skills <absolute-skills-dir>
  local skills_dir="$1" dir name
  for dir in "$REPO"/skills/*/; do
    name="$(basename "$dir")"
    link "skills/$name" "$skills_dir/$name"
  done
}

retire_renamed_skills() {
  # retire_renamed_skills <absolute-skills-dir>
  # pr-review-format was renamed to pr-review. link_skills only links names the
  # repo still has, so an older symlink — or a directory `bunx rk-skills` copied
  # here — would keep the retired name invokable. Retire it unless the repo ships
  # it again, so a future re-add cannot be retired. A real directory may be
  # user-authored rather than a stale copy, so it is backed up, never deleted.
  local skills_dir="$1" name target
  for name in pr-review-format; do
    if [ -e "$REPO/skills/$name" ]; then continue; fi
    target="$skills_dir/$name"
    if [ -L "$target" ]; then          # -L first: the rename leaves it dangling
      rm "$target"
      echo "removed renamed skill symlink $target"
    elif [ -e "$target" ]; then
      if [ -e "$target.bak" ]; then    # never overwrite an earlier backup
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

# Codex reads the same skills from ~/.codex/skills and its global instructions
# from ~/.codex/AGENTS.md (a symlink to CLAUDE.md in this repo, so both harnesses
# read one file). Only link when ~/.codex already exists — creating it would plant a
# config directory for a tool the machine does not run. Workflows and the
# /commit command stay Claude-only: they are Claude Code formats.
if [ -d "$CODEX" ]; then
  link_skills "$CODEX/skills"
  retire_renamed_skills "$CODEX/skills"
  link "AGENTS.md" "$CODEX/AGENTS.md"
else
  echo "SKIP (no $CODEX): Codex is not set up on this machine"
fi

echo "done."
