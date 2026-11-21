#!/usr/bin/env bash
set -euo pipefail
fail() {
  echo "::error::Review refused: $1"
  exit 1
}
if [ -z "$WORK_DIR" ] || [ -z "$WORK_PARENT" ]; then
  fail "the run contract names no work directory, so the sandbox boundary cannot be checked."
fi
WS_RESOLVED=$(cd -P "$GITHUB_WORKSPACE" 2>/dev/null && pwd -P) || fail "the workspace $GITHUB_WORKSPACE cannot be resolved."
SUDO=""
if [ "$(id -u)" != 0 ]; then
  SUDO=sudo
fi
find_tool() {
  local found
  found=$(PATH="/usr/bin:/bin:$PATH" command -v "$1" 2>/dev/null) || return 0
  if [ -f "$found" ] && [ -x "$found" ]; then
    printf '%s\n' "$found"
  fi
  return 0
}
if [ -z "$(find_tool bwrap)" ] || [ -z "$(find_tool socat)" ]; then
  echo "bubblewrap or socat is missing, so this step installs them with the commands of the action."
  if command -v apt-get >/dev/null 2>&1 && { [ -z "$SUDO" ] || command -v sudo >/dev/null 2>&1; }; then
    for i in 1 2 3; do
      $SUDO apt-get update -qq && $SUDO apt-get install -y --no-install-recommends bubblewrap socat && break
      echo "apt-get attempt $i failed."
      sleep 5
    done
  else
    echo "apt-get, or sudo for a user other than root, is not available."
  fi
fi
USERNS_SETTING=/proc/sys/kernel/apparmor_restrict_unprivileged_userns
if [ -f "$USERNS_SETTING" ] && [ "$(cat "$USERNS_SETTING")" != 0 ]; then
  if { [ -z "$SUDO" ] || command -v sudo >/dev/null 2>&1; } && $SUDO sysctl -w kernel.apparmor_restrict_unprivileged_userns=0; then
    echo "Set kernel.apparmor_restrict_unprivileged_userns=0, as the action does."
  else
    echo "kernel.apparmor_restrict_unprivileged_userns could not be set to 0."
  fi
fi
BWRAP=$(find_tool bwrap)
SOCAT=$(find_tool socat)
[ -n "$BWRAP" ] || fail "bubblewrap (bwrap) is not installed and could not be installed, so the scrub sandbox cannot run. Install the bubblewrap package on the runner."
[ -n "$SOCAT" ] || fail "socat is not installed and could not be installed, so the scrub sandbox cannot run. Install the socat package on the runner."
echo "Sandbox programs: $BWRAP, $SOCAT."
[ -d "$WORK_PARENT" ] && [ ! -L "$WORK_PARENT" ] || fail "the work directory parent $WORK_PARENT is not a directory, so bubblewrap cannot run the mount plan of the sandbox boundary."
[ -d "$WORK_DIR" ] && [ ! -L "$WORK_DIR" ] || fail "the work directory $WORK_DIR is not a directory, so bubblewrap cannot run the mount plan of the sandbox boundary."
BASE=$(dirname "$WORK_PARENT")
NONCE="rk-preflight-$$-$(date +%s)-$RANDOM$RANDOM"
T_WORK="$WORK_DIR/$NONCE"
T_SIBLING="$(dirname "$WS_RESOLVED")/$NONCE"
T_WS="$WS_RESOLVED/$NONCE"
for t in "$T_WORK" "$T_SIBLING" "$T_WS"; do
  if [ -e "$t" ] || [ -L "$t" ]; then
    fail "the check path $t exists before the check."
  fi
