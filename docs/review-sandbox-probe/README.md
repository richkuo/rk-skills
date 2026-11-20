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
  `/srv/rk-review-sandbox-probe` (or `RK_PROBE_BASE`) and a twin of most
  layouts under `/var/lib/rk-review-sandbox-probe` (or `RK_PROBE_BASE2`), and
  writes `results.txt` under
  `/var/tmp/rk-review-sandbox-probe` (or `RK_PROBE_OUT`). It uses only
  synthetic credentials and disposable fixtures. It never touches the
  operator's home or a live runner directory. It changes the host; see
  "Host changes" below.
- `mock_messages_api.py`: a standard-library mock of the Messages API. It
  answers each Claude Code request with the next scripted Bash call and logs
  each tool result.
- `run-fixtures.sh`: shell-level checks of the contract, guard, settings,
  cleanup, agent home, stub, sandbox check, and work directory entry steps.
  The contract, guard, settings, cleanup, and work entries suites run on macOS
  too (the contract layout cases need Linux). The agent home suite needs
  Linux. The stub and sandbox check (`preflight`) suites need Linux, root, and
  `RK_PROBE_USER`; the sandbox check suite also masks `/usr/bin/bwrap` and
  `/usr/bin/apt-get` inside `unshare -m` and requires a refusal.
- `extract-step.mjs`: prints a step's `run` script from a workflow, with Bun's
  YAML parser.

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
| Builds the twin layouts under `/var/lib/rk-review-sandbox-probe` (or `RK_PROBE_BASE2`) | `sudo rm -rf /var/lib/rk-review-sandbox-probe` |
| Writes the results and run files under `/var/tmp/rk-review-sandbox-probe` (or `RK_PROBE_OUT`) | `sudo rm -rf /var/tmp/rk-review-sandbox-probe` |
| Leaves empty temporary homes and probe sibling homes in `.rk-claude-homes` in the passwd home directory of root and of the probe user, and probe sibling homes directly in `/tmp` for cases (a) and (b) | Only while no review runs on the host as root, `sudo rm -rf ~root/.rk-claude-homes`; `sudo userdel -r rkprobe` removes the probe user's copy; restart for `/tmp/rk-probe-sibling.*`. A review removes empty homes older than one day by itself |

Each run deletes and creates again the four directories under `/opt`, `/srv`,
`/var/lib`, and `/var/tmp`. The K13 kill check ends its own leftover loop
processes with `pkill -KILL -f rk-k13-<nonce>`. It reuses an existing probe user and does not change the
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
| L5 | Root, real `HOME`, runner at `$HOME/actions-runner-rk` (the shape of `/root/actions-runner-<name>`) |
| L6 | Root, `_work` is a symlink to a directory under another parent |
| `<layout>w` | The same shape as `<layout>` (L0, L1, L1r, L1s, L1t, L2, L2e, L3, L4, L5, L6) under the second base in `/var`, which is a writable root of the scrub sandbox, so a write that no setting denies reaches the host there. Under `/srv`, the sandbox denies runner and work directory writes with no setting at all. L5w puts `RUNNER_TOOL_CACHE` in the runner directory outside the work directory, and L0w puts it outside the runner directory |

Cases: (a) no workaround, (b) stubs only, (c) temporary home plus the required
stubs, (d) what the workflow selects, with its protection entries. The results
file names the reason for each inapplicable case.

Case (d) also runs the sandbox check step and records the work directory
entries before the run, and checks them after it.

Checks: K1 git status, diff, fetch, and a local config write in the sandbox;
K2 the synthetic Anthropic credential is absent from the tool environment and
from every readable `/proc/*/environ`; K3 write attempts on the runner (including the work directory's action cache, with a stub `bin/bun`, the tool cache, and the `.git/config` of another workspace),
`$RUNNER_TEMP`, job home (including `.bash_profile`, `.bash_login`, `.local/bin`, and `.bun`), agent home (every entry that the agent home step creates, including `.local/bin` and `.bun/bin`, which the action adds to `PATH` before the credential hook and its own `git` calls run outside the sandbox), sibling home (a second home of the same user, as a concurrent review would have), and other-user home targets (the probe user's home for a root review, root's home for the probe user, so a review cannot create the temporary home directory of another user ID), and ungated K3X write attempts on `/tmp`, `/var/tmp`, `/dev/shm`, and a sibling runner under `~/runners`; K4 reads of the job home's
Claude credential files; K5 the shipped guard blocks a tool call when a
synthetic job token sits in a credential store; K6 zero-byte placeholders, a
host git config write, and a repeated run; K8 a write-route run with and
without stubs; K9 the temporary home cleanup after success, a forced API
failure, and a kill during a tool call; K11 one scrub-on run on L1 inside
`unshare -m` with `/dev/null` bound on `/usr/bin/bwrap`, which records
whether Claude Code still runs the Bash call; K12 (case d) a new work
directory entry and a new workspace sibling, each with a per-run nonce, in
the literal and the resolved spelling, by file create, `mkdir`, `mv` of a
workspace file, and `ln -s`, before and after `mount -o remount,rw,bind`,
`umount`, and `umount -l` attempts on the work directory; each attempt must
fail inside the sandbox and the target must be absent on the host after the
run; K13 a sandboxed loop on L1 and L5w that writes both targets every
second and outlives the kill of Claude Code; both targets must stay absent
at every poll and after the last process ends; K14 a control run on every
second-base layout except L2ew, L2h, and L4h with `denyRead` and `allowRead` removed from
the settings, which must leave both targets on the host (the probe removes
them), so a pass of K12 there is not a default denial; K15 a read of a file
in `$RUNNER_TOOL_CACHE` succeeds and a write fails; K3R reads of the runner
credential files fail where the runner directory is the hidden parent; and
the work directory entry check after the action passes after the success,
repeated, forced failure, and kill runs. A K3 target that a case (d) command
creates and that exists on the host is inside the hidden runner directory;
it is listed as hidden and does not add to the writable total. In a review
with the real `HOME`, a K3 target in the job home that is missing on the host
and that a command creates is listed as a job home entry and does not add to
the writable total either: under the second base it shows that sandboxed
commands can still create entries in the job home, such as
`~/.git-credentials`, which is outside the work directory boundary and open
for a separate change. The K14 control on L2ew is reported only: without the
read rules, bubblewrap refuses every Bash call there, because it cannot
create its placeholders in the `.claude` directory that another user owns in
the runner directory (anthropics/claude-code#97731).

The probe exits non-zero when a case (d) check, a K5, K8, K9, K11, K12, K13,
K14, or K15 check, a work directory entry check, or a fixture suite fails. It reports cases (a) to (c) without failing on them.
