"""Unit tests for patch_claude_comment.sh — bot-login + run-id selection (#1178).

Run: python3 .github/scripts/test_patch_claude_comment.py

The review job binds the agent to the job-scoped token, so its comments post
as github-actions[bot] instead of claude[bot]. The patch script must select
the latest comment authored by $BOT_LOGIN (default claude[bot]) rather than a
hard-coded login. github-actions[bot] is a shared author (any workflow can
post as it), so when $RUN_ID is set the selection is further constrained to
the action's own tracking comment, which embeds the /actions/runs/<run_id>
link — never another workflow's comment. gh is stubbed with a fake executable
on PATH; the script's comment recomposition (compose_claude_comment.py) runs
for real.
"""

import json
import os
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent / "patch_claude_comment.sh"

COMMENTS_PAGE = [
    [
        {
            "id": 101,
            "user": {"login": "claude[bot]"},
            "updated_at": "2026-07-01T00:00:00Z",
            "body": "review body from claude[bot]\n"
            "[View job](https://github.com/o/r/actions/runs/111)",
        },
        {
            "id": 202,
            "user": {"login": "github-actions[bot]"},
            "updated_at": "2026-07-01T01:00:00Z",
            "body": "review body from github-actions[bot]\n"
            "[View job](https://github.com/o/r/actions/runs/222)",
        },
        {
            "id": 303,
            "user": {"login": "someuser"},
            "updated_at": "2026-07-01T02:00:00Z",
            "body": "human comment",
        },
        {
            "id": 404,
            "user": {"login": "github-actions[bot]"},
            "updated_at": "2026-07-01T03:00:00Z",
            "body": "unrelated workflow comment, newer than the review comment\n"
            "[Nightly report](https://github.com/o/r/actions/runs/999)",
        },
    ]
]

FAKE_GH = """#!/usr/bin/env bash
# Fake gh for tests: a --paginate fetch prints the canned comments page; a
# --method call (PATCH/POST) records its argv (one arg per line) and prints
# nothing; a bare `gh api repos/.../issues/comments/<id>` GET (the
# TARGET_COMMENT_ID path) prints the canned single comment.
set -euo pipefail
if printf '%s\\n' "$@" | grep -q -- '--paginate'; then
  cat "$GH_STUB_COMMENTS"
elif printf '%s\\n' "$@" | grep -q -- '--method'; then
  printf '%s\\n' "$@" >> "$GH_STUB_PATCH_LOG"
else
  cat "${GH_STUB_SINGLE:-/dev/null}"
fi
"""

