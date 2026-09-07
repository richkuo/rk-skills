# Issue editing procedure

Run from the current checkout without a worktree only when the user or calling workflow has authorized the edit. Load `github-issue-format`; it owns body order, the Plain simple English section, and shared artifact conventions. The sections below own validation corrections and routing preservation.

## Routing corrections

Use the main skill's step 6 tables and the traced grades. Apply these rules when deciding whether a rescore requires an update and again before saving:

| Recomputed score versus title | Stored correction |
|---|---|
| Higher | Restamp the title prefix, rationale grades and score, and score-based fableplan signal together. |
| Equal, but rationale grades differ | Correct the rationale to the traced grades and check the routing fields. |
| Lower | Preserve the title score and routing; report each differing grade and the lower recomputation in the validation evidence. Do not invent grades to reproduce the old score. |
| No title prefix | A rescore adds no prefix and does not lower the highest-band fallback. A literal `[C0]` follows the scored rows above. |

A recomputed score below the title score restamps nothing through a rescore alone; it does not prevent independently required prose corrections. A title with no prefix gets none from a rescore. Preserve retained scoring metadata when correcting prose, and identify it as the prior routing floor in the report. If that retained rationale contains a refuted factual claim, correct that claim and explicitly label the retained score as a prior routing floor; do not present it as the recomputed result.

For an upward or equal-score correction, when the body carries an `## Execution` block, restamp its `Build model:`, `Effort:`, and `fableplan first:` lines to the new band's defaults, upward only: never lower a model or an effort. Keep an existing Fable 5.1 build or Codex CLI or Cursor CLI harness model and effort. On those protected stamps, add `fableplan first: Yes` only when required; never turn an existing Yes into No. Preserve all other Execution fields, including dependencies, parallel ordering, and explicit review or effort overrides. Step 6 owns the score threshold; explicit planning authorization and the safety routing signal remain effective independently of a numeric rescore.

## Assemble the correction

Re-fetch the issue's title, body, comments, state, and update timestamp using its full repository identity. Compare them with the validated snapshot. Incorporate newer text and recheck affected claims; do not overwrite another person's additions with the old body. Refresh the baseline and retrace affected findings if the target branch has advanced. If a changed requirement needs a user decision, prepare the unaffected corrections and report the conflict.

Apply only supported corrections. Current-behavior claims need baseline evidence; proposed behavior needs a feasible mechanism and observable acceptance criteria. Keep future behavior distinct from current facts. Preserve verified differences between paths and repository invariants, including single-writer and fail-closed contracts.

Read the complete assembled title and body before saving. Check repeated values, scope, ownership, lifetime, and acceptance criteria across sections. Preserve unrelated content and metadata. For a prose rewrite, maintain `## Plain simple English` per `github-issue-format`: add it when it is missing and update it when the corrected Problem changes. A metadata-only edit follows that skill's exception.

## Attribution

Preserve prior attribution lines and append this line after the final footer separator, using the model, effort, and harness that actually produced the validation:

Validated with LLM: <current model> | <effort> | Harness: <harness>

Collapse exact duplicates only. Prior Created and Updated lines stay as written. A caller's attribution suffix and a repository footer rule take precedence. Do not attribute the findings to a requested model that did not run.

## Save and verify

Immediately before writing, re-read the remote title, body, state, and update timestamp. If they changed since assembly, reconcile and recheck the result before writing; if edits keep arriving, stop with the prepared correction. This check reduces stale overwrites but is not an atomic concurrency guarantee.

Use one `gh issue edit <N> --repo <repository> --title <title> --body-file <file>` for the complete corrected title and body. Write the body to a temporary file outside the repository and pass the title as a safely quoted argument. Do not interpolate issue text into shell code. Leave labels, state, assignees, and milestone unchanged unless separately authorized.

Read the saved issue back and compare the intended title and complete body, including routing and attribution. After a timeout or mismatch, inspect the current issue before retrying; never blindly replay the old body or restore an earlier snapshot. Report the saved URL and outcome. Remove only temporary files created for this edit; retain any evidence report already linked to the user and confirm no repository artifact was added.

---
Updated with LLM: GPT-6 | high | Harness: Codex
