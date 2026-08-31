# Red Flags, Validation Discipline, and Common Mistakes

Reference for SKILL.md; step numbers refer to it.

## Validation discipline (step 4)

- **Read the body, not just the cited line.** A name states intent; open the function and trace the conditional fully before agreeing.
- **Prove negatives by reading the path.** "X is never validated / never freed / not awaited" — confirm the absence across *all* relevant paths; the behavior may be produced elsewhere.
- **A suggested fix is its own claim.** Verify the *remedy* is correct for this codebase, and derive the right fix from first principles if the suggested one is suboptimal.
- **Safety carve-out** — money, data integrity, security, auto-protective mechanisms: fix or escalate even at low confidence; never silently drop as Refuted without code proof it's a non-issue.
- **CI Failures**: read the failing step's actual error, not just the job name. ✅ Confirmed if it traces to this PR's diff (reproduce the failing command locally where feasible). ❌ Refuted only with evidence — pre-existing on the base branch (check CI history or reproduce on base) or a one-off infra flake — don't patch around it; note it in the disposition and flag it to the user.

## Red Flags — STOP

| Situation | Action |
|-----------|--------|
| Finding cites a line that no longer matches current code | Re-validate against current `file:line`; it may already be fixed — Refuted with the reason |
| Suggested fix touches money/data/security/auto-protective logic | Never blind-apply; implement the safest correct design from first principles |
| On the base branch or a divergent branch | Check out the PR head first; never commit review fixes to the base |
| All findings refuted | Still post the disposition with the rebuttals and request re-review — never silently no-op |
| `Requires Human Review` item | Verify the **Recommended proposed solution:** against the step 4 standard, implement the chosen solution, document decision + rejected alternatives. Never pause, punt, or guess blindly |
| A failing test looks wrong and no checkable ground says so | Leave it and fix the code — your reading is not a ground. Check first whether the red test refutes the finding; if the correct fix still can't pass, stop before step 8 and report the test with its `file:line` |
| PR `CONFLICTING` with the base | Resolve via step 7 (merge base into head, reconcile intent, re-verify) — never rebase a pushed branch or blanket `ours`/`theirs` |
| Conflict sides irreconcilable in intent (esp. safety-class code) | Stop and surface to the user instead of guessing |

## Common Mistakes

- **Blind-implementing the review** — performative agreement ships regressions; validate first, every time.
- **Delegating validation** — steps 3–4 always run inline; dispatch only steps 6–11, and never split one review across subagents.
- **Addressing only the latest review when several landed** — every review newer than your last disposition and every unresolved thread gets addressed.
