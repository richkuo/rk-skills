# Fable dispatch: shim path

This file holds the shim-path text of `SKILL.md` sections 3, 4, 5, and 8, under the same headings. The text under each heading in `SKILL.md` also applies on the shim.

## 3. The CLI shim

Write the prompt to a file and feed it on stdin; never interpolate it into the command line. The deny list is fixed:

```sh
DENY='Edit,Write,NotebookEdit,WebFetch,WebSearch,Skill,Agent,Task,Bash(git push*),Bash(git commit*),Bash(git branch*),Bash(git tag*),Bash(git checkout*),Bash(git switch*),Bash(git restore*),Bash(git reset*),Bash(git clean*),Bash(git stash*),Bash(git merge*),Bash(git rebase*),Bash(git cherry-pick*),Bash(git revert*),Bash(git am*),Bash(git apply*),Bash(git add*),Bash(git rm*),Bash(git mv*),Bash(git pull*),Bash(git worktree*),Bash(git submodule*),Bash(git notes*),Bash(git config*),Bash(git remote*),Bash(git update-ref*),Bash(git reflog*),Bash(git gc*),Bash(git prune*),Bash(git *--output*),Bash(git fetch*),Bash(git ls-remote*--u*),Bash(git ls-remote*--e*),Bash(git grep*--o*),Bash(git grep*O*),Bash(git -C*grep*--o*),Bash(git -C*grep*O*),Bash(gh issue comment*),Bash(gh issue edit*),Bash(gh issue create*),Bash(gh issue close*),Bash(gh issue reopen*),Bash(gh issue delete*),Bash(gh issue transfer*),Bash(gh issue pin*),Bash(gh issue unpin*),Bash(gh issue lock*),Bash(gh issue unlock*),Bash(gh issue develop*),Bash(gh pr create*),Bash(gh pr edit*),Bash(gh pr comment*),Bash(gh pr review*),Bash(gh pr merge*),Bash(gh pr close*),Bash(gh pr reopen*),Bash(gh pr ready*),Bash(gh pr checkout*),Bash(gh pr lock*),Bash(gh pr unlock*),Bash(gh api*),Bash(gh label create*),Bash(gh label edit*),Bash(gh label delete*),Bash(gh label clone*),Bash(gh release*),Bash(gh repo create*),Bash(gh repo edit*),Bash(gh repo delete*),Bash(gh repo fork*),Bash(gh repo sync*),Bash(gh repo rename*),Bash(gh repo archive*),Bash(gh workflow*),Bash(gh run*),Bash(gh secret*),Bash(gh variable*),Bash(gh gist*),Bash(gh cache*),Bash(gh project*),Bash(gh auth*),Bash(gh config*),Bash(gh extension*),Bash(gh alias*)'

claude -p --model fable --effort <tier> --output-format json \
  --restricted --tools "Read,Grep,Glob,Bash" \
  --strict-mcp-config \
  --permission-mode dontAsk --permission-prompts none \
  --disallowedTools "$DENY" \
  --allowedTools <read-only command list> \
  --add-dir <directories the procedure reads outside the working directory> \
  < <prompt-file>
```

