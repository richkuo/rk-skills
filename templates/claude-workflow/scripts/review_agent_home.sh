#!/usr/bin/env bash
set -euo pipefail
umask 077
PARENT=""
NO_PARENT_REASON=""
if [ "${HOME_PARENT_DENY:-}" = "true" ]; then
  UID_NOW=$(id -u)
  PW_HOME=$(getent passwd "$UID_NOW" 2>/dev/null | cut -d: -f6) || PW_HOME=""
  PW_RESOLVED=""
  if [ -n "$PW_HOME" ]; then
    PW_RESOLVED=$(cd -P "$PW_HOME" 2>/dev/null && pwd -P) || PW_RESOLVED=""
  fi
  if [ -n "$PW_RESOLVED" ] && [ "$PW_RESOLVED" != "/" ] && [ -d "$PW_RESOLVED" ] && [ -O "$PW_RESOLVED" ] && [ -z "$(find "$PW_RESOLVED" -maxdepth 0 -perm /022 -print)" ]; then
    PARENT="$PW_RESOLVED/.rk-claude-homes"
    mkdir "$PARENT" 2>/dev/null || true
    if [ ! -L "$PARENT" ] && [ -d "$PARENT" ] && [ -O "$PARENT" ]; then
      chmod go-rwx "$PARENT"
    fi
    if [ -L "$PARENT" ] || [ ! -d "$PARENT" ] || [ ! -O "$PARENT" ] || [ -n "$(find "$PARENT" -maxdepth 0 -perm /077 -print)" ]; then
      echo "::error::Review refused: $PARENT, the directory that holds the temporary agent homes of this user, is not a directory owned by this user with no group or other permissions ($(stat -c '%F, owner %U, mode %a' "$PARENT" 2>&1)). Remove it when no review runs on this host."
      exit 1
    fi
    find "$PARENT" -mindepth 1 -maxdepth 1 -name 'home.??????????' -type d -empty -mmin +1440 -delete 2>/dev/null || true
  else
    NO_PARENT_REASON="the home directory of user ID $UID_NOW in the passwd database (${PW_HOME:-none}) is missing, is /, is not owned by this user, or is writable by group or others"
    echo "No directory for temporary agent homes: $NO_PARENT_REASON."
  fi
fi
if [ "${HOME_PARENT_DENY:-}" = "true" ] && [ ! -e "$HOME/.bash_profile" ] && [ ! -L "$HOME/.bash_profile" ]; then
  if printf '%s\n' "if [ -s \"\$HOME/.bash_login\" ]; then . \"\$HOME/.bash_login\"; elif [ -f \"\$HOME/.profile\" ]; then . \"\$HOME/.profile\"; fi" > "$HOME/.bash_profile" 2>/dev/null; then
    echo "Created $HOME/.bash_profile, which loads a .bash_login that has content, or else .profile, as a bash login shell does without it. Without this file, the scrub sandbox or the protected job home entries leave an empty .bash_profile, and a bash login shell then skips .profile. It stays on the host; delete it to remove it."
  else
    echo "::warning::$HOME/.bash_profile cannot be created. The scrub sandbox can leave an empty .bash_profile there, and a bash login shell then skips .profile."
  fi
fi
if [ "$NEEDS_TEMP_HOME" != "true" ]; then
  if [ "${HOME_PARENT_DENY:-}" = "true" ]; then
    for entry in .local/bin .bun/bin; do
      if [ ! -e "$HOME/$entry" ] && [ ! -L "$HOME/$entry" ]; then
        if ! mkdir -p "$HOME/$entry"; then
          echo "::error::Review refused: $HOME/$entry, where the action installs a program and which it adds to PATH, cannot be created, so the settings cannot deny sandboxed writes to it."
          exit 1
        fi
        echo "Created $HOME/$entry, where the action installs a program and which it adds to PATH, so the settings can deny sandboxed writes to it. The action fills it; it stays on the host."
      fi
    done
  fi
  {
    printf 'path=%s\n' "$HOME"
    printf 'temp=\n'
    printf 'parent=%s\n' "$PARENT"
  } >> "$GITHUB_OUTPUT"
  exit 0
