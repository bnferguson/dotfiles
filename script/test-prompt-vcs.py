#!/usr/bin/env python3
"""Exercise the VCS prompt without modifying any real repositories."""
import os
import subprocess
import tempfile
import time
import unittest
from pathlib import Path


PROMPT = Path(__file__).resolve().parents[1] / "bin/prompt-vcs"


class PromptTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.metadata = self.root / "virtual_branches.toml"
        self.metadata.write_text("")
        self.status = self.root / "status"
        self.status.write_bytes(b"")
        self.env = dict(os.environ, PATH=f"{self.root}:{os.environ['PATH']}",
                        TEST_BRANCH="gitbutler/workspace",
                        TEST_METADATA=str(self.metadata), TEST_STATUS=str(self.status))
        self.stub("git", '''case "$1" in
  symbolic-ref) printf '%s\\n' "$TEST_BRANCH" ;;
  rev-parse) printf '%s\\n' "$TEST_METADATA" ;;
  --no-optional-locks) cat "$TEST_STATUS" ;;
  *) exit 1 ;;
esac''')
        self.stub("starship", 'printf "%s " "$2"')
        self.stub("but", "exit 99")  # Prompt must never invoke the heavy CLI.

    def stub(self, name, body):
        path = self.root / name
        path.write_text("#!/bin/sh\n" + body + "\n")
        path.chmod(0o755)

    def render(self, metadata="", status=b""):
        self.metadata.write_text(metadata)
        self.status.write_bytes(status)
        result = subprocess.run(["sh", str(PROMPT)], env=self.env,
                                text=True, capture_output=True, check=True)
        self.assertEqual(result.stderr, "")
        return result.stdout.strip()

    def test_normal_git_delegates_to_native_modules(self):
        self.env["TEST_BRANCH"] = "main"
        self.assertEqual(self.render(), "git_branch git_status")

    def test_detached_head_delegates_to_native_modules(self):
        self.stub("git", "exit 1")
        self.assertEqual(self.render(), "git_branch git_status")

    def test_parallel_stacks_order_and_archived_heads(self):
        self.assertEqual(self.render('''
[branches.fix]
order = 1
in_workspace = true
[[branches.fix.heads]]
name = "fix"
[branches.auth]
order = 0
in_workspace = true
[[branches.auth.heads]]
name = "auth"
[[branches.auth.heads]]
name = "auth-tests"
[[branches.auth.heads]]
name = "old"
archived = true
[branches.inactive]
in_workspace = false
name = "not-applied"
''', b" M a\0?? b\0 M c\0"), "🤵 auth + auth-tests + fix · 3 changed")

    def test_empty_workspace_and_legacy_branch(self):
        self.env["TEST_BRANCH"] = "gitbutler/integration"
        self.assertEqual(self.render(), "🤵 workspace")
        self.assertEqual(self.render('''
[branches.legacy]
in_workspace = true
name = "legacy"
'''), "🤵 legacy")

    def test_long_names_and_many_branches_are_bounded(self):
        metadata = '[branches.stack]\nin_workspace = true\n'
        for name in ["x" * 80, "two", "three", "four"]:
            metadata += f'[[branches.stack.heads]]\nname = "{name}"\n'
        self.assertEqual(self.render(metadata), "🤵 " + "x" * 37 + "… + two + three +…")

    def test_control_characters_are_removed(self):
        self.assertEqual(self.render('''
[branches.stack]
in_workspace = true
[[branches.stack.heads]]
name = "a\\nb\\tc"
'''), "🤵 abc")

    def test_rename_and_newline_filename_each_count_once(self):
        self.assertEqual(self.render(status=b"R  new\0old\0?? file\nname\0"),
                         "🤵 workspace · 2 changed")

    def test_failed_or_invalid_metadata_is_visible(self):
        self.assertEqual(self.render("not toml"), "🤵 workspace · unavailable")
        self.env["TEST_METADATA"] = str(self.root / "missing.toml")
        self.assertEqual(self.render(), "🤵 workspace · unavailable")

    def test_failed_git_status_is_not_a_clean_workspace(self):
        self.stub("git", '''case "$1" in
  symbolic-ref) printf '%s\\n' "$TEST_BRANCH" ;;
  rev-parse) printf '%s\\n' "$TEST_METADATA" ;;
  *) exit 1 ;;
esac''')
        self.assertEqual(self.render(), "🤵 workspace · unavailable")

    def test_prompt_does_not_wait_for_gitbutler_cli(self):
        self.stub("but", "sleep 1; exit 99")
        start = time.monotonic()
        self.assertEqual(self.render(), "🤵 workspace")
        self.assertLess(time.monotonic() - start, 0.2)


if __name__ == "__main__":
    unittest.main()
