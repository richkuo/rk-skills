# Fetch recipes

Reference for SKILL.md steps 1–2: the exact queries for the three review-feedback channels and the CI-check detail procedures.

## Review-feedback channels (step 1)

```bash
# PR reviews (formal review events) — state included so DISMISSED reviews can be skipped
gh api repos/{owner}/{repo}/pulls/<N>/reviews --paginate --jq '.[] | {id, user: .user.login, state, submitted_at, body}'
# Issue comments on the PR (where @claude review output usually lands) — REST + --paginate for completeness
gh api repos/{owner}/{repo}/issues/<N>/comments --paginate --jq '.[] | {author: .user.login, created_at, body}'
# Inline diff threads WITH resolution state — REST can't report isResolved, so use GraphQL
gh api graphql -F owner='{owner}' -F repo='{repo}' -F pr=<N> -f query='
  query($owner:String!,$repo:String!,$pr:Int!){ repository(owner:$owner,name:$repo){ pullRequest(number:$pr){
    reviewThreads(first:100){ pageInfo{hasNextPage endCursor} nodes{ isResolved isOutdated path line
      comments(first:50){ nodes{ databaseId author{login} createdAt body } } } } } } }'
```

(If `hasNextPage` is true, paginate with `endCursor` — don't silently drop threads past 100.)

## CI check snapshot (step 2)

```bash
gh pr checks <N> --json name,state,bucket,link,startedAt,completedAt
```

### Pulling detail for a `bucket: fail` check

Pull just the failing detail, not the whole log:

- GitHub Actions: resolve the run ID from the check's `link`, then `gh run view <run-id> --log-failed` for the failing step(s) only.
- Non-Actions / external CI: `gh api` only auto-fills `{owner}`/`{repo}`/`{branch}` — `{sha}` is not one of them, so get the head commit explicitly first: `gh pr view <N> --json headRefOid --jq .headRefOid`. Substitute that for `<sha>`: `gh api repos/{owner}/{repo}/commits/<sha>/check-runs --jq '.check_runs[] | select(.conclusion=="failure") | {name, output}'` for whatever summary the provider publishes.

### Attributing a `bucket: cancel` check

Skip a cancelled check unless the run log shows it was cancelled by a real failure upstream (e.g. a required prior job failed) rather than a manual/administrative cancel. When it was, check this same snapshot for a `bucket: fail` entry on that upstream job first: if one exists, skip the cancelled check entirely — the `fail`-bucket path above already turns that upstream job into its own CI Failure finding, and citing both would duplicate it. Only when the real upstream failure is *not* otherwise visible as its own `fail`-bucket entry in this snapshot does the cancelled check get a finding of its own. To source the detail concretely, resolve the run ID from the cancelled check's `link` and run `gh run view <run-id>` — that lists every job in the same workflow run with its conclusion, so a job that failed there but isn't surfaced as its own PR check shows up; pull its failing detail via the `fail`-bucket procedure above and cite that job's name (not the cancelled one). If even that yields no concrete failed job, don't invent an upstream cause — record the finding against the cancelled check's own name with its run link and flag it for human review, rather than guessing at an unverified cause.
