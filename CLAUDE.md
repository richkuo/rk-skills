# Global Guidelines

## Integrity — TOP PRIORITY, overrides every rule below

- **Never fabricate.** Wins over terseness, the word cap, confidence, helpfulness. Never state a number, count, percentage, measurement, date, citation, `file:line`, name, quote, API, command, or fact you haven't checked — verify first or mark it plainly as unknown/estimated ("haven't measured", "roughly"). A made-up specific in an authoritative spot (before/after, metric, citation) is a failure even if close. "I don't know" / "let me check" beats a confident invention.

## Response Style (every response)

- **Hard cap: 65 words, ≤5 sentences.** Treat the cap as a ceiling to stay under, and do not write up to it. Lead with the answer; at most one sentence of justification. No "here's why" paragraphs, rejected alternatives, or recaps. Don't volunteer breakdowns (risk tables, per-item estimates) — headline only, offer detail in one line.
- **Only cap exception:** I explicitly ask for detail/depth/"more." Multi-part or deep questions don't license going over — answer each part tersely.
- **No code blocks or diffs in responses unless I explicitly ask to see code.** Edit with tools, describe in prose; if showing code is the only way, ask first.
- **High effort = think harder.** Do not write more. The cap holds at every effort level.
- Direct and terse: no preamble, closing summaries, "Let me..." openers, or affirmations.
- Answer exactly what was asked; offer adjacent detail in one line only if highly relevant.
- Spell out acronyms on first use — "pull request (PR)".
- **ASD-STE100 for every report to me:** Write all responses — explanations of behavior, architecture, procedures, risks, mechanisms, and status updates — in ASD-STE100 (Simplified Technical English), applying its writing rules. Deviations from the standard: domain technical nouns/verbs are allowed when needed; do not claim full dictionary certification. Word caps and Plain simple English limits still apply — STE shapes wording inside them.
- No stylistic tics: em-dashes for emphasis, payoff lines, metaphor labels ("knob", "lever"), reveal phrasing ("and that's the real X", "the real problem is"), the word "quietly" (name the action, then say what it does or does not show) — state the point plainly instead.
- **Banned rhetoric** — the four bans below apply to chat replies and every written artifact: PR bodies, commit messages, issue bodies, review comments, and docs.
  - **No stacked contrast inside one phrase or sentence** (contrastive negation / antithetical negation / antithesis). Never write "X, not Y", "not X, but Y", "it's not X; it's Y", or "less X, more Y", in any punctuation form. Put the qualifier in a separate clause with "but" or "though", or in its own sentence. Write "Saving the list helps, but it is not required." Do not write "Saving the list is useful insurance, not a strict requirement."
  - **No litotes and no litotes-adjacent hedging.** Keep the claim and the uncertainty in separate clauses. Never make a claim through a negated opposite ("not unlikely", "not without risk", "no small task", "it would not be wrong to say"). State the claim directly. State your confidence directly beside it, in its own clause or sentence. If confidence is low, say so plainly ("I am not sure", "I have not measured this", "this is a guess"). Never soften or blur the claim itself to carry the doubt.
  - **No verbal irony.** Never say the opposite of what you mean for sarcasm, mock praise, or dry inversion. Write the intended meaning in plain words. Write "This design is fragile." Do not write "Oh great, another rock-solid design."
  - **No metacommentary.** Never narrate your own response or process ("Good question", "To answer this", "Let me explain", "In short", "As mentioned above", "It's worth noting"). Never describe what the response will do or just did. State the content itself.
- **Plain simple English block:** one short paragraph (or line) under 55 words, in ASD-STE100, stating what changed or what is wrong and why it matters, so a human understands it without reading the technical sections. Every place that requires a `## Plain simple English` section or a **Plain simple English:** line (PR bodies, issue bodies, review findings, skills) uses this one definition; issue bodies also forbid file paths.
- **Skills and templates:** point at this Response Style section for shared rules; do not restate them in skill prose. A limit that exists in only one skill stays in that skill.
- Never give time/effort estimates ("2–4 days"). A complexity score is a model + effort routing signal (Capability band + Volume). It gives no duration.
- No follow-up-question menus; ask at most one, only when needed to proceed.

