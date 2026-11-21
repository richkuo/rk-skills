---
name: cli-dispatch
description: >-
  Required dispatch procedure for a build, fix pass, or validate pass on an external coding CLI: the Codex CLI (`codex exec`) or the Cursor CLI (`agent -p`). Covers preflight, the shims, the background run, result parsing, the substitution check, and attribution. Load BEFORE dispatching any Codex CLI or Cursor CLI pass, as when an issue's Execution block stamps that harness.
---

# CLI dispatch

For an issue stamped `Build model: <Name> (Codex CLI)` or `<Name> (Cursor CLI)`. The caller owns the task prompt and the result. Never fall back to a Claude build. A run on another model is a substitution: always report it and never present it as the stamped build.

## 1. Preflight

Before writing any file, check only the stamped CLI: `command -v codex && codex login status` or `command -v agent && agent status`. A missing binary or signed-out status blocks that issue (name which); the caller runs the rest of the milestone.

## 2. Model id and effort

- `Luna (Codex CLI)` is `gpt-5.6-luna`, `Astra (Codex CLI)` is `gpt-6-astra`, `Grok (Cursor CLI)` is `cursor-grok-4.6-<effort>`. Use an explicit id (`Luna (Codex CLI, gpt-5.6-luna)`) verbatim. Any other name without an id blocks; never guess an id.
- Codex takes `low`, `medium`, `high`, `xhigh`, `max` as `-c model_reasoning_effort=<tier>`. Cursor puts the tier in the id suffix; the caller normalizes `max` to `xhigh` with a log line.
- `agent --list-models` (`agent` is `cursor-agent`) prints the ids Cursor accepts; run it when an explicit id looks unfamiliar. A `-fast` variant needs an explicit id.
- **A model id is shell data.** Accept only `^[A-Za-z0-9][A-Za-z0-9._:-]*$`, else block; single-quote it in the shim.

## 3. The prompt file

Write it outside the repository (session scratchpad, else `mktemp -d`). Append a line telling the CLI agent to read `work-on-issue` (fix pass: `fix-pr-review`) at the first existing of `~/.codex/skills/<skill>/SKILL.md`, `~/.cursor/skills/<skill>/SKILL.md`, `~/.claude/skills/<skill>/SKILL.md` (write the resolved absolute path yourself), then the section 7 attribution rules, with its footer bullet copied in full: the footer line, its scope of every commit message, PR body, issue body, and comment, the `---` line on its own directly above the first footer line, and the fix-pass verbs.

- **Build:** the task prompt verbatim plus a line: the driver handles every review trigger and cycle, so the CLI agent stops once the PR is open and verified.
- **Fix pass:** names the PR and review comment, carries the caller's constraints verbatim, and says the CLI agent must not trigger, post, or wait for any re-review and stops after pushing the fixes and posting the disposition comment.
- **Never interpolate the prompt into the command line.** Codex reads the file on stdin. Cursor reads no stdin: pass `"$(cat "$PROMPT")"` as one positional argument, expanded once, with no `--` before it. Every Cursor prompt file, fix prompts included, starts with the line `Task for the Cursor CLI agent:`, so the argument never starts with `-`.

## 4. The two shims

Run from the repository root with `REPO`, `PROMPT`, `RESULT`, `EVENTS`, and `STDERR` as absolute paths.

```sh
codex exec -C "$REPO" -m '<model-id>' -c model_reasoning_effort=<tier> \
  -s workspace-write -c sandbox_workspace_write.network_access=true \
  --json -o "$RESULT" < "$PROMPT" > "$EVENTS" 2> "$STDERR"
```

```sh
agent -p --output-format stream-json --model '<model-id>' --force --trust \
  --workspace "$REPO" "$(cat "$PROMPT")" > "$RESULT" 2> "$STDERR"
```

- **The Cursor shim has no write boundary.** `--force` runs any shell command unprompted and `--trust` accepts the workspace (a headless run stalls without both); `--workspace` and `--sandbox enabled` limit nothing. Only the section 8 snapshot diff guards a Cursor build, which holds the driver's full shell rights.
- Keep Cursor on `--output-format stream-json`; `json` writes only at the end and trips the stall limit.
- Never add `--dangerously-bypass-approvals-and-sandbox`, `--yolo` (use its alias `--force`), or any flag this section does not name.
- **Background run and limits.** Never run a shim in the foreground. Keep control files in a directory `RUN` outside the repository, beside the prompt file. Write `$RUN/launch.sh`: set `REPO`, `PROMPT`, `RESULT`, `EVENTS`, `STDERR`, and `RUN` to absolute paths, then:

