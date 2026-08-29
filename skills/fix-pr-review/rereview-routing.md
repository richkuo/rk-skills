# Re-review routing (fix-pr-review step 10)

The complete routing procedure for the re-review trigger fix-pr-review posts after it pushes its fixes. Read it whole before posting the trigger — guessing a phrase from memory posts a trigger no Action answers.

## 1. Pick the bot, then the model

The re-review goes to the review bot of the **current cycle**, and the default is `@claude`. Use `@codex` only when this cycle selected Codex — one of: the user said so ("review with Codex", "use Codex"), a caller argument named it (`reviewBot: codex`), the invocation included the literal `codex` argument (the skill's Input section), or this run itself was started by an `@codex` GitHub comment. A `codex.yml` merely existing in the repo does **not** select Codex. Once a cycle has a bot, every re-review in that cycle stays on it — never switch mid-cycle.

## 2. Route by blocking vs non-blocking

Route by whether the set you addressed contained **any blocking finding** (noted in step 1). Never route by the newest review's verdict alone: with multiple reviewers, a later `LGTM` from one does not erase another's `Needs Updates`.

A finding is blocking when it is a `Needs Fixing` or `Requires Human Review` item from any review, an inline thread that validated as a real defect, or any CI Failure finding from step 2 — **counted regardless of its verdict**, whether you fixed it or refuted it as pre-existing or flaky, exactly as the reviewer clauses count regardless of verdict.

A CI failure you refuted still counts as blocking on purpose: if that refutation was wrong, the heavier re-review is what catches the real regression you dismissed.

### Blocking — route on the reviewer that ran cycle 1

**The step-down is keyed to the reviewer that actually ran cycle 1.** The score band does not decide it. Before you read a band row, identify the cycle-1 reviewer: list the PR's comments in chronological order and take the **EARLIEST** one whose entire body is an `@<bot> … review` trigger line, **skipping every cheap non-blocking re-trigger** (`@claude sonnet review` on Claude, `@codex luna review` on Codex) unless the PR's band is the owner table's cheapest first-review row, the one band that selects that same phrase as a first review. That comment is cycle 1. Never take a later trigger comment for it — a step-down rung is a later trigger comment, so reading the newest one would send a C90 PR's blocking findings to the cheapest tier.

**Why the cheap shorthand is skipped:** a non-blocking pass posts it at any band, and a PR's first review can arrive with no trigger comment at all — a human reviewer, or fix-pr-review-loop step 1's "unaddressed feedback is already present" branch, which sets `review_count = 1` and posts nothing. On a C90 PR that pair makes `@claude sonnet review` the earliest trigger comment on the PR, and reading it as cycle 1 would pin every later blocking re-review to the cheapest reviewer. Inside the cheapest band the skip is unnecessary and would change nothing: the band row posts the same phrase, so either reading gives the same trigger. When skipping leaves no trigger comment at all, the PR has no genuine cycle 1 to key on — take the fallback table below. Then: if cycle 1 ran on Fable or on Opus — selected by the owner table's row for that band, or by a stamped `PR review:` line naming Fable or Opus at any score, which the read order puts first — take the step-down ladder instead of the fallback row. A first review on the standard trigger or on Sonnet sits at or below the ladder floor and keeps its own trigger for every blocking re-review, whatever its band. So a C55 PR whose issue stamps `@claude fable review effort:high` takes the ladder rather than a fallback row, and a C10 PR stamped `@claude opus review` takes the ladder too and drops to `@claude review` for every blocking re-review.

On a Claude cycle a stamped `haiku` posts `@claude sonnet review`: `claude.yml` resolves only `opus`, `sonnet` and `fable`, and an unresolved shorthand becomes the route keyword, which sends a trusted-author PR to the write-capable fix-pr job instead of the reviewer.

**On a Codex cycle the same stamp rule applies in Codex's own vocabulary.** Never post a `@claude` rung on a Codex cycle, and never discard the stamp back to the band. Map the stamped model onto the Codex column: a stamped `sonnet` or `haiku` becomes `@codex luna review`, and a stamped `opus` or `fable` becomes the bare `@codex review`, each followed by `effort:<tier>` when the stamped line carries one. Codex exposes one flagship and has no Fable tier, so it has no step-down ladder at all — its cycle-1 trigger simply repeats for every blocking re-review. A C60 Codex PR stamped `@claude sonnet review` therefore stays on `@codex luna review` at every cycle, and an unstamped C90 one keeps the bare `@codex review` and never reaches `luna`.

**The fallback table below applies ONLY when the PR carries no cycle-1 trigger comment** — no `@<bot> … review` comment at all, or none left after the cheap non-blocking re-triggers are skipped. It is the table that *selected* cycle 1, so once a genuine cycle-1 trigger comment exists on the PR, that comment decides and no row here overrides it. Reach for a row when a review arrived by some other route, or when every trigger comment on the PR is a non-blocking re-trigger outside the cheapest band.

**This table carries no boundary numbers of its own.** Its rows are the rows of the first-review table in `validate-issue` step 6, which owns every boundary; read the band there and take the matching row here. The triggers below are the *re-review* forms, which deviate from that table's first-review triggers on purpose.

| Owner's first-review row | Claude fallback trigger | Codex fallback trigger |
|---|---|---|
| the sonnet row | `@claude sonnet review` | `@codex luna review` |
| the standard-trigger row | `@claude review` | `@codex review` |
| the opus row | `@claude opus review`, but only when no `@claude opus review` comment already exists on the PR; `@claude review` otherwise | `@codex review` |
| the fable row, or no score | `@claude opus review`, but only when no `@claude opus review` comment already exists on the PR; `@claude review` otherwise — a first review already ran by some other route, so never open a Fable cycle on a re-review | `@codex review` at every cycle |

**Why the two heavy rows are guarded.** Fable and Opus each review one cycle only. A row that handed out a fresh Opus cycle every time the fallback was reached would let a PR that already spent its Opus rung restart at Opus indefinitely, which is the cost the ladder exists to bound. The guard reuses the rung-counting rule below: scan the PR for an `@claude opus review` comment before you post one.

Codex exposes one flagship, so every row above the sonnet row collapses onto its
bare trigger, and the heaviest row stays there — it never reaches `luna`. Only the
sonnet row and the non-blocking re-review use the cheap shorthand.

When a fallback row does apply, read the score from the `[C<score>, …]` bracket in the PR title, then from the `[C<score>]` prefix of the issue the PR closes. A stamped `PR review:` line carries a trigger and no score, so it is not a score source — it selects the reviewer directly, which is the cycle-1 rule above. `validate-issue` step 6 owns the authoritative band table.

### After a Fable or an Opus first review — the step-down ladder (Claude cycles only)

This ladder is Claude's. Its rungs are `@claude` triggers, which section 1 forbids on a Codex cycle, and Codex exposes one flagship with no tier to step down from — on Codex the cycle-1 trigger repeats instead, per the mapping above.

**Every reviewer above the standard trigger runs one blocking cycle only.** Each blocking re-review steps down one rung. The ladder floor is `@claude review`, which repeats for every blocking cycle after it. So whenever a Claude cycle 1 ran on Fable or on Opus — selected by the owner table's row for that band, or by a stamped `PR review:` line naming Fable or Opus at any score — the reviewer steps down:

| Cycle-1 reviewer | Blocking cycle 2 | Blocking cycle 3 and after |
|---|---|---|
| `@claude fable review effort:high` | `@claude opus review` | `@claude review` |
| `@claude opus review` | `@claude review` | `@claude review` |

Neither the fable trigger nor the opus trigger is ever repeated on a blocking re-review.

The ladder **stops at `@claude review`**. It never steps down to sonnet, however many cycles it takes — a change that earned a capable first review keeps one to the end. **Sonnet sits below the floor and takes no rung:** a cycle 1 on `@claude sonnet review` repeats that trigger for every blocking re-review, and the ladder never steps *up* from it. A cycle 1 on the standard `@claude review` is already at the floor and repeats too.

Decide which rung you are on from the PR's own trigger comments, reading them in chronological order from that **earliest** cycle-1 comment: after a fable cycle 1, a prior `@claude opus review` posted since means the next rung is `@claude review`; after an opus cycle 1, the single rung is `@claude review` for the first blocking re-review and every one after it. Ignore any `@claude sonnet review` comment while counting rungs — that is a non-blocking re-trigger, which consumes no rung and is never a ladder position.

### Non-blocking only

When the pass addressed only optional improvements or follow-ups, the PR was already in good shape. Route to the cheap model shorthand — `@claude sonnet review` on Claude, `@codex luna review` on Codex. The band does not apply, and a non-blocking cycle consumes no rung.

## 3. Post it as its own comment

Post a **separate** comment so the bot triggers cleanly on its own line. Never bundle the trigger into the disposition comment — a trigger buried in a longer body does not fire.

```bash
# whatever ran cycle 1, repeated when it is at or below the ladder floor — or, after a
# fable or an opus cycle 1, the next rung down; a fallback row only when the PR carries
# no trigger comment at all
gh pr comment <N> --body "@claude review"
gh pr comment <N> --body "@claude opus review"

# any pass that addressed only non-blocking items, in any band
gh pr comment <N> --body "@claude sonnet review"

# the same cases when this cycle selected Codex — every band above the cheapest collapses
# onto the bare trigger; the cheapest band and the non-blocking pass keep the shorthand
gh pr comment <N> --body "@codex review"
gh pr comment <N> --body "@codex luna review"
```

If this repo uses a different review trigger phrase or model-shorthand syntax, match it — check the repo's `.github/workflows/claude.yml` or `codex.yml` for how it resolves the shorthand, and recent PR comments for the convention.

A trigger comment is a one-line mention, not authored content — no footer.
