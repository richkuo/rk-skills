"""Regression tests pinning the security-critical routing shell in codex.yml.

The push-access boundary of the @codex workflow lives in two hand-written
shell steps inside templates/codex-workflow/workflows/codex.yml:

  - verify_invocation — decides whether a comment is a real @codex invocation,
    and (for the Codex write-route bot's own comments) whether it is the exact
    one-line "@codex review" self-trigger vs. review output that merely quotes
    @codex.
  - classify_mode — routes an invocation to the read-only `review` job or a
    push-capable job (`implement` / `fix-pr`).

A later edit to either could silently widen the write path, so this test pins
every documented outcome, including the ones the Claude bundle pins plus the
CODEX_BOT_LOGIN cases that are unique to this bundle (Claude hardcodes
claude[bot]; a Codex consumer brings its own GitHub App, so the login is a
repository variable and an unset variable must fail closed). Like the Claude
copy it does NOT re-implement the logic (a copy would drift and never catch a
workflow edit) — it EXTRACTS the real `run:` block out of the workflow YAML and
executes it in a bash subprocess with injected env, so a change to the workflow
is what the test runs against.

Run: python3 -m unittest discover -s templates/codex-workflow/scripts -p 'test_*.py'
"""

import os
import re
import subprocess
import tempfile
import unittest

HERE = os.path.dirname(__file__)
CODEX_YML = os.path.abspath(os.path.join(HERE, "..", "workflows", "codex.yml"))

VERIFY_STEP = "Verify @codex is an actual invocation (not in a code block or example)"
CLASSIFY_MODE_STEP = "Classify invocation route (review, implement, or fix-pr)"
RESOLVE_MODEL_STEP = "Resolve model from @codex invocation"
PERL_STRIP_FENCED = "s/```.*?```//gs"
SED_STRIP_INLINE = "s/`[^`]*`//g"

BOT_LOGIN = "acme-codex[bot]"


def _read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def extract_step_run_block(yml_text, step_name):
    """Return the dedented body of a step's `run: |` block, verbatim from the YAML."""
    lines = yml_text.split("\n")
    name_pat = re.compile(r"^(\s*)- name:\s*" + re.escape(step_name) + r"\s*$")
    start = None
    step_indent = None
    for idx, ln in enumerate(lines):
        m = name_pat.match(ln)
        if m:
            start = idx
            step_indent = len(m.group(1))
            break
    if start is None:
        raise AssertionError(
            f"step '{step_name}' not found in workflow — renamed? Update this extractor."
        )

    run_pat = re.compile(r"^(\s*)run:\s*\|\s*$")
    next_step_pat = re.compile(r"^ {%d}- name:" % step_indent)
    run_idx = None
    run_indent = None
    for idx in range(start + 1, len(lines)):
        if next_step_pat.match(lines[idx]):
            break
        m = run_pat.match(lines[idx])
        if m:
            run_idx = idx
            run_indent = len(m.group(1))
            break
    if run_idx is None:
        raise AssertionError(
            f"no `run: |` block found under step '{step_name}' — structure changed?"
        )

    body = []
    for idx in range(run_idx + 1, len(lines)):
        ln = lines[idx]
        if ln.strip() == "":
            body.append("")
            continue
        cur_indent = len(ln) - len(ln.lstrip())
        if cur_indent <= run_indent:
            break
        body.append(ln)

    non_blank = [l for l in body if l.strip() != ""]
    if not non_blank:
        raise AssertionError(f"step '{step_name}' has an empty run block")
    min_indent = min(len(l) - len(l.lstrip()) for l in non_blank)
    return "\n".join(l[min_indent:] if l.strip() != "" else "" for l in body)


def _run_block(script, env_overrides, output_key):
    """Execute an extracted run block with injected env; return the last value it
    wrote to GITHUB_OUTPUT under output_key (the real value is written after any
    attacker-controlled heredoc body, so last-wins is the authoritative one)."""
    with tempfile.TemporaryDirectory() as d:
        out_path = os.path.join(d, "github_output")
        open(out_path, "w").close()
        env = dict(os.environ)
        env.update(env_overrides)
        env["GITHUB_OUTPUT"] = out_path
        r = subprocess.run(["bash", "-c", script], env=env, capture_output=True, text=True)
        value = None
        prefix = output_key + "="
        with open(out_path, encoding="utf-8") as f:
            for line in f:
                if line.startswith(prefix):
                    value = line[len(prefix):].rstrip("\n")
        if value is None:
            raise AssertionError(
                f"run block wrote no {output_key}= line to GITHUB_OUTPUT; stderr:\n{r.stderr}"
            )
        return value


