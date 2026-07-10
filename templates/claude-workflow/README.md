# claude-workflow — full @claude GitHub Actions bundle

The complete two-workflow setup behind the rk-skills PR loop: a least-privilege
`@claude` bot that reviews PRs, implements issues, and fixes PR reviews, with
its prompts, comment-patching scripts, and regression tests. This is the same
setup deployed on the repos it was extracted from, genericized.

## What's inside

| Path | Purpose |
|------|---------|
| `workflows/claude.yml` | Trigger + author gate + fail-closed route classifier (`classify`), and one caller job per route with least-privilege `permissions:`. |
| `workflows/claude-run.yml` | Reusable run body shared by every route: prompt composition, Bash allowlists, the Claude Code action, LLM-footer comment patching, failure notes. |
| `prompts/*.md` | One prompt file per route (pure prompt text — the single source of truth). Must never contain `"`, backticks, or `$` (shell-evaluated downstream). |
| `scripts/` | Comment patch/compose helpers plus their unit tests, including `test_workflow_logic.py`, which extracts and executes the real classifier shell from `claude.yml`. |

## Install

Copy the pieces into your repo's `.github/`:

```sh
git clone --depth 1 https://github.com/richkuo/rk-skills /tmp/rk-skills
mkdir -p .github
cp -R /tmp/rk-skills/templates/claude-workflow/workflows .github/
cp -R /tmp/rk-skills/templates/claude-workflow/prompts   .github/
cp -R /tmp/rk-skills/templates/claude-workflow/scripts   .github/
```

Then:

1. Add the `CLAUDE_CODE_OAUTH_TOKEN` secret (Claude Code OAuth token). The
   write-capable routes authenticate as the Claude GitHub App (`claude[bot]`),
   so the app must be installed on the repo.
2. Optional: set the `DOCS_RELEASE_ENABLED` repository variable to `true` to
   enable the docs-sync / release comment flows (off by default, fail-closed).
3. Tailor the prompts: `issue-workflow.md`, `fix-pr.md`, and
   `fix-pr-review.md` carry a repo-agnostic verification paragraph — adjust it
   if your repo has specific conventions; `sync-docs-release.md` assumes no
   CHANGELOG and no in-app version field.
4. Run the tests: `python3 -m unittest discover -s .github/scripts -p 'test_*.py'`.

## Triggers (comments by OWNER / MEMBER / COLLABORATOR only)

| Comment | Route | Push? |
|---------|-------|-------|
| `@claude review` | PR review (read-only contract, `LGTM` / `Needs Updates` format) | No |
| `@claude fix` | fix-pr-review: re-validate all review feedback, fix what survives, disposition comment, re-review trigger | Yes (trusted-author PRs only) |
| `@claude <anything else>` on a PR | fix-pr: in-place edit of the PR branch | Yes (trusted-author PRs only) |
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
