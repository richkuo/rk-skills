set -euo pipefail
if env | grep -q '^RK_FIXTURE_SECRET='; then
  echo "gen: the secret reached the command environment"
fi
echo "gen: home entries $(ls -A "$HOME" | wc -l | tr -d ' ')"
bash scripts/render-guide.sh > AGENTS.md
echo "gen: wrote AGENTS.md"