```sh
set -m
rm -f "$RUN/exit" "$RUN/limit" "$RUN/pid"
( <shim> ; echo $? > "$RUN/exit" ) < /dev/null > /dev/null 2>&1 &
echo $! > "$RUN/pid"
date +%s > "$RUN/start"
cp "$RUN/start" "$RUN/changed"
echo 0 > "$RUN/bytes"
```

- Run `bash "$RUN/launch.sh"`. A retry reruns this launcher and never retakes the `before` snapshot. If `$RUN/exit` then exists, the shim ended: go to section 5. Otherwise `ps -o pgid= -p "$(cat "$RUN/pid")"` must print the same id; a different id means no limit can end the run, so end what it started and block. Nothing printed and no `$RUN/exit` is a non-zero exit.
- Poll with short calls about every 5 minutes, never back to back, with a bounded wait of at most 5 minutes between (a background sleep or the host's wait tool). When `cat "$EVENTS" "$RESULT" "$STDERR" 2>/dev/null | wc -c` differs from `$RUN/bytes`, write it there and `date +%s` to `$RUN/changed`. `$RUN/exit` means ended. **Stalled:** 30 minutes with no new byte. **Cap:** 4 hours after `$RUN/start` for a build, 2 hours for a fix or validate pass.
- On a stall or cap, write the reason to `$RUN/limit` and send `kill -TERM -- -"$(cat "$RUN/pid")"`; on a poll at least 30 seconds later, `kill -KILL` the group while `kill -0 -- -"$(cat "$RUN/pid")"` succeeds. A killed run (limit file, no exit file), or a gone group with neither file, is a non-zero exit under section 5, landed-work check first; name any limit in the blocker.

## 5. Parse the result

Sections 5 and 6 run after every run; a zero exit never skips the result read, the substitution comparison, or the `model unverified` record.

- Codex: `$RESULT` is the final message; `$EVENTS` has one JSON event per line. Cursor: `$RESULT` has one JSON event per line; the final text is the `result` field of the last `type` `result` line (none means no final message), and the `type` `system` init line's `model` is the serving model's display name. A model the output names is the record; an output naming none (the usual Codex case) records `model unverified`.
- A non-zero exit is a failure. Before any retry, check for landed work: build, a `<prefix>/issue-<N>-*` remote branch or an open PR closing the issue; fix pass, a head commit newer than the pre-run head or a new disposition comment. Landed work is a completed pass: verify it (section 8) and never re-run. Else retry once with the same inputs; a second failure blocks, quoting the last lines of `$STDERR`.

## 6. Substitution check

Compare the output's model with the requested id; compare a Cursor display name with the name `agent --list-models` prints beside the id (`cursor-grok-4.6-low - Grok 4.6 Low`). A different model is a substituted work product: adopt it only with the substitution named in the summary, flags, and footer, and never present it as the stamped model's build. No named model: record `model unverified` beside the requested id.

## 7. Attribution

- Branch prefix `codex/` or `cursor/` (CLAUDE.md Git Workflow).
- PR title bracket `[C<score>, <Name>, <tier>]`, e.g. `[C33, Luna, max]`; append `, plan` when the caller says a plan stage drove the build (CLAUDE.md PR title convention), never for a failed plan stage.
- Footer `Created with LLM: <Name> | <tier> | Harness: Codex` or `Harness: Cursor`, as the final lines of every commit message, PR body, issue body, and comment, with a `---` line on its own directly above the first footer line (the CLI agent does not load the global CLAUDE.md that defines this shape, and a repository's own commit metadata check can fail a commit without the separator, which only a history rewrite can repair); on a fix pass the commit uses `Updated`, while a new comment or issue the pass posts uses `Created` per CLAUDE.md. `<Name>` is the stamped display name, or the output's model after a section 6 substitution.

## 8. Dispatch hygiene, every caller

- **(a) Snapshot diff, every pass.** Write this script to `$RUN/snapshot.sh`. Before dispatch, run `sh "$RUN/snapshot.sh" "$REPO" > "$RUN/before"`; after the run ends or is killed, run it to `$RUN/after` and read `diff "$RUN/before" "$RUN/after"`.

```sh
REPO=$1
git -C "$REPO" for-each-ref --format='ref %(refname) %(objectname)'
git -C "$REPO" worktree list --porcelain | sed -n 's/^worktree //p' | while IFS= read -r W; do
  if [ ! -d "$W" ]; then printf 'missing %s\n' "$W"; continue; fi
  printf 'head %s %s %s\n' "$W" "$(git -C "$W" rev-parse HEAD 2>&1)" "$(git -C "$W" symbolic-ref -q HEAD || echo detached)"
  git -C "$W" --no-optional-locks status --porcelain --untracked-files=all --ignored=matching | grep -v '^.. \.claude/worktrees/' | W="$W" awk '{ print "status " ENVIRON["W"] " " $0 }'
  printf 'hash %s %s\n' "$W" "$({
    git -C "$W" diff-index -p --binary HEAD
    ( cd "$W" && git ls-files -z --others --exclude-standard | xargs -0 -n1 sh -c '
      f=$1
      [ -n "$f" ] || exit 0
      case "$f" in .claude/worktrees/*) exit 0 ;; esac
      if [ -L "$f" ]; then printf "link %s %s\n" "$f" "$(readlink "$f")"
      elif [ -f "$f" ]; then printf "file %s %s\n" "$f" "$(git hash-object --no-filters -- "$f" 2>&1)"
      else printf "unhashed %s\n" "$f"; fi
    ' sh )
  } 2>&1 | git hash-object --stdin)"
done
```

- It records every ref and, for every worktree `git worktree list --porcelain` lists, its `HEAD` and branch, porcelain status with untracked and ignored paths, and a content hash (`missing` when the directory is gone); the main checkout skips `.claude/worktrees/`. It takes no index lock and writes no object.
- **Flag rules, build or fix pass.** Exclude the issue's own worktree and its branch's `refs/heads/` and `refs/remotes/origin/` refs: build, the worktree whose branch starts with `<prefix>/issue-<N>-`; fix pass, the one whose branch equals the PR's `headRefName`. Every other changed `head`, `status`, or `hash` line (main checkout or another worktree) and every changed `ref` line outside `refs/remotes/` is a stray change: flag it with worktree path and branch, and leave it for the user. A concurrent track's own work looks the same; the flag names the branch and the reader decides.
- Note a worktree that appears during the run, with its new branch ref, in the summary without flagging it. Flag a worktree whose lines vanish or turn `missing` as removed during the run and not attributable; never drop that flag, and never recreate or prune it. Note any other `refs/remotes/` change in the summary.
- **Reach.** The guard sees the repository, its worktrees, and its refs; an ignored directory such as `node_modules/` is one `!!` line. It cannot see an edit or new file inside an ignored directory, an edit inside an existing ignored file, a write outside the repository, a push, or a GitHub write.
- **(b) PR check, build only.** Verify the PR with `gh` as a Claude builder would: number, head ref, head commit. A zero exit with no PR is a blocker; never open a PR for the CLI agent.
- **(c) Head check, fix pass only.** Check `gh pr view <num> --json headRefName,headRefOid`; a zero exit with neither a new head commit nor a disposition comment is a blocker.
- **(d) Review cycles, build and fix pass.** The driver owns every read and write of GitHub review state (the standing review, the stop decision, the cycle-1 trigger and every re-trigger the caller's routing selects, the Actions run, the verdict) and forwards each fix pass to the same shim with the section 3 fix-pass file. The CLI agent runs `fix-pr-review` through its disposition comment and never posts a trigger; when the caller forbids re-triggering (subagent review mode), the driver posts nothing.

## 9. Validate pass

A validate pass runs the `validate-issue` skill on the Codex CLI. Before any other step of a validate pass, read [validate-pass.md](validate-pass.md) completely; it holds the full section 9 text and names the sections of this file that a validate pass uses. A missing `validate-pass.md` blocks the pass. A build or fix pass does not read it.

## Failure modes

| Situation | Action |
|---|---|
| CLI absent or signed out | Block (section 1) |
| Non-zero exit, stall, or cap | Landed-work check, one retry, then block (sections 4 and 5) |
| Run has no process group of its own | End what it started; block (section 4) |
| Output names another model | Report it (section 6) |
| No PR, or no new head or disposition comment | Block (section 8) |
| Stray change or removed worktree | Flag it (section 8) |
| Cursor validate stamp, no verdict, or no read time of record | Block (section 9) |
| Open or closed state changed, title or body changed beyond the allowed edit, a comment edited or removed, a new invoking-user comment, or a failed after read during a validate pass | Block, never retried by the driver or its caller (section 9) |
| Validate blocker after the shim launched | Run the Issue diff first; retry only when it shows no blocking change (section 9) |