def run_classify_mode(
    event_name,
    stripped,
    pr_url="",
    flow="",
    pr_author_assoc="",
    pr_author_login="",
    codex_bot_login="",
):
    script = extract_step_run_block(_read(CODEX_YML), CLASSIFY_MODE_STEP)
    return _run_block(
        script,
        {
            "EVENT_NAME": event_name,
            "PR_URL": pr_url,
            "FLOW": flow,
            "STRIPPED": stripped,
            "PR_AUTHOR_ASSOC": pr_author_assoc,
            "PR_AUTHOR_LOGIN": pr_author_login,
            "CODEX_BOT_LOGIN": codex_bot_login,
        },
        "mode",
    )


def _run_block_all_outputs(script, env_overrides):
    """Execute an extracted run block with injected env; return every key it
    wrote to GITHUB_OUTPUT as a dict (last-wins per key, same rule as
    _run_block)."""
    with tempfile.TemporaryDirectory() as d:
        out_path = os.path.join(d, "github_output")
        open(out_path, "w").close()
        env = dict(os.environ)
        env.update(env_overrides)
        env["GITHUB_OUTPUT"] = out_path
        r = subprocess.run(["bash", "-c", script], env=env, capture_output=True, text=True)
        values = {}
        with open(out_path, encoding="utf-8") as f:
            for line in f:
                line = line.rstrip("\n")
                if "=" in line:
                    key, _, val = line.partition("=")
                    values[key] = val
        if not values:
            raise AssertionError(f"run block wrote no GITHUB_OUTPUT; stderr:\n{r.stderr}")
        return values


def run_resolve_model(event_name, stripped, docs_release_enabled=""):
    script = extract_step_run_block(_read(CODEX_YML), RESOLVE_MODEL_STEP)
    return _run_block_all_outputs(
        script,
        {
            "EVENT_NAME": event_name,
            "STRIPPED": stripped,
            "DOCS_RELEASE_ENABLED": docs_release_enabled,
        },
    )


def run_verify_invocation(event_name, body, trigger_actor="someuser", codex_bot_login=""):
    script = extract_step_run_block(_read(CODEX_YML), VERIFY_STEP)
    return _run_block(
        script,
        {
            "EVENT_NAME": event_name,
            "COMMENT_BODY": body,
            "REVIEW_BODY": body,
            "ISSUE_BODY": body,
            "TRIGGER_ACTOR": trigger_actor,
            "CODEX_BOT_LOGIN": codex_bot_login,
            "PERL_STRIP_FENCED": PERL_STRIP_FENCED,
            "SED_STRIP_INLINE": SED_STRIP_INLINE,
        },
        "invoked",
    )


PR_URL = "https://api.github.com/repos/o/r/pulls/5"


