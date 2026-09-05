# Re-review routing (fix-pr-review step 10)

Read it whole before posting. A guessed phrase posts a trigger no Action answers.

## 1. Pick the bot

The current cycle's bot, default `@claude`. Use `@codex` only when this cycle selected Codex: the user said so, a caller argument or the literal `codex` argument named it, or the run started from an `@codex` comment. An existing `codex.yml` selects nothing. Never switch bots mid-cycle.

## 2. Route by blocking vs non-blocking

Route by whether the addressed set contained **any blocking finding** (fix-pr-review step 1); the newest verdict alone never decides it. Blocking = a `Needs Fixing` or `Requires Human Review` item from any review, an inline thread validated as a real defect, or any CI Failure finding, counted whether fixed or refuted (a wrong refutation is what the heavier re-review catches).

**Non-blocking only** (optional improvements or follow-ups): the cheap shorthand, `@claude sonnet review` or `@codex luna review`, in any band, consuming no rung.

**Bare LGTM, merge only** (fix-pr-review step 7's merge re-review rule): the same cheap shorthand when step 7 decided the hand-resolved diff changes behavior or was in doubt, consuming no rung; no trigger when it decided prose only. Step 7's behavior decision is the test and the file class is evidence only; `milestone-workflow` step 5 sub-step 3 makes the same decision before a merge.

**Blocking** → the step-down below, **keyed to the reviewer that actually ran cycle 1**; the score band never decides it.

### Identify cycle 1

The **EARLIEST** `@<bot> … review` trigger comment on the PR (a body that is only the trigger line), **skipping every cheap non-blocking re-trigger** (`@claude sonnet review`, `@codex luna review`), **unless that cheap phrase is what cycle 1 itself would have used**: the PR's band is the owner table's cheapest first-review row, or a stamped `PR review:` line in the linked issue names `sonnet`/`haiku` (either maps to `luna` on Codex). Read the stamp before applying the skip; a stamped cheap trigger is byte-identical to the non-blocking phrase. A step-down rung is itself a later trigger comment, so a later comment is never cycle 1.

### The step-down ladder (Claude cycles)

**Every reviewer above the standard trigger runs one blocking cycle only.** Each blocking re-review steps down one rung; the floor `@claude review` repeats for every blocking cycle after it:

| Cycle-1 reviewer | Blocking cycle 2 | Blocking cycle 3 and after |
|---|---|---|
| `@claude fable review effort:high` | `@claude opus review effort:high` | `@claude review` |
| `@claude opus review effort:high` | `@claude review` | `@claude review` |
| `@claude review` or `@claude sonnet review` | same trigger | same trigger |

Neither heavy trigger is ever repeated on a blocking re-review, whether the owner table or a stamped `PR review:` line selected it. The ladder **never steps down to sonnet**: Sonnet takes no rung, so a Sonnet cycle 1 repeats its own trigger. Decide the rung from the trigger comments after cycle 1, ignoring `@claude sonnet review` comments: a prior `@claude opus review` comment (any effort suffix) after a fable cycle 1 means the next rung is `@claude review`. A stamped `haiku` posts `@claude sonnet review`: `claude.yml` resolves only `opus`, `sonnet`, and `fable`, and an unresolved shorthand becomes the route keyword.

### Codex cycles

Codex has no ladder: its cycle-1 trigger repeats for every blocking re-review. Never post a `@claude` rung on a Codex cycle, and never discard a stamp back to the band: stamped `sonnet`/`haiku` becomes `@codex luna review`, stamped `opus`/`fable` the bare `@codex review`, each keeping a stamped `effort:<tier>`.

### Fallback table

**The fallback table applies ONLY when the PR carries no cycle-1 trigger comment**, none at all or none left after the skip. Its rows are the rows of the first-review table in `validate-issue` step 6, which owns every boundary; read the band there and take the matching row here. Read the score from the `[C<score>, …]` bracket in the PR title, then the `[C<score>]` prefix of the closed issue. A stamped `PR review:` line is no score source; it selects the reviewer directly.

| Owner's first-review row | Claude fallback trigger | Codex fallback trigger |
|---|---|---|
| the sonnet row | `@claude sonnet review` | `@codex luna review` |
| the standard-trigger row | `@claude review` | `@codex review` |
| the opus row, the fable row, or no score | `@claude opus review effort:high` when no `@claude opus review` comment (any effort suffix) exists on the PR; `@claude review` otherwise | `@codex review` |

Fable and Opus each review one cycle only, and a first review already ran by some other route; never open a Fable cycle on a re-review.

## 3. Post it as its own comment

A **separate** one-line comment (`gh pr comment <N> --body "@claude review"`), no footer. A trigger inside a longer body does not fire. If the repo uses another trigger phrase, match its `.github/workflows/claude.yml` / `codex.yml`.

## Growth check

Inputs for fix-pr-review step 4, all read from the PR so a resumed loop sees the same values:

- **`<first-push-sha>`**: from `gh pr view <N> --json commits`, the newest commit whose `committedDate` is at or before the cycle-1 trigger comment's timestamp; with no trigger comment, the PR's `createdAt`. A first push of several commits resolves to the last.
- **Measurement**: `git diff --stat $(git merge-base origin/<baseRefName> HEAD)..HEAD` against the same reading at `<first-push-sha>`. Never a plain `<first-push-sha>..HEAD` two-dot diff, which counts every base change since the branch point, including step 7 merges, as PR growth.
- **`pr_cycle_count`**: the PR's trigger comments read chronologically per the cycle-1 rule, skipping the cheap non-blocking re-triggers, plus one when review feedback predates every trigger comment. Never the loop's in-memory `review_count`.
