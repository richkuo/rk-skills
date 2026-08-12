# Issue editing procedure

Read this file completely when the user replies `update issue`. Run from the current checkout without a worktree. Load `github-issue-format` before editing.

## Verify the rewrite

Every verb, value, lifetime, owner, and proposed fix in the corrected text is a new claim. Trace each claim to code before writing it. Preserve verified differences between paths. Search repository instructions and nearby comments for single-writer, fail-closed, and field-routing invariants.

## Perform the final consistency pass

Before every `gh issue edit`, read the complete assembled body. List each value or distinction repeated across sections and confirm every occurrence agrees. This pass is mandatory after edits across two or more sections or turns.

## Edit the title

Change the title when it names the wrong behavior, component, root cause, scope, or complexity score. Use `[C<score>] <plain simple English title>` when the repo follows that convention. Keep the body rationale and `fableplan` signal synchronized with the title; `yes` starts at score 61.

## Edit the body

Apply all validated corrections with `gh issue edit <N> --body-file <file>`. Keep the body complete. Preserve prior attribution lines and append the current update after one final `---` separator:

```text
---
Created with LLM: <original model> | <effort> | Harness: <harness>
Updated with LLM: <prior model> | <effort> | Harness: <harness>
Updated with LLM: <current model> | <effort> | Harness: <harness>
```

Collapse exact duplicates only. When no footer exists, append the current `Updated` line. Use the model and effort that actually ran. Use `Codex` for this interactive harness unless a repository rule overrides it.

## Verify the saved issue

Read the issue back from GitHub. Confirm title, first complexity line, corrected sections, and final footer. Remove temporary body files and confirm local status contains no new artifact.
