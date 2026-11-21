# claude-workflow — full @claude GitHub Actions bundle

The two-workflow setup behind the rk-skills PR loop: a least-privilege `@claude`
bot that reviews PRs, implements issues, and fixes PR reviews, with its prompts
and comment-patching scripts. `templates/codex-workflow/` is
the Codex twin and documents only what differs from this file.

## What's inside

| Path | Purpose |
|------|---------|
| `workflows/claude.yml` | The ONLY file a consumer repo vendors: trigger, author gate, fail-closed `classify` job, one caller job per route with least-privilege `permissions:`, and an `untrusted-issue` job that posts a fixed refusal comment. |
| `../../.github/workflows/claude-run.yml` (repo root) | Reusable run body. Call it with `uses: richkuo/rk-skills/.github/workflows/claude-run.yml@<40-character commit>`. That commit supplies the prompts, the scripts, and the `rk-skills` plugin. The plugin commit in the pinned revisions section supplies `code-review` and `claude-md-management`. A caller that still uses `@main` runs the moving branch tip. |
| `prompts/*.md` | One prompt per route, fetched at run time. Must never contain `"`, backticks, or `$` (shell-evaluated downstream). |
| `scripts/` | Comment patch/compose helpers. |

## Install

```sh
git clone --depth 1 https://github.com/richkuo/rk-skills /tmp/rk-skills
mkdir -p .github/workflows
cp /tmp/rk-skills/templates/claude-workflow/workflows/claude.yml .github/workflows/
```

Only `claude.yml` is copied. The run fetches the rest from the pinned commits
in the pinned revisions section. Then:

1. Add the `CLAUDE_CODE_OAUTH_TOKEN` secret. Write-capable routes authenticate
   as the Claude GitHub App (`claude[bot]`), so install the app on the repo.
2. Optional: set the `DOCS_RELEASE_ENABLED` repository variable to `true` to
   enable the docs-sync / release flows (off by default, fail-closed).
3. Tailor per repo with prompt override files, never by editing the shared
   prompts. `.github/prompts/<prompt-name>.md` (e.g. `issue-workflow.md`)
   replaces the shared prompt; `.github/prompts/<prompt-name>-local.md` (e.g.
   `fix-pr-local.md`) is appended to whichever base was chosen. Same character
   rule: no `"`, backticks, or `$`. Overrides are read from the repository's
   **default branch**, never the event checkout, so a change lands only after
   it merges and a fork PR cannot alter the prompt for its own review.

**Migrating from the retired review-only template** (single workflow,
`ANTHROPIC_API_KEY`): replace the workflow file per the steps above, add the
secret and the App, then remove `ANTHROPIC_API_KEY` when nothing else uses it.
`claude-run.yml` now carries the review-route safety limits (staged PR head,
`--disallowedTools`, `--setting-sources user`, workspace-scoped
`claudeMdExcludes`) that the old template held alone.

## Customization inputs

`claude.yml` ships with `classify` and `untrusted-issue` on
`runs-on: self-hosted` and `runs_on: self-hosted` on all three routes
(`review`/`implement`/`fix-pr`). The five settings are independent: each
`runs-on:` is a plain job field, and each route's `runs_on:` is a `with:` input
that defaults to `ubuntu-latest` inside `claude-run.yml` when omitted. Grep for
`runs-on` and `runs_on` and keep all five in agreement, or the routes fall back
to hosted runners while `classify` keeps working.

| Input | Default | Purpose |
|-------|---------|---------|
| `runs_on` | `ubuntu-latest` | Runner label (e.g. `self-hosted`). |
| `timeout_minutes` | `45` | Job timeout; raise for long implement runs. |
| `go_version` | (empty) | If set, installs Go for `gofmt` on edited files only. Pair with `extra_allowed_tools: 'Bash(gofmt *)'`. |
| `extra_allowed_tools` | (empty) | Comma-separated allowlist entries appended to the main agent of every route EXCEPT the hard-locked `create-release` flow. It permits no agent guide contract command. In a repository with an agent guide contract, the entries `Bash(<regenerate command>)` and `Bash(<verify command>)` are removed from it on every route (see **Agent guide contract**). Same character rule as prompts. |
| `guide_contract_permit` | (empty) | Comma-separated plain commands that permit the agent guide contract runner to run them, for example `python3 -I tools/build_agent_guide.py,bash tools/check_agent_guide.sh`. Each entry must equal the stated `Regenerate` or `Verify` command exactly; a `Bash(...)` entry or a wildcard permits nothing. It is never added to any agent allowlist. Any non-blank entry makes the contract mandatory: a docs sync or a guide revision that reads no contract at the default-branch commit stops with a comment (see **Agent guide contract**). Same character rule as prompts. |
| `review_subprocess_scrub` | `true` | Review route only. `false` turns the secret scrub off on every runner; the review then runs only for a trusted pull request author and only with `review_subprocess_scrub_off_accepted: true`. See the security model. |
| `review_subprocess_scrub_off_accepted` | `false` | Review route only. Accepts the credential exposure of `review_subprocess_scrub: false` for a trusted author. It never admits an untrusted author. |
| `review_subprocess_scrub_self_hosted` | `false` | Ignored. Kept so an older caller that passes it still runs. It skips no layout detection, preparation, protection check, or author gate. |

