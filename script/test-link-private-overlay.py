#!/usr/bin/env python3
import os
import runpy
import subprocess
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("link-private-overlay")
module = runpy.run_path(str(SCRIPT))
link_overlay, install_hook = module["link_overlay"], module["install_hook"]
link_managed_settings = module["link_managed_settings"]
BEGIN, END = module["BEGIN"], module["END"]


class OverlayTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        base = Path(self.temp.name).resolve()
        self.root, self.private = base / "public", base / "private"
        self.root.mkdir()
        self.private.mkdir()
        subprocess.run(["git", "init", "-q", str(self.root)], check=True)
        self.exclude = self.root / ".git/info/exclude"

    def put(self, path, text="x"):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
        return path

    def skill(self, name):
        return self.put(self.private / ".agents/skills" / name / "SKILL.md").parent

    def untracked(self):
        return subprocess.run(
            ["git", "-C", str(self.root), "status", "--porcelain", "--untracked-files=all"],
            check=True, capture_output=True, text=True).stdout

    def test_skills_and_agents_link_relatively_and_stay_untracked(self):
        skill = self.skill("soffi-deploy")
        agent = self.put(self.private / "claude/config/agents/soffi-reviewer.md")
        self.put(self.exclude, "*.log\n")

        link_overlay(self.root, self.private)

        shared = self.root / ".agents/skills/soffi-deploy"
        for path, target in [(shared, skill),
                             (self.root / "claude/config/skills/soffi-deploy", shared),
                             (self.root / "claude/config/agents/soffi-reviewer.md", agent)]:
            self.assertTrue(path.is_symlink())
            self.assertFalse(os.path.isabs(os.readlink(path)))
            self.assertEqual(path.resolve(), target.resolve())
        self.assertEqual(self.untracked(), "")
        self.assertTrue(self.exclude.read_text().startswith("*.log\n"))

    def test_rerun_is_idempotent(self):
        self.skill("soffi-deploy")
        link_overlay(self.root, self.private)
        first = self.exclude.read_text()
        link_overlay(self.root, self.private)
        self.assertEqual(self.exclude.read_text(), first)
        self.assertEqual(first.count(BEGIN), 1)

    def test_folders_without_skill_md_are_ignored(self):
        (self.private / ".agents/skills/draft").mkdir(parents=True)
        self.assertEqual(link_overlay(self.root, self.private), [])
        self.assertFalse(self.exclude.exists() and BEGIN in self.exclude.read_text())

    def test_repo_content_is_never_replaced(self):
        self.skill("pr")
        public = self.put(self.root / ".agents/skills/pr/SKILL.md", "public").parent
        link_overlay(self.root, self.private)
        self.assertFalse(public.is_symlink())
        self.assertEqual((public / "SKILL.md").read_text(), "public")
        self.assertNotIn("/.agents/skills/pr\n", self.exclude.read_text())

    def test_removed_overlay_entries_are_unlinked(self):
        skill = self.skill("soffi-deploy")
        link_overlay(self.root, self.private)
        (skill / "SKILL.md").unlink()
        skill.rmdir()

        link_overlay(self.root, self.private)

        for path in [".agents/skills/soffi-deploy", "claude/config/skills/soffi-deploy"]:
            self.assertFalse(os.path.lexists(self.root / path))
        self.assertNotIn(BEGIN, self.exclude.read_text())

    def test_missing_overlay_cleans_up_old_links(self):
        self.skill("soffi-deploy")
        link_overlay(self.root, self.private)
        self.private.rename(self.private.with_name("moved"))
        link_overlay(self.root, self.private)
        self.assertFalse(os.path.lexists(self.root / ".agents/skills/soffi-deploy"))

    def test_promoted_skill_keeps_its_claude_link(self):
        skill = self.skill("soffi-deploy")
        link_overlay(self.root, self.private)
        shared = self.root / ".agents/skills/soffi-deploy"
        shared.unlink()
        skill.rename(shared)

        link_overlay(self.root, self.private)

        claude = self.root / "claude/config/skills/soffi-deploy"
        self.assertTrue(claude.is_symlink())
        self.assertEqual(claude.resolve(), shared)
        self.assertIn("claude/config/skills/soffi-deploy", self.untracked())

    def test_hook_installs_once_and_respects_existing_hooks(self):
        install_hook(self.root)
        hook = self.root / ".git/hooks/pre-commit"
        self.assertEqual(hook.resolve(), self.root / "script/check-private-leaks")
        install_hook(self.root)

        hook.unlink()
        self.put(hook, "#!/bin/sh\n")
        install_hook(self.root)
        self.assertFalse(hook.is_symlink())

    def test_invalid_managed_settings_are_not_linked(self):
        self.put(self.private / "claude/managed-settings.json", "{ nope")
        managed = self.root / "managed"
        link_managed_settings(self.private, managed, use_sudo=False)
        self.assertFalse(os.path.lexists(managed / module["DROP_IN"]))


class GuardTest(unittest.TestCase):
    GUARD = SCRIPT.with_name("check-private-leaks")

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        base = Path(self.temp.name)
        self.root, self.private = base / "public", base / "private"
        self.private.mkdir()
        subprocess.run(["git", "init", "-q", str(self.root)], check=True)

    def stage(self, relative, text):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
        subprocess.run(["git", "-C", str(self.root), "add", relative], check=True)

    def guard(self):
        env = {**os.environ, "DOTFILES_PRIVATE": str(self.private)}
        return subprocess.run([str(self.GUARD)], cwd=self.root, env=env,
                              capture_output=True, text=True)

    def test_clean_commit_passes(self):
        self.stage("claude/config/settings.json", '{"model": "opus"}')
        self.assertEqual(self.guard().returncode, 0)

    def test_auto_mode_block_is_refused(self):
        self.stage("claude/config/settings.json", '{"autoMode": {"environment": []}}')
        result = self.guard()
        self.assertEqual(result.returncode, 1)
        self.assertIn("autoMode", result.stderr)

    def test_denylist_matches_added_lines_case_insensitively(self):
        (self.private / "denylist").write_text("# work\n\nAcme-Internal\n")
        self.stage("notes.md", "deploy to acme-internal.example\n")
        result = self.guard()
        self.assertEqual(result.returncode, 1)
        self.assertIn("notes.md: deploy to acme-internal.example", result.stderr)

    def test_denylist_ignores_unrelated_lines(self):
        (self.private / "denylist").write_text("acme-internal\n")
        self.stage("notes.md", "nothing private\n")
        self.assertEqual(self.guard().returncode, 0)


if __name__ == "__main__":
    unittest.main()
