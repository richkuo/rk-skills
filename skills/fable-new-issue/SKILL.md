---
name: fable-new-issue
description: Use when the user wants a GitHub issue created by a Fable 5.1 subagent. Spins up a read-only subagent running on Fable 5.1 that executes the new-issue procedure (duplicate check, code grounding, approach design, complexity score) and returns a fully-composed issue draft, which the main agent spot-checks and files. Trigger on "/fable-new-issue", "fable new issue <description>", or "create this issue with fable".
---

# fable-new-issue

Delegate issue drafting to a **Fable 5.1** subagent, then file it from the main agent. The subagent only researches and composes — it never files, edits files, or posts to GitHub; the main agent handles filing and all follow-on actions.

## Input

Same as `new-issue`:
- A description of the bug/feature/task to file.
- **Nothing** — derive from the current conversation. Since the subagent can't see this conversation, the main agent first writes a faithful summary of the discussed bug/design/follow-up (with any file paths or symbols already named) to a scratchpad file and hands that path to the subagent as the source description.
- Optionally `owner/repo` or a repo path when the issue belongs elsewhere.

## Steps

### 1. Resolve the drafting procedure

Locate the `new-issue` SKILL.md the subagent must follow — prefer the project-local copy over the global one:

1. `<repo>/.claude/skills/new-issue/SKILL.md` (if it exists)
2. `~/.claude/skills/new-issue/SKILL.md`
3. Any other install location — search by name, e.g. `ls ~/.claude/plugins/*/skills/new-issue/SKILL.md` (plugin-marketplace installs live under a plugin directory, not `~/.claude/skills/`).

Record the absolute path. If none of these resolves, stop and tell the user.

If the input is conversation-derived, write the scratchpad summary now (see Input). Do NOT pre-research or pre-draft the issue yourself — the subagent owns steps 1–6 of the procedure up to (but not including) the `gh issue create` call.

### 2. Dispatch the Fable 5.1 drafting subagent

**Load the `fable-dispatch` skill before dispatching**: it owns the dispatch path and the dispatch-hygiene rules in its section 7 (read-only prompt, snapshot/diff, retry once then report). Dispatch per its ladder; on the Agent-tool path, call the Agent tool with:

- `subagent_type`: `Plan` (no Edit or Write; the section 7 prompt rule covers Bash and MCP tools)
- `model`: `fable` (the draft must come from Fable 5.1)
- `effort`: `high` unless the user asked for another tier, with the other Agent parameters per `fable-dispatch` section 2; filing waits for the draft
- `description`: `Draft issue: <short topic>`
- `prompt`: hand it everything needed to draft independently:
  - The user's description verbatim (or the scratchpad summary path), the working directory, and the target repo if not the current checkout.
  - Instruct it to **read the SKILL.md at the recorded path and execute its steps 1 through 6 exactly** — repo/duplicate check, claim grounding with `file:line` citations traced against the correct baseline, approach design, complexity score, scope check, and full body composition per the step-6 template.
  - It must STOP before filing: no `gh issue create`, no `gh issue edit`, no comments posted, no file edits. State the full read-only rule of `fable-dispatch` section 7 in the prompt. Read-only `gh` calls (`gh issue list`, `gh pr list`, `gh repo view`, `gh label list`) are expected and allowed.
  - Return as its final message: (a) any duplicate found (URL + why it matches) — in which case no draft; (b) otherwise the complete issue draft — exact title with `[C<score>]` prefix and the full body per the template — plus one line stating which baseline claims were traced against, and any unfiled follow-up candidates from the scope check.

On the shim path, run the `fable-dispatch` section 3 caller-run fetch before the snapshot and tell the subagent it is done. The `--allowedTools` list is those four `gh` reads plus the read-only `git` forms the procedure runs: `"Bash(gh repo view *)" "Bash(gh issue list *)" "Bash(gh pr list *)" "Bash(gh label list *)" "Bash(git show *)" "Bash(git grep *)" "Bash(git log *)" "Bash(git rev-parse *)"`. `--add-dir` names the directories `fable-dispatch` section 3 gives for the recorded SKILL.md path and, for a conversation-derived input, the scratchpad directory. When `REPO` is another repository, add the cross-repository clone entries and directory from that section.

When the result arrives, save the draft verbatim to a scratchpad file immediately, so it survives context summarization. Then run the section 7 snapshot diff and **record the model that served, the tier, and whether the tier was honored**, per `fable-dispatch` section 6; step 5's footer uses these values.

### 3. Duplicate gate

If the subagent reported a duplicate, stop and surface it — offer to update/comment on the existing issue instead. Nothing is filed.

### 4. Spot-check the draft

Before filing, spot-check the draft's load-bearing `file:line` citations against the code and confirm the body meets the new-issue bar: complexity rationale as first line matching the title prefix, Problem/Goal/Approach/Acceptance criteria all concrete, a `## Plain simple English` section after the criteria (under 55 words, ASD-STE100, no paths or symbols), no time/effort estimates, plain-simple-English (ASD-STE100) title. Fix small inaccuracies yourself and note them (update the scratchpad copy); if the draft is structurally wrong (untraceable central claim, stale baseline, stub-like body), do NOT silently re-dispatch — tell the user what's off and let them decide.

### 5. File it (main agent)

File per new-issue step 6: `gh issue create --title "[C<score>] <title>" --body-file <body-file>` (with `-R owner/repo` if cross-repo; labels only when the repo visibly uses them and the fit is unambiguous).

Footer: `Created with LLM: <model that served> | <recorded tier> | Harness: <harness> | fable-new-issue`, with the model and tier that step 2 recorded and `<harness>` naming the harness actually running, per `fable-dispatch` section 6. A repo CLAUDE.md footer format overrides.

### 6. Report

Terse: issue URL, number, one-line summary, complexity score, any unfiled follow-ups from the subagent, and a note that small spot-check fixes were applied (if any). Offer "validate issue" / "work on issue" as next steps in one line.

## Notes

- The dispatch requests Fable 5.1 with `model: fable`, whatever the main agent's model. A harness can map `fable` to another model with no error, so `fable-dispatch` sections 1 and 5 detect a substitution, and the footer names the model that served.
- One subagent, one draft: don't fan out or re-run for a second opinion unless the user asks.
- Never file a placeholder or thin body — if the subagent's draft isn't complete, it doesn't get filed; that rule outranks finishing the run.