- **Guards.** The read-only `--allowedTools` list is the gate. Only the allowlist stops a form the deny list does not name, such as `git -C <path> push`, and an entry ending in `*` admits every form after its prefix: check a command's options before listing it. Allow a ref-writing command with no safe wildcard, such as `git symbolic-ref`, only as the one exact read the procedure runs. `Bash(git fetch*)` is denied and never allow-listed.
- **Never pass** `--dangerously-skip-permissions`, `--allow-dangerously-skip-permissions`, a `--permission-mode` other than `dontAsk`, `--bare`, or `--no-session-persistence`. A CLI that rejects a flag in the block fails the call (section 5); never drop an isolation flag.
- **`--add-dir`**: the directory of each file the subagent reads outside the checkout. For `fable-validate` and `fable-new-issue`: the resolved skill folder's parent, and its `realpath` parent when it is a symlink; for a conversation-derived `fable-new-issue` summary, also the scratchpad directory. Omit the flag when there is none.
- **`--allowedTools`**: every read-only command the procedure runs; never a bare `Bash`, `Bash(*)`, or an edit, comment, or push command. A missing entry lands in `.permission_denials` and the result is incomplete. For an empty list (a file-only reader), omit the flag and its value, as for an unused `--add-dir`; `--resume` keeps an omitted flag omitted.
  - `fable-validate` (`validate-issue` steps 0 to 8 at `BASE`): `"Bash(gh repo view <REPO> --json defaultBranchRef --jq .defaultBranchRef.name)" "Bash(gh issue view <N> --repo <REPO> --json title,body,comments,updatedAt)" "Bash(git rev-parse *)" "Bash(git show *)" "Bash(git grep *)" "Bash(git log *)" "Bash(git symbolic-ref --short refs/remotes/origin/HEAD)" "Bash(git check-ref-format *)"`, plus `"Bash(git ls-remote --heads origin refs/heads/<target>)"` with the validated target only when a `targetBranch` is named and `REPO` is the checkout's `origin`. Otherwise there is no `ls-remote` entry, and a cross-repository target is reported as unchecked in the verdict.
  - **Planning list**, for a planner or advisor that reads history (`fableplan`, `fable-advisor` step 2): `"Bash(git log *)" "Bash(git show *)" "Bash(git grep *)" "Bash(git rev-parse *)"`.
  - Both one-shot reviewers read only the diff in their prompt and take the empty list. Other callers name their list at their dispatch step.
  - Every `gh` entry is an exact form with the caller's resolved `<REPO>` and `<N>` and no wildcard. The caller runs any search the subagent needs and embeds the output in the untrusted-data block.
  - The prompt lists each allowed `gh` command, and any `git ls-remote` entry, verbatim with resolved values, unquoted and in that field order, and says to run exactly those strings. It says to write `git grep` patterns in lowercase with `-i` and read a capital-`O` path with `git show`.
- **Auth.** `--restricted` drops an `apiKeyHelper` or `env` credential in the user settings file; such a user passes `--settings <file>` holding only those keys, never `permissions`, hooks, or MCP servers.
- **Timeout.** Set the host's maximum Bash timeout, or run the CLI in the background with output to a file and poll for exit.

## 4. Parse the result

`--output-format json` prints one object:

- `.result`: the output (plan, verdict, or draft).
- `.is_error`: `true` means the call failed.
- `.modelUsage`: keys name each model that served, with token counts. Never assume the requested model ran.
- `.session_id`: section 8 checks it against its UUID.
- `.permission_denials`: non-empty means a blocked command. A deny-list denial (a capital `O` in a `git grep`, for example): report it, with no entry and no re-run. A denied read the procedure needs: add its `--allowedTools` entry or `--add-dir` directory and re-run once; a read the caller runs itself (a search or `gh api` read) gets no entry. A denied write means the read-only rule failed and section 3 stopped it: report the command and never allow-list a write.

## 5. Shim failure and substitution

A shim call fails on a non-zero exit or `.is_error` `true`. After the section 7 retry, fall to ladder step 3 and report the failure and the downgrade.

Substitution: exit zero and `.is_error` false, but no `.modelUsage` key contains `fable` (any case), or the Fable key lacks the largest output-token count. A helper model with a smaller count is no substitution; name it in the report. Adopt a substituted run's output, a finished product of the dominant model, as the ladder step-3 result, and report the substitution and the downgrade; a re-run lands on the same substitute. Never present an adopted result as Fable's.

## 8. Multi-turn dispatch on the shim

On the shim path:

1. Generate one UUID per dispatch, `uuidgen | tr '[:upper:]' '[:lower:]'`, as the agent's handle; never reuse it for another dispatch.
2. The first call is the section 3 command plus `--session-id <uuid>`.
3. Each consult or re-submit is the section 3 command with the same `--model`, `--effort`, and every isolation flag, plus `--resume <uuid>`, from the first call's working directory, with the new message as the stdin prompt file.
4. Each result's `.session_id` must equal the UUID; a missing or different one is a failed resume.
5. When a resume fails twice (non-zero exit, `.is_error`, or `.session_id` mismatch), start a replacement session with a new UUID, the plan or verdict trail, and a recap of the consults, and tell the user. This is the `fable-advisor` step 5 replacement rule.
6. The section 7 snapshot brackets every call, the first and each resume.
