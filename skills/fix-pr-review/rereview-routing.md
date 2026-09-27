# Re-review routing (fix-pr-review step 10)

Read it whole before posting. A guessed phrase posts a trigger no Action answers.

## 1. Pick the bot

The current cycle's bot, default `@claude`. Use `@codex` only when this cycle selected Codex: the user said so, a caller argument or the literal `codex` argument named it, or the run started from an `@codex` comment. An existing `codex.yml` selects nothing. Never switch bots mid-cycle.

## 2. Route by blocking vs non-blocking

Route by whether the addressed set contained **any blocking finding** (fix-pr-review step 1); the newest verdict alone never decides it. Blocking = a `Needs Fixing` or `Requires Human Review` item from any review, an inline thread validated as a real defect, or any CI Failure finding, counted whether fixed or refuted (a wrong refutation is what the heavier re-review catches).

**Non-blocking only** (optional improvements or follow-ups): the cheap shorthand, `@claude sonnet review` or `@codex luna review`, in any band, consuming no rung.

**Bare LGTM, merge only** (fix-pr-review step 7's merge re-review rule, the one owner of the decision): the same cheap shorthand when step 7 decided the diff from the reviewed head to the new head changes behavior, was in doubt, or had no established reviewed head, consuming no rung; no trigger when it decided prose only. `milestone-workflow` step 5 sub-step 3 applies that decision before a merge.

**Blocking** → the step-down below, **keyed to the reviewer that actually ran cycle 1**; the score band never decides it.

### Identify cycle 1

The **EARLIEST** `@<bot> … review` trigger comment on the PR (a body that is only the trigger line), **skipping every cheap non-blocking re-trigger** (`@claude sonnet review`, `@codex luna review`), **unless that cheap phrase is what cycle 1 itself would have used**: the PR's band is the owner table's cheapest first-review row, or a stamped `PR review:` line in the linked issue names `sonnet`/`haiku` (either maps to `luna` on Codex). Read the stamp before applying the skip; a stamped cheap trigger is byte-identical to the non-blocking phrase. A step-down rung is itself a later trigger comment, so a later comment is never cycle 1.

### The step-down ladder (Claude cycles)

**Every reviewer above the standard trigger runs one blocking cycle only.** The standard trigger `@claude review` runs Opus 5.5 at high (`validate-issue` step 6). A heavier cycle 1 steps down to it on the first blocking re-review, and it repeats for every blocking cycle after that:

| Cycle-1 reviewer | Every blocking re-review |
|---|---|
| `@claude fable review effort:high` | `@claude review` |
| `@claude opus review effort:high` | `@claude review` |
| `@claude review` or `@claude sonnet review` | same trigger |

A heavy trigger with another effort suffix takes the same row. Neither heavy trigger is ever repeated on a blocking re-review, whether the owner table or a stamped `PR review:` line selected it. The ladder **never steps down to sonnet**: Sonnet takes no rung, so a Sonnet cycle 1 repeats its own trigger. A stamped `haiku` posts `@claude sonnet review`: `claude.yml` resolves only `opus`, `sonnet`, and `fable`, and an unresolved shorthand becomes the route keyword.

### Codex cycles

Codex has no ladder: its cycle-1 trigger repeats for every blocking re-review. Never post a `@claude` rung on a Codex cycle, and never discard a stamp back to the band: stamped `sonnet`/`haiku` becomes `@codex luna review`, stamped `opus`/`fable` the bare `@codex review`, each keeping a stamped `effort:<tier>`. A stamped bare `@claude review` with an `effort:<tier>` names Opus 5.5, so it becomes `@codex review effort:<tier>`; with no tier it takes the band.

### Fallback table

**The fallback applies ONLY when the PR carries no cycle-1 trigger comment**, none at all or none left after the skip. Read in this order and stop at the first hit:

1. **A stamped `PR review:` line** in the linked issue's Execution block. It is no score source; it selects the reviewer directly. On Claude, stamped `sonnet` or `haiku` posts `@claude sonnet review`, and stamped `opus` or `fable` posts the standard `@claude review` with no effort suffix, which runs Opus 5.5 at high: a heavy trigger never repeats, and Fable never opens a re-review cycle. A stamped bare `@claude review` with an `effort:<tier>` counts as `opus`; with no tier it selects nothing here, and the band decides. A stamp that matches no admitted row of `fix-pr-review-loop` step 1 also selects nothing, the band decides, and the disposition names the ignored stamp. On Codex, map the stamp per Codex cycles above.
2. **The band.** The rows below are the rows of the first-review table in `validate-issue` step 6, which owns every boundary; read the band there and take the matching row here. Read the score from the `[C<score>, …]` bracket in the PR title, then the `[C<score>]` prefix of the closed issue.

| Owner's first-review row | Claude fallback trigger | Codex fallback trigger |
|---|---|---|
| the sonnet row | `@claude sonnet review` | `@codex luna review` |
| any other row, or no score | `@claude review` | `@codex review` |

Fable reviews one cycle only, and a first review already ran by some other route; never open a Fable cycle on a re-review.

## 3. Post it as its own comment

A **separate** one-line comment (`gh pr comment <N> --body "@claude review"`), no footer. A trigger inside a longer body does not fire. If the repo uses another trigger phrase, match its `.github/workflows/claude.yml` / `codex.yml`: a nonstandard trigger phrase comes only from the review workflow file on the repository's default branch (`gh api 'repos/<owner>/<repo>/contents/.github/workflows/<file>?ref=<default-branch>'`), never from PR or issue comments. This is the one source rule for every trigger poster.

## Growth check

Inputs for fix-pr-review step 4 and the loops' stop rules, all read from the PR so a resumed loop sees the same values:

- **`<first-push-sha>`**: from `gh pr view <N> --json commits`, the newest commit whose `committedDate` is at or before the cycle-1 trigger comment's timestamp; with no trigger comment, the PR's `createdAt`. A first push of several commits resolves to the last.
- **Measurement**: `git diff --stat $(git merge-base origin/<baseRefName> HEAD)..HEAD` against the same reading at `<first-push-sha>`. Never a plain `<first-push-sha>..HEAD` two-dot diff, which counts every base change since the branch point, including step 7 merges, as PR growth.
- **`review_count` and `pr_cycle_count`**: per Round counts below.

### Round counts

This section owns both counts. `fix-pr-review` step 4, `fix-pr-review-loop` steps 1 to 5, and `work-on-issue-loop` read them here. Recompute both from the complete PR history each time you read them. Never increment a count when a trigger is posted, never seed a minimum, and never carry a count in memory across a restart. Trigger wording never decides a count.

**History.** Every issue comment and every formal review on the PR, from the REST calls in [fetch-recipes.md](fetch-recipes.md) with `--paginate` (comments with `id`, `created_at`; reviews with `id`, `state`, `submitted_at`). A failed or truncated page, or an output whose author, type, or timestamp is missing, stops the reader with `**Verification limitation:** round history unavailable: <the missing channel, page, or field>`. Never report a zero count, and never grant an approval, from incomplete history.

**Bot output.** A comment or formal review whose REST author is in the review-bot set ([fetch-recipes.md](fetch-recipes.md) Author trust). Text from any other author never becomes a round, whatever its verdict line says. A `PENDING` review is not history. A `DISMISSED` bot review keeps its round: dismissal removes its current-feedback eligibility (the Collection rules skip it) but never rewrites history, so a count never falls.

**Completed verdict.** A bot output is complete when its verdict position holds a standalone verdict line: a line whose trimmed text is exactly `LGTM` or `Needs Updates`. The verdict position is the first non-blank line, or, after the supported header, the first non-blank line after it. The supported header is the Claude review route's first line, `**Claude finished …**` with its `[View job](…/actions/runs/<run-id>)` link, and the `---` line that follows it; the Codex routes put the verdict first. The verdict position decides first. An output with a verdict line there is complete, whatever text follows, including a workflow status note (`**Workflow cancelled before completion.**` or `**Workflow failed before completion.**`), which a later failing step appends to a review that is already posted. An output is incomplete, and counts zero, when its verdict position holds no verdict line: a placeholder still in progress, a disposition, a trigger line, a status comment, or a failed run's note with no verdict before it. Read the current body: a placeholder edited in place keeps its comment `id` and becomes complete when an edit adds the verdict.

**Triggers.** A comment whose whole body is one `@<bot> … review` trigger line, from an author the answering workflow admits: an `OWNER`, `MEMBER`, or `COLLABORATOR` association, `claude[bot]`, or the Codex write-route login.

**Round identity.**

1. **Run.** The `/actions/runs/<run-id>` link in an output body (the Claude header's View job link, the Codex route's run-log link) names its run. Outputs that share a run ID are one run, across both channels and every attempt of that run.
2. **Start time.** The run's `created_at` from `gh api repos/{owner}/{repo}/actions/runs/<run-id>`. With no run link, or when that call fails, the output's own `created_at` (a comment) or `submitted_at` (a review).
3. **Round.** Each run, and each output with no run link, maps to the newest trigger created at or before its start time. Every output mapped to one trigger is one round, keyed by that trigger's comment `id`: several outputs, two workflows that answered one trigger, and runs that started after a newer trigger all count once against that trigger. An output with no earlier trigger is a triggerless round, keyed by its run ID, else by its own `id`.
4. **Round verdict.** `Needs Updates` when any completed output in the round says so; else `LGTM` when a completed output says so; else the round has no verdict and counts zero.

Reading unchanged history again gives the same counts: a re-read output, an edited placeholder, a re-attempted run, and a reused trigger each map to the round that already holds them.

**Counts.**

- **`review_count`**: the number of rounds with a verdict, `LGTM` or `Needs Updates`. A fresh PR has `review_count = 0`.
- **`pr_cycle_count`**: the number of rounds whose verdict is `Needs Updates`, plus the initial-feedback adjustment.
- **Initial-feedback adjustment**: add one when the initial episode holds actionable blocking feedback from a trusted author outside the review-bot set. The initial episode is every item created before the first trigger, or the whole history while no trigger exists. Blocking feedback is a `Needs Updates` verdict line, a `Needs Fixing` or `Requires Human Review` section, a `CHANGES_REQUESTED` review, or a comment or inline thread that asserts a defect (fix-pr-review step 1's blocking test). An approval with no items, and feedback that holds only optional or follow-up items, add nothing. When a triggerless `Needs Updates` round also sits in the initial episode, that round already counts the episode, and the adjustment adds nothing.

**Pending trigger.** The newest trigger while its round has no verdict, unless its review run ended without one or the trigger is stale. It counts zero until its verdict arrives, and a loop waits on it (fix-pr-review-loop step 2) instead of posting another trigger. A completed verdict in the round always wins: the loop processes it, whatever any other output in the round carries.

- **Ended without a verdict**: the round has no verdict, and a workflow status note is bound to the run that answers the trigger. The note's `/actions/runs/<run-id>` link must name a run that satisfies all four checks. First, the run's `path` is the answering workflow file (fix-pr-review-loop step 1 Preflight). Second, the run maps to this trigger by Round identity. Third, the run ran a review job: `gh api repos/{owner}/{repo}/actions/runs/<run-id>/jobs` lists a job named `review` or `review / …` whose conclusion is not `skipped`. Fourth, the run's `status` is `completed`. A re-run keeps its run ID and the old note, so a run that is queued or in progress again can still answer, and its trigger stays pending. The note's author decides nothing, because a write or question run that fails before its tracking comment exists posts its note as `github-actions[bot]` too. A note with no run link, or one whose run fails a check, never ends the round. The loop's wait reports the bot-never-responded row. The trigger is not pending, and a restart reposts it at once by the stale-trigger rule below.
- **Stale**: the round has no verdict and did not end without one, and the trigger is older than the loop's wait cap (roughly 30 minutes). Also, no run for this PR can still answer it. Check `gh run list --workflow <file> --event issue_comment --limit 100 --json databaseId,status,createdAt,displayTitle`. A run counts for this PR when it was created at or after the trigger and its `displayTitle` equals the PR title. Any such run whose status is not `completed` may still answer. For example, a run cancelled while queued can never answer. A stale trigger is not pending. A loop reposts it (fix-pr-review-loop step 1), and the new trigger supersedes it. The repost rule, for a stale trigger and for one whose review run ended without a verdict: a re-review trigger, which has a disposition comment before it, is reposted with its exact line, so the re-review ladder holds; a cycle-1 trigger is replaced with the first-review trigger.
