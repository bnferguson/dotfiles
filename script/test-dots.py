#!/usr/bin/env python3
"""Exercise dots in disposable repositories, without running real installers."""
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

SOURCE = Path(__file__).resolve().parents[1] / "bin/dots"


class DotsTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.repo = self.root / ".dotfiles"
        self.repo.mkdir()
        self.git("init", "-b", "main")
        self.git("config", "user.name", "Test")
        self.git("config", "user.email", "test@example.invalid")
        (self.repo / "file").write_text("base\n")
        self.git("add", "file")
        self.git("commit", "-m", "base")
        self.remote = self.root / "remote.git"
        self.git("clone", "--bare", str(self.repo), str(self.remote))
        self.git("remote", "add", "origin", str(self.remote))
        self.git("config", "branch.main.remote", "origin")
        self.git("config", "branch.main.merge", "refs/heads/main")
        self.git("config", "pull.rebase", "true")
        (self.repo / "bin").mkdir()
        shutil.copyfile(SOURCE, self.repo / "bin/dots")
        (self.repo / "script").mkdir()
        installer = self.repo / "script/install"
        installer.write_text('#!/bin/sh\nprintf installed > "$HOME/installed"\n')
        installer.chmod(0o755)
        self.commands = self.root / "commands"
        self.commands.mkdir()
        self.stub("uname", "echo TestOS")
        self.stub("mise", "exit 0")

    def git(self, *args, cwd=None):
        return subprocess.run(["git", "-C", str(cwd or self.repo), *args],
                              check=True, text=True, capture_output=True).stdout.strip()

    def stub(self, name, body):
        path = self.commands / name
        path.write_text("#!/bin/sh\n" + body + "\n")
        path.chmod(0o755)

    def advance_remote(self):
        upstream = self.root / "upstream"
        self.git("clone", str(self.remote), str(upstream))
        self.git("config", "user.name", "Test", cwd=upstream)
        self.git("config", "user.email", "test@example.invalid", cwd=upstream)
        (upstream / "file").write_text("upstream\n")
        self.git("add", "file", cwd=upstream)
        self.git("commit", "-m", "upstream", cwd=upstream)
        self.git("push", "origin", "main", cwd=upstream)

    def dots(self, *args, **env):
        return subprocess.run(["bash", str(self.repo / "bin/dots"), *args], cwd=self.root,
                              env={**os.environ, "HOME": str(self.root),
                                   "XDG_STATE_HOME": str(self.root / ".local/state"),
                                   "PATH": f"{self.commands}:/usr/bin:/bin", **env},
                              capture_output=True, text=True)

    def assert_installed(self, result):
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertTrue((self.root / "installed").exists())

    def test_overlapping_edits_do_not_create_stash_conflicts_or_stop_maintenance(self):
        self.advance_remote()
        self.git("config", "merge.autoStash", "true")
        self.git("config", "rebase.autoStash", "true")
        (self.repo / "file").write_text("local\n")
        result = self.dots()
        self.assert_installed(result)
        self.assertEqual((self.repo / "file").read_text(), "local\n")
        self.assertEqual(self.git("ls-files", "--unmerged"), "")
        self.assertEqual(self.git("stash", "list"), "")
        self.assertIn("!", result.stdout + result.stderr)

    def test_unrelated_edits_allow_fast_forward_with_rebase_config(self):
        (self.repo / "other").write_text("base\n")
        self.git("add", "other")
        self.git("commit", "-m", "other")
        self.git("push", "origin", "main")
        self.advance_remote()
        (self.repo / "other").write_text("local\n")
        self.assert_installed(self.dots())
        self.assertEqual((self.repo / "file").read_text(), "upstream\n")
        self.assertEqual((self.repo / "other").read_text(), "local\n")

    def test_clean_update(self):
        self.advance_remote()
        self.assert_installed(self.dots())
        self.assertEqual((self.repo / "file").read_text(), "upstream\n")

    def test_feature_branch_skips_update_without_stopping_maintenance(self):
        self.git("checkout", "-b", "feature/workspace")
        self.advance_remote()
        before = self.git("rev-parse", "HEAD")
        result = self.dots()
        self.assert_installed(result)
        self.assertEqual(self.git("rev-parse", "HEAD"), before)
        self.assertIn("Not on main", result.stdout + result.stderr)

    def test_detached_head_skips_update_without_stopping_maintenance(self):
        self.git("checkout", "--detach")
        self.advance_remote()
        before = self.git("rev-parse", "HEAD")
        result = self.dots()
        self.assert_installed(result)
        self.assertEqual(self.git("rev-parse", "HEAD"), before)
        self.assertIn("Not on main", result.stdout + result.stderr)

    def test_divergence_does_not_merge_or_stop_maintenance(self):
        self.advance_remote()
        (self.repo / "local").write_text("local\n")
        self.git("add", "local")
        self.git("commit", "-m", "local")
        before = self.git("rev-parse", "HEAD")
        result = self.dots()
        self.assert_installed(result)
        self.assertEqual(self.git("rev-parse", "HEAD"), before)
        self.assertIn("!", result.stdout + result.stderr)

    def test_fetch_failure_does_not_stop_maintenance(self):
        self.git("remote", "set-url", "origin", str(self.root / "missing.git"))
        result = self.dots()
        self.assert_installed(result)
        self.assertIn("!", result.stdout + result.stderr)

    def test_unattended_logged_run(self):
        installer = self.repo / "script/install"
        installer.write_text('#!/bin/sh\n'
                             'test "$DOTFILES_UNATTENDED" = 1 || exit 3\n'
                             'test "$DOTFILES_UPDATE" = 1 || exit 4\n'
                             'if read answer; then exit 5; fi\n'
                             'echo installer-output\n')
        result = self.dots()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        log = self.root / ".local/state/dots/latest.log"
        self.assertTrue(log.exists())
        self.assertIn("installer-output", log.read_text())
        self.assertIn("exit=0", log.read_text())
        self.assertEqual(log.stat().st_mode & 0o777, 0o600)

    def test_failed_upgrade_does_not_skip_installers(self):
        self.stub("mise", "echo upgrade-failed >&2; exit 7")
        result = self.dots()
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue((self.root / "installed").exists())
        log = self.root / ".local/state/dots/latest.log"
        self.assertIn("upgrade-failed", log.read_text())
        self.assertIn("exit=7", log.read_text())

    def test_macos_maintenance_does_not_run_setup(self):
        self.stub("uname", "echo Darwin")
        scripts = self.repo / "macos/scripts"
        scripts.mkdir(parents=True)
        for name in ["setup-sudoers.sh", "set-hostname.sh", "set-defaults.sh"]:
            path = scripts / name
            path.write_text('#!/bin/sh\necho prompted > "$HOME/prompted"\n')
            path.chmod(0o755)
        self.assert_installed(self.dots())
        self.assertFalse((self.root / "prompted").exists())

    def test_sudo_never_requests_a_password(self):
        self.stub("sudo", 'test "$1" = -n || exit 99; echo sudo-denied >&2; exit 1')
        installer = self.repo / "script/install"
        installer.write_text('#!/bin/sh\nsudo some-admin-command\n')
        result = self.dots()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("sudo-denied", result.stdout)
        self.assertNotIn("exit=99", result.stdout)

    def test_interactive_mode_restores_setup(self):
        self.stub("uname", "echo Darwin")
        scripts = self.repo / "macos/scripts"
        scripts.mkdir(parents=True)
        setup = scripts / "set-defaults.sh"
        setup.write_text('echo setup > "$HOME/setup"\n')
        result = self.dots("--interactive")
        self.assert_installed(result)
        self.assertTrue((self.root / "setup").exists())

    def test_default_run_keeps_logged_output_on_stdout(self):
        installer = self.repo / "script/install"
        installer.write_text('#!/bin/sh\necho live-output\necho error-output >&2\n'
                             'printf installed > "$HOME/installed"\n')
        result = self.dots()
        self.assert_installed(result)
        log = (self.root / ".local/state/dots/latest.log").read_text()
        for output in ["live-output", "error-output"]:
            self.assertIn(output, result.stdout)
            self.assertIn(output, log)

    def test_redundant_log_flag_is_rejected(self):
        result = self.dots("--log")
        self.assertEqual(result.returncode, 2)
        self.assertFalse((self.root / "installed").exists())

    def test_log_path_option_does_not_run_maintenance(self):
        result = self.dots("--log-path")
        self.assertEqual(result.returncode, 0)
        self.assertTrue(result.stdout.strip().endswith("/dots/latest.log"))
        self.assertFalse((self.root / "installed").exists())

    def test_existing_conflicts_stop_before_update_or_install(self):
        blob = self.git("rev-parse", "HEAD:file")
        subprocess.run(["git", "-C", str(self.repo), "update-index", "--index-info"],
                       input=f"0 {'0' * 40}\tfile\n100644 {blob} 1\tfile\n"
                             f"100644 {blob} 2\tfile\n100644 {blob} 3\tfile\n",
                       check=True, text=True, capture_output=True)
        result = self.dots()
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.root / "installed").exists())


if __name__ == "__main__":
    unittest.main()
