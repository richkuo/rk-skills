---
name: work-on-issue
description: Use when the user says "work on issue", "work on this issue", "implement issue", "/work-on-issue", or otherwise asks to implement a GitHub issue end-to-end (not merely validate it). Takes a GitHub issue URL or number (defaults to the just-validated issue). Implements the fix in an isolated worktree, verifies it, commits and pushes, and opens a PR that closes the issue. This is the default follow-on when validate-issue offers "work on issue".
---

# work-on-issue

Take a GitHub issue from "validated" to "PR open", autonomously and end-to-end: isolate the work in a fresh worktree, implement the fix to the codebase's conventions, verify it really works, commit and push, then open a pull request that closes the issue. The skill ends with the open PR — requesting review is the caller's job (work-on-issue-loop does it; standalone, the user decides). Don't stop to ask the user between steps — do the work and report at the end.

**This is the natural follow-on to validate-issue.** When validate-issue ends with `→ Reply "work on issue"`, the user replying "work on issue" lands here. The skill is also valid standalone — invoke it when the user asks to implement an issue without a prior validation pass.

**Implement the issue, not your memory of it.** Re-read the issue and any validation findings before writing code; the description can be stale or wrong (that's what validate-issue exists to catch). Build the fix the traced code supports, not the one the prose suggests.

## Input

The user provides one of:
- Nothing — **default to the issue just validated this session**, else the latest open issue (`gh issue list --limit 1`).
- `#<N>` / `<N>` / full URL / `owner/repo#N`.
- `{ issue: <N>, baseRefs: [{ pr: <PR number>, ref: "<head branch>", sha: "<head commit>" }, ...] }` — orchestration-only form for hard dependencies. `baseRefs` is optional; when present, its order is authoritative and deterministic (upstream track order), and every entry pins a predecessor pull request's reviewed readiness head.

The steps assume the issue belongs to the repo of the current checkout. If `owner/repo#N` or the URL points at a different repo, do not proceed against the local checkout — locate a local clone of that repo and work there, or stop and tell the user which repo needs to be checked out. (`gh issue view`/`gh pr create` accept `-R owner/repo`, but the implementation itself needs the matching working tree.) Standalone calls have no `baseRefs` and retain the latest default branch as their base.

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

### 1. Resolve and verify the worktree base

All implementation happens in a fresh worktree — never on the default branch itself or a divergent checked-out branch. Detect and fetch the default branch even when dependencies are supplied because it remains the pull request base:

```bash
DEFAULT_BRANCH=$(gh repo view --json defaultBranchRef -q .defaultBranchRef.name)
git fetch origin "$DEFAULT_BRANCH"
git branch --show-current   # where am I now?
```

If `baseRefs` is absent, the resolved worktree base is `origin/<default>` as before. If it is present, validate the complete list **before creating a worktree**:

- Reject an empty list; duplicate PR numbers, refs, or SHAs; non-positive integer PR numbers; and SHAs that are not 40–64 hexadecimal characters. Before any field reaches a shell command, validate each ref as plain data against `^[A-Za-z0-9][A-Za-z0-9._/@+-]*$`; this rejects leading-dash values (`-h`, `--normalize`), whitespace, semicolons, quotes, backticks, and shell expansions. Only after that static allowlist passes, reject the default branch and refs that fail `git check-ref-format --branch "$ref"`.
- Preserve caller order. For each entry, verify `gh pr view <pr> --json headRefName,headRefOid,headRepository` belongs to this repository and exactly matches both `ref` and `sha`. Any mismatch means the reviewed head changed after readiness and is a blocker; never silently use the new head.
- Fetch the pull request's GitHub ref explicitly into a namespaced local ref (`pull/<pr>/head:refs/rk-skills/dependencies/pr-<pr>`), verify that fetched ref resolves exactly to `sha`, and record that commit. A missing, ambiguous, cross-repository, or changed head is a blocker; never fall back to the default branch.
- The first verified SHA is the initial worktree base. Remaining SHAs are integrated in caller order after worktree creation.

### 1.1 Create the isolated worktree

- **If validate-issue already entered a worktree for this issue this session** (cwd is under `.claude/worktrees/<prefix>/issue-<N>-…`), confirm with `pwd` / `git branch --show-current` and proceed — do not create a second one.
- **On Claude Code**, create and switch into one with the native `EnterWorktree` tool (it creates under `.claude/worktrees/` and switches the session cwd in one step):

```
EnterWorktree(name: "cc/issue-<N>-<slug>")
```

Pass the name **with** the `cc/` prefix — `EnterWorktree` uses it verbatim as the branch/worktree name, it does not add one itself. `<slug>` = the issue title kebab-cased to ≤5 words (drop filler, strip punctuation) — e.g. issue 873 "Scale-in / pyramiding support for open positions" → `cc/issue-873-scale-in-pyramiding`. EnterWorktree starts from its configured base; when `baseRefs` is present, immediately move the brand-new, commit-free branch to the first verified SHA with an anchored `git -C <worktree-path> reset --hard <resolved-first-sha>`. Never do this to a re-entered worktree.

- **On Cursor or Codex** (no `EnterWorktree` tool available), create the worktree with a raw `git worktree add`, prefixing the branch by hand — `cursor/` or `codex/` respectively:

```bash
git worktree add .claude/worktrees/cursor/issue-<N>-<slug> -b cursor/issue-<N>-<slug> <resolved-base>
```

(swap `cursor/` for `codex/` on Codex), then `cd` into it — remember the session's tracked cwd doesn't follow a bare `cd`, so re-verify `pwd` before later steps.

If a worktree for this issue already exists, enter it by `path` (Claude Code) or `cd` into it (Cursor/Codex).

After the call, confirm the switch (`pwd` / `git branch --show-current`), state the path, and verify that `HEAD` exactly matches the resolved base commit. Anchor every command with `-C <worktree-path>` because shell state does not persist. If a brand-new worktree differs, reset only that commit-free worktree to the resolved base; never reset a re-entered worktree.

```bash
git -C <worktree-path> rev-parse HEAD <resolved-base-sha>   # the two SHAs must match
```

### 1.2 Integrate multiple hard prerequisites

When `baseRefs` contains more than one ref, create one deterministic integration base **before reading or changing product files**:

1. From the worktree based on the first ref, merge all remaining recorded remote-tracking commits in caller order with one `git merge --no-commit --no-ff` invocation.
2. If Git reports any conflict or cannot form the integration, abort the merge and return blocked with the conflicting refs. Do not resolve product conflicts speculatively, implement the issue, or open a pull request.
3. If a merge is pending, commit it with a concise dependency-integration message and the repository's required LLM attribution footer. If every remaining ref was already contained, no integration commit is needed.
4. For **every** recorded predecessor commit, run `git -C <worktree-path> merge-base --is-ancestor <sha> HEAD`. Any failure blocks implementation. Record the verified refs and their order for the pull request body.

The resulting `HEAD` is the only authorized base for validation and implementation. A single `baseRefs` entry needs no merge but still needs the ancestry check. Do every later step from inside this verified worktree.

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
git push -u origin <branch>   # the worktree's <prefix>/issue-<N>-<slug> branch
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

- **Title:** match the repo's PR-title convention (the commit-title style is usually right) — global default is `type(#<N>): summary [C<score>, <model>, <effort>]` (Conventional Commits type, `#<N>` as scope, then the trailing bracket reusing the issue's `[C<score>]` prefix paired with the model/effort actually used to build the PR; append `, fableplan` inside the bracket if a Fable plan ran first). **Project precedence:** a repo `CLAUDE.md`/`AGENTS.md` that defines its own PR-title convention overrides this default.
- **Body must close the issue:** include `Closes #<N>` so merging the PR resolves it. Summarize what changed and how it was verified under `## Summary` / verification headings first; keep it scannable, don't restate the whole issue. **End with `## Plain simple English`** — one short paragraph under 55 words, no jargon, no unexplained acronyms — stating what changed and why it matters, so a human can understand the PR without reading the technical summary.
- **Dependency base:** when `baseRefs` was supplied, list every predecessor pull request and verified head in integration order, state that they must merge first, and keep the PR base set to the repository's default branch.
- **Footer:** same convention as the commit — **Created** verb, repo footer format (global default `Created with LLM: <current model> | <effort> | Harness: <harness>`, harness resolved per step 5: `Claude Code` interactively, the Action identifier in CI). No `Co-authored-by` trailer.

