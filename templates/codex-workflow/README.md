# codex-workflow — full @codex GitHub Actions bundle

The Codex twin of `templates/claude-workflow/`: a least-privilege `@codex` bot
that reviews PRs, implements issues, and fixes PR reviews. Same three routes,
same fail-closed router, same review contract, same install shape, with
`openai/codex-action` underneath. Read the Claude bundle's README first; this
file states only what differs.

Claude and Codex are independent: separate workflow files, concurrency groups,
and secrets. Installing this bundle changes nothing about an existing `@claude`
bundle, and the in-session rk-skills skills keep posting `@claude` unless Codex
is named (see **Skills default to Claude**).

## What's inside

| Path | Purpose |
|------|---------|
| `workflows/codex.yml` | The ONLY file a consumer repo vendors: trigger, author gate, fail-closed `classify` job, one caller job per route with least-privilege `permissions:`. |
| `../../.github/workflows/codex-run.yml` (repo root) | Reusable run body, called via `uses: richkuo/rk-skills/.github/workflows/codex-run.yml@main`. Fetches the prompts, the shared comment-patch scripts, and the `skills/` tree at run time. |
| `prompts/*.md` | One prompt per route, fetched at run time. `pr-review-format.md` is byte-identical to the Claude copy; the others differ only where the harness does. |
| `scripts/test_workflow_logic.py` | Executes the real classifier shell out of `codex.yml`, pinning every route including the `CODEX_BOT_LOGIN` fail-closed cases. |

Comment-patch helpers are not duplicated: `codex-run.yml` reuses
`templates/claude-workflow/scripts/`, which key off `BOT_LOGIN`, `RUN_ID`, and
a harness variable set here to `openai/codex-action@v1`.

## Install

```sh
git clone --depth 1 https://github.com/richkuo/rk-skills /tmp/rk-skills
mkdir -p .github/workflows
cp /tmp/rk-skills/templates/codex-workflow/workflows/codex.yml .github/workflows/
```

Only `codex.yml` is copied; everything else is fetched at run time. Then:

1. Add the `OPENAI_API_KEY` secret. Every route bills OpenAI usage on it.
2. **Write routes need your own GitHub App.** `openai/codex-action` mints no
   App token and a `GITHUB_TOKEN` push does not retrigger CI, so `implement`
   and `fix-pr` mint an installation token via `actions/create-github-app-token`.
   Create an App with **contents: write**, **pull requests: write**, **issues:
   write**, install it on the repo, and add `CODEX_APP_ID` and
   `CODEX_APP_PRIVATE_KEY` as secrets. A write route missing either fails at
   once naming the missing one; there is no `GITHUB_TOKEN` fallback. (A PAT with
   `repo` + `workflow` scope in the same two secrets needs a fork of the run
   body.)
3. **Set the `CODEX_BOT_LOGIN` repository variable** to your App's bot login
   (e.g. `acme-codex[bot]`). Claude hardcodes `claude[bot]` because one Claude
   App serves every consumer; your Codex App is per repo, and a job-level `if:`
   cannot read secrets. Unset, it disables only bot self-trigger (a review chain
   never continues on its own), bot-author trust (a PR opened by your App stays
   read-only under `@codex`), and the LLM footer patch on write-route comments.
   Human OWNER/MEMBER/COLLABORATOR routes still work.
4. Optional: set `DOCS_RELEASE_ENABLED=true` to enable the docs-sync / release
   flows (off by default, fail-closed).
5. Prompt overrides work as in the Claude bundle: `.github/prompts/<name>.md`
   replaces, `.github/prompts/<name>-local.md` appends, both read from the
   default branch.
6. Tests:
   `python3 -m unittest discover -s /tmp/rk-skills/templates/codex-workflow/scripts -p 'test_*.py'`.

## Customization inputs

`codex.yml` ships with `classify` on `runs-on: self-hosted` and
`runs_on: self-hosted` on all three routes. The four settings are independent
(`runs_on` defaults to `ubuntu-latest` inside `codex-run.yml` when omitted);
grep for `runs-on` and `runs_on` and keep all four in agreement.

