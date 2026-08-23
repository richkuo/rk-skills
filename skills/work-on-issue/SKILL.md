---
name: work-on-issue
description: Use when the user says "work on issue", "work on this issue", "implement issue", "/work-on-issue", or otherwise asks to implement a GitHub issue end-to-end (not merely validate it). Takes a GitHub issue URL or number (defaults to the just-validated issue). Implements the fix in an isolated worktree, verifies it, commits and pushes, and opens a PR that closes the issue. This is the default follow-on when validate-issue offers "work on issue".
---

# work-on-issue

Take a GitHub issue from "validated" to "PR open", autonomously and end-to-end: isolate the work in a fresh worktree, implement the fix to the codebase's conventions, verify it really works, commit and push, then open a pull request that closes the issue. The skill ends with the open PR — requesting review is the caller's job (work-on-issue-loop does it; standalone, the user decides). Don't stop to ask the user between steps — do the work and report at the end.

**This is the natural follow-on to validate-issue** — when its next-step line offers or recommends "work on issue", the user replying "work on issue" lands here. The skill is also valid standalone, without a prior validation pass.

**Implement the issue, not your memory of it.** Re-read the issue and any validation findings before writing code; the description can be stale or wrong (that's what validate-issue exists to catch). Build the fix the traced code supports, not the one the prose suggests.

## Input

The user provides one of:
- Nothing — **default to the issue just validated this session**, else the latest open issue (`gh issue list --limit 1`).
- `#<N>` / `<N>` / full URL / `owner/repo#N`.
- `{ issue: <N>, baseRefs: [{ pr: <PR number>, ref: "<head branch>", sha: "<head commit>" }, ...] }` — orchestration-only form for hard dependencies. `baseRefs` is optional; when present, its order is authoritative and deterministic (upstream track order), and every entry pins a predecessor pull request's reviewed readiness head.

The steps assume the issue belongs to the repo of the current checkout. If `owner/repo#N` or the URL points at a different repo, do not proceed against the local checkout — locate a local clone of that repo and work there, or stop and tell the user which repo needs to be checked out. (`gh issue view`/`gh pr create` accept `-R owner/repo`, but the implementation itself needs the matching working tree.) Standalone calls have no `baseRefs` and retain the latest default branch as their base.

## Steps

### 0. Resolve the issue, gate-check it, and detect a plan

Resolve which issue to work (per Input above), then fetch it — before creating any worktree, both because the gates below may end the run and because the worktree slug needs the issue title:

```bash
gh issue view <N> --comments
gh pr list --state open --search "#<N> in:title,body"
```

Two gates, checked while no worktree or code exists yet:

- **The issue must still be open.** If it's closed, stop and report — don't implement a resolved issue.
- **No existing PR may already address it** — discovering one later wastes the entire cycle, splits review, and orphans a branch. A PR that merely mentions `#<N>` in passing doesn't count; one that fixes it does. If a genuine PR exists, surface it and stop (or, if it's this session's own branch, continue on it).

Then scan the fetched comments for an implementation plan: `fableplan` and every chain that wraps it post one under the heading `## Implementation plan (Fable 5)`, and maintainers sometimes paste their own. A posted plan was produced with more deliberation than a fresh read of the issue, so **it must be found before any code is written, never discovered afterwards.**

- **Match on the heading first** — a comment starting with `## Implementation plan` (any parenthetical model tag) is a plan; so is a comment a maintainer clearly frames as this issue's implementation plan, even without the heading. **If several exist, the newest wins** — earlier ones are superseded drafts; do not merge them.
- **A caller-supplied plan does not end the scan.** When the caller (`fableplan-work-on-issue`, `fableplan-loop`, the loop chains) points you at a plan file, still check the thread — a plan comment newer than the caller's copy supersedes it. The same plan in both places is one artifact, not two competing ones.
- **Record what you adopted** — the comment author, its URL, its date, and **whether a Fable model authored it** (the heading names one, e.g. `## Implementation plan (Fable 5)` / `(Fable 5 advisor)`, or the comment's footer names Fable 5 as the model). A maintainer's hand-written plan is adopted the same way, but it is not Fable-authored; step 6 keys the `, fableplan` title marker off this flag.

Finding no plan is normal: proceed with the issue body and validation findings alone.

### 1. Create the isolated worktree on a verified base

All implementation happens in a fresh worktree — never on the default branch itself or a divergent checked-out branch. Detect and fetch the default branch even when dependencies are supplied because it remains the pull request base: `DEFAULT_BRANCH=$(gh repo view --json defaultBranchRef -q .defaultBranchRef.name)`, then `git fetch origin "$DEFAULT_BRANCH"`, and `git branch --show-current` to see where you are now. Fetch before the base checks below: they compare against the local `origin/<default-branch>` ref, so a skipped fetch lets them pass on two equally stale copies.

**Resolve the base.** If `baseRefs` is absent, the resolved worktree base is `origin/<default>`. If it is present, validate the complete list **before creating a worktree**:

- Reject an empty list; duplicate PR numbers, refs, or SHAs; non-positive integer PR numbers; and SHAs that are not 40–64 hexadecimal characters. Before any field reaches a shell command, validate each ref as plain data against `^[A-Za-z0-9][A-Za-z0-9._/@+-]*$`; this rejects leading-dash values (`-h`, `--normalize`), whitespace, semicolons, quotes, backticks, and shell expansions. Only after that static allowlist passes, reject the default branch and refs that fail `git check-ref-format --branch "$ref"`.
- Preserve caller order. For each entry, verify `gh pr view <pr> --json headRefName,headRefOid,headRepository` belongs to this repository and exactly matches both `ref` and `sha`. Any mismatch means the reviewed head changed after readiness and is a blocker; never silently use the new head.
- Fetch the pull request's GitHub ref explicitly into a namespaced local ref (`pull/<pr>/head:refs/rk-skills/dependencies/pr-<pr>`), verify that fetched ref resolves exactly to `sha`, and record that commit. A missing, ambiguous, cross-repository, or changed head is a blocker; never fall back to the default branch.
- The first verified SHA is the initial worktree base. Remaining SHAs are integrated in caller order after worktree creation.

**Create and enter the worktree.**

- **If validate-issue already entered a worktree for this issue this session** (cwd is under `.claude/worktrees/<prefix>/issue-<N>-…`), confirm with `pwd` / `git branch --show-current` and proceed — do not create a second one. Likewise, if a worktree for this issue already exists, enter it by `path` (Claude Code) or `cd` into it (Cursor/Codex) instead of creating a duplicate.
- **On Claude Code**, create and switch into one in a single step with the native `EnterWorktree` tool, which creates under `.claude/worktrees/`: `EnterWorktree(name: "cc/issue-<N>-<slug>")`. Pass the name **with** the `cc/` prefix — `EnterWorktree` uses it verbatim as the branch/worktree name, it does not add one itself. `<slug>` = the issue title kebab-cased to ≤5 words (drop filler, strip punctuation) — e.g. issue 873 "Scale-in / pyramiding support for open positions" → `cc/issue-873-scale-in-pyramiding`. EnterWorktree starts from its configured base: the `worktree.baseRef` setting at `fresh` (its default) branches from `origin/<default>`, while `head` branches from the local HEAD, which may be stale; this is why the fetch above and the HEAD check below are required. When `baseRefs` is present, immediately move the brand-new, commit-free branch to the first verified SHA with an anchored `git -C <worktree-path> reset --hard <resolved-first-sha>`. Never do this to a re-entered worktree.
- **On Cursor or Codex** (no `EnterWorktree` tool available), create the worktree with a raw `git worktree add`, prefixing the branch by hand — `cursor/` or `codex/` respectively:

```bash
git worktree add .claude/worktrees/cursor/issue-<N>-<slug> -b cursor/issue-<N>-<slug> <resolved-base>
```

(swap `cursor/` for `codex/` on Codex), then `cd` into it — remember the session's tracked cwd doesn't follow a bare `cd`, so re-verify `pwd` before later steps.

After the call, confirm the switch (`pwd` / `git branch --show-current`), state the path, and verify that `HEAD` exactly matches the resolved base commit: `git -C <worktree-path> rev-parse HEAD <resolved-base-sha>` — the two SHAs must match. Anchor every command with `-C <worktree-path>`: shell state does not persist between Bash calls, and an unanchored command runs in the original checkout, where it can misreport or destroy uncommitted work. If a brand-new worktree differs, move it with `git -C <worktree-path> reset --hard <resolved-base>`; this is safe only because the brand-new branch carries no commits. Never reset a re-entered worktree or any worktree that already has work on it.

**Integrate multiple hard prerequisites.** When `baseRefs` contains more than one ref, create one deterministic integration base **before reading or changing product files**:

1. From the worktree based on the first ref, merge all remaining recorded remote-tracking commits in caller order with one `git merge --no-commit --no-ff` invocation.
2. If Git reports any conflict or cannot form the integration, abort the merge and return blocked with the conflicting refs. Do not resolve product conflicts speculatively, implement the issue, or open a pull request.
3. If a merge is pending, commit it with a concise dependency-integration message and the repository's required LLM attribution footer. If every remaining ref was already contained, no integration commit is needed.
4. For **every** recorded predecessor commit, run `git -C <worktree-path> merge-base --is-ancestor <sha> HEAD`. Any failure blocks implementation. Record the verified refs and their order for the pull request body.

The resulting `HEAD` is the only authorized base for validation and implementation. A single `baseRefs` entry needs no merge but still needs the ancestry check. Do every later step from inside this verified worktree.

### 2. Understand the issue and the code

Read the issue body **and its comment thread**, already fetched in step 0 (maintainer clarifications and prior validation reports often live in comments), the validation findings if validate-issue produced them this session, and the repo's `CLAUDE.md` / architecture docs for the subsystem you're about to touch. Establish: which files change, what the correct fix is (per the traced code, not the prose), what tests prove it, and which conventions/invariants govern the area. If the issue's proposed sketch was marked ⚠️/❌ during validation, implement the **optimal direction for this repo**, not the original sketch — correctness and the codebase's patterns outrank issue loyalty.

**An adopted plan is the blueprint.** If step 0 found one, implement to it rather than re-deriving an approach — the plan already cost a planning pass. Three things override it, in this order:

1. **The traced code.** Where the plan contradicts what the code actually does, follow the code.
2. **Anything newer on the issue.** A maintainer comment or an issue edit posted after the plan supersedes the part it touches.
3. **Correctness and safety.** A plan step that breaks an invariant is wrong; implement the safe design instead.

Every deviation is deliberate and must be named in the PR body (step 6) with its reason. Silent divergence from a posted plan is a defect, because a reviewer reads the plan and expects the diff to match it.

**This is the single plan-deviation policy.** A caller chain (`fableplan-work-on-issue`, `fableplan-loop`, the validate/fableplan loops) may restate it, but it never narrows it — a caller sentence that permits only one of the three overrides does not remove the other two. Following a stale plan against a newer maintainer comment, or against safety, is wrong under every caller.

**Mirror the plan's steps into the task tracker.** Before writing any code, for **every** adopted plan regardless of length, copy its numbered steps into the session's task tracker (`TodoWrite` / `TaskCreate` or the harness equivalent), one item per step, and mark an item complete only when its verify point passes. Fallbacks, both mandatory:

- **The plan is missing its numbers, its verify points, or both** (a maintainer's hand-written plan, a numbered plan whose steps carry no per-step check, or prose paragraphs with no steps at all): derive whichever element is missing — number the steps when the plan has no numbering, and give each step an observable check (a command to run, a test that passes, a file state to confirm) when the plan states none. Either element missing on its own triggers this fallback; a plan missing both gets **both** derived. A step whose check cannot run until a later step lands adopts that later check and stays open until then (if an override later cancels, replaces, or removes that step, the borrowed check re-homes in the order **"A borrowed verify point re-homes when its source step is overridden"** below sets out — replacement's check, else the item's own check, else a deviation of its own; the overridden-step disposition immediately below governs the *cancelled step's own* item, not its borrowers); never leave an item with no verify point, because completion keys on one.
- **The harness exposes no task tracker** (`TodoWrite`/`TaskCreate` absent, as in the GitHub Action path of step 5): write the same numbered checklist to a scratchpad file and update each item's state there — reuse the plan scratchpad when a caller passed one down, otherwise create one. Keep that file **outside the repository working tree** (the harness scratchpad directory) so step 5's staging never sweeps it into the commit. Surviving context summarization is the reason this rule exists, so the checklist must live in a file, never only in the conversation.

This keeps a long build anchored to the plan across context summarization, and makes a skipped step visible instead of silently dropped.

**An overridden step closes as a recorded deviation.** When one of the three overrides above cancels or replaces a plan step, that step's own verify point can never pass, so the item is neither completable as planned nor safe to leave open — an open item reads as a skipped step. Close it as a deviation carrying its own verify point: the observable check that proves the replacement is correct, or, for a step a newer issue comment deleted outright, the comment itself as the record that it closed as removed. Name the same deviation in the PR body per step 6. Two overrides firing on one step still produce one disposition and one PR-body entry. Nothing in this mirroring rule ever justifies building a step the traced code, a newer issue comment, or safety has overridden.

**A borrowed verify point re-homes when its source step is overridden.** A checklist item whose verify point keys on a later step's outcome does not reach a terminal state just because that later step did, and this holds however the cross-reference arose: derived by the mirroring agent under the first fallback above, or written by the plan's own author — a numbered, already-verified step may still say "proven once step 7's integration test exercises it", and the mirroring agent copies that authored check verbatim. When an override cancels, replaces, or removes the step whose check was borrowed, **every** open item that borrowed it re-homes its check, in this order: to the replacement step's verify point when the override replaced the step; otherwise to its own observable check that proves the borrowing step is correct; and only when no such check can exist does the borrowing item close as a recorded deviation of its own, with its PR-body entry per step 6. **Re-homing cascades.** When a borrowing item closes as a deviation of its own, every open item that borrowed *that* item's check re-homes in turn, and the chain repeats until no open item keys on a check that cannot run. A borrowing item is never left waiting on a check that can never run, because an open item with an unreachable check reads as a skipped step.

### 3. Implement the fix

Build the absolute-best solution the issue calls for, per the global "absolute best solution" rule in CLAUDE.md/AGENTS.md.

- **Follow existing conventions.** Read the surrounding code first; match its patterns, naming, error handling, and the repo's `CLAUDE.md` guardrails. Reuse existing helpers over new infrastructure.
- **Respect invariants.** Grep `CLAUDE.md`/guardrails and nearby comments for any invariant governing the values you write (ownership, single-source-of-truth, fail-closed, "X never into Y"). Route values through their authorized path, not the convenient one.
- **Write tests for the change** — new functionality and bug fixes both get tests (regression test the bug, not just the happy path). Match the repo's test layout and harness.
- **Update existing tests the change makes stale.** When the issue's change deliberately replaces behavior an existing test asserts, rewrite that test to assert the new correct behavior. This covers fixtures, snapshots, and helper expectations, as well as assertions. **Removal is authorized in two cases only:** the change deletes the covered behavior outright, so nothing remains to rewrite the test into; or another test now asserts that same behavior, making this one redundant. Say which case applies. A test that fails because the change is wrong stays as it is: fix the code. Never delete, skip, loosen, or narrow a test to get a green tree. Name every rewritten, renamed, or removed test with its reason in the PR body (step 6).
- **A test you believe is itself wrong stops the run.** The issue authorizes the behavior it asks for, so a stale test inside that scope is rewritten under the bullet above with no further approval. A test *outside* the issue's scope that fails because you believe the test asserts wrong behavior is a different case. The CLAUDE.md/AGENTS.md "tests are a correctness floor" rule requires the maintainer's explicit sign-off there, and this skill has no mid-flow channel to obtain it. Leave the test untouched, and do not commit over the failure (step 4 forbids it). **Stop before step 5**, leave the worktree in place, and report the test, its `file:line`, and why you believe it is wrong, inside step 7's cap. That report *is* the sign-off request, so the run ends rather than pausing mid-flow; the user answers and re-runs the skill, which re-enters the existing worktree at step 1. A caller with no human attached (work-on-issue-loop, the pipelines) surfaces the same stop instead of proceeding.
- **Prove regression tests are real (red → green).** For a bug fix, run the new test against the unfixed code first — write the test before the fix, or stash the fix — and watch it fail. A regression test that never failed proves nothing.
- Keep the diff scoped to the issue; don't smuggle in unrelated refactors.

### 4. Verify before claiming anything

Evidence before assertions: run the project's build, tests, and linters and confirm they pass before you commit. Check the repo's `CLAUDE.md` / `package.json` / Makefile for the exact commands (e.g. `go build ./...` + `go test -race ./...` + `gofmt -w`, `bun test` + `bun run build`, `uv run --no-sync python -m pytest` + `py_compile`). Report real results — if something fails, fix it or surface it; never paper over a failure.

### 5. Commit and push

Only after verification passes:

```bash
git status                    # review BEFORE staging — any stray artifacts, logs, local config?
git add -A                    # only if status showed nothing unrelated; otherwise stage the intended files by name and leave the strays out
git commit -F <msg-file>
git push -u origin <branch>   # the worktree's <prefix>/issue-<N>-<slug> branch
```

Commit message: a concise summary of the change, referencing the issue (match the repo's commit-title convention — e.g. `feat(#<N>): …` / `fix(#<N>): …` if the repo uses it). This is new work, so the footer uses the **Created** verb. **Honor the repo's footer convention (its `CLAUDE.md` takes precedence over this default)**:

```
---
Created with LLM: <current model> | <effort> | Harness: <harness>
```

The global LLM Attribution Footer rule in CLAUDE.md/AGENTS.md owns the field values. This skill adds one resolution rule: `<harness>` is whatever actually produced the change — `Claude Code` for an interactive session, or the GitHub Action identifier when running in CI (e.g. `anthropics/claude-code-action@v1`; the workflow states this identifier in your system prompt — use that value, and treat its absence as an interactive session).

### 6. Open the PR

The duplicate-PR gate already ran in step 0; if significant time has passed since, re-run the `gh pr list` search cheaply before creating. Shell state does **not** persist between Bash commands, so `$DEFAULT_BRANCH` from step 1 is gone here — re-detect it inline rather than assuming the variable survived:

```bash
gh pr create --base "$(gh repo view --json defaultBranchRef -q .defaultBranchRef.name)" --head <branch> --title "<title>" --body-file <body-file>
```

- **Title:** match the repo's PR-title convention (the commit-title style is usually right) — global default is `type(#<N>): summary [C<score>, <model>, <effort>]` (Conventional Commits type, `#<N>` as scope, then the trailing bracket reusing the issue's `[C<score>]` prefix paired with the model/effort actually used to build the PR; append `, fableplan` inside the bracket only when a **Fable** plan drove the build — one produced this session, or a Fable-authored plan adopted in step 0, which counts the same. An adopted plan a maintainer wrote earns no marker, because `, fableplan` asserts that a Fable 5 plan was posted before the build). **Project precedence:** a repo `CLAUDE.md`/`AGENTS.md` that defines its own PR-title convention overrides this default.
- **Body must close the issue:** include `Closes #<N>` so merging the PR resolves it. Summarize what changed and how it was verified under `## Summary` / verification headings first; keep it scannable, don't restate the whole issue. **End with `## Plain simple English`** — the Plain simple English block per the CLAUDE.md/AGENTS.md Response Style rules — stating what changed and why it matters.
- **Changed existing tests:** when the diff rewrites, renames, or removes an existing test, list each one with its reason. For a rewrite or a rename, say what the change replaced, so the old expectation no longer holds. For a removal, name which of step 3's two cases applies: the covered behavior is deleted outright, or the test that now asserts that behavior (in which case the removed test's expectation was correct and is simply redundant). A reviewer must be able to tell a deliberate behavior change from a weakened test.
- **Adopted plan:** when step 0 found a plan, link the comment and state that the diff follows it, then list every deviation with its reason (or state that there were none). A reviewer compares the diff against that plan.
- **Dependency base:** when `baseRefs` was supplied, list every predecessor pull request and verified head in integration order, state that they must merge first, and keep the PR base set to the repository's default branch.
- **Footer:** same convention as the commit — **Created** verb, harness resolved per step 5.

Capture the PR number/URL from the command output.

### 7. Report to the user

The skill ends here — do **not** trigger an `@claude` review or wait on CI; requesting review belongs to the caller (work-on-issue-loop posts the trigger itself; standalone, the user decides whether and when to request one).

Terse summary: the worktree/branch, what you implemented (one or two lines), the verification result, the commit SHA, the PR URL, and that it closes #<N>. The work is done and the PR is open — not waiting on the user.

**When step 3 stopped the run on a test you believe is wrong,** this report replaces the normal one: say that no commit and no PR exist, name the test and its `file:line`, state why you believe it is wrong, and say that the run resumes once the maintainer answers. Keep the worktree.

**Follow-on work named in the deliverables must not silently drop.** If the PR body, commit message, or any doc the diff adds names follow-on work ("own issue", "future work", "not yet wired"), state it in the report as **unfiled** — under work-on-issue-loop, its step 3 files these once review converges; standalone, tell the user the issues still need filing.

**Cap this report at 55 words, plain simple English in ASD-STE100** — apply the Response Style rules in CLAUDE.md/AGENTS.md, written for a reader with no context on this codebase or its internals.

## Guardrails

| Situation | Action |
|-----------|--------|
| About to implement on the default branch or a divergent checked-out branch | Stop — enter the isolated worktree first (step 1) |
| Caller supplies invalid, duplicate, missing, ambiguous, cross-repository, or changed `baseRefs`; multiple bases conflict; or a verified predecessor is not an ancestor of the integration base | Stop blocked, aborting any pending merge first — never fall back to the default branch or guess a replacement |
| Fresh worktree's HEAD doesn't match the resolved base | Reset per step 1 — only the just-created, commit-free worktree, never a re-entered one |
| Worktree for this issue already exists | Enter it by `path`; don't create a duplicate |
| Issue lives in a different repo than the current checkout | Stop — work in a clone of that repo, or tell the user which repo to check out |
| Issue is already closed, or an open PR already addresses it | Stop at step 0, before a worktree exists — report the closed issue or surface the PR; continue only when that PR is this session's own branch |
| Issue thread already carries an implementation plan | Adopt the newest one (step 0) and build to it (step 2) — never re-derive an approach the plan already settled |
| Adopted plan conflicts with the traced code, a newer maintainer comment, or an invariant | Deviate per step 2's three overrides — nothing else justifies it — and state the deviation in the PR body |
| Adopted plan of any length, long or short | Mirror its numbered steps into the task tracker (step 2) — or into the plan scratchpad file when the harness has no tracker — and complete each item only at its verify point; an overridden step closes as a recorded deviation, never as done and never left open |
| Checklist item's verify point keys on a later step, and an override cancels, replaces, or removes that step | Re-home the borrowed check per step 2 — to the replacement's verify point, else the item's own observable check, else close the item as its own recorded deviation — whether the mirroring agent derived the cross-reference or the plan's author wrote it, cascading to anything that borrowed *that* item's check; never close it as done and never leave it waiting on a check that can never run |
| Issue description conflicts with what the code actually does, or its sketch was ⚠️/❌ in validation | Trust the traced code and implement the optimal direction for this repo, not the original sketch; note the discrepancy in the PR body |
| Fix touches money / data integrity / security / auto-protective logic | Implement the safest correct design from first principles; verify the invariant isn't violated |
| Anywhere the default branch is needed (fetch or PR `--base`) | Detect it (`gh repo view --json defaultBranchRef`), re-detecting inline where used — shell variables don't persist between commands |
| Existing test asserts behavior the issue's change deliberately replaced | Rewrite it to the new correct behavior — or remove it only when the behavior is gone or another test now covers it — and record each one with its reason in the PR body |
| Test outside the issue's scope fails and you believe the test itself is wrong | Don't touch it and don't commit over it — stop before step 5, keep the worktree, and report the test, its `file:line`, and your evidence as the sign-off request |
| Tempted to skip or soften tests because "it's a small change" | Small changes break too; write the regression test and watch it fail on the unfixed code (red → green) |
| Tests/build/lint fail locally | Fix or surface it — never commit, push, or claim success on a failing tree |
| `git status` shows files unrelated to the change | Don't `git add -A` — stage the intended files by name |
| Writing the PR body | Follow step 6 — `Closes #<N>` is what makes the merge resolve the issue |
| Tempted to trigger an `@claude` review, wait on CI, or pause to ask the user mid-flow | Don't — the skill ends with the open PR, and review requests belong to the caller (step 7) |
