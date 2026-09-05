# claude-workflow — full @claude GitHub Actions bundle

The two-workflow setup behind the rk-skills PR loop: a least-privilege `@claude`
bot that reviews PRs, implements issues, and fixes PR reviews, with its prompts,
comment-patching scripts, and regression tests. `templates/codex-workflow/` is
the Codex twin and documents only what differs from this file.

## What's inside

| Path | Purpose |
|------|---------|
| `workflows/claude.yml` | The ONLY file a consumer repo vendors: trigger, author gate, fail-closed `classify` job, one caller job per route with least-privilege `permissions:`. |
| `../../.github/workflows/claude-run.yml` (repo root) | Reusable run body, called via `uses: richkuo/rk-skills/.github/workflows/claude-run.yml@main`. Fetches the prompts and scripts below from rk-skills at run time, so an rk-skills update reaches every consumer on its next run. |
| `prompts/*.md` | One prompt per route, fetched at run time. Must never contain `"`, backticks, or `$` (shell-evaluated downstream). |
| `scripts/` | Comment patch/compose helpers plus unit tests. `test_workflow_logic.py` executes the real classifier shell out of `claude.yml`. |

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
4. Tests:
   `python3 -m unittest discover -s /tmp/rk-skills/templates/claude-workflow/scripts -p 'test_*.py'`.

**Migrating from the retired review-only template** (single workflow,
`ANTHROPIC_API_KEY`): replace the workflow file per the steps above, add the
secret and the App, then remove `ANTHROPIC_API_KEY` when nothing else uses it.
`claude-run.yml` now carries the review-route safety limits (staged PR head,
`--disallowedTools`, `--setting-sources user`, workspace-scoped
`claudeMdExcludes`) that the old template held alone.

## Customization inputs

`claude.yml` ships with `classify` on `runs-on: self-hosted` and
`runs_on: self-hosted` on all three routes (`review`/`implement`/`fix-pr`).
The four settings are independent: `classify`'s `runs-on:` is a plain job
field, and each route's `runs_on:` is a `with:` input that defaults to
`ubuntu-latest` inside `claude-run.yml` when omitted. Grep for `runs-on` and
`runs_on` and keep all four in agreement, or the routes fall back to hosted
runners while `classify` keeps working.

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
| `@claude <anything>` on an issue | implement: validate, implement, PR via the issue-workflow prompt | Yes |
| `@claude sync-docs` / `@claude create-release` (hyphenated only) | docs/release flows (needs `DOCS_RELEASE_ENABLED=true`) | Scoped |
| `@claude sync-release` | docs/release flow, only after the candidate-list edit above | Scoped |

Model shorthand (`opus`, `sonnet`, `fable`, each also with a `5` suffix, e.g.
`@claude opus5 review`) and `effort:low|medium|high|xhigh` are parsed from the
comment. `opus`/`opus5` selects Opus 5; no shorthand keeps the Opus 4.8
default; no effort keeps `xhigh`. Review events (formal reviews, inline
comments) always stay read-only.

## Security model

- **Least-privilege split:** the review route runs with `contents: read` on the
  job token, so a prompt-injected diff can never push or merge; only
  trusted-author routes get `contents: write` + `id-token: write`.
- **No-execution ban:** the agent never runs the project's code in any mode
  (no test suites, builds, type checks, or scripts). Allowlists carry no
  interpreters; CI owns checks.
- **Fail-closed routing:** anything ambiguous classifies as read-only review;
  untrusted PR authors never reach a push-capable route.