| Input | Default | Purpose |
|-------|---------|---------|
| `runs_on` | `ubuntu-latest` | Runner label. |
| `timeout_minutes` | `45` | Job timeout. |
| `go_version` | (empty) | If set, installs Go for `gofmt` on edited files only. |
| `extra_allowed_tools` | (empty) | Accepted for parity with `claude-run.yml` and **ignored**: Codex has no per-tool allowlist. A non-empty value logs a notice. |
| `bot_login` | (empty) | Pass `${{ vars.CODEX_BOT_LOGIN }}`; see install step 3. |

Self-hosted runners need `git`, `gh`, `node`, `npm` (the action installs the
Codex CLI with `npm install -g`), `python3`, and `jq`; the footer patch scripts
use the last two and fail without `jq`.

`flow` also accepts `sync-release`, which `codex.yml` does not detect by default;
add it to the flow candidate list only if your repo has a merge-triggered
release workflow that parses the `docs-release/*` branch name.

## Triggers (comments by OWNER / MEMBER / COLLABORATOR only)

| Comment | Route | Push? |
|---------|-------|-------|
| `@codex review` | PR review (read-only, `LGTM` / `Needs Updates` format) | No |
| `@codex <anything else>` on a PR | fix-pr: re-validate unaddressed feedback, fix what survives, fold in comment text as scope, disposition comment, re-review trigger | Yes (trusted-author PRs only) |
| `@codex <anything>` on an issue | implement: validate, implement, PR via the issue-workflow prompt | Yes |
| `@codex sync-docs` / `@codex create-release` (hyphenated only) | docs/release flows (needs `DOCS_RELEASE_ENABLED=true`) | Scoped |
| `@codex sync-release` | docs/release flow, only after the candidate-list edit above | Scoped |

`effort:low|medium|high|xhigh` is parsed from the comment; the default is
`xhigh`. Review events (formal reviews, inline comments) always stay read-only.

| Shorthand | Model | Notes |
|-----------|-------|-------|
| (none) / `sol` | `gpt-5.6-sol` | Flagship default. |
| `terra` | `gpt-5.6-terra` | Balanced everyday model. |
| `luna` / `mini` | `gpt-5.6-luna` | Fast and affordable; the counterpart to `@claude sonnet review` for the C0–C20 band and the cheap non-blocking re-review. |
| `codex` / `spark` | `gpt-5.3-codex-spark` | Text-only fast coding preview. |

An unrecognized shorthand falls through to the default.

## Security model

- **No write credential on the read path.** The review route mints no App
  token, its job token is `contents: read`, and Codex runs in the read-only
  sandbox, which denies writes and network. The agent never posts; a trusted
  step posts its final message with the job token via `--body-file`, so model
  output is never shell-evaluated.
- **Everything the review needs is staged first.** `codex-run.yml` checks out
  the PR head, resolves the merge base, and writes PR metadata to a file before
  Codex starts. Facts the agent cannot source produce the contract's
  `**Verification limitation:**` line.
- **`GITHUB_TOKEN` never pushes, on any route.** Every job stays
  `contents: read`; only the App installation token can write.
- **Two independent trust gates on the write path.** `classify` runs with
  `permissions: {}`; the `fix-pr` job re-asserts PR-author trust from the event
  payload, so a classify bug cannot grant push over an untrusted-author PR.
- **No-execution ban:** the agent never runs the project's code; CI owns checks.
- **Fail-closed routing:** ambiguity classifies as read-only review; untrusted
  PR authors never reach a push-capable route; an unset `CODEX_BOT_LOGIN`
  removes bot trust.
- **Loop prevention:** a comment by the configured Codex bot invokes only when
  its stripped body is exactly a one-line `@codex [model] review [effort:…]`
  trigger.

## Skills default to Claude

`fix-pr-review`, `work-on-issue-loop`, `fix-pr-review-loop`, and
`milestone-workflow` keep posting `@claude review` even with `codex.yml`
installed. They post `@codex` only when Codex is explicitly selected: you say
so, a caller argument names it (`reviewBot: codex`), or the run was started by
an `@codex` GitHub comment. Once a cycle picks a bot, every re-review in that
cycle stays on it.
