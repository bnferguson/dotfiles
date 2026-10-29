#!/usr/bin/env python3
"""Exercise pinning and installation against a disposable upstream repository."""
import json
import os
from pathlib import Path
import runpy
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch


SOURCE = Path(__file__).resolve().parents[1]
SYNC = runpy.run_path(str(SOURCE / "bin/pstack-sync"))


class PstackTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.root = self.directory / "dotfiles"
        self.root.mkdir()
        (self.root / "pstack/adapters").mkdir(parents=True)
        shutil.copyfile(SOURCE / "pstack/adapters/shared.md", self.root / "pstack/adapters/shared.md")
        (self.root / ".cache").mkdir()
        self.remote = self.directory / "remote"
        self.remote.mkdir()
        self.git("init", "-b", "main")
        self.git("config", "user.name", "Test")
        self.git("config", "user.email", "test@example.invalid")
        self.put("pstack/plugin.json", '{"version":"1.0"}\n')
        self.put("pstack/LICENSE", "fixture license\n")
        self.put("pstack/skills/how/SKILL.md",
                 '---\nname: how\ndescription: Explain behavior.\ndisable-model-invocation: true\n---\n'
                 '# How\n\nRead [why](../why/SKILL.md).\n'
                 '[Upstream why](https://github.com/cursor/plugins/blob/main/pstack/skills/why/SKILL.md).\n')
        self.put("pstack/skills/why/SKILL.md", '---\nname: why\ndescription: Find context.\n---\n# Why\n')
        self.put("pstack/skills/how/scripts/run", "#!/bin/sh\nexit 0\n")
        (self.remote / "pstack/skills/how/scripts/run").chmod(0o755)
        self.commit()
        shutil.copytree(self.remote / "pstack", self.root / "pstack/upstream")
        source = SYNC["files"](self.root / "pstack/upstream")
        generated = SYNC["render"](self.root, source)
        self.write_lock({"format": 1, "repository": str(self.remote), "branch": "main", "path": "pstack",
                         "commit": self.git("rev-parse", "HEAD"), "tree": self.git("rev-parse", "HEAD:pstack"),
                         "version": "1.0", "generated_sha256": SYNC["fingerprint"](generated)})

    def git(self, *args):
        return subprocess.run(["git", *args], cwd=self.remote, check=True,
                              text=True, capture_output=True).stdout.strip()

    def put(self, name, content):
        path = self.remote / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)

    def commit(self):
        self.git("add", ".")
        self.git("commit", "-m", "fixture")

    def lock(self):
        return json.loads((self.root / "pstack/lock.json").read_text())

    def write_lock(self, lock):
        (self.root / "pstack/lock.json").write_text(json.dumps(lock))

    def command(self, command, success=True):
        result = subprocess.run([str(SOURCE / "bin/pstack-sync"), command, "--root", str(self.root)],
                                capture_output=True, text=True)
        if success:
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        else:
            self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        return result

    def test_offline_install_preserves_references_modes_and_local_skills(self):
        shutil.rmtree(self.remote)
        local = self.root / ".agents/skills/how/SKILL.md"
        local.parent.mkdir(parents=True)
        local.write_text("local skill")
        before = (self.root / "pstack/lock.json").read_bytes()
        self.command("install")
        self.command("install")
        self.command("verify")
        skill = self.root / ".agents/skills/pstack-how"
        self.assertTrue(skill.is_symlink())
        self.assertIn("name: pstack-how", (skill / "SKILL.md").read_text())
        self.assertIn("../pstack-why/SKILL.md", (skill / "SKILL.md").read_text())
        self.assertNotIn("https://github.com", (skill / "SKILL.md").read_text())
        self.assertTrue((skill / "../pstack-why/SKILL.md").exists())
        self.assertTrue((skill / "../../adapter.md").exists())
        self.assertTrue(os.access(skill / "scripts/run", os.X_OK))
        self.assertIn("false", (skill / "agents/openai.yaml").read_text())
        self.assertEqual(local.read_text(), "local skill")
        self.assertEqual(before, (self.root / "pstack/lock.json").read_bytes())
        self.assertEqual((self.root / "pstack/generated/LICENSE").read_text(), "fixture license\n")

    def test_check_ignores_unrelated_changes_and_reports_package_updates_without_writes(self):
        self.put("other/file", "unrelated")
        self.commit()
        before = (self.root / "pstack/lock.json").read_bytes()
        self.assertIn("up to date", self.command("check").stdout)
        self.put("pstack/LICENSE", "changed")
        self.commit()
        self.assertIn("pstack-sync update", self.command("check").stdout)
        self.assertEqual(before, (self.root / "pstack/lock.json").read_bytes())
        self.assertFalse((self.root / "pstack/generated").exists())

    def test_update_advances_pin_and_prunes_only_owned_links(self):
        self.command("install")
        shutil.rmtree(self.remote / "pstack/skills/why")
        self.put("pstack/skills/how/SKILL.md", '---\nname: how\ndescription: Updated behavior.\n---\n# How\n')
        self.put("pstack/skills/new/SKILL.md", '---\nname: new\ndescription: New behavior.\n---\n# New\n')
        self.commit()
        unrelated = self.root / ".agents/skills/pstack-personal"
        unrelated.symlink_to("../personal")
        self.command("update")
        self.command("verify")
        self.assertEqual(self.lock()["commit"], self.git("rev-parse", "HEAD"))
        self.assertFalse((self.root / ".agents/skills/pstack-why").is_symlink())
        self.assertTrue((self.root / ".agents/skills/pstack-new/SKILL.md").exists())
        self.assertTrue(unrelated.is_symlink())

    def test_source_and_adapter_drift_fail_verification(self):
        adapter = self.root / "pstack/adapters/shared.md"
        adapter.write_text(adapter.read_text() + "\nChanged adapter\n")
        self.assertIn("Adapter output changed", self.command("verify", success=False).stderr)
        self.command("update")
        self.command("verify")
        (self.root / "pstack/upstream/LICENSE").write_text("local change")
        before = (self.root / "pstack/lock.json").read_bytes()
        self.command("install", success=False)
        self.command("update", success=False)
        self.assertEqual(before, (self.root / "pstack/lock.json").read_bytes())

    def test_collision_refuses_install_before_publishing(self):
        occupied = self.root / ".agents/skills/pstack-how"
        occupied.mkdir(parents=True)
        (occupied / "SKILL.md").write_text("personal override")
        self.command("install", success=False)
        self.assertEqual((occupied / "SKILL.md").read_text(), "personal override")
        self.assertFalse((self.root / "pstack/generated").exists())

    def test_invalid_upstream_update_keeps_previous_pin_and_installation(self):
        self.command("install")
        before = (self.root / "pstack/lock.json").read_bytes()
        self.put("pstack/skills/how/SKILL.md", "missing frontmatter")
        self.commit()
        self.command("update", success=False)
        self.command("verify")
        self.assertEqual(before, (self.root / "pstack/lock.json").read_bytes())

    def test_broken_skill_reference_rejects_update(self):
        self.command("install")
        before = (self.root / "pstack/lock.json").read_bytes()
        shutil.rmtree(self.remote / "pstack/skills/why")
        self.commit()
        self.command("update", success=False)
        self.assertEqual(before, (self.root / "pstack/lock.json").read_bytes())
        self.command("verify")

    def test_invalid_plugin_manifest_keeps_previous_source(self):
        before = (self.root / "pstack/upstream/plugin.json").read_bytes()
        self.put("pstack/plugin.json", "invalid json")
        self.commit()
        self.command("update", success=False)
        self.command("verify")
        self.assertEqual(before, (self.root / "pstack/upstream/plugin.json").read_bytes())

    def test_generated_drift_is_detected_and_install_repairs_it(self):
        self.command("install")
        path = self.root / "pstack/generated/skills/pstack-how/scripts/run"
        path.write_text("changed")
        self.command("verify", success=False)
        self.command("install")
        self.command("verify")
        self.assertEqual(path.read_text(), "#!/bin/sh\nexit 0\n")

    def test_install_preserves_runtime_dependency_caches(self):
        self.command("install")
        modules = self.root / "pstack/generated/skills/pstack-how/scripts/node_modules"
        modules.mkdir()
        (modules / "dependency").write_text("runtime cache")
        (modules / "alias").symlink_to("dependency")
        self.command("verify")
        self.command("install")
        self.assertEqual((modules / "dependency").read_text(), "runtime cache")

    def test_git_tree_includes_executable_modes(self):
        source = SYNC["files"](self.root / "pstack/upstream")
        self.assertEqual(SYNC["git_tree"](source), self.lock()["tree"])
        content, _ = source["skills/how/scripts/run"]
        source["skills/how/scripts/run"] = (content, False)
        self.assertNotEqual(SYNC["git_tree"](source), self.lock()["tree"])

    def test_publication_failures_preserve_source_and_pin(self):
        self.command("install")
        source = SYNC["files"](self.root / "pstack/upstream")
        proposed = {**source, "LICENSE": (b"new license\n", False)}
        lock = {**self.lock(), "tree": SYNC["git_tree"](proposed)}
        before = (self.root / "pstack/lock.json").read_bytes()
        original_rename = Path.rename
        original_replace = Path.replace

        def fail_snapshot(path, target):
            if path.name == "upstream" and path.parent.name.startswith(".incoming-"):
                raise OSError("snapshot publication failed")
            return original_rename(path, target)

        def fail_lock(path, target):
            if path.name == "lock.json" and path.parent.name.startswith(".incoming-"):
                raise OSError("lock publication failed")
            return original_replace(path, target)

        for method, failure in [("rename", fail_snapshot), ("replace", fail_lock)]:
            with self.subTest(method=method), patch.object(Path, method, failure):
                with self.assertRaises(OSError):
                    SYNC["publish_update"](self.root, proposed, lock)
            self.assertEqual(SYNC["files"](self.root / "pstack/upstream"), source)
            self.assertEqual((self.root / "pstack/lock.json").read_bytes(), before)
            self.command("verify")
        self.command("update")


if __name__ == "__main__":
    unittest.main()