Capture the PR number/URL from the command output.

### 7. Report to the user

The skill ends here — do **not** trigger an `@claude` review or wait on CI; requesting review belongs to the caller (work-on-issue-loop posts the trigger itself; standalone, the user decides whether and when to request one).

Terse summary: the worktree/branch, what you implemented (one or two lines), the verification result, the commit SHA, the PR URL, and that it closes #<N>. The work is done and the PR is open — not waiting on the user.

**Follow-on work named in the deliverables must not silently drop.** If the PR body, commit message, or any doc the diff adds names follow-on work ("own issue", "future work", "not yet wired"), state it in the report as **unfiled** — under work-on-issue-loop, its step 4.5 files these once review converges; standalone, tell the user the issues still need filing.

**Cap this report at 55 words, ELI18** — plain language, no jargon, as if explaining the outcome to a smart 18-year-old with no context on this codebase or its internals.

## Guardrails

| Situation | Action |
|-----------|--------|
| About to implement on the default branch or a divergent checked-out branch | Stop — enter the isolated worktree first (step 1) |
| Caller supplies invalid, duplicate, missing, ambiguous, cross-repository, or changed `baseRefs` | Stop blocked — never fall back to the default branch or guess a replacement |
| Fresh worktree's HEAD doesn't match the resolved base | Reset only the just-created, commit-free worktree to the verified base; never reset a re-entered worktree |
| Multiple bases conflict or any verified predecessor is not an ancestor of the integration base | Abort the merge and return blocked before product changes |
| Worktree for this issue already exists | Enter it by `path`; don't create a duplicate |
| Issue lives in a different repo than the current checkout | Stop — work in a clone of that repo, or tell the user which repo to check out |
| Issue is already closed | Stop and report — don't implement a resolved issue |
| An open PR already addresses the issue | Don't start a duplicate — catch this in step 0, before a worktree exists; surface it (or continue on it if it's this session's branch) |
| Issue description conflicts with what the code actually does | Trust the traced code; implement the real fix, note the discrepancy in the PR body |
| Issue's proposed sketch was ⚠️/❌ in validation | Implement the optimal direction for this repo, not the original sketch |
| Fix touches money / data integrity / security / auto-protective logic | Implement the safest correct design from first principles; verify the invariant isn't violated |
| Anywhere the default branch is needed (fetch or PR `--base`) | Detect it (`gh repo view --json defaultBranchRef`), re-detecting inline where used — shell variables don't persist between commands |
| Tempted to skip or soften tests because "it's a small change" | Small changes break too; write the regression test and watch it fail on the unfixed code (red → green) |
| Tests/build/lint fail locally | Fix or surface it — never commit, push, or claim success on a failing tree |
| `git status` shows files unrelated to the change | Don't `git add -A` — stage the intended files by name |
| Writing the PR body | `## Summary` / verification first; include `Closes #<N>` (without it the merge doesn't resolve the issue); end with `## Plain simple English` (≤55 words, no jargon), then the repo's footer convention — **Created** verb, no `Co-authored-by` |
| Tempted to trigger an `@claude` review or wait on CI after opening the PR | Don't — the skill ends with the open PR; review requests are the caller's job |
| Tempted to pause and ask the user mid-flow | Don't — implement, verify, commit, push, open the PR, then report |
