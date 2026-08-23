# Re-review routing (fix-pr-review step 10)

The complete routing procedure for the re-review trigger fix-pr-review posts after it pushes its fixes. Read it whole before posting the trigger — guessing a phrase from memory posts a trigger no Action answers.

## 1. Pick the bot, then the model

The re-review goes to the review bot of the **current cycle**, and the default is `@claude`. Use `@codex` only when this cycle selected Codex — one of: the user said so ("review with Codex", "use Codex"), a caller argument named it (`reviewBot: codex`), the invocation included the literal `codex` argument (the skill's Input section), or this run itself was started by an `@codex` GitHub comment. A `codex.yml` merely existing in the repo does **not** select Codex. Once a cycle has a bot, every re-review in that cycle stays on it — never switch mid-cycle.

## 2. Route by blocking vs non-blocking

Route by whether the set you addressed contained **any blocking finding** (noted in step 1). Never route by the newest review's verdict alone: with multiple reviewers, a later `LGTM` from one does not erase another's `Needs Updates`.

A finding is blocking when it is a `Needs Fixing` or `Requires Human Review` item from any review, an inline thread that validated as a real defect, or any CI Failure finding from step 2 — **counted regardless of its verdict**, whether you fixed it or refuted it as pre-existing or flaky, exactly as the reviewer clauses count regardless of verdict.

A CI failure you refuted still counts as blocking on purpose: if that refutation was wrong, the heavier re-review is what catches the real regression you dismissed.

### Blocking — route on the PR's complexity band

| Band | Claude trigger | Codex trigger |
|---|---|---|
| C0–C10 | `@claude sonnet review` | `@codex luna review` |
| C11–C40 | `@claude review` | `@codex review` |
| C41–C80 | `@claude opus review` | `@codex review` |
| C81+, or no score | Step down one rung per blocking cycle (below) | `@codex review` at every cycle |

Codex exposes one flagship, so all three bands above C10 collapse onto its bare
trigger, and the C81+ ladder stays there — it never reaches `luna`. Only the
C0–C10 band and the non-blocking re-review use the cheap shorthand.

Read the score with fix-pr-review-loop step 1's source order: a stamped `PR review:` line, then the PR title bracket, then the closed issue's `[C<score>]` prefix. `validate-issue` step 6 owns the authoritative table.

A first review in the C0–C10, C11–C40, or C41–C80 band keeps its own trigger for every blocking re-review. Only the C81+ band steps down.

### C81+ — the step-down ladder

Fable reviews the first cycle only, so the reviewer steps down one rung per blocking re-review:

| Blocking cycle | Trigger |
|---|---|
| 1 (the first review, not this skill's job) | `@claude fable review effort:high` |
| 2 | `@claude opus review` |
| 3 and after | `@claude review` |

The ladder **stops at `@claude review`**. A C81+ PR never steps down to sonnet, however many cycles it takes — a high-complexity change keeps a capable reviewer to the end.

Decide which rung you are on from the PR's own trigger comments: a prior `@claude opus review` posted after the `@claude fable review` one means the next rung is `@claude review`.

### Non-blocking only

When the pass addressed only optional improvements or follow-ups, the PR was already in good shape. Route to the cheap model shorthand — `@claude sonnet review` on Claude, `@codex luna review` on Codex. The band does not apply, and a non-blocking cycle consumes no rung.

## 3. Post it as its own comment

Post a **separate** comment so the bot triggers cleanly on its own line. Never bundle the trigger into the disposition comment — a trigger buried in a longer body does not fire.

```bash
# blocking, C11–C40 — and every blocking re-review from cycle 3 on at C81+
gh pr comment <N> --body "@claude review"

# blocking, C41–C80 — and the FIRST blocking re-review after a fable first review at C81+
gh pr comment <N> --body "@claude opus review"

# blocking, C0–C10 — and any pass that addressed only non-blocking items, in any band
gh pr comment <N> --body "@claude sonnet review"

# the same cases when this cycle selected Codex — every band above C10 collapses onto the
# bare trigger; the C0–C10 band and the non-blocking pass keep the cheap shorthand
gh pr comment <N> --body "@codex review"
gh pr comment <N> --body "@codex luna review"
```

If this repo uses a different review trigger phrase or model-shorthand syntax, match it — check the repo's `.github/workflows/claude.yml` or `codex.yml` for how it resolves the shorthand, and recent PR comments for the convention.

A trigger comment is a one-line mention, not authored content — no footer.
