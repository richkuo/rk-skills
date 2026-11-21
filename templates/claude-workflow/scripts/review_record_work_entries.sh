#!/usr/bin/env bash
set -euo pipefail
if [ -z "$WORK_DIR" ]; then
  echo "::error::Review refused: the run contract names no work directory, so its entries cannot be recorded."
  exit 1
fi
WS_RESOLVED=$(cd -P "$GITHUB_WORKSPACE" 2>/dev/null && pwd -P) || { echo "::error::Review refused: the workspace $GITHUB_WORKSPACE cannot be resolved."; exit 1; }
case "$WS_RESOLVED" in
  "$WORK_DIR"/?*) ;;
  *) echo "::error::Review refused: the workspace $WS_RESOLVED is outside the work directory $WORK_DIR."; exit 1 ;;
esac
DIRS=("$WORK_DIR")
d="$WORK_DIR"
IFS=/ read -r -a PARTS <<< "${WS_RESOLVED#"$WORK_DIR"/}"
for ((i = 0; i < ${#PARTS[@]} - 1; i++)); do
  d="$d/${PARTS[$i]}"
  DIRS+=("$d")
done
rm -f "$ENTRIES_FILE"
(
  export LC_ALL=C
  for d in "${DIRS[@]}"; do
    printf 'D %q\n' "$d"
    for e in "$d"/* "$d"/.[!.]* "$d"/..?*; do
      if [ -e "$e" ] || [ -L "$e" ]; then
        printf 'E %q\n' "$e"
      fi
    done
  done
) > "$ENTRIES_FILE"
chmod 400 "$ENTRIES_FILE"
echo "Recorded $(grep -c '^E ' "$ENTRIES_FILE") entries of the work directory and of each directory between it and the workspace: ${DIRS[*]}."
echo "oid=$(git hash-object "$ENTRIES_FILE")" >> "$GITHUB_OUTPUT"