Self-hosted runners should provide `git`, `gh`, `jq`, and `python3`. A run that
ends green needs both `jq` and `python3`, because the post-run comment steps use
both tools.

- Neither tool: the stage step stops every route, and the failure-note step
  posts a plain failure note on the issue or pull request.
- Only one tool: the stage step passes, because it can read the pinned plugin
  sources and write the local marketplace with either tool. Claude runs and
  replies. A post-run comment step then fails, and the failure-note step posts
  a plain failure note.
- No `jq`: the post-run Claude error check is also skipped with a warning.

`flow` also accepts `sync-release` (docs sync plus a `docs-release/v<version>`
PR whose merge triggers the repo's own release workflow). `claude.yml` does not
detect that phrase by default; add it to the flow candidate list only if your
repo has a merge-triggered release workflow that parses the `docs-release/*`
branch name.

## Agent guide contract

A repository that generates its agent guides (for example `AGENTS.md`) from
`CLAUDE.md` and rule files with a project command states this in an
`## Agent guide contract` block in its root `CLAUDE.md`. The block form is
owned by `skills/sync-docs/guide-contract.md`. A caller with no block and no
`guide_contract_permit` entry sees no change: both docs flows and the
post-implementation `Revise CLAUDE.md with session learnings` step run as
before. A permit of blank entries only is no permit.

To enable it, set `guide_contract_permit` of the `implement` job (the docs
flows run through that job) to the two exact commands, joined by a comma, for
example `guide_contract_permit: 'python3 -I tools/build_agent_guide.py,bash
tools/check_agent_guide.sh'`. A `Bash(...)` entry or a wildcard entry does not
permit a command, and `extra_allowed_tools` permits nothing.

A permit with any non-blank entry makes the contract mandatory for that caller,
also when no entry permits a command. Put the contract block on the default
branch before you set the permit, or in the same change: from the time the
permit is set, a docs sync or a guide revision that reads no contract at the
default-branch commit stops. That includes the implement run that adds the
block on a session branch.

- **Separate permit.** The permit is its own input so that it never adds a
  command to an agent allowlist. `extra_allowed_tools` reaches the agent of the
  review, `fix-pr`, and implement routes, and the review route checks out the
  pull request head, so a raw project command on that list would let the review
  agent run code that the pull request wrote. For the same reason, when the
  default-branch `CLAUDE.md` states a contract, the compose step removes the
  entries `Bash(<regenerate command>)` and `Bash(<verify command>)` from
  `extra_allowed_tools` on every route, and it removes `Bash(<entry>)` for each
  `guide_contract_permit` entry. When the heading is there but the runner cannot
  report a parsed contract (a malformed statement, no `python3`, or a runner
  failure), every `extra_allowed_tools` entry is dropped for that run with a
  warning.

- **Trusted read.** The `Compose Claude prompt` step reads the block from
  `CLAUDE.md` at the default-branch tip (the fetched `FETCH_HEAD`; when the
  fetch fails, `HEAD` only on a run of the default branch). Pull request
  content and session branches are never read for the block.
- **Runner.** `scripts/guide_contract.py` runs the two commands. It refuses to
  run unless the work-tree contract block and every stated command file equal
  the default-branch blobs. It starts each command with no shell, a 600-second
  limit, and an environment of only `PATH`, an empty `HOME`, and git overrides
  that turn hooks and the file monitor off. It refuses a regenerate command that
  changes a file outside the stated generated files and a verify command that
  changes any file. The clean environment keeps the job secrets out of the
  command environment; on Linux a process can still read the environment of
  other processes of the same user, so the trust in the command comes from its
  equality with the default-branch files.
- **Docs flows.** The compose step appends
  `prompts/sync-docs-guide-contract.md` after the base prompt and before any
  `-local.md` override, names the state (`ready`, `denied`, `malformed`, or
  `unavailable`), and, when it is `ready`, gives the agent two exact runner
  command lines and adds only those two lines to the allowlist. A `ready` state
  also writes staged copies of the stated sources into
  `$RUNNER_TEMP/rk-guide-stage`, names each one in the prompt, and adds that
  directory with `--add-dir`. The runner run command copies each changed staged
  copy over its source before it regenerates, under the same stop rules as the
  settle step, and it checks the contract block again after the copy. Any other state
  is a blocked sync with a comment. With a permit entry and no readable
  contract at the default-branch commit (no trusted commit, a `CLAUDE.md` that
  is missing, is not a regular file, or has no exact heading line, or a heading
  only inside a code fence), the compose step records the reason, prints it as an error, and fails
  the job before the agent starts. `Report a stopped documentation sync` then
  posts one comment that states the reason, and the generic failure note is
  skipped when that comment posts. The `create-release` flow reads no contract
  and does not stop.
- **Implement route.** `Prepare the guide contract revise pass` finds the one
  session branch that the run created or moved and pushed, compares its
  contract block and command files with the default branch, and creates the
  work tree `.claude/worktrees/rk-guide-revise`. Claude Code denies an edit to a
  rule file under `.claude/rules/` as a sensitive file, so the prepare step also writes one staged copy
  of each stated source that exists into `$RUNNER_TEMP/rk-guide-stage`, outside
  the workspace. `Revise the guide sources` runs with `--add-dir` on that
  directory and edits only the staged copies (no project command, no commit, no
  push). The settle step copies each changed staged copy over its source in the
  revise work tree before its checks. It stops with no write when a staging
  file is no staged copy of a stated source, a staged copy is a symbolic link or
  is missing, a source or one of its parent directories is a symbolic link, or a
  source changed both in place and in its staged copy.
  `Regenerate, verify, and commit the agent guides` runs the runner and commits
  the sources with the regenerated guides in one commit. `Push the agent guide
  commit` is an action step whose allowlist is exactly `Bash(git -C
  .claude/worktrees/rk-guide-revise push)`, because only the action holds the
  `claude[bot]` push identity that starts CI, and it removes that credential
  when its step ends. `Report the guide contract result` posts a comment that
  names the reason, the command, and its output on any stop, and also when the
  revise step fails before it edits a source. It reads the revise step's
  execution file: when Claude Code denied a tool call, the run notice states
  the denial and the comment names each denied tool and path, also when the
  commit landed. The settle step refuses to run a
  project command while the work tree holds any git-ignored file. The job result
  does not change, because the implementation is already pushed. A session that
  changed a command file or the contract block gets that comment, and no project
  command runs. With a permit entry and no readable contract at the
  default-branch commit, the prepare step reports `stop` with the reason in
  place of `none`: no revise work tree is made, the legacy `Revise CLAUDE.md
  with session learnings` step does not run, `Report the guide contract result`
  posts the reason, and the implementation commit stays on the session branch.
  `Detect if Claude made commits` opens the prepare step when the main checkout
  changed, or when the runner `session-branches` command finds one or more
  session branches. This includes a session that commits only in a work tree
  under `.claude/worktrees/`. A session branch is a local branch that is new or
  moved since the record step. The default branch, a branch under `rk-guide/`,
  and a new branch that still points at the start commit (such as the unmoved
  action branch) are no session branches, and the prepare step uses the same
  rule. When the detect step cannot prove the recorded branch list or the
  runner, or `python3` is missing, it opens the prepare step, so that the
  prepare step posts its stop reason. The detect step never reads
  `guide_contract_permit`. The legacy `Revise CLAUDE.md with session learnings`
  step still reads only the main checkout result.
- **Limits.** A docs-flow agent must call the runner; Claude Code enforces this
  only because the raw command entries are off its allowlist. The command-file
  list is the repository's statement: a helper that the generator loads and the
  list omits is not compared, so list a directory when in doubt.
  The runner finds each program on the `PATH` that the trusted step recorded;
  an agent that can write into a directory on that `PATH` already controls
  every command it runs, so the runner adds no exposure there.
  A caller that states a contract and sets no permit still gets the legacy
  editors when no trusted commit is available, because the workflow then has no
  signal from that caller.

## Triggers (comments by OWNER / MEMBER / COLLABORATOR only)

| Comment | Route | Push? |
|---------|-------|-------|
| `@claude review` | PR review (read-only, `LGTM` / `Needs Updates` format) | No |
| `@claude <anything else>` on a PR | fix-pr: re-validate unaddressed feedback, fix what survives, fold in comment text as scope, disposition comment, re-review trigger | Yes (trusted-author PRs only) |
| `@claude <anything>` on an issue | implement: validate, implement, PR via the issue-workflow prompt | Yes (trusted-author issues only; any other issue gets a fixed refusal comment and no agent run) |
| `@claude sync-docs` / `@claude create-release` (hyphenated only) on an issue | docs/release flows (needs `DOCS_RELEASE_ENABLED=true`) | Scoped (trusted issue author only) |
| `@claude sync-release` on an issue | docs/release flow, only after the candidate-list edit above | Scoped (trusted issue author only) |

The docs/release flows start only from a comment on a plain issue. On a PR,
`sync-docs`, `create-release`, and `sync-release` are ordinary comment text, so
the comment routes to fix-pr or review by the PR rules above.

Model shorthand (`opus`, `sonnet`, `fable`, each also with a `5` suffix, e.g.
`@claude opus5 review`) and `effort:low|medium|high|xhigh` are parsed from the
comment. `opus`/`opus5` and no shorthand both select Opus 5.5; no effort keeps
`high`. Review events (formal reviews, inline comments) always stay read-only.
`claude.yml` passes the shorthand and effort on as written, and `claude-run.yml`
maps them to a model id. A caller pinned to a commit keeps that commit's model
map until the pin moves. A caller on `@main` receives a model-map change on its
next run. An older `claude.yml` that still passes `model_id` keeps its own
model until you copy the template again.

## Security model

- **Least-privilege split:** the review route runs with `contents: read` on the
  job token, so a prompt-injected diff can never push or merge; only
  trusted-author routes get `contents: write` + `id-token: write`.
- **Two trust gates on every write route:** `classify` checks the commenter and
  the issue or PR author, and the `implement` and `fix-pr` jobs re-assert
  author trust (`OWNER`, `MEMBER`, `COLLABORATOR`, or `claude[bot]`) from the
  event payload, so a `classify` bug cannot grant push. The `implement` job
  also refuses a PR comment. An issue or docs/release flow whose author fails
  that check routes to the `untrusted-issue` job, which has only
  `issues: write`, runs no agent and no checkout, and posts one fixed comment
  that interpolates no event field.
- **Flows run only on issues:** `claude.yml` detects a docs/release flow only
  on a comment on a plain issue. The first step of `claude-run.yml` also fails
  the job, before any checkout, when a flow or the `implement` route arrives on
  a pull request event. A caller pinned to a commit has the refusal in that
  commit. A caller on `@main` has the refusal on the branch tip.
- **No-execution ban:** the agent never runs the project's code in any mode
  (no test suites, builds, type checks, or scripts). Allowlists carry no
  interpreters; CI owns checks.
- **Fail-closed routing:** anything ambiguous classifies as read-only review;
  untrusted issue or PR authors never reach a push-capable route.
- **No job token on disk during review:** the review route keeps the job token
  out of git config and `$RUNNER_TEMP`. `claude-run.yml` sets the action's
  `allowed_non_write_users` input to a value that no GitHub login can equal, so
  the action uses a token-free credential helper and scrubs secrets from
  subprocess environments, except when the caller turns the scrub off (see
  below). The action's write-permission check still applies
  to every actor. Git offers the token only to the GitHub server. A
  `PreToolUse` hook blocks every tool call if the token reaches git config,
  `$RUNNER_TEMP`, or a git credential store under the job home or the agent
  home, if git does not open the workspace, if the job token is missing from
  the environment, or if the guard script changed.
  `/proc` reads, `git --output`, and file-reading flags such as
  `git diff --no-index` are denied. The token stays in the agent process
  environment for `gh pr comment`; this is an accepted residual risk because
  the token has only this job's permissions and expires when the job ends.
- **Secret scrub on self-hosted runners:** every review keeps the scrub on by
  default, on every runner. The scrub's bubblewrap sandbox fails every Bash
  call in two self-hosted Linux layouts, so `claude-run.yml` prepares those
  runs before checkout:
  - The literal or resolved workspace is inside the literal or resolved
    `$HOME/actions-runner` or `$HOME/runners` (anthropics/claude-code#97730).
    Only the Claude action step runs with a temporary `HOME`, a new mode-0700
    directory `<passwd home>/.rk-claude-homes/home.*`, where `<passwd home>`
    is the home directory of the runner user ID in the passwd database. Its Claude Code settings
    and memory start empty. The step creates the home's startup, git, Bun,
    npm, Claude, ssh, and program-path entries before the run (`.local/bin`
    and `.bun/bin`, which the action adds to `PATH`), and the settings deny
    sandboxed writes to each of them. The credential hook and the action's
    own `git` calls run outside the sandbox with that `PATH`, so a program
    that a sandboxed command put there would run with the job token. With `HOME` moved, the sandbox no
    longer protects the job home by itself, so the step also creates the same
    entries in the job home when they are missing (empty files, `{}` for
    `.claude.json`, mode-0700 directories), and the settings deny them. The
    empty zsh files stop the zsh first-run setup menu for a user with no zsh
    files. These entries stay on the host; the step log lists them, and
    deleting them removes them. An always-run step empties the
    temporary home after the action. The empty directory stays on the host
    because the action adds its program directories to `PATH` for the rest of
    the job; a failed cleanup skips every later step that would run a program
    from `PATH`. A later review of the same user removes empty homes older than
    one day.
  - The review runs as root and a workspace ancestor is owned by another user
    ID (anthropics/claude-code#97731). A step creates a `.claude` directory
    (mode 0755) and a root-owned `.mcp.json` file (mode 0644,
    `{"mcpServers":{}}`) in each such ancestor that lacks them. The new
    `.claude` is owned by root, because the root sandbox cannot create its
    placeholders in a directory owned by another user. When the ancestor is
    that user's home directory, the step emits a warning: that user's own
    Claude Code cannot write its settings there until the runner moves out of
    the home and someone runs `sudo rm -r <home>/.claude`. It keeps valid existing entries,
    refuses symlinks and wrong types, never overwrites, and never follows a
    replaced path. The stubs stay on the host for later jobs.
  Every review on a self-hosted Linux runner with the scrub on adds
  sandboxed write denials to its settings file: `<passwd home>/.rk-claude-homes`,
  the mode-0700 directory of this user that holds every temporary home;
  `$RUNNER_TEMP`; the job home's startup, ssh, git, and Claude files and its
  program directories `.local/bin` and `.bun` (a review with the real `HOME`
  creates `.local/bin` and `.bun/bin` when they are missing, because the
  action installs programs there and adds them to `PATH`); the protected
  entries of the temporary home; the runner installation files; every entry of
  the runner work directory except the one that holds the workspace (the
  action cache `_work/_actions`, from which the action runs Bun with the job
  token after Claude ends, the tool cache, and the workspaces of other
  repositories); and `$RUNNER_TOOL_CACHE`, which the step creates when it is
  missing. An entry that a review creates in the work directory during the
  run is not covered. Without the first entry, a review could change
  the home of another review that runs as the same user at the same time.
  The directory is in the user's own home, so another user ID cannot create
  it first and stop that user's reviews; in shared `/tmp` it could. A review
  refuses the passwd home when it is missing, `/`, not owned by the user, or
  writable by group or others; a review that needs a temporary home then
  stops. The sandbox's own runner protection did not cover a root runner
  inside another user's home on the probe.
  If the preparation fails, the review stops before Claude starts. No path
  turns the scrub off for a layout. The guard, the checks before and after the
  action, and the settings cover both the job home and the temporary home.
  A manual remedy that needs no preparation is to move the runner out of
  `$HOME` and give the workspace ancestors to root. The sandbox behavior
  belongs to the Claude Code version the pinned action installs, so a change
  of the action pin reruns `docs/review-sandbox-probe/probe.sh` (the
  `Review sandbox probe` workflow does this on a pull request).
- **Scrub-off exception:** `review_subprocess_scrub: false` turns the scrub off
  on every runner, so tool subprocesses can see the Claude credential. The
  review then runs only when the pull request author has the `OWNER`,
  `MEMBER`, or `COLLABORATOR` association (or is `claude[bot]`) and the
  review job also sets `review_subprocess_scrub_off_accepted: true`; the step
  then emits a warning that names the exposure. Any other author is refused
  before checkout whatever the acceptance input is. This route uses the job
  home and runs no stub or temporary-home step.
  `review_subprocess_scrub_self_hosted` is ignored.
- **Host changes on self-hosted Linux runners:** every review on a
  self-hosted Linux runner that keeps the scrub runs
  `sudo apt-get install bubblewrap socat` and
  `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0`. The sysctl
  setting stays until the machine restarts. In the two layouts above, a review
  also leaves the ancestor stubs and empty temporary home directories (each
  removed by a later review after one day), and every such review leaves the
  directory `<passwd home>/.rk-claude-homes`. A review with a temporary home
  also leaves the missing protected entries that it creates in the job home
  (listed in its step log). When the job home has no `.bash_profile`, every
  such review creates one that loads a `.bash_login` with content, or else
  `.profile`, as a bash login shell does without it. The scrub sandbox
  otherwise leaves an empty `~/.bash_profile` in a real `HOME` (probe layout
  L4), and a bash login shell then skips `.profile`. An empty
  `.bash_profile` that an earlier review left stays; delete it to restore
  the login order.
  `review_subprocess_scrub: false` skips the host changes and the scrub, under
  the scrub-off exception above.

## Pinned revisions

The maintainer of `richkuo/rk-skills` owns these pins. The run checks out this
repository at `job.workflow_sha`, which is the full commit of the called
workflow file. That commit supplies the prompts, the scripts, and the
`rk-skills` plugin. The workflow file cannot store its own commit id. A caller
pin selects it. The run checks out `anthropics/claude-plugins-official` at the
commit in the table below and copies `code-review` and `claude-md-management`
from that tree into a local marketplace named `rk-pinned-claude-plugins`. Both
agent passes install `code-review` from that marketplace. The documentation
pass also installs `claude-md-management` from it. The primary pass installs
`rk-skills` from the called workflow commit.

A missing commit id, a failed checkout, a checkout whose commit does not match,
a required plugin source that is not a relative path inside its pinned tree, or
a runner with neither `jq` nor `python3` stops the job. The run does not
substitute a branch or a tag.

Each entry in `rk-pinned-claude-plugins` is a copy of the pinned upstream
entry, with every field kept, such as `strict`, `version`, and component
lists. Only `source` is set, to the validated relative path.

Claude Code refuses a local marketplace whose name is `claude-plugins-official`.
The `code-review` entry in `anthropics/claude-code` is a git subdirectory of
`anthropics/claude-plugins-official` at `ref: main` with no commit id. The run
does not add either of those marketplace URLs.

`templates/claude-workflow/workflows/claude.yml` and
`.github/workflows/claude.yml` in this repository still call `@main`. Copy the
template, then replace `@main` with the full commit you reviewed. An `@main`
caller runs the moving branch tip, so the workflow file and the same-repository
assets move together and are not frozen.

This repository is public. A public caller may use this public reusable
workflow. Do not move the workflow to a private repository to satisfy a pin.
If this repository becomes private, fix access before the next caller change.
Do not point a caller at a branch to keep a private workflow reachable.

| Source | Version | Commit |
|--------|---------|--------|
| Prompts, scripts, and the `rk-skills` plugin | The commit the caller pins | `job.workflow_sha` for that run |
| `anthropics/claude-plugins-official` (`code-review`, `claude-md-management`) | No release tag. Snapshot of `main` on 2026-11-12. | `e0ab6e51219eef74e417a0e1d89e5d53e5e763d4` |

Record a new mapping in this table. Do not add the version as a comment in the
workflow file.

### Update procedure

1. Read the upstream change. For the plugin pin, open the commit and confirm
   that `code-review` and `claude-md-management` each have a relative source
   path and that those directories are present. Read each full entry too. The
   run copies every field of the entry, so a new field such as `strict: false`
   or a component list changes what gets installed.
2. Confirm this repository is still public, and that a public caller can still
   use the reusable workflow.
3. Put the new plugin commit in `.github/workflows/claude-run.yml` and in the
   table above. Move the two together.
4. Confirm a bad commit id, a failed checkout, and a non-local plugin source
   each stop the job, and that no step assigns a branch or a tag as a fallback.
5. Run the review, implement, and fix-pr routes on a controlled change. Confirm
   the inputs, the permissions, and the author gates are unchanged.
6. To roll back, restore the previous plugin commit in the workflow and in the
   table, then move each caller pin back to the previous workflow commit.
