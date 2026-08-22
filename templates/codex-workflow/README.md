# codex-workflow — full @codex GitHub Actions bundle

The Codex twin of `templates/claude-workflow/`: a least-privilege `@codex` bot
that reviews PRs, implements issues, and fixes PR reviews, with its prompts and
regression tests. Same three routes, same fail-closed router, same review
contract, same consumer install shape — a different agent underneath.

Claude and Codex are independent. Installing this bundle changes nothing about
an existing `@claude` bundle: separate workflow files, separate concurrency
groups, separate secrets. In-session rk-skills skills keep posting `@claude`
unless you name Codex (see **Skills default to Claude** below).

## What's inside

| Path | Purpose |
|------|---------|
| `workflows/codex.yml` | The ONLY file a consumer repo vendors: trigger + author gate + fail-closed route classifier (`classify`), and one caller job per route with least-privilege `permissions:`, each calling the published run body. |
| `../../.github/workflows/codex-run.yml` (repo root) | Reusable run body shared by every route, published from rk-skills and called cross-repo via `uses: richkuo/rk-skills/.github/workflows/codex-run.yml@main`. Fetches the prompts below, the shared comment-patch scripts, and the rk-skills `skills/` tree at run time — updating rk-skills updates every consumer repo on its next run. |
| `prompts/*.md` | One prompt file per route (pure prompt text — the single source of truth, fetched at run time). `pr-review-format.md` is byte-identical to the Claude bundle's copy; the others differ only where the harness does. |
| `scripts/test_workflow_logic.py` | Extracts and executes the real classifier shell out of `workflows/codex.yml`, pinning every routing outcome including the `CODEX_BOT_LOGIN` fail-closed cases. |

Comment-patch helpers are NOT duplicated here: `codex-run.yml` reuses
`templates/claude-workflow/scripts/` unchanged, because those scripts already
key off `BOT_LOGIN`, `RUN_ID`, and a harness env variable, which this bundle
sets to `openai/codex-action@v1`.

## Install

Copy the trigger workflow into your repo's `.github/workflows/`:

```sh
git clone --depth 1 https://github.com/richkuo/rk-skills /tmp/rk-skills
mkdir -p .github/workflows
cp /tmp/rk-skills/templates/codex-workflow/workflows/codex.yml .github/workflows/
```

Prompts, scripts, skills, and the run body are NOT copied — they are fetched
from rk-skills at run time by the reusable workflow. Then:

1. Add the `OPENAI_API_KEY` secret. Every route consumes OpenAI usage on that
   key.
2. **Write routes need your own GitHub App.** `openai/codex-action` mints no
   GitHub App token, and a `GITHUB_TOKEN` push does not retrigger CI, so the
   `implement` and `fix-pr` routes take an installation token from
   `actions/create-github-app-token`. Create a GitHub App with **contents:
   write**, **pull requests: write**, and **issues: write**, install it on the
   repo, and add its id and private key as the `CODEX_APP_ID` and
   `CODEX_APP_PRIVATE_KEY` secrets. A write route with either secret missing
   fails immediately with an error naming the missing one — there is
   deliberately no fallback to `GITHUB_TOKEN`. (A personal access token with
   `repo` + `workflow` scope, wired into the same two secrets by a fork of the
   run body, is the documented alternative; the stock run body expects an App.)
3. **Set the `CODEX_BOT_LOGIN` repository variable** to your App's bot login
   (for example `acme-codex[bot]`). Claude hardcodes `claude[bot]` because every
   consumer shares one Claude App; your Codex App is yours, so the login is per
   repo, and a job-level `if:` cannot read secrets. Leaving it unset disables
   ONLY two things — the bot self-trigger (a review chain never continues on its
   own) and bot-author trust (a PR opened by your Codex App is treated as
   untrusted, so `@codex` on it stays read-only) — and also skips the LLM footer
   patch on write-route comments. Human OWNER/MEMBER/COLLABORATOR routes work
   with it unset.
4. Optional: set the `DOCS_RELEASE_ENABLED` repository variable to `true` to
   enable the docs-sync / release comment flows (off by default, fail-closed).
5. Tailor per repo with prompt override files, not by editing the shared
   prompts. Two forms, combinable per route:
   - **Replace:** `.github/prompts/<prompt-name>.md` (e.g. `issue-workflow.md`)
     is used INSTEAD of the shared prompt.
   - **Append:** `.github/prompts/<prompt-name>-local.md` (e.g.
     `fix-pr-local.md`) is appended to whichever base was chosen.
   Overrides are read from the repository's **default branch**, never the event
   checkout, so a change lands only after it merges (and a fork PR can never
   alter the prompt for its own review).
6. Run the tests from the rk-skills clone:
   `python3 -m unittest discover -s /tmp/rk-skills/templates/codex-workflow/scripts -p 'test_*.py'`.

## Customization inputs

The vendored `codex.yml` ships with `classify` on `runs-on: self-hosted` and
`runs_on: self-hosted` passed to every route (`review`/`implement`/`fix-pr`).
If your repo has no self-hosted runner registered, switch all four back to
`ubuntu-latest` (or your own label) before installing.

**These four settings are independent — changing one does NOT change the
others.** `classify`'s `runs-on:` is a plain job field; each route's `runs_on:`
is a separate `with:` input to the reusable workflow, defaulted to
`ubuntu-latest` *inside codex-run.yml itself* when omitted. A repo that edits
only `classify` without also setting `runs_on:` on the three routes will have
those routes silently fall back to `ubuntu-latest`. Grep the file for `runs-on`
and `runs_on` and confirm all four agree before relying on a non-default runner.

