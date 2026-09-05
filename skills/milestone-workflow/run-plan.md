# milestone-workflow: tracks and preflight

Companion to `SKILL.md`; step 1 and step 3 of the skill point here.

## Dependency tracks (step 1)

- List the issues with `--state all` and search for open PRs that close each one. Buckets: **build**; **resume** (open issue with an open PR: run `fix-pr-review-loop` on it, never a fresh build); **skip** (closed).
- Settle cross-bucket edges, never drop them. Predecessor merged: drop the edge. Predecessor in resume: finish its loop first, and with merging on merge it at LGTM plus green CI; with merging off, a hard edge excludes the dependent and its hard descendants as **blocked pending merge of PR #X**. Predecessor closed without a merged PR: exclude the dependent and its hard descendants as **blocked pending decision** and ask whether to reopen or re-scope.
- Read `**Depends on:**` (hard) and `**Runs after:**` (ordering-only); an explicit `none` is authoritative. For a missing field, infer only that edge kind from the prose and label every inferred edge; flag an unclear kind for plan review.
- Reject references outside the milestone and cycles across both edge kinds.
- Tracks are `{ issues: [...], after: [<track>...], runsAfter: [<track>...] }`. One `issues` array only when every serial edge is hard; ordering-only chains stay separate tracks joined by `runsAfter`. Unrelated tracks start together; multiple hard predecessors stay separate `after` entries.

## Preflight (step 3)

- `gh auth status` succeeds and `gh api repos/<owner>/<repo> --jq .permissions.push` is `true`.
- Default `reviewMode: 'github'` needs `.github/workflows/claude.yml` (from `templates/claude-workflow/workflows/claude.yml`, `CLAUDE_CODE_OAUTH_TOKEN`, the Claude GitHub App, a `runs-on` you have) and working Actions; `reviewBot: 'codex'` needs `codex.yml` plus the secrets the `fix-pr-review-loop` preflight lists. Without a bot, pass `reviewMode: 'subagent'` or `reviewLoop: false`. Actions-hosted CI is a separate dependency.
- With a `targetBranch`: validate the name per `work-on-issue` step 1 ("Target"), and `git ls-remote --heads origin "refs/heads/<branch>"` must list exactly one line. A missing or invalid branch stops the run; never create it or fall back to the default branch.
- With merging on, the account must be allowed to squash-merge and delete branches on the target branch; otherwise relax protection or run `merge: false`.
- Every issue stamped on an external CLI: `command -v codex` plus `codex login status` (Codex), `command -v agent` plus `agent status` (Cursor). A missing binary or signed-out status blocks only that issue at run time; fix it here or restamp through `execution-plan-review`. An issue with no Execution block stops the run: send it through `execution-plan-review`.
- The target repo's CLAUDE.md covers package manager and test commands.
