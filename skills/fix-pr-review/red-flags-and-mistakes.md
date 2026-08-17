# Red Flags and Common Mistakes

Reference for SKILL.md: the stop conditions and the failure patterns this skill exists to avoid. Step numbers refer to SKILL.md.

## Red Flags — STOP

| Situation | Action |
|-----------|--------|
| Finding cites a line that no longer matches current code | Re-validate against current `file:line`; it may already be fixed — mark Refuted with the reason |
| Suggested fix would touch money/data/security/auto-protective logic | Never blind-apply; verify the remedy from first principles and implement the safest correct design |
| Reviewer's remedy is plausible but you can't confirm it's correct here | Don't implement on faith — trace it, then implement the absolute-best solution you can stand behind from the code |
| A collected "review" is actually your own prior disposition comment or an `@claude review` trigger | Skip it; act only on *actual* review feedback |
| Only some feedback channels checked (e.g. formal reviews but not inline diff threads or CI) | Fetch every review-feedback channel (step 1) and the CI snapshot (step 2) before extracting findings — inline threads are where human reviewers usually comment, and a red check is a finding too |
| CI check's `bucket` is `pending` or `skipping` | Skip it — take the `gh pr checks` snapshot as-is, don't wait or poll; a run that finishes later gets caught on the next pass |
| CI failure doesn't trace to this PR's diff (pre-existing on the base branch, or a one-off flake) | Don't fix around it — mark Refuted with the base-branch/flake evidence and flag it to the user; only fix failures this PR actually caused |
| `git status` shows dirty files you didn't edit | Stage only your fix files; leave the rest and mention them in the report |
| You're on `main` or a divergent branch, not the PR head | Check out the PR head first; never commit review fixes to the base branch |
| Branch can't fast-forward to its upstream head | Stop — the branch diverged; surface to the user, don't force anything |
| PR is from a fork | Check out with `gh pr checkout` and push to the tracked upstream — `origin` is the wrong remote for the head branch |
| All findings refuted | Still post the disposition comment with the rebuttals and request re-review — don't silently no-op |
| `Requires Human Review` item | Prefer the item's **Recommended proposed solution:** when present; still verify against the step 4 best-solution standard. Implement the chosen solution; document the decision + rejected alternatives in the comment so the user can override. Never pause for confirmation, punt the bare tradeoff, or guess blindly |
| Tests/build fail after fixes | Report the failure; don't push or claim success |
| PR is `CONFLICTING` with the base branch | Resolve via step 7 (merge base into head, reconcile intent of both sides, re-verify) — never rebase a pushed PR branch, never resolve by blanket `ours`/`theirs`, never leave an approved PR unmergeable |
| Conflict sides are irreconcilable in intent (esp. money/data/security/auto-protective code) | Stop and surface to the user instead of guessing a resolution |

## Common Mistakes

- **Blind-implementing the review.** Performative agreement ships regressions. Validate first, every time.
- **Delegating validation.** Steps 3–4 always run inline — the delegation gate keys off *validated* verdicts. Dispatch only steps 6–11 (open judgment/safety findings stay inline), and never split one review across subagents. The subagent's footers must name the model that actually ran (normally the same session model).
- **Missing inline diff comments or CI.** Fetching only formal reviews and issue comments skips the line-level threads where human reviewers usually comment, and skipping step 2 misses failing CI checks. Fetch every channel in steps 1 and 2.
- **Waiting or polling on in-progress CI.** Step 2 is a single snapshot; skip anything whose `bucket` is `pending` or `skipping` rather than blocking the run on it.
- **Patching around a pre-existing or flaky CI failure.** Verify the failure traces to this PR's diff before touching code — otherwise it's Refuted with evidence, not a fix target.
- **Addressing only the latest review when several landed.** Every review newer than your last disposition and every unresolved inline thread (any age) gets addressed.
- **Routing the re-review by the newest verdict.** A later `LGTM` from one reviewer doesn't erase another's blocking findings — route by whether any blocking finding was addressed.
- **`git add -A`.** Stage the fix files explicitly; a blanket add can commit unrelated dirty or untracked files.
- **Dropping a refuted finding silently.** Push back on the record in the comment with a code-grounded reason — that's how the reviewer learns it was wrong.
- **Committing to the base branch.** Fixes land on the PR head branch only.
- **Skipping verification before push.** Run the tests/build; report real results.
- **Pausing or punting on a judgment call.** Do the analysis the reviewer couldn't and *implement* the absolute-best solution (step 4 standard); document it for override. Don't stop to ask, don't relay the bare tradeoff, don't guess blindly.
- **Skipping the optional improvements.** `Recommended Optional` items get implemented to the same standard, not deferred.
- **Ignoring merge conflicts because "the review is addressed".** An unmergeable PR isn't done — check `mergeable` in step 0 and resolve conflicts in step 7, with the same verification and safety discipline as findings.
- **Bundling the re-review trigger into the disposition comment.** Keep `@claude review` as its own comment so the bot fires reliably.