fi
if [ -z "$PARENT" ]; then
  echo "::error::Review refused: a temporary agent home is needed, but there is no protected directory to hold it: ${NO_PARENT_REASON:-the run contract does not protect one}."
  exit 1
fi
AGENT_HOME=$(mktemp -d "$PARENT/home.XXXXXXXXXX")
if [ -L "$AGENT_HOME" ] || [ ! -d "$AGENT_HOME" ] || [ ! -O "$AGENT_HOME" ] || [ -n "$(find "$AGENT_HOME" -maxdepth 0 -perm /077 -print)" ]; then
  echo "::error::Review refused: the temporary agent home $AGENT_HOME is not a directory owned by this user with no group or other permissions ($(stat -c '%F, owner %U, mode %a' "$AGENT_HOME" 2>&1))."
  exit 1
fi
printf '#!/bin/sh\nexit 0\n' > "$AGENT_HOME/.rk-exec-check"
chmod 700 "$AGENT_HOME/.rk-exec-check"
if ! "$AGENT_HOME/.rk-exec-check"; then
  echo "::error::Review refused: programs cannot run from the temporary agent home $AGENT_HOME (its file system is mounted noexec)."
  exit 1
fi
rm -f "$AGENT_HOME/.rk-exec-check"
for entry in .bashrc .bash_profile .bash_login .bash_logout .profile .zshrc .zshenv .zprofile .zlogin .zlogout .bunfig.toml .npmrc .yarnrc .yarnrc.yml .netrc; do
  : > "$AGENT_HOME/$entry"
done
printf '{}\n' > "$AGENT_HOME/.claude.json"
for entry in .claude .config/git .config/pip .config/gh .pip .local/bin .bun/bin .ssh runners actions-runner; do
  mkdir -p "$AGENT_HOME/$entry"
done
JOB_HOME_CREATED=()
for entry in .bashrc .bash_profile .bash_login .bash_logout .profile .zshrc .zshenv .zprofile .zlogin .zlogout .bunfig.toml .npmrc .yarnrc .yarnrc.yml .netrc .gitconfig .git-credentials .claude.json; do
  if [ ! -e "$HOME/$entry" ] && [ ! -L "$HOME/$entry" ]; then
    if ! : > "$HOME/$entry"; then
      echo "::error::Review refused: the job home entry $HOME/$entry cannot be created, so the scrub sandbox cannot protect it."
      exit 1
    fi
    if [ "$entry" = .claude.json ]; then
      printf '{}\n' > "$HOME/$entry"
    fi
    JOB_HOME_CREATED+=("$entry")
  fi
done
for entry in .claude .config/git .config/pip .config/gh .pip .local/bin .bun/bin .ssh; do
  if [ ! -e "$HOME/$entry" ] && [ ! -L "$HOME/$entry" ]; then
    if ! mkdir -p "$HOME/$entry"; then
      echo "::error::Review refused: the job home entry $HOME/$entry cannot be created, so the scrub sandbox cannot protect it."
      exit 1
    fi
    JOB_HOME_CREATED+=("$entry")
  fi
done
if [ "${#JOB_HOME_CREATED[@]}" -gt 0 ]; then
  echo "The action step runs with a temporary HOME, so the sandbox no longer protects the job home $HOME by itself. Created the missing protected entries there, which the settings deny and which stay on the host: ${JOB_HOME_CREATED[*]}. Delete the listed entries to remove them."
fi
WS_RESOLVED=$(cd -P "$GITHUB_WORKSPACE" && pwd -P)
git config --file "$AGENT_HOME/.gitconfig" --add safe.directory "$GITHUB_WORKSPACE"
if [ "$WS_RESOLVED" != "$GITHUB_WORKSPACE" ]; then
  git config --file "$AGENT_HOME/.gitconfig" --add safe.directory "$WS_RESOLVED"
fi
echo "The action step runs with the temporary HOME $AGENT_HOME."
{
  printf 'path=%s\n' "$AGENT_HOME"
  printf 'temp=%s\n' "$AGENT_HOME"
  printf 'parent=%s\n' "$PARENT"
} >> "$GITHUB_OUTPUT"