class ClassifyModeRoutingTest(unittest.TestCase):
    """Pin every documented route. fix-pr is the only issue_comment path that
    earns push over PR content, so its gates (trusted PR author, no 'review'
    word) are exercised against their inverses."""

    def test_trusted_member_pr_comment_no_review_word_is_fix_pr(self):
        self.assertEqual(
            run_classify_mode("issue_comment", "@codex correct the lint error",
                              pr_url=PR_URL, pr_author_assoc="MEMBER"),
            "fix-pr",
        )

    def test_trusted_owner_pr_comment_is_fix_pr(self):
        self.assertEqual(
            run_classify_mode("issue_comment", "@codex address the feedback",
                              pr_url=PR_URL, pr_author_assoc="OWNER"),
            "fix-pr",
        )

    def test_codex_bot_authored_pr_is_fix_pr(self):
        self.assertEqual(
            run_classify_mode("issue_comment", "@codex address the feedback",
                              pr_url=PR_URL, pr_author_assoc="NONE",
                              pr_author_login=BOT_LOGIN, codex_bot_login=BOT_LOGIN),
            "fix-pr",
        )

    def test_codex_bot_authored_pr_is_review_when_bot_login_unset(self):
        self.assertEqual(
            run_classify_mode("issue_comment", "@codex address the feedback",
                              pr_url=PR_URL, pr_author_assoc="NONE",
                              pr_author_login=BOT_LOGIN, codex_bot_login=""),
            "review",
        )

    def test_human_routes_still_work_when_bot_login_unset(self):
        self.assertEqual(
            run_classify_mode("issue_comment", "@codex fix the lint error",
                              pr_url=PR_URL, pr_author_assoc="MEMBER",
                              codex_bot_login=""),
            "fix-pr",
        )

    def test_other_bot_login_is_review_only(self):
        self.assertEqual(
            run_classify_mode("issue_comment", "@codex fix this",
                              pr_url=PR_URL, pr_author_assoc="NONE",
                              pr_author_login="other-bot[bot]", codex_bot_login=BOT_LOGIN),
            "review",
        )

    def test_external_author_pr_comment_is_review_only(self):
        self.assertEqual(
            run_classify_mode("issue_comment", "@codex fix the lint error",
                              pr_url=PR_URL, pr_author_assoc="NONE"),
            "review",
        )

    def test_contributor_author_pr_comment_is_review_only(self):
        self.assertEqual(
            run_classify_mode("issue_comment", "@codex fix this",
                              pr_url=PR_URL, pr_author_assoc="CONTRIBUTOR"),
            "review",
        )

    def test_review_keyword_forces_review_even_for_trusted_author(self):
        self.assertEqual(
            run_classify_mode("issue_comment", "@codex review this carefully",
                              pr_url=PR_URL, pr_author_assoc="MEMBER"),
            "review",
        )

    def test_review_keyword_after_model_shorthand_is_review(self):
        self.assertEqual(
            run_classify_mode("issue_comment", "@codex luna review",
                              pr_url=PR_URL, pr_author_assoc="MEMBER"),
            "review",
        )

    def test_review_keyword_after_uppercase_model_shorthand_is_review(self):
        self.assertEqual(
            run_classify_mode("issue_comment", "@codex Luna review",
                              pr_url=PR_URL, pr_author_assoc="MEMBER"),
            "review",
        )

    def test_fix_pr_keyword_after_uppercase_model_shorthand_routes_to_fix_pr(self):
        self.assertEqual(
            run_classify_mode("issue_comment", "@codex TERRA fix this",
                              pr_url=PR_URL, pr_author_assoc="OWNER"),
            "fix-pr",
        )

    def test_review_and_fix_loses_push_on_purpose(self):
        self.assertEqual(
            run_classify_mode("issue_comment", "@codex review and fix it",
                              pr_url=PR_URL, pr_author_assoc="OWNER"),
            "review",
        )

    def test_review_word_later_in_sentence_no_longer_forces_review(self):
        self.assertEqual(
            run_classify_mode("issue_comment", "@codex fix-pr the review comments",
                              pr_url=PR_URL, pr_author_assoc="MEMBER"),
            "fix-pr",
        )

    def test_fix_pr_keyword_routes_to_fix_pr(self):
        self.assertEqual(
            run_classify_mode("issue_comment", "@codex fix-pr",
                              pr_url=PR_URL, pr_author_assoc="MEMBER"),
            "fix-pr",
        )

    def test_fix_pr_keyword_after_model_shorthand_routes_to_fix_pr(self):
        self.assertEqual(
            run_classify_mode("issue_comment", "@codex sol fix-pr and be thorough",
                              pr_url=PR_URL, pr_author_assoc="OWNER"),
            "fix-pr",
        )

    def test_fix_pr_keyword_untrusted_pr_author_is_review_only(self):
        self.assertEqual(
            run_classify_mode("issue_comment", "@codex fix-pr",
                              pr_url=PR_URL, pr_author_assoc="NONE"),
            "review",
        )

    def test_fix_pr_keyword_on_plain_issue_is_implement(self):
        self.assertEqual(
            run_classify_mode("issue_comment", "@codex fix-pr",
                              pr_url="", pr_author_assoc="MEMBER"),
            "implement",
        )

    def test_fix_pr_keyword_on_inline_review_surface_stays_review(self):
        self.assertEqual(
            run_classify_mode("pull_request_review_comment", "@codex fix-pr",
                              pr_url=PR_URL, pr_author_assoc="OWNER"),
            "review",
        )

    def test_pull_request_review_surface_is_review(self):
        self.assertEqual(
            run_classify_mode("pull_request_review", "@codex fix this",
                              pr_url=PR_URL, pr_author_assoc="MEMBER"),
            "review",
        )

    def test_pull_request_review_comment_surface_is_review(self):
        self.assertEqual(
            run_classify_mode("pull_request_review_comment", "@codex fix this",
                              pr_url=PR_URL, pr_author_assoc="OWNER"),
            "review",
        )

    def test_issues_event_is_implement(self):
        self.assertEqual(
            run_classify_mode("issues", "@codex build this feature",
                              pr_author_assoc="MEMBER"),
            "implement",
        )

    def test_issue_comment_on_issue_is_implement(self):
        self.assertEqual(
            run_classify_mode("issue_comment", "@codex implement this",
                              pr_url="", pr_author_assoc="MEMBER"),
            "implement",
        )

    def test_flow_forces_implement(self):
        self.assertEqual(
            run_classify_mode("issue_comment", "@codex sync-docs",
                              pr_url="", flow="sync-docs", pr_author_assoc="MEMBER"),
            "implement",
        )

    def test_flow_wins_over_pr_review_word(self):
        self.assertEqual(
            run_classify_mode("issue_comment", "@codex create-release review",
                              pr_url=PR_URL, flow="create-release",
                              pr_author_assoc="MEMBER"),
            "implement",
        )


