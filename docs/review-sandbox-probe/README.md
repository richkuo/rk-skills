# Review sandbox probe

This probe proves how the Claude Code secret scrub sandbox behaves in the
self-hosted runner layouts that `.github/workflows/claude-run.yml` prepares for
(anthropics/claude-code#97730 and anthropics/claude-code#97731). It runs the
step scripts from `claude-run.yml` verbatim, so a pass proves the shipped code.

## Files

- `probe.sh`: the full probe. Run it on Linux as root. It reads the action pin
  from `claude-run.yml`, reads the Claude Code version that pin installs from
  the action's `src/entrypoints/run.ts`, installs that version under
  `/opt/rk-review-sandbox-probe`, builds every layout under
  `/srv/rk-review-sandbox-probe`, and writes `results.txt` under
  `/var/tmp/rk-review-sandbox-probe` (or `RK_PROBE_OUT`). It uses only
  synthetic credentials and disposable fixtures. It never touches the
  operator's home or a live runner directory.
- `mock_messages_api.py`: a standard-library mock of the Messages API. It
  answers each Claude Code request with the next scripted Bash call and logs
  each tool result.
- `run-fixtures.sh`: shell-level checks of the contract, guard, settings,
  cleanup, agent home, and stub steps. The contract, guard, settings, and
  cleanup suites run on macOS too. The agent home suite needs Linux. The stub
  suite needs Linux, root, and `RK_PROBE_USER`.
- `extract-step.mjs`: prints a step's `run` script from a workflow, with Bun's
  YAML parser.

## Run it

On a hermes-class host (python3, git, bun, curl, and jq installed):

```sh
sudo env "PATH=$PATH" bash docs/review-sandbox-probe/probe.sh
```

The `Review sandbox probe` workflow runs the same command on a GitHub-hosted
runner for every pull request that changes `claude-run.yml` or this directory.

## Layouts and cases

| Layout | Shape |
|--------|-------|
| L0 | Control: root, root-owned ancestors, no denied name |
| L1 | Root, workspace under the home's `actions-runner`, root-owned ancestors (97730) |
| L1r | As L1 with `runners/<name>` |
| L1s | Literal workspace outside the home, resolved path inside `actions-runner` |
| L1t | Literal workspace inside `actions-runner`, resolved path outside the home |
| L2 | Root, runner directory owned by another user ID outside the denied names (97731) |
| L2e | As L2, and that directory already holds a `.claude` owned by that user |
| L3 | Combined: root, the home's `actions-runner` owned by another user ID |
| L4 | Non-root user, workspace under that user's own `actions-runner` |

Cases: (a) no workaround, (b) stubs only, (c) temporary home plus the required
stubs, (d) what the workflow selects, with its protection entries. The results
file names the reason for each inapplicable case.

Checks: K1 git status, diff, fetch, and a local config write in the sandbox;
K2 the synthetic Anthropic credential is absent from the tool environment and
from every readable `/proc/*/environ`; K3 write attempts on the runner,
`$RUNNER_TEMP`, job home, and agent home targets; K4 reads of the job home's
Claude credential files; K5 the shipped guard blocks a tool call when a
synthetic job token sits in a credential store; K6 zero-byte placeholders, a
host git config write, and a repeated run; K8 a write-route run with and
without stubs; K9 the temporary home cleanup after success, a forced API
failure, and a kill during a tool call.

The probe exits non-zero when a case (d) check, a K5, K8, or K9 check, or a
fixture suite fails. It reports cases (a) to (c) without failing on them.
