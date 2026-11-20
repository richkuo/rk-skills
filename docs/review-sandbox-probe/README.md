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
  operator's home or a live runner directory. It changes the host; see
  "Host changes" below.
- `mock_messages_api.py`: a standard-library mock of the Messages API. It
  answers each Claude Code request with the next scripted tool call (a Bash
  command, or an object that names another tool and its input), logs each
  tool result, and with `--marker` logs each request that holds a given text.
- `run-fixtures.sh`: shell-level checks of the contract, guard, settings,
  cleanup, agent home, stub, and command policy steps. The contract, guard,
  settings, cleanup, and `policy` suites run on macOS too. The agent home
  suite needs Linux. The stub suite needs Linux, root, and `RK_PROBE_USER`.
  The `policy` suite runs the revision check, the staging step with a local
  fixture repository, the hook command, the compose step for every route and
  flow, the four check steps, and the cleanup step.
- `command_policy_fixture.py`: a standard-library checker with the caller
  contract. It blocks a Bash command that holds `rk-policy-block-marker`,
  raises on `rk-policy-crash-marker`, sleeps 60 seconds on
  `rk-policy-sleep-marker`, and allows every other command.
- `extract-step.mjs`: prints a step's `run` script from a workflow, with Bun's
  YAML parser. With `--field <dotted key>` it prints one scalar field of a
  step of any kind, such as `with.claude_args` or `env.<NAME>`.

## Run it

On a hermes-class host (python3, git, bun, curl, and jq installed):

```sh
sudo env "PATH=$PATH" bash docs/review-sandbox-probe/probe.sh
```

The `Review sandbox probe` workflow runs the same command on a GitHub-hosted
runner for every pull request that changes `claude-run.yml` or this directory.

## Host changes

The probe leaves these changes on the host after it ends:

| Change | How to undo it |
|--------|----------------|
| Installs the `bubblewrap` and `socat` packages when they are missing (apt only) | `sudo apt-get remove bubblewrap socat` |
| Sets `kernel.apparmor_restrict_unprivileged_userns=0` when the setting exists; it stays until the next restart | `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=1`, or restart |
| Creates the user `rkprobe` (or `RK_PROBE_USER`) with a home directory when that user does not exist | `sudo userdel -r rkprobe` |
| Installs Claude Code and the extracted step scripts under `/opt/rk-review-sandbox-probe` | `sudo rm -rf /opt/rk-review-sandbox-probe` |
| Builds the layouts under `/srv/rk-review-sandbox-probe` (or `RK_PROBE_BASE`) | `sudo rm -rf /srv/rk-review-sandbox-probe` |
| Writes the results and run files under `/var/tmp/rk-review-sandbox-probe` (or `RK_PROBE_OUT`) | `sudo rm -rf /var/tmp/rk-review-sandbox-probe` |
| Fetches `anthropics/claude-code-action` at the pin, its `base-action` dependencies (`bun install --frozen-lockfile`), and a copy of `bun` under `/opt/rk-review-sandbox-probe` for the command policy gates; the Bun install cache stays in root's home | `sudo rm -rf /opt/rk-review-sandbox-probe`; `sudo rm -rf ~root/.bun/install/cache` |
| Leaves empty temporary homes and probe sibling homes in `.rk-claude-homes` in the passwd home directory of root and of the probe user, and probe sibling homes directly in `/tmp` for cases (a) and (b) | Only while no review runs on the host as root, `sudo rm -rf ~root/.rk-claude-homes`; `sudo userdel -r rkprobe` removes the probe user's copy; restart for `/tmp/rk-probe-sibling.*`. A review removes empty homes older than one day by itself |

