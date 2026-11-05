# claude-workflow — full @claude GitHub Actions bundle

The two-workflow setup behind the rk-skills PR loop: a least-privilege `@claude`
bot that reviews PRs, implements issues, and fixes PR reviews, with its prompts
and comment-patching scripts. `templates/codex-workflow/` is
the Codex twin and documents only what differs from this file.

## What's inside

| Path | Purpose |
|------|---------|
| `workflows/claude.yml` | The ONLY file a consumer repo vendors: trigger, author gate, fail-closed `classify` job, one caller job per route with least-privilege `permissions:`, and an `untrusted-issue` job that posts a fixed refusal comment. |
| `../../.github/workflows/claude-run.yml` (repo root) | Reusable run body, called via `uses: richkuo/rk-skills/.github/workflows/claude-run.yml@main`. Resolves the model id and effort, and fetches the prompts and scripts below from rk-skills at run time, so an rk-skills update reaches every consumer on its next run. |
| `prompts/*.md` | One prompt per route, fetched at run time. Must never contain `"`, backticks, or `$` (shell-evaluated downstream). |
| `scripts/` | Comment patch/compose helpers. |

## Install

```sh
git clone --depth 1 https://github.com/richkuo/rk-skills /tmp/rk-skills
mkdir -p .github/workflows
cp /tmp/rk-skills/templates/claude-workflow/workflows/claude.yml .github/workflows/
```

Only `claude.yml` is copied; everything else is fetched at run time. Then:

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
`runs-on: self-hosted`, and with `runs_on: self-hosted` on the `implement` and
`fix-pr` routes. The `review` route passes `runs_on: ubuntu-latest` for every
PR author. A GitHub-hosted runner is a fresh machine for each job and keeps the
secret scrub (see Security model). The five settings are independent: each
`runs-on:` is a plain job field, and each route's `runs_on:` is a `with:` input
that defaults to `ubuntu-latest` inside `claude-run.yml` when omitted. Grep for
`runs-on` and `runs_on` and keep the four `self-hosted` labels in agreement, or
the routes fall back to hosted runners while `classify` keeps working. Replace
`ubuntu-latest` on the `review` route only with the label of an isolated
ephemeral runner: a fresh machine for each job that shares no host with the
write routes. A repository with GitHub-hosted runners turned off must make that
replacement; otherwise reviews stay queued and do not run.

To run reviews on `self-hosted`, use a runner layout that keeps the secret
scrub, or set `review_subprocess_scrub_self_hosted: true` where the scrub works
on that runner. Keep untrusted-author reviews on a hosted runner with
`runs_on: ${{ needs.classify.outputs.pr_author_trusted == 'true' && 'self-hosted' || 'ubuntu-latest' }}`.
Set `review_subprocess_scrub_off_accepted: true` only to accept the exposure
that the Security model names; without it, a review in a scrub-off layout fails.

| Input | Default | Purpose |
|-------|---------|---------|
| `runs_on` | `ubuntu-latest` | Runner label (e.g. `self-hosted`). |
| `review_subprocess_scrub` | `true` | Review route only. `false` skips the scrub host changes and turns the scrub off on every runner; a review then runs only with `review_subprocess_scrub_off_accepted: true`. |
| `review_subprocess_scrub_self_hosted` | `false` | Review route only. `true` keeps the scrub on in the two self-hosted Linux layouts that break its sandbox (see Security model). |
| `review_subprocess_scrub_off_accepted` | `false` | Review route only. `true` accepts a review with the scrub off, for a trusted PR author only. See Security model for the exposure. |
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
maps them to a model id, so a model change in rk-skills reaches every consumer
on its next run. An older `claude.yml` that still passes `model_id` keeps its
own model until you copy the template again.

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
  a pull request event. That step protects a `claude.yml` copy that is not up
  to date, because `claude-run.yml` is fetched from `@main` at run time.
- **No-execution ban:** the agent never runs the project's code in any mode
  (no test suites, builds, type checks, or scripts). Allowlists carry no
  interpreters; CI owns checks.
- **Fail-closed routing:** anything ambiguous classifies as read-only review;
  untrusted issue or PR authors never reach a push-capable route, and every
  review runs on `ubuntu-latest` instead of the self-hosted runner.
- **No job token on disk during review:** the review route keeps the job token
  out of git config and `$RUNNER_TEMP`. `claude-run.yml` sets the action's
  `allowed_non_write_users` input to a value that no GitHub login can equal, so
  the action uses a token-free credential helper and scrubs secrets from
  subprocess environments, except where the owner turns the scrub off with
  `review_subprocess_scrub_off_accepted` (see below). The action's write-permission check still applies
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
  `.claude` or `.mcp.json` (anthropics/claude-code#97731). The scrub is off in
  those layouts unless `review_subprocess_scrub_self_hosted` is `true`, and it
  is off on every runner when `review_subprocess_scrub` is `false`. In both
  scrub-off cases, `claude-run.yml` fails the review with an `::error::` before
  any checkout unless the `review` job sets
  `review_subprocess_scrub_off_accepted: true`. A review of a PR whose author
  is not `OWNER`, `MEMBER`, `COLLABORATOR`, or `claude[bot]` (read from the
  event payload; an empty association is untrusted) fails in both cases,
  whatever that input is. GitHub-hosted runners and every other self-hosted
  layout keep the scrub, and the template sends every review to
  `ubuntu-latest`. The check protects every caller, including a `claude.yml`
  copy that is not up to date, because `claude-run.yml` is fetched from
  `@main`. With `review_subprocess_scrub_off_accepted: true`, the step emits a
  warning that names the exposure: tool subprocesses can see the Claude
  credential while the review reads text that people other than the PR author
  write. That text is comments, formal reviews, and inline review comments,
  which any GitHub user can post on a public repository, and commits from other
  people in the diff. A prompt injection in that text can try to read the
  credential. Set the input only when you accept that exposure.
- **Host changes on self-hosted Linux runners:** every review on a
  self-hosted Linux runner that keeps the scrub runs
  `sudo apt-get install bubblewrap socat` and
  `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0`. The sysctl
  setting stays until the machine restarts. Pass
  `review_subprocess_scrub: false` in the `review` job to skip both; this also
  turns off the scrub on every runner, so every review then fails unless the
  `review` job also sets `review_subprocess_scrub_off_accepted: true`, and every
  review of an untrusted-author PR fails in all cases.
