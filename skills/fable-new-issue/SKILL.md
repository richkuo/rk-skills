---
name: fable-new-issue
description: Use when the user wants a GitHub issue created by a Fable 5 subagent. Spins up a read-only subagent running on Fable 5 that executes the new-issue procedure (duplicate check, code grounding, approach design, complexity score) and returns a fully-composed issue draft, which the main agent spot-checks and files. Trigger on "/fable-new-issue", "fable new issue <description>", or "create this issue with fable".
---

# fable-new-issue

Delegate issue drafting to a **Fable 5** subagent, then file it from the main agent. The subagent only researches and composes — it never files, edits files, or posts to GitHub; the main agent handles filing and all follow-on actions.

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

### 2. Dispatch the Fable 5 drafting subagent

Snapshot `git status --porcelain` before dispatching, then call the Agent tool with:

- `subagent_type`: `Plan` (read-only: no Edit/Write, keeps drafting side-effect-free)
- `model`: `fable` (the whole point — the draft must come from Fable 5)
- `run_in_background`: `false` — filing depends on the draft
- `description`: `Draft issue: <short topic>`
- `prompt`: hand it everything needed to draft independently:
  - The user's description verbatim (or the scratchpad summary path), the working directory, and the target repo if not the current checkout.
  - Instruct it to **read the SKILL.md at the recorded path and execute its steps 1 through 6 exactly** — repo/duplicate check, claim grounding with `file:line` citations traced against the correct baseline, approach design, complexity score, scope check, and full body composition per the step-6 template.
  - It must STOP before filing: no `gh issue create`, no `gh issue edit`, no comments posted, no file edits — including via Bash (it lacks Edit/Write but still has Bash, so state this explicitly). Read-only `gh` calls (`gh issue list`, `gh pr list`, `gh repo view`, `gh label list`) are expected and allowed.
  - Return as its final message: (a) any duplicate found (URL + why it matches) — in which case no draft; (b) otherwise the complete issue draft — exact title with `[C<score>]` prefix and the full body per the template — plus one line stating which baseline claims were traced against, and any unfiled follow-up candidates from the scope check.

If the call returns null or errors, retry once; if it fails again, report the failure to the user instead of drafting yourself.

When the result arrives:
- Diff `git status --porcelain` against the snapshot to confirm no file changes; if changed, tell the user and ask whether to revert before continuing.
- Save the draft verbatim to a scratchpad file immediately, so it survives context summarization.

### 3. Duplicate gate

If the subagent reported a duplicate, stop and surface it — offer to update/comment on the existing issue instead. Nothing is filed.

### 4. Spot-check the draft

Before filing, spot-check the draft's load-bearing `file:line` citations against the code and confirm the body meets the new-issue bar: complexity rationale as first line matching the title prefix, Problem/Goal/Approach/Acceptance criteria all concrete, no time/effort estimates, ELI18 title. Fix small inaccuracies yourself and note them (update the scratchpad copy); if the draft is structurally wrong (untraceable central claim, stale baseline, stub-like body), do NOT silently re-dispatch — tell the user what's off and let them decide.

### 5. File it (main agent)

File per new-issue step 6: `gh issue create --title "[C<score>] <title>" --body-file <body-file>` (with `-R owner/repo` if cross-repo; labels only when the repo visibly uses them and the fit is unambiguous).

Footer: since the draft came from the Fable 5 subagent, use `Created with LLM: Fable 5 | high | Harness: Claude Code | fable-new-issue`. A repo CLAUDE.md footer format overrides.

### 6. Report

Terse: issue URL, number, one-line summary, complexity score, any unfiled follow-ups from the subagent, and a note that small spot-check fixes were applied (if any). Offer "validate issue" / "work on issue" as next steps in one line.

## Notes

- The drafting subagent runs on Fable 5 regardless of the main agent's model — `model: fable` forces it.
- **If the `fable` model is unavailable in this harness** (the Agent call errors on the model id), fall back to the most capable model available and proceed — the isolation pattern (read-only subagent drafts, main agent files) is what matters. Name the model that actually ran in the footer and report, never "Fable 5".
- One subagent, one draft: don't fan out or re-run for a second opinion unless the user asks.
- Never file a placeholder or thin body — if the subagent's draft isn't complete, it doesn't get filed; that rule outranks finishing the run.