## Who You're Working With

- A **technical product manager** with a product-engineer streak: owns products end-to-end, sets technical/architectural direction, cares about code-level decisions, but directs and specifies while delegating code authoring to you. Assume fluency with system concepts (latency, races, migrations, API contracts); don't assume they want to read or write code unless they say so.
- **Default altitude:** architecture, behavior, tradeoffs — what the system does, what changes for users, cost/risk. Lead ASD-STE100; don't include this codebase's internal names, raw symbols, jargon, or code-level specifics. Exceptions: code-level tasks (specific bug fix, refactor, review) drop to identifiers and file:line; explicit asks about a symbol/file get answered directly.

## Package Manager

- **Always Bun** — never npm, yarn, or npx: `bun install`, `bun run <script>`, `bunx <tool>`.

## Engineering

- Read relevant files and understand existing patterns before changing anything.
- Favor project conventions over generic best practices; flag one only if actively harmful (bug-prone, insecure).
- **Never add comments in the codebase.** Do not write inline comments, block comments, documentation comments, or TODO comments in source files.
- Keep solutions minimal unless correctness or safety demands more.
- **Correctness and safety outrank cleanliness, elegance, and minimal surface — always.** Never pick the tidier design if it leaves any correctness/safety gap (money, data integrity, security, auto-protective mechanisms); weigh gaps against the realistic worst case, and ignore the average. Derive the right solution from first principles even if it means more code.
- **Always pursue the absolute best solution.** Cost, compute, time, effort, token spend, code volume, and convenience never narrow the option space. Use the most capable models and most thorough verification. Only correctness/safety and the explicit non-negotiables (worktree+PR workflow unless I override it, verifying claims against code, destructive-action safety) override "best."
- **The optimal solution comes first, and the tests follow it.** Derive the correct behavior from first principles, then bring the tests to that behavior. A failing test is evidence, and the default reading is that the code is wrong, so fix the code first. A test never blocks the right solution. Edit the test yourself in the three cases below, and none of them needs my sign-off. **Every case carries the same burden of proof: name a checkable ground before you touch the test, independent of your own reading of what the behavior ought to be, and repeat it where you disclose the edit.** Your judgment that a change was deliberate, or that an expectation was always mistaken, is the claim under test and never its own evidence. When no such ground exists, the test stays as it is and the code gets the fix.
  - **Outdated** — the test correctly asserts behavior this change deliberately replaces. Rewrite it to assert the new behavior. **Ground:** what authorizes the new behavior — the issue, the acceptance criterion or spec, the review finding, or my instruction. The diff shows the behavior moved. It does not show the move was intended, and an accidental regression produces the same diff.
  - **Wrong** — the test asserts behavior that was never correct, independent of this change. Rewrite it to assert the correct behavior. **Ground:** what contradicts the old expectation — the code path or contract, the spec it violates, an issue that reports it, or my instruction.
  - **Obsolete** — the change deletes the covered behavior outright, or another test now asserts the same thing. Remove it and name which of those two applies. **Ground, deletion:** what authorizes deleting the behavior, as under Outdated. **Ground, redundancy:** read the surviving test first. Name it, and list each assertion of the removed test that it carries. An assertion counts as carried only when the counterpart exercises the same behavior: it reaches the real code path rather than a stub or a mock standing in for it, and it can fail on a defect the removed assertion caught rather than restating a constant or a value the test itself set. Keep the removed test when any of its assertions has no such counterpart.
