# Worked example — two finished review comments

Read this after the `## Format` section of [SKILL.md](SKILL.md). It renders one complete
`Needs Updates` review and one complete `LGTM` review, so you can match your draft against a
finished comment. You never have to rebuild the layout from the rules on your own.

**The rules in [SKILL.md](SKILL.md) win.** This file only illustrates them. Where the example
and the `## Format` rules disagree, follow the rules and treat the example as stale.

Everything between the fenced blocks below is commentary for you. It is never part of a posted
review — a review comment contains nothing outside the structure the rules define, except the
footer.

## The diff under review (invented)

The PR adds one file, `skills/release-notes/SKILL.md`. A file that instructs an agent is
executable, so the review hunts behavioral defects and self-contradictions in the instructions.
It says nothing about prose quality.

```
 1  ---
 2  name: release-notes
 3  description: Draft and publish the GitHub release for the current repo.
 4  ---
 5
 6  # Release notes
 7
 8  ## Step 1 — Collect what landed
 9
10  Read the previous tag: `gh release view --json tagName -q .tagName`.
11  List the merged PRs:
12  `gh pr list --state merged --limit 30 --json number,title,mergedAt`.
13
14  ## Step 2 — Group the entries
15
16  Group every title by its Conventional Commit type: `feat`, `fix`, `chore`.
17  Write the grouped list to `notes.md`.
18
19  ## Step 3 — Publish
20
21  Every PR merged after the previous tag must appear in `notes.md`.
22  Publish it: `gh release create <tag> --latest --notes-file notes.md`.
```

## Example 1 — a `Needs Updates` review

All four H3 sections appear in their fixed order: the two blocking sections
(`### Needs Fixing`, `### Requires Human Review`) first, then the two non-blocking ones
(`### Recommended Optional`, `### Create Follow-up Issue`). Omit any section with no items — a
real review rarely fills all four. Each item shows its full field set in the required order, and
`**Plain simple English:**` is always the item's last field.

```markdown
Needs Updates

### Needs Fixing

1. **Step 1 caps the merged-PR list at 30 while step 3 requires every PR merged after the previous tag, so a release with more entries loses them with no error.**
`skills/release-notes/SKILL.md:12` passes `--limit 30`, and line 21 states the completeness rule the notes must satisfy. The listing is also unbounded in the other direction: it carries no filter on the previous tag, so it returns the 30 most recent merged PRs of all time, including PRs already shipped in an earlier release. An agent that follows both lines produces a list that is truncated and over-inclusive at once, and nothing in the file tells it to check the two against each other. Verified by reading the added file in full and comparing line 12 with line 21; both lines are inside this diff. I did not run the commands.
**Invariant:** An enumeration step must return the whole set a later step declares mandatory, and must fail loudly when it cannot.
**Must survive:** more than 30 PRs merged after the previous tag; exactly 30 merged PRs, where the truncation is invisible; the first release of a repo, where no previous tag exists and the range is the whole history.
**Plain simple English:** Step 1 collects only the 30 newest merged pull requests. Step 3 says the notes must show every pull request merged after the last release. If more landed, the notes lose entries and no message tells the operator. Make step 1 read the full range.

### Requires Human Review

1. **Step 3 publishes a public release and moves the `latest` pointer with no maintainer confirmation.**
`skills/release-notes/SKILL.md:22` runs `gh release create --latest`, which changes what every consumer of this repo resolves as the current release. The file has no draft state and no confirmation gate. Whether an agent may publish unattended is a release policy this repo has not recorded, so you must decide it.
**Recommended proposed solution:** Make the skill create a draft release and stop there, then tell the maintainer the draft is ready and give the link. Add publishing as a separate step that a person starts. The agent keeps doing the slow work, and a human keeps control of the public pointer.
**Plain simple English:** When the notes are ready, must the agent: **A)** publish the release immediately and mark it as the latest one, or **B)** save a draft and wait for a person to publish it?

### Recommended Optional

1. **Step 2 gives no rule for a title that carries no listed Conventional Commit type, so a common input has undefined behavior.**
`skills/release-notes/SKILL.md:16` names `feat`, `fix`, and `chore`. A title such as `Bump the lockfile` or `revert(#87): back out the retry change` matches none of them, and the file never says whether it gets an `Other` group, gets dropped, or stops the run. Each agent decides for itself, so two runs over the same set of PRs produce different notes.
**Invariant:** Every input class an instruction accepts has exactly one defined output.
**Must survive:** a title with no type prefix at all; a valid type outside the three listed, such as `docs` or `revert`; a title with a scope and no type, such as `(#87): back out the retry change`.
**Plain simple English:** Step 2 sorts pull request titles into three groups. It does not say what to do with a title that fits none of them. Two runs can then give different notes. Name the group that takes all other titles.

### Create Follow-up Issue

1. **This skill round-trips whatever tag string it reads, while `skills/create-release/SKILL.md` builds tags from `package.json`, so the two disagree once both run in one repo.**
Line 10 reads `tagName` and line 22 passes it back unchanged, which is self-consistent inside this PR. The existing release skill composes its own tag instead. Reconciling them needs one shared tag rule plus a decision about the tags already published in every consumer repo — its own design decision, and it would expand this diff well past the file it adds.
**Plain simple English:** Two skills in this repo make release tag names in different ways. This pull request works correctly on its own. If both skills run on one repository, the tag names can disagree. Agree one rule for tag names in a separate change.

**Verification limitation:** GitHub release-notes body size limit (docs.github.com) unavailable — this route has no network or fetch tool.

---
Reviewed with LLM: Opus 5 | high | Harness: Claude Code
```

What the example demonstrates:

- **The verdict keys off blocking sections only.** Two blocking items are present, so the first
  line is `Needs Updates`. Had only the last two sections carried items, the first line would be
  `LGTM` with those sections below it.
- **Field order is fixed.** `### Needs Fixing` and `### Recommended Optional` items carry
  **Invariant:** then **Must survive:**; `### Requires Human Review` items carry **Recommended
  proposed solution:**; `### Create Follow-up Issue` items carry neither. Every item in every
  section ends with **Plain simple English:**.
- **The verification-limitation line is not a finding.** It sits between the last finding
  section and the footer, never under an H3 section, and carries no `Invariant` /
  `Must survive` / `Plain simple English`. Review loops do not treat it as remaining work.
- **`### Requires Human Review` names the decision.** Its technical description stays under 50
  words and ends by stating what the human must decide. Its plain-simple-English field is an A/B
  question.
- **`### Create Follow-up Issue` earns its place.** The item is out of this PR's scope and cannot
  fold into the diff. A trivially-fixable instance of a bug class this PR already touches would
  go to `### Needs Fixing` or `### Recommended Optional` instead.
- **Nothing else appears.** No preamble, no summary of the PR, no emoji, no "great work" line,
  and no verification prose outside the findings.

## Example 2 — a bare `LGTM` review

With no findings at all, the verdict stands alone above the footer.

```markdown
LGTM

---
Reviewed with LLM: Opus 5 | high | Harness: Claude Code
```

The bare `LGTM` itself asserts that you completed every applicable item under "Before you write".
Do not add verification prose to prove it. Only two things may join a bare `LGTM` above the
footer: zero or more `**Verification limitation:**` lines, and the non-blocking finding sections
when the review has non-blocking findings and nothing blocking.

Both examples end with the LLM Attribution Footer using the verb `Reviewed`, the verb this repo
reserves for a pull request review comment. Fill in the model, effort, and harness that actually
ran.
