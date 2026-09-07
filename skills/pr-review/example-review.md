# Worked examples

[SKILL.md](SKILL.md) owns the review contract. These fixtures are invented and complete for the stated checks. Model and effort placeholders in sample footers must be replaced with the values that actually ran. Sample reviews show format; they grant no posting or merge permission.

## Fixture 1: incomplete release notes

The caller requests a static review of a new release-notes skill. The existing collector returns every pull request merged since the previous tag, newest first. Publishing is already authorized. The new file contains these instructions:

| Head line | Content of skills/release-notes/SKILL.md |
|---|---|
| 1 | Read all pull requests from the existing release-range collector. |
| 2 | Keep only the first 30 entries. |
| 3 | Write each retained title to the release notes. |
| 4 | The notes must include every pull request merged since the previous tag. |
| 5 | Publish the notes for the requested new tag. |

The head and base were checked and stayed unchanged. The source has been read in full, and there are no prior reviews, test edits, or external claims to verify. More than 30 entries in the release range demonstrates the defect. More than 30 entries across the repository's whole history does not demonstrate it.

```markdown
Needs Updates

### Needs Fixing

1. **Remove the cap that drops release entries.**
Reading `skills/release-notes/SKILL.md:2` shows that it discards entries required by line 4 when the release range contains more than 30 pull requests. Keep the collector's full result; the commands were not executed.
**Reachability:** More than 30 pull requests merged since the previous tag.
**Invariant:** Release notes include every entry in the release range.
**Must survive:** 31 entries in the range; exactly 30 entries; older entries outside the range stay excluded.
**Plain simple English:** Large releases lose entries from their notes. Remove the cap so every change since the last release appears.

---
Reviewed with LLM: <actual model> | <actual effort> | Harness: <actual harness>
```

Deleting line 2 fixes the demonstrated defect. The collector already supplies the correct range, and the caller already authorized publishing, so neither needs another finding.

## Fixture 2: clean static review with an access limitation

The same PR removes the cap before review. The reviewer verifies the complete supplied head snapshot, collector contract, and empty history. The offline route cannot check whether the live head has changed. The caller must check revision freshness before using this verdict to merge.

```markdown
LGTM

**Verification limitation:** live revision check unavailable: the supplied snapshot has no network access.

---
Reviewed with LLM: <actual model> | <actual effort> | Harness: <actual harness>
```

When no limitation applies, omit that line. Add no verification summary to a clean verdict.

## Other section choices

- Use Recommended Optional for a supported improvement with a concrete benefit, such as a retryable operation that discards safe progress and makes the user repeat work. Include Invariant, Must survive, and Plain simple English.
- Use Create Follow-up Issue when a related pre-existing defect needs a new mechanism outside the requested scope. Name the existing behavior, evidence, and missing mechanism. Include Plain simple English. A defect this PR creates must stay in the PR.
- Use Requires Human Review when a concrete safety concern depends on unavailable evidence, such as a changed authorization call whose deployed policy cannot be inspected. Name that call and the exact policy evidence needed. Include Recommended proposed solution and Plain simple English. Missing network access alone does not establish a hazard.

---
Updated with LLM: GPT-6 | high | Harness: Claude Code
