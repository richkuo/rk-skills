# richkuo-skills

Version-controlled backup of my personal Claude Code configuration — custom skills, global instructions, and slash commands.

The real files live here. On my machine they're symlinked into `~/.claude`, so editing in either place is the same file and a `git commit` here captures the change. Third-party / marketplace-installed skills are deliberately excluded (they're reinstallable and not authored by me).

## Contents

- `CLAUDE.md` — global instructions for all Claude Code sessions (linked to `~/.claude/CLAUDE.md`)
- `commands/commit.md` — the `/commit` slash command (linked to `~/.claude/commands/commit.md`)
- `skills/` — personal workflow skills (each linked to `~/.claude/skills/<name>`):
  - PR review: `fix-pr-review`, `fix-pr-review-loop`
  - Issues: `new-issue`, `new-issue-loop`, `validate-issue`, `validate-issue-loop`, `work-on-issue`, `work-on-issue-loop`
  - Docs/release: `sync-docs`, `sync-docs-release`, `create-release`
  - Fable helpers: `fable-validate`, `fable-validate-loop`, `fableplan`

## Restore on a new machine

Clone this repo, then run `./install.sh`. It symlinks every tracked item into `~/.claude`, backing up any existing file to `<name>.bak` first. It never deletes your data.

```bash
git clone git@github.com:richkuo/richkuo-skills.git ~/Work/richkuo-skills
cd ~/Work/richkuo-skills && ./install.sh
```