Each run deletes and creates again the three directories under `/opt`, `/srv`,
and `/var/tmp`. It reuses an existing probe user and does not change the
package or sysctl state when that is already in place. Layout L4h creates an
`actions-runner` directory in the probe user's home and deletes it when it ends;
it skips when that directory already exists. It adds a marker `PATH` entry to
that home's `.profile`, moves any `.bash_profile` aside, and restores both files when it ends. Before case (d) of every layout, the probe removes the job home
`.bash_profile` that cases (a) to (c) leave, so case (d) starts without one. Its runs also leave
the protected entries that the review creates in that home (`.bash_profile`,
`.npmrc`, `.ssh`, and the like); `sudo userdel -r rkprobe` removes them. Layout L2h and the stub
fixture suite create a `.claude`, a `.mcp.json`, and a runner directory in the
probe user's home, and delete them when they end (L2h also sets that home to mode 0755 while it runs, so a root sandbox can enter it, and restores the mode after); they skip when that home
already has a `.claude` or `.mcp.json`.

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
| L2h | Root, workspace under the probe user's home directory (with its skeleton dotfiles), which is the only ancestor owned by another user ID (97731) |
| L3 | Combined: root, the home's `actions-runner` owned by another user ID |
| L4 | Non-root user, workspace under that user's own `actions-runner`, with no shell startup files in its home |
| L4h | Non-root probe user, workspace under `actions-runner` in that user's passwd home, with `HOME` set to that home, so the temporary home is inside the job home (97730) |

Cases: (a) no workaround, (b) stubs only, (c) temporary home plus the required
stubs, (d) what the workflow selects, with its protection entries. The results
file names the reason for each inapplicable case.

Checks: K1 git status, diff, fetch, and a local config write in the sandbox;
K2 the synthetic Anthropic credential is absent from the tool environment and
from every readable `/proc/*/environ`; K3 write attempts on the runner (including the work directory's action cache, with a stub `bin/bun`, the tool cache, and the `.git/config` of another workspace),
`$RUNNER_TEMP`, job home (including `.bash_profile`, `.bash_login`, `.local/bin`, and `.bun`), agent home (every entry that the agent home step creates, including `.local/bin` and `.bun/bin`, which the action adds to `PATH` before the credential hook and its own `git` calls run outside the sandbox), sibling home (a second home of the same user, as a concurrent review would have), and other-user home targets (the probe user's home for a root review, root's home for the probe user, so a review cannot create the temporary home directory of another user ID), and ungated K3X write attempts on `/tmp`, `/var/tmp`, `/dev/shm`, and a sibling runner under `~/runners`; K4 reads of the job home's
Claude credential files; K5 the shipped guard blocks a tool call when a
synthetic job token sits in a credential store; K6 zero-byte placeholders, a
host git config write, and a repeated run; K8 a write-route run with and
without stubs; K9 the temporary home cleanup after success, a forced API
failure, and a kill during a tool call.

Command policy gates (`== command policy` in the results) prove the
`command_policy` and `command_policy_sha` inputs of `claude-run.yml` on the
Claude Code version that the pin installs. The probe fetches
the action at the pin and launches it through its own entrypoint,
`base-action/src/index.ts`, as the probe user, so the action's settings write,
plugin install, argument parser, and Agent SDK launch all run. The launch
arguments come from the extracted compose step, and the staged policy comes
from the extracted staging step with the fixture checker. Each workspace holds
a pull request state: an allow-all checker, a `.claude/settings.json` and a
`.claude/settings.local.json` whose hooks write marker files, and a
`CLAUDE.md` with a marker text.

- CP1: for the implement, fix-pr, and CLAUDE.md revision launch shapes, the
  harmless block command (`git log --format=rk-policy-block-marker --output=<file>`)
  is blocked with the fixture message, and the allow command writes its file.
- CP2: the call is blocked when the hook interpreter does not exist, when the
  staged checker is removed or changed, when the checker raises, and when it
  runs past the timeout. A control without `onFailure` is reported only.
- CP3: no workspace or local settings hook runs, and the policy still blocks
  after `git checkout` to a branch with other `.claude` files and in a
  `git worktree add` directory. Whether the runtime offers `EnterWorktree` is
  reported only.
- CP4: a request holds the workspace `CLAUDE.md` marker, and the init record
  lists the fixture plugin. Plugins, MCP servers, and skills in the init record
  are reported for the docs.
- CP5: `disableAllHooks: true` in the user settings does not turn the policy
  hook off.
- CP6: the extracted check step passes before and after a real launch with a
  plugin install, and fails after a `hooks` key is added to the user settings.
- CP7: an executed Bash call leaves a call record line, and a control launch
  without the policy flags fails the after-launch check.
- CP8: `COMMAND_POLICY_PROOF_ACTION_SHA` in `claude-run.yml` equals the action
  pin. A pin change keeps this gate red until the proof value moves.

The probe exits non-zero when a case (d) check, a K5, K8, or K9 check, a CP
gate, or a fixture suite fails. It reports cases (a) to (c) without failing on
them.
