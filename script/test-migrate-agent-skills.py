#!/usr/bin/env python3
import contextlib
import io
import json
import runpy
import tempfile
import unittest
from pathlib import Path

migrate = runpy.run_path(str(Path(__file__).with_name("migrate-agent-skills")))["migrate"]


class MigrationTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "dotfiles"
        self.home = Path(self.temp.name) / "home"
        self.repo = self.root / ".agents/skills"
        self.global_root = self.home / ".agents/skills"
        self.repo.mkdir(parents=True)
        self.global_root.mkdir(parents=True)

    def skill(self, base, name, text):
        path = base / name
        path.mkdir()
        (path / "SKILL.md").write_text(text)
        return path

    def read_json(self, path):
        try:
            return json.loads(path.read_text())
        except (OSError, json.JSONDecodeError) as error:
            self.fail(f"Invalid migration metadata: {error}")

    def run_migration(self):
        with contextlib.redirect_stdout(io.StringIO()):
            return migrate(self.root, self.home)

    def test_new_skills_are_imported_and_future_writes_reach_repo(self):
        self.skill(self.global_root, "new", "upstream")
        imported, preserved = self.run_migration()
        self.assertEqual(imported, ["new"])
        self.assertFalse(preserved)
        self.assertEqual((self.repo / "new/SKILL.md").read_text(), "upstream")
        self.assertTrue(self.global_root.is_symlink())
        self.assertFalse(str(self.global_root.readlink()).startswith("/"))
        self.skill(self.global_root, "later", "installed later")
        self.assertEqual((self.repo / "later/SKILL.md").read_text(), "installed later")
        self.assertEqual(len(list(self.global_root.parent.glob("skills.backup-*"))), 1)

    def test_conflicting_repo_skills_and_global_backups_survive(self):
        self.skill(self.repo, "custom", "local override")
        self.skill(self.global_root, "custom", "new upstream")
        (self.home / ".agents/.skill-lock.json").write_text(json.dumps({
            "version": 3, "skills": {"custom": {"source": "owner/repo", "skillFolderHash": "new"}},
        }))
        _, preserved = self.run_migration()
        self.assertEqual(preserved, {"custom"})
        self.assertEqual((self.repo / "custom/SKILL.md").read_text(), "local override")
        backup = next(self.global_root.parent.glob("skills.backup-*"))
        self.assertEqual((backup / "custom/SKILL.md").read_text(), "new upstream")
        lock = self.read_json(self.root / ".agents/.skill-lock.json")
        self.assertNotIn("custom", lock["skills"])

    def test_identical_skills_keep_upstream_provenance(self):
        for base in (self.repo, self.global_root):
            self.skill(base, "same", "same text")
        (self.home / ".agents/.skill-lock.json").write_text(json.dumps({
            "version": 3, "skills": {"same": {"source": "owner/repo"}},
        }))
        self.run_migration()
        link = self.home / ".agents/.skill-lock.json"
        self.assertTrue(link.is_symlink())
        self.assertEqual(self.read_json(link)["skills"]["same"]["source"], "owner/repo")
        link.write_text('{"version":3,"skills":{}}')
        self.assertEqual((self.root / ".agents/.skill-lock.json").read_text(), '{"version":3,"skills":{}}')

    def test_existing_per_skill_links_do_not_become_self_links(self):
        local = self.skill(self.repo, "linked", "local")
        (self.global_root / "linked").symlink_to(local)
        self.run_migration()
        self.assertFalse(local.is_symlink())
        self.assertEqual((self.global_root / "linked/SKILL.md").read_text(), "local")

    def test_broken_os_specific_links_are_preserved_as_relative_links(self):
        (self.global_root / "os-skill").symlink_to(self.root / "linux/vendor-skill")
        self.run_migration()
        link = self.repo / "os-skill"
        self.assertTrue(link.is_symlink())
        self.assertEqual(link.resolve(), (self.root / "linux/vendor-skill").resolve())
        self.assertFalse(str(link.readlink()).startswith("/"))

    def test_rerun_is_idempotent(self):
        self.skill(self.global_root, "new", "text")
        self.run_migration()
        before = (self.root / ".agents/.skill-lock.json").read_bytes()
        imported, preserved = self.run_migration()
        self.assertEqual(imported, [])
        self.assertFalse(preserved)
        self.assertEqual((self.root / ".agents/.skill-lock.json").read_bytes(), before)
        self.assertEqual(len(list(self.global_root.parent.glob("skills.backup-*"))), 1)

    def test_invalid_lock_aborts_before_any_files_change(self):
        self.skill(self.global_root, "new", "text")
        (self.home / ".agents/.skill-lock.json").write_text('{"version":99}')
        with self.assertRaises(ValueError):
            self.run_migration()
        self.assertFalse(self.global_root.is_symlink())
        self.assertFalse((self.repo / "new").exists())


if __name__ == "__main__":
    unittest.main()
