# Worked example

Read after the `## Format` section of [SKILL.md](SKILL.md), which owns every rule; where this file and the rules disagree, the rules win. Text outside the two fenced blocks is commentary and never part of a posted review.

## The diff under review (invented)

The PR adds one file, `skills/release-notes/SKILL.md`. Line numbers below are the ones the findings cite.

```
10  Read the previous tag: `gh release view --json tagName -q .tagName`.
12  `gh pr list --state merged --limit 30 --json number,title,mergedAt`.
16  Group every title by its Conventional Commit type: `feat`, `fix`, `chore`.
21  Every PR merged after the previous tag must appear in `notes.md`.
22  Publish it: `gh release create <tag> --latest --notes-file notes.md`.
```

## Example 1: a `Needs Updates` review

All four H3 sections appear only so the layout of each is visible; a real review omits empty sections. The `### Needs Fixing` item carries **Reachability:** because the ordinary path does not reach its defect.

```markdown
Needs Updates

### Needs Fixing

1. **Step 1 caps the merged-PR list at 30 while step 3 requires every PR merged after the previous tag, so a large release loses entries with no error.**
`skills/release-notes/SKILL.md:12` passes `--limit 30` with no previous-tag filter, and line 21 states the completeness rule. An agent that follows both produces a list that is truncated and over-inclusive at once. Verified by reading the added file and comparing line 12 with line 21; I did not run the commands.
**Reachability:** Any release cut once more than 30 pull requests have merged in the whole history of the repository; the 30-item window then drops entries inside the release range.
**Invariant:** An enumeration step must return the whole set a later step declares mandatory, and must fail loudly when it cannot.
**Must survive:** more than 30 PRs merged after the previous tag; exactly 30, where the truncation is invisible; a first release with no previous tag.
**Plain simple English:** Step 1 collects only the 30 newest merged pull requests. Step 3 says the notes must show every pull request merged after the last release. If more landed, the notes lose entries and no message tells the operator. Make step 1 read the full range.

### Requires Human Review

1. **Step 3 publishes a public release and moves the `latest` pointer with no maintainer confirmation.**
`skills/release-notes/SKILL.md:22` runs `gh release create --latest` with no draft state and no confirmation gate. Whether an agent may publish unattended is a release policy this repo has not recorded, so you must decide it.
**Recommended proposed solution:** Create a draft release, stop, and report the link. Add publishing as a separate step a person starts.
**Plain simple English:** When the notes are ready, must the agent: **A)** publish the release immediately and mark it as the latest one, or **B)** save a draft and wait for a person to publish it?

### Recommended Optional

1. **Step 2 gives no rule for a title with no listed Conventional Commit type, so a common input has undefined behavior.**
`skills/release-notes/SKILL.md:16` names `feat`, `fix`, and `chore`. A title such as `Bump the lockfile` matches none, and the file never says whether it gets an `Other` group, is dropped, or stops the run. Two runs over the same PRs can produce different notes.
**Invariant:** Every input class an instruction accepts has exactly one defined output.
**Must survive:** a title with no type prefix; a valid type outside the three listed, such as `docs`; a title with a scope and no type.
**Plain simple English:** Step 2 sorts pull request titles into three groups. It does not say what to do with a title that fits none of them. Name the group that takes all other titles.

### Create Follow-up Issue

1. **This skill round-trips the tag it reads, while `skills/create-release/SKILL.md` builds tags from `package.json`, so the two disagree once both run in one repo.**
Line 10 reads `tagName` and line 22 passes it back unchanged, which is self-consistent inside this PR. Reconciling the two skills needs one shared tag rule and a decision about tags already published, so it is its own design decision outside this diff.
**Plain simple English:** Two skills in this repo make release tag names in different ways. This pull request works correctly on its own. Agree one rule for tag names in a separate change.

**Verification limitation:** GitHub release-notes body size limit (docs.github.com) unavailable — this route has no network or fetch tool.

---
Reviewed with LLM: Opus 5 | high | Harness: Claude Code
```

## Example 2: a bare `LGTM` review

```markdown
LGTM

---
Reviewed with LLM: Opus 5 | high | Harness: Claude Code
```

Fill in the model, effort, and harness that actually ran.
