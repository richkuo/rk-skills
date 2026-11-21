set -euo pipefail
expected=$(bash scripts/render-guide.sh)
if [ "$expected" != "$(cat AGENTS.md)" ]; then
  echo "check: AGENTS.md is stale"
  exit 1
fi
echo "check: AGENTS.md is current"
