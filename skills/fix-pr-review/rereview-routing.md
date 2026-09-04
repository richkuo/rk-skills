# Re-review routing (fix-pr-review step 10)

Read it whole before posting — a guessed phrase posts a trigger no Action answers.

## 1. Pick the bot

The re-review goes to the **current cycle's** bot; the default is `@claude`. Use `@codex` only when this cycle selected Codex: the user said so, a caller argument named it, the invocation carried the literal `codex` argument, or this run started from an `@codex` comment. A `codex.yml` merely existing does **not** select Codex. Never switch bots mid-cycle.

## 2. Route by blocking vs non-blocking

Route by whether the addressed set contained **any blocking finding** (fix-pr-review step 1). The newest review's verdict alone does not decide it: a later `LGTM` from one reviewer does not erase another's `Needs Updates`. Blocking = a `Needs Fixing` or `Requires Human Review` item from any review, an inline thread that validated as a real defect, or any CI Failure finding — **counted regardless of its verdict**, fixed or refuted. A refuted CI failure still counts on purpose: a wrong refutation is what the heavier re-review catches.

**Non-blocking only** (optional improvements or follow-ups) → the cheap shorthand, `@claude sonnet review` on Claude or `@codex luna review` on Codex, in any band, consuming no rung.

**Bare LGTM, merge only** (fix-pr-review step 7's merge re-review rule) → the same cheap shorthand when step 7 decided the hand-resolved diff changes behavior or was in doubt, consuming no rung; **no trigger** when step 7 decided it is prose only. The prior LGTM covers a prose-only merge. It never covers a hand-resolved behavior change, whichever file carries it: source, tests, config, workflows, scripts, or agent-executed Markdown. Step 7's behavior decision is the test; the file class is evidence only. The same decision gates a merge in `milestone-workflow` step 5 sub-step 3.

**Blocking** → the step-down below, **keyed to the reviewer that actually ran cycle 1**; the score band never decides it.

### Identify cycle 1

Take the **EARLIEST** `@<bot> … review` trigger comment on the PR (one whose entire body is the trigger line), **skipping every cheap non-blocking re-trigger** (`@claude sonnet review` on Claude, `@codex luna review` on Codex) — **unless that cheap phrase is what cycle 1 itself would have used**, in which case the earliest such comment IS cycle 1. Two things make it so: the PR's band is the owner table's cheapest first-review row, or a stamped `PR review:` line in the linked issue names the cheap reviewer (`sonnet`/`haiku` on Claude, either mapped to `luna` on Codex). **Read the stamp before applying the skip** — a stamped cheap trigger is byte-identical to the non-blocking phrase, and skipping it discards the genuine cycle 1. A step-down rung is itself a later trigger comment, so a later comment is never cycle 1.

### The step-down ladder (Claude cycles)

**Every reviewer above the standard trigger runs one blocking cycle only.** Each blocking re-review steps down one rung; the floor is `@claude review`, which repeats for every blocking cycle after it:

| Cycle-1 reviewer | Blocking cycle 2 | Blocking cycle 3 and after |
|---|---|---|
| `@claude fable review effort:high` | `@claude opus review` | `@claude review` |
| `@claude opus review` | `@claude review` | `@claude review` |
| `@claude review` or `@claude sonnet review` | same trigger | same trigger |

Neither heavy trigger is ever repeated on a blocking re-review, whether the owner-table row or a stamped `PR review:` line selected it. The ladder **never steps down to sonnet**: Sonnet sits below the floor and takes no rung, so a Sonnet cycle 1 repeats its own trigger, as does a cycle 1 already on `@claude review`. Decide the rung from the trigger comments after cycle 1 — a prior `@claude opus review` after a fable cycle 1 means the next rung is `@claude review` — ignoring `@claude sonnet review` comments, which consume no rung. A stamped `haiku` posts `@claude sonnet review`: `claude.yml` resolves only `opus`, `sonnet`, and `fable`, and an unresolved shorthand becomes the route keyword.

### Codex cycles

Codex exposes one flagship and has no ladder — its cycle-1 trigger repeats for every blocking re-review. Never post a `@claude` rung on a Codex cycle, and never discard a stamp back to the band: a stamped `sonnet`/`haiku` becomes `@codex luna review`, a stamped `opus`/`fable` the bare `@codex review`, each keeping a stamped `effort:<tier>`.

### Fallback table

**The fallback table applies ONLY when the PR carries no cycle-1 trigger comment** — none at all, or none left after the cheap re-triggers are skipped. **It carries no boundary numbers of its own**: its rows are the rows of the first-review table in `validate-issue` step 6, which owns every boundary — read the band there and take the matching row here. Read the score from the `[C<score>, …]` bracket in the PR title, then the `[C<score>]` prefix of the issue the PR closes; a stamped `PR review:` line is not a score source — it selects the reviewer directly.

| Owner's first-review row | Claude fallback trigger | Codex fallback trigger |
|---|---|---|
| the sonnet row | `@claude sonnet review` | `@codex luna review` |
| the standard-trigger row | `@claude review` | `@codex review` |
| the opus row, the fable row, or no score | `@claude opus review` only when no `@claude opus review` comment already exists on the PR; `@claude review` otherwise | `@codex review` |

The heavy rows are guarded because Fable and Opus each review one cycle only, and a first review already ran by some other route — never open a Fable cycle on a re-review.

## 3. Post it as its own comment

Post a **separate** comment (`gh pr comment <N> --body "@claude review"` etc.) — a trigger buried in a longer body does not fire, so never bundle it into the disposition. If the repo uses a different trigger phrase, match its `.github/workflows/claude.yml` / `codex.yml`. A trigger comment is a one-line mention and carries no footer.

## Growth check

Inputs for fix-pr-review step 4's growth check, all read from the PR itself so a resumed loop sees the same values:

- **`<first-push-sha>`** — from `gh pr view <N> --json commits`, the newest commit whose `committedDate` is at or before the cycle-1 trigger comment's timestamp; with no trigger comment, use the PR's `createdAt`. A first push of several commits resolves to the last of them.
- **Measurement** — `git diff --stat $(git merge-base origin/<baseRefName> HEAD)..HEAD` against the same reading at `<first-push-sha>`. Never a plain `<first-push-sha>..HEAD` two-dot diff, which counts every base change since the branch point — including commits a step 7 merge brought in — as PR growth.
- **`pr_cycle_count`** — the PR's `@<bot> … review` trigger comments read chronologically per the cycle-1 rule, skipping the cheap non-blocking re-triggers, plus one when review feedback predates every trigger comment. Never the loop's in-memory `review_count`.