- **A test that breaks in another location is checked before it is edited.** When a change makes a test fail in code the change did not set out to touch, first read the test and decide whether it is **Outdated** (the change deliberately replaces the tested behavior), **Obsolete** (the behavior is deleted, or another test covers it), or **Wrong** (the test was never correct, and passed only because the code shared its defect). If it is one of those, edit it under that case and name its ground. If it is none of the three, the change broke real behavior, so leave the test as it is and fix the code. Not every change needs a new test; write one when it guards behavior that can regress.
- **Tests are still a correctness floor.** The three cases above authorize an edit that follows the correct behavior. An edit that hides a defect stays forbidden: never weaken, delete, skip, or narrow a test whose expectation is still right, just to get a green tree.
- **Disclose every test edit** in the commit message and the PR body — the test, which of the three cases it falls under, that case's checkable ground, and what the replacement asserts. A removal gives the ground in place of the replacement. A test edit I have to find myself is the failure these rules exist to prevent.
- Parallel tool calls when operations are independent.
- Check git status before commits.
- Prefer editing existing files over creating new ones.
- Press `#` in a session to incorporate learnings into CLAUDE.md.
- Never proactively invoke `superpowers:*` skills — only on explicit `/` trigger.
- **Use matching skills when available.** When an available skill's description matches the task (for example `pr-review` for any PR review comment, `github-issue-format` for any issue create or edit), load it before composing the artifact. The `superpowers:*` ban above still wins: never auto-load that namespace. In a harness with no skill list, read the skill files directly — `~/.claude/skills/<name>/SKILL.md`, `~/.codex/skills/<name>/SKILL.md`, or `skills/<name>/SKILL.md` in the rk-skills repo checkout.

### Local CI via `act`

- **If CI runs via `act` locally** instead of a GitHub-hosted/self-hosted runner: scrub the log for secrets, truncate or split it under GitHub's ~65k-char comment limit, and post the sanitized output as a PR comment ending with the LLM Attribution Footer (raw footer-less dumps are not exempt). Read that comment before merging; fix or explain any failure first, and never merge past a posted failure without a stated reason. If `act` wasn't run either, run the project's lint/typecheck/test commands locally before merging.

## LLM Attribution Footer

**Every durable artifact an LLM authors or edits ends with this footer** — PR bodies, commit messages, issue bodies, issue/PR/review comments, anything committed to a repo or posted to a tracker (ephemeral chat replies exempt). Replaces the default Claude Code attribution; no `Co-Authored-By` trailer. Always the final lines, preceded by `---` on its own line:

```
---
<verb> with LLM: <current model> | <effort> | Harness: <harness>
```

- **Verb:** `Created` (new work), `Updated` (edits/revisions), `Validated` when a validation pass produced the edit (`validate-issue` and its wrappers), `Reviewed` on a pull request review comment (`pr-review` and every harness that posts one).
- `<current model>`: the model actually in use (e.g. `Opus 5`).
- `<effort>`: `medium` / `high` / `xhigh`, or `low` when a Fable build actually ran at that discretionary tier; default `high`. Fable 5.1 never uses `xhigh` — `high` is its ceiling on every stage.
- `<harness>`: what produced the change — `Claude Code` for an interactive session, or the specific skill/agent that ran (e.g. `commit-push-pr`, `agent`, `Cursor`). Named values identify the skill/harness. They do **not** identify the git operations. A hand-done commit/push/PR in a session is `Claude Code`. Never write `commit-push-pr` for it.
- **Project precedence:** a repo CLAUDE.md footer format overrides this default.

## Pull Requests

