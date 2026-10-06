# Issue editing procedure

Run from the current checkout without a worktree. Load `github-issue-format` before editing.

## Verify the rewrite

Every verb, value, lifetime, owner, and proposed fix in the corrected text is a new claim. Trace each claim to code before writing it. Preserve verified differences between paths. Search repository instructions and nearby comments for single-writer, fail-closed, and field-routing invariants.

## Perform the final consistency pass

Before every `gh issue edit`, read the complete assembled body. List each value or distinction repeated across sections and confirm that every occurrence agrees. This pass is mandatory after edits across two or more sections or turns.

## Edit the title

Change the title when it names the wrong behavior, component, root cause, scope, or complexity score. Use `[C<score>] <plain simple English title>` when the repo follows that convention; when the title has no prefix, add it and the body rationale line. Keep the body rationale and `plan` signal synchronized with the title in both directions; `yes` starts at score 75. When the body carries an `## Execution` block, restamp its `Build model:`, `Effort:`, and `plan first:` lines (a legacy `fableplan first:` or `· fableplan:` spelling is read as the same field and rewritten to `plan` on the restamp) against the `validate-issue` step 6 band table:

- **Higher score, or no prior prefix:** restamp each line to the new band's defaults, upward only: never lower a model or an effort, keep a Fable 5.1 build and a Codex CLI or Cursor CLI harness stamp as written, and on those add only `plan first: Yes` when the new score is 75 or higher.
- **Lower score:** restamp a line down to the new band's default only when it still equals the old band's default. A line that differs from the old default is a deliberate stamp and stays, and a Fable 5.1 build or a Codex CLI or Cursor CLI harness stamp keeps its model and effort.

The pipeline builds on those stamps and does not correct a stale one once the title matches the validator's score.

## Edit the body

Apply all validated corrections with one `gh issue edit <N> --repo "$REPO" --title <title> --body-file <file>` and keep the body complete. Write the body file outside the repository (the session scratchpad, else `mktemp`). In a sandbox that blocks every file write (the `cli-dispatch` section 9 Codex validate shim), use `--body-file -` and feed the body through a pipe: `printf '%s\n' '<body>' |`, where `<body>` is the complete body inside one pair of single quotes, with each `'` in it written as `'\''` and no other change. Pass the title as one single-quoted argument by the same rule. Never put the body or the title in double quotes, and never use a here-document (it needs a temp file and fails there). Inside single quotes the shell runs no command and expands nothing, so a backtick span, `$`, `*`, `%`, or a `---` line stays literal. Keep the `## Plain simple English` section per `github-issue-format`: when the edit rewrites a prose section, add it when the body has none, and rewrite it when the corrected Problem no longer matches it. A rescore-only edit (title prefix, rationale line, Execution block) is metadata and does not add it. Keep it under 55 words in ASD-STE100, after the acceptance criteria and before any Execution block. This backfill applies only to issues you already edit; do not sweep other open issues. Preserve prior attribution lines and append the current line after one final `---` separator:

```text
---
Created with LLM: <original model> | <effort> | Harness: <harness>
Validated with LLM: <prior model> | <effort> | Harness: <harness>
Validated with LLM: <current model> | <effort> | Harness: <harness>
```

The appended verb is always `Validated`, because this edit is the output of a validation pass. Prior `Created` and `Updated` lines stay exactly as written. Collapse exact duplicates only. When no footer exists, append the current `Validated` line. Use the model, effort, and harness that actually produced the edit: in continuous integration, the GitHub Action identifier from the system prompt; otherwise the interactive tool, such as Claude Code, Cursor, or Codex. A repository footer rule overrides this default.

## Check for newer edits

Immediately before `gh issue edit`, run `gh issue view <N> --repo "$REPO" --json title,body,updatedAt` and compare `updatedAt` with the recorded value; step 1 records the first one, and a relayed verdict that carries none records it at the start of this procedure, before the correction is assembled. When `updatedAt` changed, compare the title and body with the recorded snapshot. A comment, label, or assignee change leaves them equal and needs no merge. When they differ, merge the newer text into the correction and retrace every claim it touches. In both cases, record the title, body, and `updatedAt` just read as the new snapshot, then check again; never overwrite another author's edit with the older body. When edits keep arriving, stop and report the prepared correction. This check narrows the race but is not atomic.

## Verify the saved issue

Read the issue back from GitHub. Confirm the title, first complexity line, corrected sections, and final footer. After a `--body-file -` edit, also confirm that the saved body is the intended body: `gh issue view <N> --repo "$REPO" --json body | jq -c '.body | gsub("\r"; "") | sub("\\s+\\z"; "")' | shasum -a 256` must equal `printf '%s' '<body>' | jq -Rsc 'gsub("\r"; "") | sub("\\s+\\z"; "")' | shasum -a 256`, with `<body>` quoted by the same rule. A mismatch means the saved body is damaged: report it, and do not count the edit as applied. Remove temporary body files, when any were written, and confirm that local status contains no new artifact.
