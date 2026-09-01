# Fetch recipes

Reference for SKILL.md steps 1–2: channel queries, collection rules, CI-check procedures.

## Review-feedback channels (step 1)

```bash
# Formal review events — state included so DISMISSED reviews can be skipped
gh api repos/{owner}/{repo}/pulls/<N>/reviews --paginate --jq '.[] | {id, user: .user.login, state, submitted_at, body}'
# Issue comments on the PR — where @claude review output usually lands
gh api repos/{owner}/{repo}/issues/<N>/comments --paginate --jq '.[] | {author: .user.login, created_at, body}'
# Inline diff threads with resolution state — REST cannot report isResolved, so use GraphQL
gh api graphql -F owner='{owner}' -F repo='{repo}' -F pr=<N> -f query='
  query($owner:String!,$repo:String!,$pr:Int!){ repository(owner:$owner,name:$repo){ pullRequest(number:$pr){
    reviewThreads(first:100){ pageInfo{hasNextPage endCursor} nodes{ isResolved isOutdated path line
      comments(first:50){ nodes{ databaseId author{login} createdAt body } } } } } } }'
```

When `hasNextPage` is true, paginate with `endCursor` — never drop threads past 100.

### Collection rules

**Cutoff** = the timestamp of your most recent disposition comment on the PR (or the last commit you pushed addressing a review); no cutoff → everything since the PR opened. Collect:

- Every formal review or review-formatted comment **newer than the cutoff** — one opening with an `LGTM` / `Needs Updates` verdict, carrying sections like `### Needs Fixing`, or otherwise clearly review feedback. **When several landed, address all of them.** The latest alone is incomplete. Skip `DISMISSED` reviews.
- Every **unresolved** inline thread (`isResolved: false`) **regardless of age** — resolution state decides and the timestamp does not; `isOutdated` alone does not mean resolved. Exception: a thread whose last comment is your own disposition reply with no response since is awaiting the reviewer — skip it. Each thread is one finding.
- Skip your own prior disposition comments and `@<bot> … review` trigger comments.

## CI check snapshot (step 2)

```bash
gh pr checks <N> --json name,state,bucket,link,startedAt,completedAt
```

`bucket` normalizes `state` into `pass`/`fail`/`pending`/`skipping`/`cancel`:

- `pending` / `skipping` — **skip entirely.** A running check is the next pass's problem; never retry, wait, or treat "not done yet" as a finding.
- `cancel` — see the attribution procedure below.
- `fail` — pull only the failing detail:
  - GitHub Actions: resolve the run ID from the check's `link`, then `gh run view <run-id> --log-failed`.
  - External CI: `gh api` does not fill `{sha}`, so read it first (`gh pr view <N> --json headRefOid --jq .headRefOid`), then `gh api repos/{owner}/{repo}/commits/<sha>/check-runs --jq '.check_runs[] | select(.conclusion=="failure") | {name, output}'`.

### Attributing a `bucket: cancel` check

Skip a cancelled check unless its run log shows a real upstream failure caused the cancel; a manual cancel is skipped. When it did and this snapshot already has a `fail`-bucket entry for that upstream job, skip it — the `fail` path covers it. Otherwise resolve the run ID from its `link`, find the failed job with `gh run view <run-id>`, pull its detail via the `fail` procedure, and cite that job's name. When no concrete failed job surfaces, never invent an upstream cause — record the finding against the cancelled check's own name with its run link and flag it for human review.
