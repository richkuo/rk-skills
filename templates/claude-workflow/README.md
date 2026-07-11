# claude-workflow — full @claude GitHub Actions bundle

The complete two-workflow setup behind the rk-skills PR loop: a least-privilege
`@claude` bot that reviews PRs, implements issues, and fixes PR reviews, with
its prompts, comment-patching scripts, and regression tests. This is the same
setup deployed on the repos it was extracted from, genericized.

## What's inside

| Path | Purpose |
|------|---------|
| `workflows/claude.yml` | The ONLY file a consumer repo vendors: trigger + author gate + fail-closed route classifier (`classify`), and one caller job per route with least-privilege `permissions:`, each calling the published run body. |
| `../../.github/workflows/claude-run.yml` (repo root) | Reusable run body shared by every route, published from rk-skills and called cross-repo via `uses: richkuo/rk-skills/.github/workflows/claude-run.yml@main`. Fetches the prompts and scripts below from rk-skills at run time — updating rk-skills updates every consumer repo on its next run. |
| `prompts/*.md` | One prompt file per route (pure prompt text — the single source of truth, fetched at run time). Must never contain `"`, backticks, or `$` (shell-evaluated downstream). |
| `scripts/` | Comment patch/compose helpers plus their unit tests, including `test_workflow_logic.py`, which extracts and executes the real classifier shell from `claude.yml`. Fetched at run time. |

## Install

Copy the trigger workflow into your repo's `.github/workflows/`:

```sh
git clone --depth 1 https://github.com/richkuo/rk-skills /tmp/rk-skills
mkdir -p .github/workflows
cp /tmp/rk-skills/templates/claude-workflow/workflows/claude.yml .github/workflows/
```

Prompts, scripts, and the run body are NOT copied — they are fetched from
rk-skills at run time by the reusable workflow. Then:

1. Add the `CLAUDE_CODE_OAUTH_TOKEN` secret (Claude Code OAuth token). The
   write-capable routes authenticate as the Claude GitHub App (`claude[bot]`),
   so the app must be installed on the repo.
2. Optional: set the `DOCS_RELEASE_ENABLED` repository variable to `true` to
   enable the docs-sync / release comment flows (off by default, fail-closed).
3. Tailor per repo with prompt override files, not by editing the shared
   prompts. Two forms, combinable per route:
   - **Replace:** `.github/prompts/<prompt-name>.md` (e.g. `issue-workflow.md`)
     is used INSTEAD of the shared prompt — for repos whose base prompt needs
     safety-hardened language the shared text lacks.
   - **Append:** `.github/prompts/<prompt-name>-local.md` (e.g.
     `fix-pr-local.md`) is appended to whichever base was chosen.
   Both obey the same character rule: no `"`, backticks, or `$`. Overrides are
   read from the repository's **default branch**, never the event checkout, so
   a change to them lands only after it merges (and a fork PR can never alter
   the prompt for its own review).
4. Run the tests from the rk-skills clone:
   `python3 -m unittest discover -s /tmp/rk-skills/templates/claude-workflow/scripts -p 'test_*.py'`.

## Customization inputs

Each call site in `claude.yml` can pass these optional `with:` inputs to the
reusable workflow (defaults shown):

| Input | Default | Purpose |
|-------|---------|---------|
| `runs_on` | `ubuntu-latest` | Runner label (e.g. `self-hosted`). |
| `timeout_minutes` | `45` | Job timeout; raise for repos with long implement runs. |
| `go_version` | (empty) | If set, installs Go — ONLY for `gofmt` on edited files (a formatter, never execution). Pair with `extra_allowed_tools: 'Bash(gofmt *)'`. |
| `extra_allowed_tools` | (empty) | Comma-separated allowlist entries appended to every route EXCEPT the hard-locked `create-release` flow. Same character rule as prompts: no `"`, backticks, or `$`. |

Self-hosted runners should provide `git`, `gh`, and `jq`; without `jq` the
post-run Claude error check is skipped with a warning instead of failing.

The `flow` input also accepts `sync-release` (docs sync + a `docs-release/v<version>`
PR whose merge triggers the repo's own release workflow). The vendored
`claude.yml` does not detect that phrase by default — add it to the flow
candidate list only if your repo has a merge-triggered release workflow that
parses the `docs-release/*` branch name.

## Triggers (comments by OWNER / MEMBER / COLLABORATOR only)

| Comment | Route | Push? |
|---------|-------|-------|
| `@claude review` | PR review (read-only contract, `LGTM` / `Needs Updates` format) | No |
| `@claude <anything else>` on a PR | fix-pr: re-validate all unaddressed review feedback, fix what survives, fold in any comment text as additional scope, disposition comment, re-review trigger | Yes (trusted-author PRs only) |
| `@claude <anything>` on an issue | implement: validate → implement → PR via the issue-workflow prompt | Yes |
| `@claude sync docs` / `create release` / `sync release` | docs/release flows (needs `DOCS_RELEASE_ENABLED=true`) | Scoped |

Model shorthand (`@claude opus …`, `sonnet`, `fable`) and `effort:low|medium|high|xhigh`
are parsed from the comment; review events (formal reviews, inline comments)
always stay read-only regardless of keyword.

## Security model

- **Least-privilege split:** the review route runs with `contents: read` and is
  bound to the job token, so a prompt-injected diff can never push or merge;
  only trusted-author routes get `contents: write` + `id-token: write`.
- **No-execution ban:** the agent never runs the project's code in any mode —
  no test suites, builds, type checks, simulations, or scripts. Allowlists
  carry no interpreters; CI (if you have it) owns checks.
- **Fail-closed routing:** anything ambiguous classifies as read-only review;
  untrusted PR authors never reach a push-capable route.