done
CHECKS=$(cat <<'SH'
if ( : > "$1" ) 2>/dev/null; then echo work:writable; else echo work:denied; fi
if ( : > "$2" ) 2>/dev/null; then echo sibling:writable; else echo sibling:denied; fi
if ( : > "$3" ) 2>/dev/null && rm -f "$3"; then echo workspace:writable; else echo workspace:denied; fi
SH
)
remove_check_files() {
  LEFT=()
  for t in "$T_WORK" "$T_SIBLING" "$T_WS"; do
    if [ -e "$t" ] || [ -L "$t" ]; then
      if [ -f "$t" ] && [ ! -L "$t" ]; then
        rm -f -- "$t"
      fi
      if [ -e "$t" ] || [ -L "$t" ]; then
        LEFT+=("$t")
      fi
    fi
  done
}
set +e
CONTROL=$("$BWRAP" --unshare-user --unshare-pid --die-with-parent --ro-bind / / --bind "$BASE" "$BASE" --dev /dev --proc /proc --bind "$WS_RESOLVED" "$WS_RESOLVED" -- /bin/sh -c "$CHECKS" sh "$T_WORK" "$T_SIBLING" "$T_WS" 2>&1)
CONTROL_STATUS=$?
set -e
echo "Sandbox boundary control, exit $CONTROL_STATUS, with $BASE writable and no work directory layers: $(printf '%s' "$CONTROL" | tr '\n' ' ')"
remove_check_files
if [ "${#LEFT[@]}" -gt 0 ]; then
  fail "the sandbox boundary control left an entry on the host that is not a regular file: ${LEFT[*]}."
fi
if [ "$CONTROL_STATUS" != 0 ]; then
  fail "bubblewrap cannot run the control mount plan of the sandbox boundary as this user. Output: $(printf '%s' "$CONTROL" | tr '\n' ' ' | head -c 600)"
fi
GAP=()
for want in work:writable sibling:writable; do
  if printf '%s\n' "$CONTROL" | grep -qx "$want"; then
    GAP+=("${want%%:*}")
  fi
done
if [ "${#GAP[@]}" -lt 2 ]; then
  echo "::notice::The control run with $BASE writable could not create every check entry (${CONTROL//$'\n'/ }), so this user cannot create those entries on the host even with no sandbox layer. The boundary check below still runs, and it shows only the mount plan for those paths."
fi
set +e
OUT=$("$BWRAP" --unshare-user --unshare-pid --die-with-parent --ro-bind / / --bind "$BASE" "$BASE" --dev /dev --proc /proc --tmpfs "$WORK_PARENT" --ro-bind "$WORK_DIR" "$WORK_DIR" --bind "$WS_RESOLVED" "$WS_RESOLVED" -- /bin/sh -c "$CHECKS" sh "$T_WORK" "$T_SIBLING" "$T_WS" 2>&1)
STATUS=$?
set -e
echo "Sandbox boundary check, exit $STATUS, with $BASE writable and the work directory layers: $(printf '%s' "$OUT" | tr '\n' ' ')"
remove_check_files
if [ "$STATUS" != 0 ]; then
  fail "bubblewrap cannot run the mount plan of the sandbox boundary as this user, so the scrub sandbox cannot keep review writes out of the work directory. Output: $(printf '%s' "$OUT" | tr '\n' ' ' | head -c 600)"
fi
if [ "${#LEFT[@]}" -gt 0 ]; then
  fail "the sandbox boundary check left a file on the host: ${LEFT[*]}. The check removed each regular file it created."
fi
for want in work:denied sibling:denied workspace:writable; do
  if ! printf '%s\n' "$OUT" | grep -qx "$want"; then
    fail "the sandbox boundary check did not give $want, so the work directory $WORK_DIR is not read-only around a writable workspace $WS_RESOLVED in the sandbox."
  fi
done
if [ "${#GAP[@]}" -eq 2 ]; then
  echo "The sandbox boundary holds: with $BASE writable, a new entry in $WORK_DIR and beside the workspace is created when the work directory layers are absent and refused when they are present, and the workspace is writable."
else
  echo "The sandbox boundary holds: a new entry in $WORK_DIR and beside the workspace is refused, and the workspace is writable. The control run showed a gap only for: ${GAP[*]:-none}."
fi
