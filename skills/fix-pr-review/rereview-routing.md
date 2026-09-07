# Re-review routing

Read for step 10. This reference owns bot selection, blocking re-review routing, and growth measurement. `validate-issue` step 6 owns the first-review table and all score boundaries.

## 1. Select and verify the bot

Default to `@claude`. Select `@codex` only through an explicit user instruction, caller argument, literal `codex` selector, or invocation from an `@codex` comment. The existence of `codex.yml` selects nothing. Keep the selected bot throughout the cycle.

Read the selected workflow's trigger parser or use verified integration evidence. Confirm that the exact phrase requests a review; an unsupported model shorthand can enter a write route. If the integration is absent or cannot be established, report re-review unavailable. Do not install workflows or switch bots as a side effect.

## 2. Classify the pass

Use the entire original addressed set. Needs Fixing, Requires Human Review, inline defect claims, and CI failures are blocking for routing even when refuted. Optional improvements and follow-ups are non-blocking. A blocked or incompletely published pass posts no trigger.

**Non-blocking only:** `@claude sonnet review` or `@codex luna review`, consuming no rung.

**Bare LGTM, merge only**: step 7 decides whether the hand-resolved diff changes behavior. A behavior change or doubt uses the same cheap shorthand; prose only posts none. File type alone never decides. This is also the decision used by `milestone-workflow` before merging.

**Blocking** → use the ladder below, keyed to the reviewer that actually ran cycle 1.

### Establish cycle 1

Read the EARLIEST one-line review trigger comment for the selected bot, skipping every cheap non-blocking re-trigger unless that cheap phrase was the intended first-review route. Establish that from the linked issue's stamped `PR review:` line first, otherwise the owner's first-review table and PR/issue score. Do not treat a later step-down trigger as cycle 1. Where available, verify the trigger against the resulting review or workflow run; a known failed dispatch is not a completed reviewer cycle.

Preserve an explicit effort suffix where the rules repeat a trigger. Do not infer a historical reviewer from a current score when a verified trigger or review record establishes it. If the history remains ambiguous, report the uncertainty and use the fallback rule without claiming an exact cycle count.

### Claude ladder

Each reviewer above the standard trigger runs one blocking cycle only. Blocking re-reviews step down as follows:

| Cycle-1 trigger | Next blocking review | Later blocking reviews |
|---|---|---|
| `@claude fable review effort:high` | `@claude opus review effort:high` | `@claude review` |
| `@claude opus review effort:high` | `@claude review` | `@claude review` |
| `@claude review` or `@claude sonnet review` | Repeat cycle-1 trigger | Repeat cycle-1 trigger |

The ladder never steps down to sonnet. Ignore cheap non-blocking triggers when counting rungs. An Opus trigger with any effort after a Fable first cycle consumes the Opus rung once its review ran. Keep a still-pending request instead of posting a second one. A stamped `haiku` maps to `sonnet`; the Claude workflow admits `opus`, `sonnet`, and `fable` as review shorthands.

### Codex routing

Codex has no ladder. Repeat its cycle-1 trigger for each blocking re-review. Map stamped `sonnet`/`haiku` to `@codex luna review`, and `opus`/`fable` to `@codex review`, preserving stamped effort. Never post a Claude model shorthand on Codex.

### Fallback table

The fallback table applies ONLY when the PR carries no cycle-1 trigger comment that can be established after the skip. A verified first reviewer takes precedence. Read an available stamp before the score; map it as the corresponding first reviewer, then apply the re-review rule. Otherwise read the PR title score, then the closed issue's score, and use the row in the owner table.

| Owner's first-review row | Claude fallback | Codex fallback |
|---|---|---|
| Sonnet | `@claude sonnet review` | `@codex luna review` |
| Standard | `@claude review` | `@codex review` |
| Opus, Fable, or unknown | `@claude opus review effort:high` if no prior Opus review is established; otherwise `@claude review` | `@codex review` |

Never start a Fable review on a re-review pass. Report an inferred route as inferred.

## 3. Publish once

Confirm the open PR still has the verified head and the disposition covers the collected sources. Check for a matching trigger already posted after that disposition, including on resumed runs. Post only when missing, as a separate comment whose entire body is the verified trigger line; the trigger has no footer because its parser requires that form.

Record the returned URL, ID, and timestamp. If the write result is uncertain, read comments to establish whether it succeeded before retrying. Do not wait for the review here. Give the loop caller the confirmed trigger status so it counts only new requests.

## Growth check

Read persisted PR history so a resumed pass uses the same inputs:

- **`<first-push-sha>`:** prefer a recorded first-review head or a verified initial push event. Otherwise use the newest PR commit dated at or before the first trigger, or PR creation if there was no trigger, as an explicitly estimated baseline. Commit time is not push time. If that commit is absent or history was rewritten, report the missing baseline.
- **Measurement:** for current HEAD and the baseline separately, find their merge base with the fetched base-branch tip and sum additions plus deletions with `git diff --numstat <merge-base> <head>`. Base merges must not count as PR growth. Binary changes have no line count; disclose them separately. A zero baseline has an undefined ratio. Never fabricate a denominator or use the direct baseline-to-HEAD diff as PR growth.
- **`pr_cycle_count`:** count chronological review trigger comments under the cycle-1 rules, excluding cheap non-blocking re-triggers, plus one if feedback predates every trigger. A cheap first-review route still counts its blocking requests. Use linked dispositions to distinguish identical cheap phrases; report ambiguity when the evidence is missing. Never substitute the loop's in-memory `review_count`.

---
Updated with LLM: GPT-6 | high | Harness: skill-creator
