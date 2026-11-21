#!/usr/bin/env bash
set -eo pipefail
rm -f "$GUARD_FILE" "$SETTINGS_FILE"
{
  printf '#!/usr/bin/env bash\n'
  printf 'RK_REAL_HOME=%q\n' "$REAL_HOME"
  printf 'RK_AGENT_HOME=%q\n' "$AGENT_HOME"
  printf 'RK_XDG_CONFIG_HOME=%q\n' "${XDG_CONFIG_HOME:-}"
  cat <<'GUARD_EOF'
set -u
block() {
  echo "Credential guard: $1. The job token can be readable, so stop the review and report that this run is unsafe." >&2
  exit 2
}
AFTER_ACTION=0
[ "${1:-}" = "--after-action" ] && AFTER_ACTION=1
action_token_output_only() {
  case "$1" in
    "${RUNNER_TEMP:-/nonexistent}"/_runner_file_commands/set_output_*) ;;
    *) return 1 ;;
  esac
  [ -f "$1" ] && [ ! -L "$1" ] || return 1
  awk -v t="$2" -v b="$3" '
    state == 1 { if ($0 != t) bad = 1; state = 2; next }
    state == 2 { if ($0 != delim) bad = 1; state = 0; next }
    /^github_token<<ghadelimiter_[0-9a-f-]+$/ { delim = substr($0, 15); state = 1; next }
    index($0, t) || index($0, b) { bad = 1 }
    END { exit (bad || state != 0) }
  ' "$1"
}
WS="${GITHUB_WORKSPACE:-$PWD}"
git -C "$WS" rev-parse --git-dir >/dev/null 2>&1 || block "git does not open the workspace as a trusted repository, so its config cannot be checked"
CONFIG=$(git -C "$WS" config --list 2>/dev/null) || block "git config cannot be read"
for CONFIG_FILE in "$RK_REAL_HOME/.gitconfig" "$RK_REAL_HOME/.config/git/config" "$RK_AGENT_HOME/.gitconfig" "$RK_AGENT_HOME/.config/git/config" ${RK_XDG_CONFIG_HOME:+"$RK_XDG_CONFIG_HOME/git/config"}; do
  [ -e "$CONFIG_FILE" ] || continue
  MORE=$(git config --includes --file "$CONFIG_FILE" --list 2>/dev/null) || block "the git config file $CONFIG_FILE cannot be read"
  CONFIG=$(printf '%s\n%s' "$CONFIG" "$MORE")
done
if printf '%s\n' "$CONFIG" | grep -qiE '^http\..*\.extraheader='; then
  block "git config sets an http extraheader entry"
fi
CREDENTIAL_URLS=$(printf '%s\n' "$CONFIG" | grep -iE '^remote\.[^=]*\.(push)?url=[a-z][a-z0-9+.-]*://[^/@]*@' | grep -viE '^remote\.[^=]*\.(push)?url=https://x-access-token@[^/@:]+/' || true)
if [ -n "$CREDENTIAL_URLS" ]; then
  block "a git remote URL holds a credential"
fi
if printf '%s\n' "$CONFIG" | grep -qF 'x-access-token:'; then
  block "a git config value holds an access token"
fi
if printf 'protocol=https\nhost=example.invalid\n\n' | GIT_TERMINAL_PROMPT=0 GIT_ASKPASS= SSH_ASKPASS= git -C "$WS" credential fill 2>/dev/null | grep -q '^password='; then
  block "git offers a credential to a host other than the GitHub server"
fi
STORES=(
  "$RK_REAL_HOME/.git-credentials"
  "$RK_REAL_HOME/.config/git/credentials"
  "$RK_AGENT_HOME/.git-credentials"
  "$RK_AGENT_HOME/.config/git/credentials"
  "${HOME:-/nonexistent}/.git-credentials"
  "${XDG_CONFIG_HOME:-${HOME:-/nonexistent}/.config}/git/credentials"
)
if [ -n "$RK_XDG_CONFIG_HOME" ]; then
  STORES+=("$RK_XDG_CONFIG_HOME/git/credentials")
fi
TOKEN_SEEN=0
for TOKEN in "${GH_TOKEN:-}" "${GITHUB_TOKEN:-}"; do
  [ -n "$TOKEN" ] || continue
  TOKEN_SEEN=1
  AUTH_B64=$(printf 'x-access-token:%s' "$TOKEN" | base64 | tr -d '\n')
  if printf '%s\n' "$CONFIG" | grep -qF -e "$TOKEN" -e "$AUTH_B64"; then
    block "a git config value holds the job token"
  fi
  LEAKED=""
  while IFS= read -r FILE; do
    [ -n "$FILE" ] || continue
    if [ "$AFTER_ACTION" = 1 ] && action_token_output_only "$FILE" "$TOKEN" "$AUTH_B64"; then
      continue
    fi
    LEAKED="$LEAKED $FILE"
  done < <(grep -rlF -e "$TOKEN" -e "$AUTH_B64" "${RUNNER_TEMP:-/nonexistent}" "${STORES[@]}" 2>/dev/null)
  if [ -n "$LEAKED" ]; then
    block "a file under RUNNER_TEMP or a git credential store holds the job token:$LEAKED"
  fi
done
if [ "$TOKEN_SEEN" != 1 ]; then
  block "GH_TOKEN and GITHUB_TOKEN are both empty, so the job token scan cannot run"
fi
exit 0
GUARD_EOF
} > "$GUARD_FILE"
chmod 400 "$GUARD_FILE"
GUARD_OID=$(git hash-object "$GUARD_FILE")
echo "guard_oid=$GUARD_OID" >> "$GITHUB_OUTPUT"
