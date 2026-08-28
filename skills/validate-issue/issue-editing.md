# Issue editing procedure

Read this file completely when the user replies `update issue`. Run from the current checkout without a worktree. Load `github-issue-format` before editing.

## Verify the rewrite

Every verb, value, lifetime, owner, and proposed fix in the corrected text is a new claim. Trace each claim to code before writing it. Preserve verified differences between paths. Search repository instructions and nearby comments for single-writer, fail-closed, and field-routing invariants.

## Perform the final consistency pass

Before every `gh issue edit`, read the complete assembled body. List each value or distinction repeated across sections and confirm every occurrence agrees. This pass is mandatory after edits across two or more sections or turns.

## Edit the title

Change the title when it names the wrong behavior, component, root cause, scope, or complexity score. Use `[C<score>] <plain simple English title>` when the repo follows that convention. Keep the body rationale and `fableplan` signal synchronized with the title; `yes` starts at score 71.

## Edit the body

Apply all validated corrections with `gh issue edit <N> --body-file <file>`. Keep the body complete. Keep the `## Plain simple English` section per `github-issue-format`: add it when the body has none, and rewrite it when the corrected Problem no longer matches it. Keep it under 55 words in ASD-STE100, after the acceptance criteria and before any Execution block. This backfill happens only on issues you already edit. Do not sweep other open issues. Preserve prior attribution lines and append the current line after one final `---` separator:

```text
---
Created with LLM: <original model> | <effort> | Harness: <harness>
Validated with LLM: <prior model> | <effort> | Harness: <harness>
Validated with LLM: <current model> | <effort> | Harness: <harness>
```

This edit is the output of a validation pass, so the appended verb is always `Validated`. Prior `Created` and `Updated` lines stay exactly as written. Collapse exact duplicates only. When no footer exists, append the current `Validated` line. Use the model, effort, and harness that actually produced the edit. In continuous integration, use the GitHub Action identifier from the system prompt; its absence means the session is interactive. Use the specific interactive tool, such as Claude Code, Cursor, or Codex. A repository footer rule overrides this default.

## Verify the saved issue

Read the issue back from GitHub. Confirm title, first complexity line, corrected sections, and final footer. Remove temporary body files and confirm local status contains no new artifact.
