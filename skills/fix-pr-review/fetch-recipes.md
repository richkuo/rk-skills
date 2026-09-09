# Fetch and reconcile feedback

Read for steps 1 and 2. Use the PR's resolved base repository and GitHub host for all review and check queries, including fork PRs. Record the inspected head SHA. A failed or truncated fetch is incomplete input; retry recoverable reads. Remaining collection gaps block completion and re-review.

## Three channels

- Formal reviews: `gh api repos/{owner}/{repo}/pulls/<N>/reviews --paginate`. Retain ID, author, state, submitted time, commit ID, body, and URL. Skip dismissed review bodies; their unresolved inline claims are still considered separately.
- Issue comments: `gh api repos/{owner}/{repo}/issues/<N>/comments --paginate`. Retain ID, author, created and updated times, body, and URL. Include ordinary prose that asks for a change, even without review headings.
- Inline threads: query GraphQL `repository.pullRequest.reviewThreads` with `first:100`, an `after` cursor, and `pageInfo { hasNextPage endCursor }`. Retain thread ID, `isResolved`, `isOutdated`, path, line, and comment IDs. For each thread, separately paginate its `comments` connection through `node(id: <thread ID>)` as a `PullRequestReviewThread`, retaining `fullDatabaseId`, author, timestamps, body, URL, and review commit where available. Each connection has its own cursor; paginating threads alone does not fetch all replies. Use the root comment's `fullDatabaseId` as the REST reply target; preserve its exact integer text. If it is null, obtain the matching REST comment ID before replying.

Use `gh api graphql` with variables supplied as structured fields or from a request file. Check GraphQL errors as well as command exit status. Never put fetched bodies or branch names into executable shell text.

## Reconciliation across runs

Read prior dispositions and match findings by source identity and claim. A last-disposition timestamp or last pushed commit is only a search aid; neither proves an older finding was addressed. Edited comments need comparison by current body and `updated_at`/`updatedAt` as available.

Collect every unaddressed claim from all reviews and comments, plus unresolved inline threads of any age. Split compound threads in step 3. `isOutdated` alone does not settle a thread. Ignore trigger comments and disposition prose as new findings, but retain reviewer replies that contest a disposition or add evidence.

A prior disposition covers only the claims it explicitly accounts for. Verify its fixed claim at the current head or retain its code-grounded rebuttal or valid deferral. A final fixer reply with no newer response is awaiting review only when it accounts for every claim in that thread and its evidence still holds. A generic acknowledgment, partial reply, or Blocked item remains actionable. Do not resolve threads merely because a reply was posted.

Read again before publishing to detect new or edited feedback. Reconcile additions and refresh validation if the head changed. If feedback keeps changing and a complete pass cannot be established, preserve work and report the incomplete set. Never move a global cutoff past findings absent from the disposition.

## CI snapshot

Use `gh pr checks <N> --repo <owner/repo> --json name,state,bucket,link,startedAt,completedAt`. Nonzero status can mean failing or pending checks; distinguish returned check data from an API failure.

- `fail`: collect failing details. For GitHub Actions, obtain the run ID from the check link and use `gh run view <run-id> --repo <owner/repo> --log-failed`. For external checks, read the check output or linked provider evidence at the recorded head. Paginate check-run results and select the check by identity, not name alone.
- `pending` or `skipping`: record status, with no finding, waiting, or retry.
- `cancel`: investigate only available evidence. A concrete upstream failure becomes a finding unless its failed job is already represented. A manual cancel creates no finding. An unknown cause is a verification gap; never invent an upstream defect.

Unavailable logs leave attribution unresolved. Record the access limitation separately from the failed check; do not call it pre-existing or fixed without evidence.

---
Updated with LLM: GPT-6 | high | Harness: skill-creator
