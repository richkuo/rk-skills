# Re-review routing (fix-pr-review step 10)

The complete routing procedure for the re-review trigger fix-pr-review posts after it pushes its fixes. Read it whole before posting the trigger — guessing a phrase from memory posts a trigger no Action answers.

## 1. Pick the bot, then the model

The re-review goes to the review bot of the **current cycle**, and the default is `@claude`. Use `@codex` only when this cycle selected Codex — one of: the user said so ("review with Codex", "use Codex"), a caller argument named it (`reviewBot: codex`), the invocation included the literal `codex` argument (the skill's Input section), or this run itself was started by an `@codex` GitHub comment. A `codex.yml` merely existing in the repo does **not** select Codex. Once a cycle has a bot, every re-review in that cycle stays on it — never switch mid-cycle.

## 2. Route by blocking vs non-blocking

Route by whether the set you addressed contained **any blocking finding** (noted in step 1). Never route by the newest review's verdict alone: with multiple reviewers, a later `LGTM` from one does not erase another's `Needs Updates`.

A finding is blocking when it is a `Needs Fixing` or `Requires Human Review` item from any review, an inline thread that validated as a real defect, or any CI Failure finding from step 2 — **counted regardless of its verdict**, whether you fixed it or refuted it as pre-existing or flaky, exactly as the reviewer clauses count regardless of verdict.

A CI failure you refuted still counts as blocking on purpose: if that refutation was wrong, the heavier re-review is what catches the real regression you dismissed.

### Blocking — route on the reviewer that ran cycle 1

**The step-down is keyed to the reviewer that actually ran cycle 1.** The score band does not decide it. Before you read a band row, identify the cycle-1 reviewer: list the PR's comments in chronological order and take the **EARLIEST** one whose entire body is an `@<bot> … review` trigger line. That comment is cycle 1. Never take a later trigger comment for it — a step-down rung and a cheap non-blocking re-trigger are both later trigger comments, so reading the newest one would let a `@claude sonnet review` posted by a non-blocking cycle 2 pass as the cycle-1 reviewer and send a C90 PR's blocking findings to the cheapest tier. Then: if cycle 1 ran on Fable — selected by the C81+ row below, or by a stamped `PR review:` line naming Fable at any score, which the read order puts first — take the step-down ladder instead of the band row. A first review on any other model keeps its own trigger for every blocking re-review, whatever its band. So a C55 PR whose issue stamps `@claude fable review effort:high` takes the ladder rather than the C41–C80 row, and a C10 PR stamped `@claude opus review` keeps Opus for every blocking re-review.

On a Claude cycle a stamped `haiku` posts `@claude sonnet review`: `claude.yml` resolves only `opus`, `sonnet` and `fable`, and an unresolved shorthand becomes the route keyword, which sends a trusted-author PR to the write-capable fix-pr job instead of the reviewer.

**On a Codex cycle the same stamp rule applies in Codex's own vocabulary.** Never post a `@claude` rung on a Codex cycle, and never discard the stamp back to the band. Map the stamped model onto the Codex column: a stamped `sonnet` or `haiku` becomes `@codex luna review`, and a stamped `opus` or `fable` becomes the bare `@codex review`, each followed by `effort:<tier>` when the stamped line carries one. Codex exposes one flagship and has no Fable tier, so it has no step-down ladder at all — its cycle-1 trigger simply repeats for every blocking re-review. A C60 Codex PR stamped `@claude sonnet review` therefore stays on `@codex luna review` at every cycle, and an unstamped C90 one keeps the bare `@codex review` and never reaches `luna`.

**The band table below applies ONLY when the PR carries no `@<bot> … review` trigger comment at all.** It is the table that *selected* cycle 1, so once a cycle-1 trigger comment exists on the PR, that comment decides and no row here overrides it. Reach for a row only when a review arrived by some other route and the PR has no trigger comment to read.

| Band | Claude trigger | Codex trigger |
|---|---|---|
| C0–C10 | `@claude sonnet review` | `@codex luna review` |
| C11–C40 | `@claude review` | `@codex review` |
| C41–C80 | `@claude opus review` | `@codex review` |
| C81+, or no score | `@claude opus review` — a first review already ran by some other route, so never open a Fable cycle on a re-review | `@codex review` at every cycle |

Codex exposes one flagship, so all three bands above C10 collapse onto its bare
trigger, and the C81+ ladder stays there — it never reaches `luna`. Only the
C0–C10 band and the non-blocking re-review use the cheap shorthand.

When a band row does apply, read the score from the `[C<score>, …]` bracket in the PR title, then from the `[C<score>]` prefix of the issue the PR closes. A stamped `PR review:` line carries a trigger and no score, so it is not a score source — it selects the reviewer directly, which is the cycle-1 rule above. `validate-issue` step 6 owns the authoritative band table.

### After a Fable first review — the step-down ladder (Claude cycles only)

This ladder is Claude's. Its rungs are `@claude` triggers, which section 1 forbids on a Codex cycle, and Codex has no Fable tier to step down from — on Codex the cycle-1 trigger repeats instead, per the mapping above.

Fable reviews the first cycle only, so whenever a Claude cycle 1 ran on Fable — selected by the C81+ first-review row or by a stamp at any score — the reviewer steps down one rung per blocking re-review. Cycle 1 on any other model takes none of these rungs; it repeats its own trigger:

| Blocking cycle | Trigger |
|---|---|
| 1 (the first review, not this skill's job) | `@claude fable review effort:high` |
| 2 | `@claude opus review` |
| 3 and after | `@claude review` |

The ladder **stops at `@claude review`**. It never steps down to sonnet, however many cycles it takes — a change that earned a Fable first review keeps a capable reviewer to the end.

Decide which rung you are on from the PR's own trigger comments, reading them in chronological order from that **earliest** `@claude fable review` comment: a prior `@claude opus review` posted after it means the next rung is `@claude review`. Ignore any `@claude sonnet review` comment while counting rungs — that is a non-blocking re-trigger, which consumes no rung and is never a ladder position.

### Non-blocking only

When the pass addressed only optional improvements or follow-ups, the PR was already in good shape. Route to the cheap model shorthand — `@claude sonnet review` on Claude, `@codex luna review` on Codex. The band does not apply, and a non-blocking cycle consumes no rung.

## 3. Post it as its own comment

Post a **separate** comment so the bot triggers cleanly on its own line. Never bundle the trigger into the disposition comment — a trigger buried in a longer body does not fire.

```bash
# whatever ran cycle 1, repeated — or, after a fable cycle 1, the next rung down;
# a band row only when the PR carries no trigger comment at all
gh pr comment <N> --body "@claude review"
gh pr comment <N> --body "@claude opus review"

# any pass that addressed only non-blocking items, in any band
gh pr comment <N> --body "@claude sonnet review"

# the same cases when this cycle selected Codex — every band above C10 collapses onto the
# bare trigger; the C0–C10 band and the non-blocking pass keep the cheap shorthand
gh pr comment <N> --body "@codex review"
gh pr comment <N> --body "@codex luna review"
```

If this repo uses a different review trigger phrase or model-shorthand syntax, match it — check the repo's `.github/workflows/claude.yml` or `codex.yml` for how it resolves the shorthand, and recent PR comments for the convention.

A trigger comment is a one-line mention, not authored content — no footer.