class ResolveModelTest(unittest.TestCase):
    """Pin the model-shorthand → MODEL_ID resolution and the docs/release FLOW
    matcher, extracted straight from the live YAML so a change to the shorthand
    regex or the model-id case statement is what the test runs against."""

    def test_no_shorthand_defaults_to_flagship(self):
        self.assertEqual(
            run_resolve_model("issue_comment", "@codex fix this")["model_id"],
            "gpt-5.6-sol",
        )

    def test_unknown_shorthand_falls_through_to_the_default(self):
        self.assertEqual(
            run_resolve_model("issue_comment", "@codex banana review")["model_id"],
            "gpt-5.6-sol",
        )

    def test_sol_shorthand_selects_the_flagship(self):
        self.assertEqual(
            run_resolve_model("issue_comment", "@codex sol review")["model_id"],
            "gpt-5.6-sol",
        )

    def test_terra_shorthand_selects_the_balanced_model(self):
        self.assertEqual(
            run_resolve_model("issue_comment", "@codex terra fix this")["model_id"],
            "gpt-5.6-terra",
        )

    def test_luna_shorthand_selects_the_fast_model(self):
        self.assertEqual(
            run_resolve_model("issue_comment", "@codex luna review")["model_id"],
            "gpt-5.6-luna",
        )

    def test_mini_alias_selects_the_fast_model(self):
        self.assertEqual(
            run_resolve_model("issue_comment", "@codex mini review")["model_id"],
            "gpt-5.6-luna",
        )

    def test_uppercase_luna_shorthand_selects_the_fast_model(self):
        self.assertEqual(
            run_resolve_model("issue_comment", "@codex LUNA review")["model_id"],
            "gpt-5.6-luna",
        )

    def test_codex_shorthand_selects_the_codex_spark_model(self):
        self.assertEqual(
            run_resolve_model("issue_comment", "@codex codex review")["model_id"],
            "gpt-5.3-codex-spark",
        )

    def test_default_effort_is_xhigh(self):
        self.assertEqual(
            run_resolve_model("issue_comment", "@codex review")["effort"],
            "xhigh",
        )

    def test_effort_token_overrides_the_default(self):
        self.assertEqual(
            run_resolve_model("issue_comment", "@codex review effort:medium")["effort"],
            "medium",
        )

    def test_flow_matches_create_release_with_model_shorthand(self):
        self.assertEqual(
            run_resolve_model(
                "issue_comment", "@codex luna create-release", docs_release_enabled="true"
            )["flow"],
            "create-release",
        )

    def test_flow_matches_sync_docs_without_shorthand(self):
        self.assertEqual(
            run_resolve_model(
                "issue_comment", "@codex sync-docs", docs_release_enabled="true"
            )["flow"],
            "sync-docs",
        )

    def test_flow_empty_when_docs_release_disabled(self):
        self.assertEqual(
            run_resolve_model("issue_comment", "@codex create-release")["flow"],
            "",
        )


