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
| `extra_allowed_tools` | (empty) | Comma-separated allowlist entries appended to every route EXCEPT the hard-locked `create-release` flow. Same character rule as prompts. |

Self-hosted runners should provide `git`, `gh`, and `jq`; without `jq` the
post-run Claude error check is skipped with a warning.

`flow` also accepts `sync-release` (docs sync plus a `docs-release/v<version>`
PR whose merge triggers the repo's own release workflow). `claude.yml` does not
detect that phrase by default; add it to the flow candidate list only if your
repo has a merge-triggered release workflow that parses the `docs-release/*`
branch name.

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
  subprocess environments, except where the scrub is off by default on a
  self-hosted runner (see below). The action's write-permission check still applies
  to every actor. Git offers the token only to the GitHub server. A
  `PreToolUse` hook blocks every tool call if the token reaches git config,
  `$RUNNER_TEMP`, or a git credential store, or if the guard script changed.
  `/proc` reads, `git --output`, and file-reading flags such as
  `git diff --no-index` are denied. The token stays in the agent process
  environment for `gh pr comment`; this is an accepted residual risk because
  the token has only this job's permissions and expires when the job ends.
- **Secret scrub on self-hosted runners:** the scrub's bubblewrap sandbox
  fails every Bash call in two self-hosted Linux layouts, and the reviewer then
  cannot run `git diff`: the literal or resolved workspace is inside
  `$HOME/actions-runner` or `$HOME/runners` (anthropics/claude-code#97730), or
  the review runs as root and a workspace ancestor owned by another uid lacks
  `.claude` or `.mcp.json` (anthropics/claude-code#97731). In those layouts
  the review route turns the scrub off by default, so tool subprocesses there
  can see the Claude credential, and the step emits a warning naming the
  cause. GitHub-hosted runners and every other self-hosted layout keep the
  scrub. Pass `review_subprocess_scrub_self_hosted: true` to `claude-run.yml`
  in the `review` job to keep the scrub in those layouts anyway.
  `claude-run.yml` still accepts `review_subprocess_scrub_off_accepted` so an
  older caller that sets it keeps running, but it ignores the value.
- **Host changes on self-hosted Linux runners:** every review on a
  self-hosted Linux runner that keeps the scrub runs
  `sudo apt-get install bubblewrap socat` and
  `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0`. The sysctl
  setting stays until the machine restarts. Pass
  `review_subprocess_scrub: false` in the `review` job to skip both; this also
  turns off the scrub on every runner.

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
or a required plugin source that is not a relative path inside its pinned tree
stops the job. The run does not substitute a branch or a tag.

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
   path and that those directories are present.
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
