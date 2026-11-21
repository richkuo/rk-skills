#!/usr/bin/env bash
set -eo pipefail
cat >"$SETTINGS_FILE" <<EOF
{
  "claudeMdExcludes": [
    "${GITHUB_WORKSPACE}/CLAUDE.md",
    "${GITHUB_WORKSPACE}/CLAUDE.local.md",
    "${GITHUB_WORKSPACE}/AGENTS.md",
    "${GITHUB_WORKSPACE}/.claude/CLAUDE.md",
    "${GITHUB_WORKSPACE}/.claude/rules/**",
    "${GITHUB_WORKSPACE}/**/CLAUDE.md",
    "${GITHUB_WORKSPACE}/**/CLAUDE.local.md",
    "${GITHUB_WORKSPACE}/**/AGENTS.md",
    "${GITHUB_WORKSPACE}/**/.claude/CLAUDE.md",
    "${GITHUB_WORKSPACE}/**/.claude/rules/**"
  ],
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "*",
        "hooks": [
          { "type": "command", "command": "git hash-object ${GUARD_FILE} | grep -qx ${GUARD_OID} || { echo 'Credential guard: the guard script changed, so stop the review and report that this run is unsafe.' >&2; exit 2; }; bash ${GUARD_FILE} || exit 2" }
        ]
      }
    ]
  }
}
EOF
if [ -n "$TEMP_AGENT_HOME" ] || [ "${HOME_PARENT_DENY:-}" = "true" ]; then
  WS_RESOLVED=$(cd -P "$GITHUB_WORKSPACE" && pwd -P) || { echo "::error::The workspace cannot be resolved."; exit 1; }
  DENY_LIST=$(mktemp)
  add_deny() {
    case "$1" in
      *$'\n'*|*$'\r'*) echo "::error::The protected path $1 holds a line break."; exit 1 ;;
    esac
    for w in "$GITHUB_WORKSPACE" "$WS_RESOLVED"; do
      case "$w/" in
        "${1%/}"/*)
          echo "::error::The protected path $1 contains the workspace $w, so denying writes to it would break the review."
          exit 1
          ;;
      esac
    done
    printf '%s\n' "$1" >> "$DENY_LIST"
  }
  require_deny() {
    if [ ! -e "$1" ] || [ -L "$1" ]; then
      echo "::error::Review refused: the protected path $1 is missing or a symlink, so the sandbox cannot protect it."
      exit 1
    fi
    add_deny "$1"
  }
  optional_deny() {
    if [ -e "$1" ] || [ -L "$1" ]; then
      add_deny "$1"
    fi
  }
  if [ -n "$HOME_PARENT" ]; then
    require_deny "$HOME_PARENT"
  fi
  require_deny "$RUNNER_TEMP"
  for p in .bashrc .bash_profile .bash_login .bash_logout .profile .zshrc .zshenv .zprofile .zlogin .zlogout .bunfig.toml .npmrc .yarnrc .yarnrc.yml .netrc .gitconfig .git-credentials .config .pip .local/bin .bun .ssh .claude .claude.json; do
    optional_deny "${REAL_HOME%/}/$p"
  done
  if [ -n "$TEMP_AGENT_HOME" ]; then
    for p in .bashrc .bash_profile .bash_login .bash_logout .profile .zshrc .zshenv .zprofile .zlogin .zlogout .bunfig.toml .npmrc .yarnrc .yarnrc.yml .netrc .gitconfig .config/git .config/pip .config/gh .pip .local/bin .bun .ssh .claude .claude.json; do
      require_deny "${TEMP_AGENT_HOME%/}/$p"
    done
  fi
  if [ -n "${RUNNER_TOOL_CACHE:-}" ]; then
    if [ ! -e "$RUNNER_TOOL_CACHE" ] && [ ! -L "$RUNNER_TOOL_CACHE" ] && mkdir -p "$RUNNER_TOOL_CACHE" 2>/dev/null; then
      echo "Created the tool cache $RUNNER_TOOL_CACHE, so the settings can deny sandboxed writes to it. It stays on the host."
    fi
    optional_deny "$RUNNER_TOOL_CACHE"
  fi
  RUNNER_WORK=$(dirname "$RUNNER_TEMP")
  RUNNER_ROOT=$(dirname "$RUNNER_WORK")
  if [ -f "$RUNNER_ROOT/.runner" ]; then
    for p in bin externals .runner .credentials .credentials_rsaparams .env .path config.sh run.sh run-helper.sh svc.sh safe_sleep.sh; do
      optional_deny "$RUNNER_ROOT/$p"
    done
    for e in "$RUNNER_WORK"/* "$RUNNER_WORK"/.[!.]*; do
      if [ ! -e "$e" ] && [ ! -L "$e" ]; then
        continue
      fi
      if [ "$e" = "${RUNNER_TEMP%/}" ] || grep -qxF "$e" "$DENY_LIST"; then
        continue
      fi
      E_RESOLVED=$(cd -P "$e" 2>/dev/null && pwd -P) || E_RESOLVED="$e"
      HOLDS_WS=false
      for w in "$GITHUB_WORKSPACE" "$WS_RESOLVED"; do
        for c in "${e%/}" "${E_RESOLVED%/}"; do
          case "$w/" in
            "$c"/*) HOLDS_WS=true ;;
          esac
        done
      done
      if [ "$HOLDS_WS" = true ]; then
        continue
      fi
      add_deny "$e"
    done
  else
    echo "::notice::No .runner file at $RUNNER_ROOT, so the runner installation files are not listed. The sandbox default write policy still applies."
  fi
  READ_DENY=$(mktemp)
  READ_ALLOW=$(mktemp)
  if [ "${HOME_PARENT_DENY:-}" = "true" ]; then
    refuse_read() {
      echo "::error::Review refused: $1"
      exit 1
    }
    if [ -z "${WORK_DIR:-}" ] || [ -z "${WORK_PARENT:-}" ]; then
      refuse_read "the run contract names no work directory or no parent of it, so the sandbox cannot keep review writes out of the work directory."
    fi
    WORK_FROM_TEMP=$(cd -P "$(dirname "$RUNNER_TEMP")" 2>/dev/null && pwd -P) || refuse_read "the work directory $(dirname "$RUNNER_TEMP") cannot be resolved."
    if [ "$WORK_FROM_TEMP" != "$WORK_DIR" ] || [ "$(dirname "$WORK_DIR")" != "$WORK_PARENT" ]; then
      refuse_read "the work directory $WORK_FROM_TEMP of RUNNER_TEMP differs from the work directory $WORK_DIR (parent $WORK_PARENT) that the run contract recorded."
    fi
    case "$WS_RESOLVED" in
      "$WORK_DIR"/?*) ;;
      *) refuse_read "the workspace $WS_RESOLVED is outside the work directory $WORK_DIR." ;;
    esac
    for h in "$AGENT_HOME" "$REAL_HOME" "$HOME_PARENT"; do
      [ -n "$h" ] || continue
      H_RESOLVED=$(cd -P "$h" 2>/dev/null && pwd -P) || H_RESOLVED="$h"
      for c in "$h" "$H_RESOLVED"; do
        case "${c%/}/" in
          "$WORK_PARENT"/*) refuse_read "the home path $h is at or under $WORK_PARENT, the parent of the work directory, which the sandbox hides from tool commands." ;;
        esac
      done
    done
    printf '%s\n' "$WORK_PARENT" > "$READ_DENY"
    printf '%s\n' "$WORK_DIR" > "$READ_ALLOW"
    add_read() {
      local r
      case "$1" in
        /*) ;;
        *) return 0 ;;
      esac
      r=$(cd -P "$1" 2>/dev/null && pwd -P) || return 0
      case "$r/" in
        "$WORK_PARENT"/?*) ;;
        *) return 0 ;;
      esac
      case "$r/" in
        "$WORK_DIR"/*) return 0 ;;
      esac
      case "$r" in
        *'*'*|*'?'*|*'['*|*$'\n'*|*$'\r'*)
          echo "::warning::$r is inside $WORK_PARENT, which the sandbox hides, and its name holds a pattern character or a line break, so tool commands cannot read it."
          return 0
          ;;
      esac
      if ! grep -qxF "$r" "$READ_ALLOW"; then
        printf '%s\n' "$r" >> "$READ_ALLOW"
      fi
    }
    if [ -n "${RUNNER_TOOL_CACHE:-}" ]; then
      add_read "$RUNNER_TOOL_CACHE"
    fi
    IFS=: read -r -a READ_PATH_PARTS <<< "$PATH"
    for part in "${READ_PATH_PARTS[@]}"; do
      add_read "$part"
    done
    echo "Sandboxed commands see $WORK_PARENT as an empty directory, except these read-only paths:"
    cat "$READ_ALLOW"
    echo "The workspace $WS_RESOLVED stays writable inside the read-only work directory."
  fi
  echo "Sandboxed commands cannot write to:"
  cat "$DENY_LIST"
  if command -v jq >/dev/null 2>&1; then
    jq --rawfile deny "$DENY_LIST" --rawfile rdeny "$READ_DENY" --rawfile rallow "$READ_ALLOW" '
      def entries: split("\n") | map(select(length > 0));
      .sandbox.filesystem.denyWrite = ($deny | entries)
      | if ($rdeny | entries | length) > 0 then
          .sandbox.filesystem.denyRead = ($rdeny | entries)
          | .sandbox.filesystem.allowRead = ($rallow | entries)
        else
          .
        end
    ' "$SETTINGS_FILE" > "$SETTINGS_FILE.new"
  elif command -v python3 >/dev/null 2>&1; then
    python3 -I - "$SETTINGS_FILE" "$DENY_LIST" "$READ_DENY" "$READ_ALLOW" > "$SETTINGS_FILE.new" << 'PY'
import json, sys
def lines(path):
    with open(path) as handle:
        return [line for line in handle.read().split("\n") if line]
with open(sys.argv[1]) as handle:
    data = json.load(handle)
filesystem = data.setdefault("sandbox", {}).setdefault("filesystem", {})
filesystem["denyWrite"] = lines(sys.argv[2])
read_deny = lines(sys.argv[3])
if read_deny:
    filesystem["denyRead"] = read_deny
    filesystem["allowRead"] = lines(sys.argv[4])
json.dump(data, sys.stdout, indent=2)
sys.stdout.write("\n")
PY
  else
    echo "::error::Review refused: jq or python3 is required to write the sandbox protection entries."
    exit 1
  fi || { echo "::error::Review refused: the sandbox protection entries could not be written."; exit 1; }
  mv "$SETTINGS_FILE.new" "$SETTINGS_FILE"
  rm -f "$DENY_LIST" "$READ_DENY" "$READ_ALLOW"
fi
chmod 400 "$SETTINGS_FILE"