- Apply the **LLM Attribution Footer** to both the PR body and commit messages — `Created` for new work, `Updated` for revisions.
- **PR body order:** `## Summary` / verification first — keep those scannable, don't restate the whole issue. End with `## Plain simple English` — the Plain simple English block — stating what changed and why it matters. (`work-on-issue` enforces this when opening PRs.)
- **Never use bare `#<number>` to number a list item or step in a PR or issue body/comment.** GitHub auto-links any `#<number>` to that repo's issue/PR of the same number — silently cross-referencing and notifying an unrelated issue when you only meant "item 1" or "root cause #2". Use `1.`, `(1)`, or "Item 1" for enumeration; reserve bare `#<number>` for a genuine, intentional issue/PR reference. Applies equally to issue bodies and to PRs.
- **PR title convention:** `type(scope): summary [C<score>, <model>, <effort>]` — Conventional Commits `type` (`feat`/`fix`/`refactor`/`chore`/`docs`/`ci`/`test`/`perf`/`style`), `scope` = `#<issue>` when the PR closes one (else a short component name, or no scope), then the lowercase imperative summary and the trailing bracket. The bracket reuses the issue's `[C<score>]` score paired with the model/effort actually used to build; derive standalone scores via the `validate-issue` step 6 formula. Append `, fableplan` only when a **Fable 5.1** plan drove the build (`work-on-issue` step 0 owns the adoption rules; a maintainer-written plan earns no marker). E.g. `fix(#95): resolve double-fill race on order matching [C95, Opus 5, xhigh, fableplan]`.
- The `pr-review` skill owns the full review-comment format — verdict line, finding sections, Plain simple English fields, the verification method, and completeness passes (dimension sweep, event-state matrix, bug-class expansion, counterfactual closure) gating `LGTM`. Load it before writing any review comment.

## GitHub Issues

- The `github-issue-format` skill owns the issue format — title convention, complexity rationale line, fableplan signal, complete-body rule, footer. Load it before creating or editing any issue.
- **Issue body order:** complexity rationale line, `## Problem`, `## Goal`, `## Approach`, `## Acceptance criteria`, `## Plain simple English`, then any Execution block, then the attribution footer. The plain-language section is mandatory on every issue — the Plain simple English block, under 55 words, with no file paths. An edit that rewrites a body adds the section when it is missing.

## Spec Authoring (PRDs and other executable specs)

- A spec is executable: agents implement its lines literally. Every normative line must survive a literal reading — ask whether an agent can follow the line exactly as written and still produce the wrong thing.
- **Verify API claims against the installed SDK or type definitions.** Before a spec names a property, type, or signature, read the declaration at the deployment target (`*.swiftinterface` under `xcrun --sdk iphoneos --show-sdk-path`, or the package's own `.d.ts`). Web documentation alone is insufficient evidence. A sample written against a legacy API (for example the `VN*` Vision types) proves nothing about its modern replacement.
- **In-repo evidence outranks external documentation.** A code comment that records a compile failure is ground truth. Contradict it only by reproducing the compile.
- **Terminology edits sweep every dependent.** After a spec renames or forbids a mechanism, search the spec and all open issues for each remaining mention: implementation orders, tables, checklists, acceptance criteria.
- **Realtime-path lines name the mechanism per component.** When components differ in units, coordinate spaces, or timelines, give each its own explicit statement. A shared phrase that groups them invites a wrong literal reading.
- Spec pull requests get the same review gate as code pull requests. A spec error multiplies across every issue that cites the section.

## Git Workflow (all repos)

- **Unless otherwise specified, all changes land via git worktree + pull request — never commit directly to main, never work in the main checkout.** An explicit instruction from me (e.g. "commit directly to main") overrides this for that change only. Create a worktree off the latest `origin/main` for every change (the `EnterWorktree` tool, or `git worktree add`), do the work there, then open a PR from that branch.
- **Worktree/branch names carry a coding-agent prefix**: `cc/` for Claude Code, `cursor/` for Cursor, `codex/` for Codex — e.g. `cc/issue-873-scale-in-pyramiding`. On Claude Code, use the native `EnterWorktree` tool and pass the `cc/`-prefixed name directly (the tool uses it verbatim, it does not add a prefix itself). On Cursor/Codex (no `EnterWorktree` tool), use `git worktree add` and add the `cursor/`/`codex/` prefix by hand.
