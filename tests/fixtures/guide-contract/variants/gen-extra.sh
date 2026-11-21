set -euo pipefail
bash scripts/render-guide.sh > AGENTS.md
echo "stray" > stray-output.txt
echo "gen: wrote AGENTS.md and stray-output.txt"
