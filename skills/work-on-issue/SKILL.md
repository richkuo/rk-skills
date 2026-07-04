---
name: work-on-issue
description: Use when the user says "work on issue", "work on this issue", "implement issue", "/work-on-issue", or otherwise asks to implement a GitHub issue end-to-end (not merely validate it). Takes a GitHub issue URL or number (defaults to the just-validated issue). Implements the fix in an isolated worktree, verifies it, commits and pushes, opens a PR that closes the issue, and triggers an @claude review on the PR. This is the default follow-on when validate-issue offers "work on issue".
---

# work-on-issue

Take a GitHub issue from "validated" to "PR under review", autonomously and end-to-end: isolate the work in a fresh worktree, implement the fix to the codebase's conventions, verify it really works, commit and push, open a pull request that closes the issue, then request an `@claude` review. Don't stop to ask the user between steps — do the work and report at the end.

**This is the natural follow-on to validate-issue.** When validate-issue ends with `→ Reply "work on issue"`, the user replying "work on issue" lands here. The skill is also valid standalone — invoke it when the user asks to implement an issue without a prior validation pass.

**Implement the issue, not your memory of it.** Re-read the issue and any validation findings before writing code; the description can be stale or wrong (that's what validate-issue exists to catch). Build the fix the traced code supports, not the one the prose suggests.

## Input

The user provides one of:
- Nothing — **default to the issue just validated this session**, else the latest open issue (`gh issue list --limit 1`).
- `#<N>` / `<N>` / full URL / `owner/repo#N`.

The steps assume the issue belongs to the repo of the current checkout. If `owner/repo#N` or the URL points at a different repo, do not proceed against the local checkout — locate a local clone of that repo and work there, or stop and tell the user which repo needs to be checked out. (`gh issue view`/`gh pr create` accept `-R owner/repo`, but the implementation itself needs the matching working tree.)

## Steps

### 0. Resolve the issue and gate-check it

Resolve which issue to work (per Input above), then fetch it — before creating any worktree, both because the gates below may end the run and because the worktree slug needs the issue title:

```bash
gh issue view <N> --comments
gh pr list --state open --search "#<N> in:title,body"
```

Two gates, checked while no worktree or code exists yet:

- **The issue must still be open.** If it's closed, stop and report — don't implement a resolved issue.
- **No existing PR may already address it** — discovering one later wastes the entire cycle, splits review, and orphans a branch. Inspect any search hit: a PR that merely mentions `#<N>` in passing doesn't count, one that fixes it does. If a genuine PR exists, surface it and stop (or, if it's this session's own branch, continue on it).

### 1. Ensure an isolated worktree off the latest default branch

All implementation happens in a fresh worktree branched from the repo's current default branch — never on the default branch itself, never on a divergent checked-out branch. Detect the default branch; don't assume `main` (repos use `master`, `develop`, etc.):

```bash
DEFAULT_BRANCH=$(gh repo view --json defaultBranchRef -q .defaultBranchRef.name)
git fetch origin "$DEFAULT_BRANCH"
git branch --show-current   # where am I now?
```

- **If validate-issue already entered a worktree for this issue this session** (cwd is under `.claude/worktrees/issue-<N>-…`), confirm with `pwd` / `git branch --show-current` and proceed — do not create a second one.
- **Otherwise create and switch into one** with the native `EnterWorktree` tool (it creates under `.claude/worktrees/` — base ref verified below — AND switches the session cwd in one step — a bare `git worktree add` + `cd` leaves the session's tracked cwd on the old checkout, so always use the tool):

```
EnterWorktree(name: "issue-<N>-<slug>")
```

`<slug>` = the issue title kebab-cased to ≤5 words (drop filler, strip punctuation) — e.g. 873 "Scale-in / pyramiding support for open positions" → `issue-873-scale-in-pyramiding`. If a worktree for this issue already exists, enter it by `path`.

After the call, confirm the switch (`pwd` / `git branch --show-current`), state the path, and **verify the base** — EnterWorktree branches from `origin/<default>` only when the `worktree.baseRef` setting is `fresh` (its default); set to `head`, it branches from the local HEAD, which may be stale or divergent:

```bash
git rev-parse HEAD "origin/$(gh repo view --json defaultBranchRef -q .defaultBranchRef.name)"   # the two SHAs must match
```

If they differ on a worktree you **just created**, move it onto the fetched default with `git reset --hard origin/<default>` — safe only because the brand-new branch carries no commits. Never reset a re-entered worktree that already has work on it. Do every later step from inside the worktree.

### 2. Understand the issue and the code

Read the issue body **and its comment thread**, already fetched in step 0 (maintainer clarifications and prior validation reports often live in comments), the validation findings if validate-issue produced them this session, and the repo's `CLAUDE.md` / architecture docs for the subsystem you're about to touch. Establish: which files change, what the correct fix is (per the traced code, not the prose), what tests prove it, and which conventions/invariants govern the area. If the issue's proposed sketch was marked ⚠️/❌ during validation, implement the **optimal direction for this repo**, not the original sketch — correctness and the codebase's patterns outrank issue loyalty.

### 3. Implement the fix

Build the absolute-best solution the issue calls for, evaluated as if cost, effort, time, token spend, and code volume were unlimited — they are not factors. The only constraints that override "best" are correctness and safety.

- **Follow existing conventions.** Read the surrounding code first; match its patterns, naming, error handling, and the repo's `CLAUDE.md` guardrails. Reuse existing helpers over new infrastructure.
- **Respect invariants.** Grep `CLAUDE.md`/guardrails and nearby comments for any invariant governing the values you write (ownership, single-source-of-truth, fail-closed, "X never into Y"). Route values through their authorized path, not the convenient one.
- **Write tests for the change** — new functionality and bug fixes both get tests (regression test the bug, not just the happy path). Match the repo's test layout and harness.
- **Prove regression tests are real (red → green).** For a bug fix, run the new test against the unfixed code first — write the test before the fix, or stash the fix — and watch it fail. A regression test that never failed proves nothing.
- Keep the diff scoped to the issue; don't smuggle in unrelated refactors.

### 4. Verify before claiming anything

Evidence before assertions: run the project's build, tests, and linters and confirm they pass before you commit. Check the repo's `CLAUDE.md` / `package.json` / Makefile for the exact commands (e.g. `go build ./...` + `go test -race ./...` + `gofmt -w`, `bun test` + `bun run build`, `uv run --no-sync python -m pytest` + `py_compile`). Report real results — if something fails, fix it or surface it; never paper over a failure.

### 5. Commit and push

Only after verification passes:

```bash
git status                    # review BEFORE staging — any stray artifacts, logs, local config?
git add -A                    # only if status showed nothing unrelated; otherwise stage files explicitly
git commit -F <msg-file>
git push -u origin <branch>   # the worktree's issue-<N>-<slug> branch
```

If `git status` shows anything unrelated to the change, don't `add -A` — stage the intended files by name and leave the strays out.

Commit message: a concise summary of the change, referencing the issue (match the repo's commit-title convention — e.g. `feat(#<N>): …` / `fix(#<N>): …` if the repo uses it). This is new work, so the footer uses the **Created** verb. **Honor the repo's footer convention (its `CLAUDE.md` takes precedence over this default)**:

```
---
Created with LLM: <current model> | <effort> | Harness: <harness>
```

Fill `<current model>` (e.g. `Opus 4.8`) and `<effort>` (`high` by default). `<harness>` is whatever actually produced the change — `Claude Code` for an interactive session, or the GitHub Action identifier when running in CI (e.g. `anthropics/claude-code-action@v1`; the workflow states this identifier in your system prompt — use that value, and treat its absence as an interactive session). Never put time/effort estimates in the message body. No `Co-authored-by` trailer.

### 6. Open the PR

The duplicate-PR gate already ran in step 0; if significant time has passed since, re-run the `gh pr list` search cheaply before creating.

Shell state does **not** persist between Bash commands, so `$DEFAULT_BRANCH` from step 1 is gone here — re-detect it inline rather than assuming the variable survived:

```bash
gh pr create --base "$(gh repo view --json defaultBranchRef -q .defaultBranchRef.name)" --head <branch> --title "<title>" --body-file <body-file>
```

- **Title:** match the repo's PR-title convention (the commit-title style is usually right).
- **Body must close the issue:** include `Closes #<N>` so merging the PR resolves it. Summarize what changed and how it was verified; keep it scannable. Don't restate the whole issue.
- **Footer:** same convention as the commit — **Created** verb, repo footer format (global default `Created with LLM: <current model> | <effort> | Harness: <harness>`, harness resolved per step 5: `Claude Code` interactively, the Action identifier in CI). No `Co-authored-by` trailer.

Capture the PR number/URL from the command output.

### 7. Check CI, then trigger the @claude review

Local verification isn't CI — environment differences and matrix jobs can fail on a tree that passed locally. Check the PR's checks before requesting review; a review of a red PR is wasted:

```bash
gh pr checks <PR-number>
```

- **Failing** → fix the failure, push, and re-check before triggering. **Bound the loop:** if CI is still red after two or three fix-push-recheck rounds, stop and report the PR's true state (open, CI red, what was tried) — an honestly-reported red PR beats an endless loop or a false success.
- **Pending** → don't block the flow waiting; trigger the review and state the pending CI status in the final report.
- **Empty output is not "no checks".** Immediately after the PR opens, CI may not have registered its runs yet. If the repo defines workflows (`ls .github/workflows/`), wait briefly and re-run `gh pr checks` before classifying; conclude "none configured" only when the repo has no CI workflows at all — then proceed and note it in the report.

Then post a **separate, one-line** comment so the bot triggers cleanly on its own:

```bash
gh pr comment <PR-number> --body "@claude review"
```

(If the repo uses a different review trigger phrase, match it — check recent PR comments.) A trigger mention is not authored content — no footer.

### 8. Report to the user

Terse summary: the worktree/branch, what you implemented (one or two lines), the verification result, the CI-checks status (passing / pending / none — or red-after-bounded-attempts when step 7's exit fired), the commit SHA, the PR URL, that it closes #<N>, and that an `@claude` review was requested. The work is done and under review — not waiting on the user.

**Follow-on work named in the deliverables must not silently drop.** If the PR body, commit message, or any doc the diff adds names follow-on work ("own issue", "future work", "not yet wired"), state it in the report as **unfiled** — under work-on-issue-loop, its step 4.5 files these once review converges; standalone, tell the user the issues still need filing.

**Cap this report at 55 words, ELI18** — plain language, no jargon, as if explaining the outcome to a smart 18-year-old with no context on this codebase or its internals.

## Guardrails

| Situation | Action |
|-----------|--------|
| About to implement on the default branch or a divergent checked-out branch | Stop — enter the isolated worktree first (step 1) |
| Fresh worktree's HEAD doesn't match `origin/<default>` | `worktree.baseRef` may be `head` — reset the just-created, commit-free branch onto `origin/<default>` before implementing |
| Worktree for this issue already exists | Enter it by `path`; don't create a duplicate |
| Issue lives in a different repo than the current checkout | Stop — work in a clone of that repo, or tell the user which repo to check out |
| Issue is already closed | Stop and report — don't implement a resolved issue |
| An open PR already addresses the issue | Don't start a duplicate — catch this in step 0, before a worktree exists; surface it (or continue on it if it's this session's branch) |
| Issue description conflicts with what the code actually does | Trust the traced code; implement the real fix, note the discrepancy in the PR body |
| Issue's proposed sketch was ⚠️/❌ in validation | Implement the optimal direction for this repo, not the original sketch |
| Fix touches money / data integrity / security / auto-protective logic | Implement the safest correct design from first principles; verify the invariant isn't violated |
| Anywhere the default branch is needed (fetch, worktree base, `--base`) | Detect it (`gh repo view --json defaultBranchRef`), re-detecting inline where used — shell variables don't persist between commands |
| Tempted to skip or soften tests because "it's a small change" | Small changes break too; write the regression test and watch it fail on the unfixed code (red → green) |
| Tests/build/lint fail locally | Fix or surface it — never commit, push, or claim success on a failing tree |
| `git status` shows files unrelated to the change | Don't `git add -A` — stage the intended files by name |
| Writing the PR body | Include `Closes #<N>` (without it the merge doesn't resolve the issue) and end with the repo's footer convention — **Created** verb, no `Co-authored-by` |
| `gh pr checks` output is empty right after the PR opens | Not the same as "no CI" — check for workflows and re-poll before classifying |
| CI checks failing after the PR opens | Fix and push before triggering review; if still red after a few rounds, stop and report the true state — never claim success on a red PR |
| Bundling `@claude review` into the PR body or first comment | Keep it a separate one-line comment so the bot fires reliably |
| Tempted to pause and ask the user mid-flow | Don't — implement, verify, commit, push, open the PR, request review, then report |
