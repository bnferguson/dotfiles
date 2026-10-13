#!/usr/bin/env python3
import os
import json
import runpy
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


SCRIPT = Path(__file__).with_name("migrate-agent-directories")
module = runpy.run_path(str(SCRIPT))
migrate, ROOTS = module["migrate"], module["ROOTS"]
skills_only = module["skills_only"]


class MigrationTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "repo"
        self.home = Path(self.temp.name) / "home"
        self.root.mkdir()
        self.home.mkdir()

    def put(self, path, text="original"):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
        return path

    def run_migration(self):
        return migrate(self.root, self.home)

    def assert_relative(self, path, target):
        self.assertTrue(path.is_symlink())
        self.assertFalse(os.path.isabs(path.readlink()))
        self.assertEqual(path.resolve(), target.resolve())

    def test_all_roots_are_write_through_and_backups_private(self):
        for live, _ in ROOTS:
            self.put(self.home / live / "existing/SKILL.md")
        backup = self.run_migration()
        self.assertEqual(stat.S_IMODE(backup.stat().st_mode), 0o700)
        self.assertTrue(backup.is_relative_to((self.home / ".local/state/dotfiles/migrations").resolve()))
        for live, repo in ROOTS:
            self.assert_relative(self.home / live, self.root / repo)
            self.put(self.home / live / "future/SKILL.md", "future")
            self.assertEqual((self.root / repo / "future/SKILL.md").read_text(), "future")
            self.assertEqual((backup / live / "existing/SKILL.md").read_text(), "original")

    def test_recursive_merge_preserves_repo_conflicts_and_originals(self):
        for live, repo in ROOTS:
            self.put(self.home / live / "skill/SKILL.md", "upstream")
            self.put(self.home / live / "skill/deep/new.txt", "missing")
            self.put(self.root / repo / "skill/SKILL.md", "override")
            self.put(self.home / live / ".DS_Store")
        backup = self.run_migration()
        for live, repo in ROOTS:
            self.assertEqual((self.root / repo / "skill/SKILL.md").read_text(), "override")
            self.assertEqual((self.root / repo / "skill/deep/new.txt").read_text(), "missing")
            self.assertEqual((backup / live / "skill/SKILL.md").read_text(), "upstream")
            self.assertFalse((self.root / repo / ".DS_Store").exists())

    def test_shared_aliases_native_overrides_and_no_codex_pi_catalog(self):
        shared = self.root / ".agents/skills"
        for name in ("alias", "new", "override"):
            self.put(shared / name / "SKILL.md")
        live = self.home / ".claude/skills"
        self.put(live / "override/SKILL.md", "native")
        (live / "alias").symlink_to(self.home / ".agents/skills/alias")
        self.put(shared / "not-a-skill/readme.txt")
        self.run_migration()
        native = self.root / "claude/config/skills"
        for name in ("alias", "new"):
            self.assert_relative(native / name, shared / name)
        self.assert_relative(native / "override", shared / "override")
        self.assertEqual((native / "override/SKILL.md").read_text(), "original")
        self.assertFalse((native / "not-a-skill").exists())
        for repo in ("codex/config/skills", "pi/config/skills"):
            self.assertEqual(list((self.root / repo).iterdir()), [])

    def test_same_target_links_do_not_replace_repo_directories(self):
        self.put(self.root / ".agents/agent-specific-skills.json",
                 json.dumps({"claude": ["skill-creator"]}))
        destination = self.root / "claude/config/skills/skill-creator"
        self.put(destination / "SKILL.md", "repo")
        live = self.home / ".claude/skills"
        live.mkdir(parents=True)
        (live / "skill-creator").symlink_to(destination)
        self.run_migration()
        self.assertFalse(destination.is_symlink())
        self.assertEqual((destination / "SKILL.md").read_text(), "repo")

    def test_imported_links_keep_original_referents_including_broken_links(self):
        live = self.home / ".claude/rules"
        live.mkdir(parents=True)
        external = self.put(self.home / "external/rule.md")
        (live / "valid").symlink_to("../../external/rule.md")
        (live / "broken").symlink_to("../../external/missing.md")
        self.run_migration()
        repo = self.root / "claude/config/rules"
        self.assert_relative(repo / "valid", external)
        self.assert_relative(repo / "broken", external.parent / "missing.md")
        self.assertFalse((repo / "broken").exists())

    def test_idempotence_and_empty_roots(self):
        self.assertIsNone(self.run_migration())
        before = [(self.home / live).readlink() for live, _ in ROOTS]
        self.assertIsNone(self.run_migration())
        self.assertEqual(before, [(self.home / live).readlink() for live, _ in ROOTS])
        self.assertFalse((self.home / ".local").exists())
        self.assertTrue(all((self.root / repo).is_dir() for _, repo in ROOTS))

    def test_existing_correct_links_do_not_create_more_backups(self):
        self.put(self.home / ".claude/rules/one")
        first = self.run_migration()
        self.assertIsNone(self.run_migration())
        self.assertEqual(list(first.parent.iterdir()), [first])

    def test_generated_synced_snapshot_is_not_recursively_merged(self):
        live = self.home / ".claude/skills/synced"
        repo = self.root / "claude/config/skills/synced"
        self.put(live / "catalog/secret.md", "private")
        self.put(live / "new/SKILL.md", "generated")
        self.put(repo / "catalog/secret.md", "repo")
        backup = self.run_migration()
        self.assertEqual((repo / "catalog/secret.md").read_text(), "repo")
        self.assertFalse((repo / "new").exists())
        self.assertEqual((backup / ".claude/skills/synced/new/SKILL.md").read_text(), "generated")

    def test_absent_generated_snapshot_is_imported(self):
        self.put(self.home / ".claude/skills/synced/catalog/SKILL.md")
        self.run_migration()
        self.assertTrue((self.root / "claude/config/skills/synced/catalog/SKILL.md").is_file())

    def test_destination_directory_alias_is_never_followed(self):
        external = self.root / ".agents/skills/shared"
        self.put(external / "SKILL.md", "shared")
        destination = self.root / "claude/config/skills/shared"
        destination.parent.mkdir(parents=True)
        destination.symlink_to(external)
        self.put(self.home / ".claude/skills/shared/new.txt", "native")
        backup = self.run_migration()
        self.assertFalse((external / "new.txt").exists())
        self.assertTrue(destination.is_symlink())
        self.assertTrue((backup / ".claude/skills/shared/new.txt").exists())

    def test_unsafe_paths_fail_before_any_root_changes(self):
        cases = ("unrelated", "target-alias", "parent-alias", "file", "cycle", "repo-cycle", "ancestor-cycle", "state-alias")
        for case in cases:
            with self.subTest(case=case), tempfile.TemporaryDirectory() as directory:
                root, home = Path(directory) / "repo", Path(directory) / "home"
                self.put(home / ".claude/rules/first")
                root.mkdir()
                outside = Path(directory) / "outside"
                self.put(outside / "untouched")
                live, repo = home / ".pi/agent/skills", root / "pi/config/skills"
                live.parent.mkdir(parents=True)
                repo.parent.mkdir(parents=True)
                if case == "unrelated":
                    live.symlink_to(outside)
                elif case == "target-alias":
                    repo.symlink_to(outside)
                elif case == "parent-alias":
                    (home / ".codex").symlink_to(outside)
                elif case == "file":
                    live.write_text("not a directory")
                elif case in ("cycle", "repo-cycle", "ancestor-cycle"):
                    base = repo if case == "repo-cycle" else live
                    base.mkdir()
                    (base / "loop").symlink_to("." if case == "ancestor-cycle" else "loop")
                else:
                    (home / ".local").symlink_to(outside)
                with self.assertRaises(ValueError):
                    migrate(root, home)
                self.assertFalse((home / ".claude/rules").is_symlink())
                self.assertFalse((root / "claude").exists())
                self.assertEqual(list(outside.iterdir()), [outside / "untouched"])

    def test_failed_root_link_restores_original_directory(self):
        live = self.home / ".claude/rules"
        self.put(live / "local.md", "original")
        linker = migrate.__globals__["relative_link"]

        canonical_live = self.home.resolve() / ".claude/rules"

        def fail_root(target, path):
            if path == canonical_live:
                raise OSError("link failed")
            linker(target, path)

        with patch.dict(migrate.__globals__, relative_link=fail_root), self.assertRaises(OSError):
            self.run_migration()
        self.assertFalse(live.is_symlink())
        self.assertEqual((live / "local.md").read_text(), "original")

    def test_generated_catalog_is_git_ignored_but_new_installs_are_visible(self):
        self.put(self.home / ".claude/skills/synced/private/SKILL.md", "generated")
        self.put(self.home / ".claude/skills/.trash/removed/SKILL.md", "deleted")
        self.put(self.home / ".codex/skills/.system/bundled/SKILL.md", "bundled")
        self.run_migration()
        ignore_file = SCRIPT.parent.parent / ".gitignore"
        self.put(self.root / ".gitignore", ignore_file.read_text())
        subprocess.run(["git", "init", "-q", str(self.root)], check=True)
        self.put(self.home / ".claude/skills/new-local/SKILL.md", "new")
        visible = subprocess.check_output(
            ["git", "-C", str(self.root), "status", "--porcelain", "--untracked-files=all"], text=True)
        self.assertIn("claude/config/skills/new-local/SKILL.md", visible)
        self.assertNotIn("synced", visible)
        self.assertNotIn(".trash", visible)
        self.assertNotIn(".system", visible)
        ignored = subprocess.run(
            ["git", "-C", str(self.root), "check-ignore", "--quiet",
             "claude/config/skills/synced/private/SKILL.md"])
        self.assertEqual(ignored.returncode, 0)

    def test_future_native_installs_consolidate_with_roots_already_linked(self):
        self.run_migration()
        skill = self.home / ".pi/agent/skills/future"
        self.put(skill / "SKILL.md", "future")
        backup = self.run_migration()
        canonical = self.root / ".agents/skills/future"
        self.assert_relative(skill, canonical)
        self.assertEqual((canonical / "SKILL.md").read_text(), "future")
        self.assertEqual((backup / "repo/pi/config/skills/future/SKILL.md").read_text(), "future")
        self.assertIsNone(self.run_migration())
        self.assertEqual(list(backup.parent.iterdir()), [backup])

    def test_agents_share_one_whole_definition(self):
        for agent, text in (("claude", "first"), ("codex", "second"), ("pi", "third")):
            self.put(self.root / agent / "config/skills/common/SKILL.md", text)
            self.put(self.root / agent / f"config/skills/common/{text}.txt", text)
        backup = self.run_migration()
        common = self.root / ".agents/skills/common"
        self.assertEqual(sorted(p.name for p in common.iterdir()), ["SKILL.md", "first.txt"])
        for agent, text in (("claude", "first"), ("codex", "second"), ("pi", "third")):
            self.assert_relative(self.root / agent / "config/skills/common", common)
            self.assertEqual((backup / f"repo/{agent}/config/skills/common/SKILL.md").read_text(), text)

    def test_shared_whole_tree_wins_and_duplicate_backups_are_private(self):
        shared = self.root / ".agents/skills/common"
        self.put(shared / "SKILL.md", "override")
        self.put(shared / "only-shared.txt", "keep")
        self.put(self.root / "claude/config/skills/common/SKILL.md", "native")
        self.put(self.root / "claude/config/skills/common/deep/native.txt", "private")
        before = {p.relative_to(shared): p.read_bytes() for p in shared.rglob("*") if p.is_file()}
        backup = self.run_migration()
        after = {p.relative_to(shared): p.read_bytes() for p in shared.rglob("*") if p.is_file()}
        self.assertEqual(before, after)
        self.assertEqual(stat.S_IMODE(backup.stat().st_mode), 0o700)
        self.assertTrue((backup / "repo/claude/config/skills/common/deep/native.txt").is_file())
        self.put(self.root / "codex/config/skills/common/SKILL.md", "override")
        second = self.run_migration()
        self.assertTrue((second / "repo/codex/config/skills/common/SKILL.md").is_file())

    def test_declared_exceptions_remain_native(self):
        self.put(self.root / ".agents/agent-specific-skills.json", json.dumps({
            "claude": ["deep-research", "skill-creator"], "codex": ["deep-research"], "pi": []}))
        for agent in ("claude", "codex", "pi"):
            for name in ("deep-research", "skill-creator"):
                self.put(self.root / agent / f"config/skills/{name}/SKILL.md", agent)
        self.run_migration()
        for agent in ("claude", "codex", "pi"):
            for name in ("deep-research", "skill-creator"):
                skill = self.root / agent / f"config/skills/{name}"
                expected = agent == "pi" or (agent == "codex" and name == "skill-creator")
                self.assertEqual(skill.is_symlink(), expected)

    def test_invalid_manifests_are_rejected_before_mutation(self):
        invalid = [[], {"other": []}, {"claude": "one"}, {"pi": [1]},
                   {"pi": ["../escape"]}, {"pi": [".hidden"]}, {"pi": ["synced"]},
                   {"pi": ["a/b"]}, {"pi": [""]}, {"pi": ["a\\\\b"]}]
        self.put(self.home / ".claude/rules/unchanged")
        for data in invalid:
            with self.subTest(data=data):
                self.put(self.root / ".agents/agent-specific-skills.json", json.dumps(data))
                for operation in (migrate, skills_only):
                    with self.assertRaises(ValueError):
                        operation(self.root, self.home)
                self.assertFalse((self.home / ".claude/rules").is_symlink())
                self.assertFalse((self.root / "claude").exists())
                self.assertFalse((self.home / ".local").exists())

    def test_skill_collision_and_shared_alias_preflight(self):
        for case in ("shared-file", "shared-nonskill", "shared-alias", "ancestor-alias", "native-file"):
            with self.subTest(case=case), tempfile.TemporaryDirectory() as directory:
                root, home = Path(directory) / "repo", Path(directory) / "home"
                root.mkdir()
                self.put(home / ".claude/rules/unchanged")
                self.put(home / ".pi/agent/skills/collision/SKILL.md")
                shared = root / ".agents/skills"
                if case == "shared-file":
                    self.put(shared / "collision")
                elif case == "shared-nonskill":
                    self.put(shared / "collision/readme")
                elif case == "native-file":
                    self.put(root / "pi/config/skills/collision")
                else:
                    outside = Path(directory) / "outside"
                    self.put(outside / "SKILL.md")
                    if case == "shared-alias":
                        shared.mkdir(parents=True)
                        (shared / "collision").symlink_to(outside)
                    else:
                        (root / ".agents").symlink_to(outside)
                with self.assertRaises(ValueError):
                    migrate(root, home)
                self.assertFalse((home / ".claude/rules").is_symlink())
                self.assertFalse((root / "claude").exists())

    def test_generated_top_level_skills_and_external_links_are_not_promoted(self):
        for agent in ("claude", "codex", "pi"):
            for name in ("synced", ".trash", ".system", ".hidden"):
                self.put(self.root / agent / f"config/skills/{name}/SKILL.md")
                self.put(self.root / agent / f"config/skills/{name}/nested/SKILL.md")
        native = self.root / "pi/config/skills"
        external = self.home / "package/skill"
        self.put(external / "SKILL.md")
        (native / "package").symlink_to(external)
        self.assertIsNone(self.run_migration())
        self.assertFalse((self.root / ".agents/skills").exists())
        self.assertTrue((native / "package").is_symlink())
        self.assertIsNone(self.run_migration())

    def test_failed_skill_link_restores_native_tree(self):
        skill = self.root / "pi/config/skills/local"
        self.put(skill / "SKILL.md", "original")
        linker = migrate.__globals__["relative_link"]

        def fail_skill(target, path):
            if path == skill.resolve():
                raise OSError("link failed")
            linker(target, path)

        with patch.dict(migrate.__globals__, relative_link=fail_skill), self.assertRaises(OSError):
            self.run_migration()
        self.assertFalse(skill.is_symlink())
        self.assertEqual((skill / "SKILL.md").read_text(), "original")

    def test_skills_only_handles_future_write_through_install_for_all_agents(self):
        self.run_migration()
        skill = self.home / ".codex/skills/future"
        self.put(skill / "SKILL.md", "installed")
        backup = skills_only(self.root, self.home)
        canonical = self.root / ".agents/skills/future"
        self.assert_relative(skill, canonical)
        self.assertTrue((backup / "repo/codex/config/skills/future/SKILL.md").is_file())
        self.assert_relative(self.root / "claude/config/skills/future", canonical)
        self.assertIsNone(skills_only(self.root, self.home))

    def test_promoted_links_preserve_internal_and_external_targets(self):
        native = self.root / "pi/config/skills/linked"
        internal = self.put(native / "assets/internal.txt", "internal")
        external = self.put(self.root / "pi/config/outside.txt", "external")
        self.put(native / "SKILL.md")
        (native / "inside").symlink_to("assets/internal.txt")
        (native / "outside").symlink_to("../../outside.txt")
        self.run_migration()
        canonical = self.root / ".agents/skills/linked"
        self.assert_relative(canonical / "inside", canonical / "assets/internal.txt")
        self.assert_relative(canonical / "outside", external)
        self.assertEqual((canonical / "inside").read_text(), internal.read_text())
        self.assertEqual((canonical / "outside").read_text(), "external")

    def test_empty_legacy_native_folder_does_not_block_shared_link(self):
        shared = self.root / ".agents/skills/legacy"
        self.put(shared / "SKILL.md", "shared")
        native = self.root / "claude/config/skills/legacy"
        self.put(native / ".DS_Store", "finder")
        unrelated = self.root / "claude/config/skills/unrelated"
        self.put(unrelated / "custom.txt", "keep")
        self.put(self.root / ".agents/skills/unrelated/SKILL.md", "shared")
        backup = self.run_migration()
        self.assert_relative(native, shared)
        self.assertEqual((backup / "repo/claude/config/skills/legacy/.DS_Store").read_text(), "finder")
        self.assertFalse(unrelated.is_symlink())
        self.assertEqual((unrelated / "custom.txt").read_text(), "keep")

    def test_failed_import_does_not_publish_partial_shared_tree(self):
        native = self.root / "pi/config/skills/partial"
        self.put(native / "SKILL.md", "original")
        copier = migrate.__globals__["shutil"].copytree

        def fail_copy(source, destination, **kwargs):
            copier(source, destination, **kwargs)
            raise OSError("copy failed")

        with patch.object(migrate.__globals__["shutil"], "copytree", side_effect=fail_copy), self.assertRaises(OSError):
            skills_only(self.root, self.home)
        self.assertFalse((self.root / ".agents/skills/partial").exists())
        self.assertEqual(list((self.root / ".agents/skills").iterdir()), [])
        self.assertFalse(native.is_symlink())
        self.assertEqual((native / "SKILL.md").read_text(), "original")

    def test_incoming_common_conflict_does_not_mix_tree_or_lock(self):
        shared = self.root / ".agents/skills/common"
        self.put(shared / "SKILL.md", "shared")
        lock = self.put(self.root / ".agents/.skill-lock.json", '{"skills": {}}')
        self.put(self.home / ".codex/skills/common/SKILL.md", "incoming")
        self.put(self.home / ".codex/skills/common/extra.txt", "private")
        backup = self.run_migration()
        self.assertEqual(list(shared.iterdir()), [shared / "SKILL.md"])
        self.assertEqual(lock.read_text(), '{"skills": {}}')
        self.assert_relative(self.home / ".codex/skills/common", shared)
        self.assertEqual((backup / "repo/codex/config/skills/common/extra.txt").read_text(), "private")
        self.assertTrue((backup / ".codex/skills/common/extra.txt").is_file())

    def test_skills_only_preflight_rejects_unsafe_paths_before_any_promotion(self):
        for case in ("state", "shared", "native", "collision"):
            with self.subTest(case=case), tempfile.TemporaryDirectory() as directory:
                root, home = Path(directory) / "repo", Path(directory) / "home"
                home.mkdir()
                skill = root / "claude/config/skills/first"
                self.put(skill / "SKILL.md")
                outside = Path(directory) / "outside"
                outside.mkdir()
                if case == "state":
                    (home / ".local").symlink_to(outside)
                elif case == "shared":
                    (root / ".agents").symlink_to(outside)
                elif case == "native":
                    (root / "pi").symlink_to(outside)
                else:
                    self.put(root / ".agents/skills/first/not-a-skill")
                with self.assertRaises(ValueError):
                    skills_only(root, home)
                self.assertFalse(skill.is_symlink())
                self.assertEqual(list(outside.iterdir()), [])

    def test_skills_only_cli_does_not_create_roots_or_merge_home(self):
        self.put(self.home / ".claude/skills/live/SKILL.md", "live")
        result = subprocess.run([str(SCRIPT), "--skills-only", "--root", str(self.root),
                                 "--home", str(self.home)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse((self.home / ".claude/skills").is_symlink())
        self.assertEqual(list(self.root.iterdir()), [])
        self.assertFalse((self.home / ".local").exists())

    def test_cli_uses_only_fixture_paths(self):
        result = subprocess.run([str(SCRIPT), "--root", str(self.root), "--home", str(self.home)],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue((self.home / ".claude/skills").is_symlink())


if __name__ == "__main__":
    unittest.main()