| Input | Default | Purpose |
|-------|---------|---------|
| `runs_on` | `ubuntu-latest` | Runner label (e.g. `self-hosted`). |
| `timeout_minutes` | `45` | Job timeout; raise for repos with long implement runs. |
| `go_version` | (empty) | If set, installs Go — ONLY for `gofmt` on edited files (a formatter, never execution). |
| `extra_allowed_tools` | (empty) | Accepted for call-site parity with `claude-run.yml` and **ignored** here: Codex has no per-tool allowlist. A non-empty value logs a notice and changes nothing. |
| `bot_login` | (empty) | Pass `${{ vars.CODEX_BOT_LOGIN }}`; see install step 3. |

Self-hosted runners should provide `git`, `gh`, `node`, `npm` (the action
installs the Codex CLI with `npm install -g`), `python3`, and `jq` — the shared
comment-patch scripts that stamp the LLM footer use the last two. Without `jq`
the footer step fails rather than degrading, so install it before pointing a
self-hosted runner at this bundle.

The `flow` input also accepts `sync-release` (docs sync plus a
`docs-release/v<version>` PR whose merge triggers the repo's own release
workflow). The vendored `codex.yml` does not detect that phrase by default — add
it to the flow candidate list only if your repo has a merge-triggered release
workflow that parses the `docs-release/*` branch name.

## Triggers (comments by OWNER / MEMBER / COLLABORATOR only)

| Comment | Route | Push? |
|---------|-------|-------|
| `@codex review` | PR review (read-only contract, `LGTM` / `Needs Updates` format) | No |
| `@codex <anything else>` on a PR | fix-pr: re-validate all unaddressed review feedback, fix what survives, fold in any comment text as additional scope, disposition comment, re-review trigger | Yes (trusted-author PRs only) |
| `@codex <anything>` on an issue | implement: validate → implement → PR via the issue-workflow prompt | Yes |
| `@codex sync-docs` / `@codex create-release` (hyphenated — the classifier does not match `sync docs` / `create release` with a space) | docs/release flows (needs `DOCS_RELEASE_ENABLED=true`) | Scoped |
| `@codex sync-release` | docs/release flow — only after your repo adds `sync-release` to the vendored `codex.yml` candidate list (see the `flow` note above); the template does not detect it by default | Scoped |

Model shorthand and `effort:low|medium|high|xhigh` are parsed from the comment.
Review events (formal reviews, inline comments) always stay read-only regardless
of keyword.

| Shorthand | Model | Notes |
|-----------|-------|-------|
| (none) | `gpt-5.6-sol` | Flagship; the default, paired with the default `xhigh` effort. |
| `sol` | `gpt-5.6-sol` | |
| `terra` | `gpt-5.6-terra` | Balanced everyday model. |
| `luna` / `mini` | `gpt-5.6-luna` | Fast and affordable; Codex's counterpart to `@claude sonnet review`, used for the C0–C10 band and for the cheap non-blocking re-review. |
| `codex` / `spark` | `gpt-5.3-codex-spark` | Text-only fast coding preview. |

An unrecognized shorthand falls through to the default, matching the Claude
bundle's behavior.

## Security model

- **No write credential on the read path.** The review route mints no GitHub App
  token at all, its job token is `contents: read`, and Codex runs in the
  read-only sandbox — which denies the agent writes *and* network. A
  prompt-injected diff has nothing to push with and nowhere to call out to. The
  agent never posts: its final message is posted afterwards by a trusted step
  with the job token via `--body-file`, so model output is never
  shell-evaluated.
- **Everything the review needs is staged first.** Because the review sandbox
  has no network, `codex-run.yml` checks out the PR head, resolves its merge
  base, and writes the PR metadata to a file before Codex starts. The agent
  judges the diff from local git reads. External facts it cannot source produce
  the contract's `**Verification limitation:**` line, exactly as the format
  prescribes for a route with no fetch tool.
- **`GITHUB_TOKEN` never pushes, on any route.** Every job stays `contents:
  read`; only the App installation token can write. That makes "no
  `GITHUB_TOKEN` fallback for push" a permission boundary rather than an
  intention.
- **Two independent trust gates on the write path.** `classify` runs with
  `permissions: {}` and routes; the `fix-pr` job then RE-ASSERTS PR-author trust
  from the event payload, so a classify bug cannot grant push over an
  untrusted-author PR.
- **No-execution ban:** the agent never runs the project's code in any mode — no
  test suites, builds, type checks, simulations, or scripts. CI (if you have it)
  owns checks.
- **Fail-closed routing:** anything ambiguous classifies as read-only review;
  untrusted PR authors never reach a push-capable route; an unset
  `CODEX_BOT_LOGIN` removes bot trust rather than defaulting to trusted.
- **Loop prevention:** a comment authored by the configured Codex bot invokes
  only when its stripped body is exactly a one-line `@codex [model] review
  [effort:…]` trigger. Review output that merely quotes `@codex` never chains
  another run.

## Skills default to Claude

The rk-skills in-session skills (`fix-pr-review`, `work-on-issue-loop`,
`fix-pr-review-loop`, `milestone-workflow`) keep posting `@claude review` even
when `codex.yml` is installed. They post `@codex` only when Codex is explicitly
selected — you say so, a caller argument names it (`reviewBot: codex`), or the
run itself was started by an `@codex` GitHub comment. Once a cycle picks a bot,
every re-review in that cycle stays on that bot.
