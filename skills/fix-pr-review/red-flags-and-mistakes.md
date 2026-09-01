# Validation discipline and red flags

Reference for SKILL.md step 4.

## Validation discipline

- **Read the whole body, beyond the cited line.** A name states intent; open the function and trace the conditional fully before agreeing.
- **Prove negatives by reading the path.** "X is never validated / never freed / not awaited" — confirm the absence across *all* relevant paths; the behavior may be produced elsewhere.
- **A suggested fix is its own claim.** Verify the remedy is correct for this codebase; derive the right fix from first principles when the suggested one is suboptimal, and never blind-apply one that touches money, data, security, or auto-protective logic.
- **Safety carve-out** — money, data integrity, security, auto-protective mechanisms: fix or escalate even at low confidence; never drop as Refuted without code proof it is a non-issue.
- **CI Failures**: read the failing step's actual error; the job name alone is no evidence. ✅ Confirmed when it traces to this PR's diff (reproduce the failing command locally where feasible). ❌ Refuted only with evidence — pre-existing on the base branch (CI history, or reproduce on base) or a one-off infra flake; never patch around it, and flag it to the user.
- **`Requires Human Review`**: verify the **Recommended proposed solution:** like any remedy, implement the chosen solution, and document the decision plus rejected alternatives. Never pause, punt, or guess blindly.

## Red flags — STOP

| Situation | Action |
|-----------|--------|
| Finding cites a line that no longer matches current code | Re-validate against current `file:line`; an already-fixed defect is Refuted with the reason |
| All findings refuted | Still post the disposition with the rebuttals and request the re-review — never silently no-op |
| A failing test looks wrong and no checkable ground says so | Leave it and fix the code — your reading is not a ground; when the correct fix still cannot pass, stop before step 8 and report it |
| Conflict sides irreconcilable in intent, especially safety-class code | Stop and surface it to the user instead of guessing |

## Common mistakes

- **Blind-implementing the review** — performative agreement ships regressions; validate first, every time.
- **Delegating validation** — steps 3–4 always run inline; dispatch only steps 6–11, as one unit; one review never splits across several subagents.
- **Addressing only the latest review when several landed** — every review newer than your last disposition and every unresolved thread gets addressed.