class VerifyInvocationSelfTriggerTest(unittest.TestCase):
    """Pin the Codex bot self-trigger guard: whitespace/blank-line padding around
    an exact one-line '@codex review' must still fire, but any real second
    non-blank line must not (loop prevention). With CODEX_BOT_LOGIN unset the
    bot path must not be reachable at all."""

    def test_exact_one_line_self_trigger_fires(self):
        self.assertEqual(
            run_verify_invocation("issue_comment", "@codex review", BOT_LOGIN, BOT_LOGIN),
            "true",
        )

    def test_leading_blank_line_still_fires(self):
        self.assertEqual(
            run_verify_invocation("issue_comment", "\n@codex review", BOT_LOGIN, BOT_LOGIN),
            "true",
        )

    def test_leading_blank_and_indentation_still_fires(self):
        self.assertEqual(
            run_verify_invocation("issue_comment", "  \n   @codex review  ", BOT_LOGIN, BOT_LOGIN),
            "true",
        )

    def test_trailing_carriage_return_still_fires(self):
        self.assertEqual(
            run_verify_invocation("issue_comment", "@codex review\r", BOT_LOGIN, BOT_LOGIN),
            "true",
        )

    def test_model_shorthand_self_trigger_fires(self):
        self.assertEqual(
            run_verify_invocation("issue_comment", "@codex luna review", BOT_LOGIN, BOT_LOGIN),
            "true",
        )

    def test_effort_token_self_trigger_fires(self):
        self.assertEqual(
            run_verify_invocation(
                "issue_comment", "@codex review effort:high", BOT_LOGIN, BOT_LOGIN
            ),
            "true",
        )

    def test_second_nonblank_line_does_not_fire(self):
        self.assertEqual(
            run_verify_invocation(
                "issue_comment",
                "@codex review\nplease also fix the flaky test",
                BOT_LOGIN,
                BOT_LOGIN,
            ),
            "false",
        )

    def test_multiline_review_output_quoting_codex_does_not_fire(self):
        body = "@codex review\n\nLGTM\n### Recommended Optional\n1. Something to consider."
        self.assertEqual(
            run_verify_invocation("issue_comment", body, BOT_LOGIN, BOT_LOGIN), "false"
        )

    def test_bot_non_review_comment_does_not_fire(self):
        self.assertEqual(
            run_verify_invocation("issue_comment", "@codex fix this", BOT_LOGIN, BOT_LOGIN),
            "false",
        )

    def test_bot_self_trigger_is_unreachable_when_bot_login_unset(self):
        self.assertEqual(
            run_verify_invocation("issue_comment", "@codex review", BOT_LOGIN, ""),
            "true",
        )
        self.assertEqual(
            run_verify_invocation(
                "issue_comment", "@codex review\nand more text", BOT_LOGIN, ""
            ),
            "true",
        )

    def test_human_at_codex_invocation_fires(self):
        self.assertEqual(
            run_verify_invocation("issue_comment", "@codex fix this", "someuser", BOT_LOGIN),
            "true",
        )

    def test_human_at_codex_only_in_code_block_does_not_fire(self):
        body = "here is an example:\n```\n@codex review\n```\nthanks"
        self.assertEqual(
            run_verify_invocation("issue_comment", body, "someuser", BOT_LOGIN), "false"
        )

    def test_human_at_codex_only_in_inline_code_does_not_fire(self):
        body = "comment `@codex review` on the PR to start one"
        self.assertEqual(
            run_verify_invocation("issue_comment", body, "someuser", BOT_LOGIN), "false"
        )


if __name__ == "__main__":
    unittest.main()