def run_patch_script(tmp_path: Path, extra_env: dict, single_comment=None):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    gh = bin_dir / "gh"
    gh.write_text(FAKE_GH)
    gh.chmod(gh.stat().st_mode | stat.S_IEXEC)

    comments = tmp_path / "comments.json"
    comments.write_text(json.dumps(COMMENTS_PAGE))
    patch_log = tmp_path / "patch.log"

    env = os.environ.copy()
    env.update(
        {
            "PATH": f"{bin_dir}:{env['PATH']}",
            "GH_STUB_COMMENTS": str(comments),
            "GH_STUB_PATCH_LOG": str(patch_log),
            "REPO": "o/r",
            "ISSUE_NUMBER": "1178",
            "GH_TOKEN": "test-token",
            "MODEL_ID": "claude-sonnet-5",
            "EFFORT": "xhigh",
            "CLAUDE_HARNESS": "anthropics/claude-code-action@v1",
        }
    )

    if single_comment is not None:
        single = tmp_path / "single.json"
        single.write_text(json.dumps(single_comment))
        env["GH_STUB_SINGLE"] = str(single)
    env.update(extra_env)

    result = subprocess.run(
        ["bash", str(SCRIPT)],
        cwd=SCRIPT.parent,
        env=env,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    log = patch_log.read_text() if patch_log.exists() else ""
    return result.stdout, log

class PatchClaudeCommentTest(unittest.TestCase):
    def _run(self, extra_env, single_comment=None):
        with tempfile.TemporaryDirectory() as d:
            return run_patch_script(Path(d), extra_env, single_comment)[1]

    def _run_full(self, extra_env, single_comment=None):
        with tempfile.TemporaryDirectory() as d:
            return run_patch_script(Path(d), extra_env, single_comment)

    def test_default_bot_login_patches_claude_bot_comment(self):
        patched = self._run({})
        self.assertIn("repos/o/r/issues/comments/101", patched)
        self.assertIn("body from claude[bot]", patched)

    def test_bot_login_override_without_run_id_takes_latest_by_author(self):

        patched = self._run({"BOT_LOGIN": "github-actions[bot]"})
        self.assertIn("repos/o/r/issues/comments/404", patched)

    def test_run_id_selects_own_comment_despite_newer_same_author(self):

        patched = self._run({"BOT_LOGIN": "github-actions[bot]", "RUN_ID": "222"})
        self.assertIn("repos/o/r/issues/comments/202", patched)
        self.assertIn("body from github-actions[bot]", patched)

    def test_run_id_without_match_is_a_clean_noop(self):

        patched = self._run({"BOT_LOGIN": "github-actions[bot]", "RUN_ID": "555"})
        self.assertEqual(patched, "")

    def test_run_id_match_is_not_a_prefix_match(self):

        patched = self._run({"BOT_LOGIN": "github-actions[bot]", "RUN_ID": "22"})
        self.assertEqual(patched, "")

    def test_run_id_also_constrains_default_claude_bot(self):
        patched = self._run({"RUN_ID": "111"})
        self.assertIn("repos/o/r/issues/comments/101", patched)

    def test_no_matching_comment_is_a_clean_noop(self):
        patched = self._run({"BOT_LOGIN": "nobody[bot]"})
        self.assertEqual(patched, "")

    def test_on_miss_post_creates_new_status_comment(self):

        patched = self._run(
            {
                "BOT_LOGIN": "github-actions[bot]",
                "RUN_ID": "555",
                "ON_MISS": "post",
                "STATUS_NOTE": "**Workflow failed before completion.** See run log.",
            }
        )
        self.assertIn("--method\nPOST", patched)
        self.assertIn("repos/o/r/issues/1178/comments", patched)
        self.assertIn("Workflow failed before completion", patched)
        self.assertNotIn("PATCH", patched)

    def test_on_miss_post_still_patches_when_own_comment_exists(self):
        patched = self._run(
            {
                "BOT_LOGIN": "github-actions[bot]",
                "RUN_ID": "222",
                "ON_MISS": "post",
                "STATUS_NOTE": "**Workflow failed before completion.** See run log.",
            }
        )
        self.assertIn("repos/o/r/issues/comments/202", patched)
        self.assertNotIn("--method\nPOST", patched)

    def test_on_miss_post_without_status_note_is_a_noop(self):

        patched = self._run(
            {"BOT_LOGIN": "github-actions[bot]", "RUN_ID": "555", "ON_MISS": "post"}
        )
        self.assertEqual(patched, "")

    def test_select_only_emits_run_matched_comment_id_without_patching(self):

        out, log = self._run_full(
            {"BOT_LOGIN": "github-actions[bot]", "RUN_ID": "222", "SELECT_ONLY": "1"}
        )
        self.assertEqual(out, "202")
        self.assertEqual(log, "")

    def test_select_only_emits_empty_string_on_miss(self):

        out, log = self._run_full(
            {"BOT_LOGIN": "github-actions[bot]", "RUN_ID": "555", "SELECT_ONLY": "1"}
        )
        self.assertEqual(out, "")
        self.assertEqual(log, "")

    def test_target_comment_id_patches_that_comment_bypassing_selection(self):

        single = {
            "id": 202,
            "user": {"login": "claude[bot]"},
            "updated_at": "2026-07-01T01:00:00Z",
            "body": "primary work comment from claude[bot]",
        }
        patched = self._run({"TARGET_COMMENT_ID": "202"}, single_comment=single)
        self.assertIn("repos/o/r/issues/comments/202", patched)
        self.assertIn("primary work comment", patched)
        self.assertIn("--method\nPATCH", patched)
        self.assertNotIn("issues/comments/101", patched)

if __name__ == "__main__":
    unittest.main()

