#!/usr/bin/env python3
"""Exercise config migrations with disposable homes and real JSON/TOML files."""
import importlib.machinery
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest

import tomlkit


SCRIPT = Path(__file__).with_name("sync-agent-settings")
loader = importlib.machinery.SourceFileLoader("sync_agent_settings", str(SCRIPT))
spec = importlib.util.spec_from_loader(loader.name, loader)
sync = importlib.util.module_from_spec(spec)
loader.exec_module(sync)


class AgentSettingsTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name)
        self.repo = self.directory / "repo"
        self.home = self.directory / "home"
        self.state = self.home / ".local/state/dotfiles/agent-settings"
        self.sources = {}
        self.destinations = {}
        for name, source, destination in sync.SETTINGS:
            self.sources[name] = self.repo / source
            self.destinations[name] = self.home / destination
            self.sources[name].parent.mkdir(parents=True, exist_ok=True)
            self.sources[name].write_text('model = "shared"\n' if name == "codex" else '{}\n')

    def write_source(self, name, data):
        content = tomlkit.dumps(data) if name == "codex" else json.dumps(data)
        self.sources[name].write_text(content)

    def write_local(self, name, data):
        path = self.destinations[name]
        path.parent.mkdir(parents=True, exist_ok=True)
        content = tomlkit.dumps(data) if name == "codex" else json.dumps(data)
        path.write_text(content)

    def read_local(self, name):
        content = self.destinations[name].read_text()
        return tomlkit.parse(content).unwrap() if name == "codex" else json.loads(content)

    def run_sync(self):
        sync.sync_settings(self.repo, self.home, self.state)

    def test_symlink_migration_preserves_runtime_and_source(self):
        sources = {
            "claude": {"theme": "dark", "autoMode": {"environment": ["private"]}},
            "codex": {"model": "shared", "projects": {"/local": {"trust_level": "trusted"}},
                      "hooks": {"state": {"local": {"trusted_hash": "hash"}}},
                      "tui": {"screen_reader_detection_done": True,
                              "model_availability_nux": {"shared": 4}}},
            "pi": {"theme": "dark", "deviceId": "local-device", "lastChangelogVersion": "1.6",
                   "extensionChangelogVersions": {"extension": "2"}},
        }
        for name, data in sources.items():
            self.write_source(name, data)
            destination = self.destinations[name]
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.symlink_to(self.sources[name])
        before = {name: path.read_bytes() for name, path in self.sources.items()}
        self.run_sync()
        for name, data in sources.items():
            self.assertFalse(self.destinations[name].is_symlink())
            self.assertEqual(self.read_local(name), data)
            self.assertEqual(self.sources[name].read_bytes(), before[name])
            saved = self.state / "backups" / f"{name}-{self.destinations[name].name}"
            self.assertEqual(saved.read_bytes(), before[name])
            self.assertEqual(saved.stat().st_mode & 0o777, 0o600)
        self.assertNotIn("deviceId", json.loads((self.state / "pi.json").read_text()))
        self.assertNotIn("projects", json.loads((self.state / "codex.json").read_text()))

    def test_shared_updates_and_removals_keep_local_keys_and_list_entries(self):
        self.write_source("claude", {"permissions": {"allow": ["shared-old"], "defaultMode": "old"},
                                     "hooks": {"SessionStart": [{"command": "old"}]}})
        self.write_local("claude", {"permissions": {"allow": ["shared-old", "local"],
                                                   "deny": ["private"]},
                                    "hooks": {"SessionStart": [{"command": "old"}, {"command": "local"}]},
                                    "localOnly": True})
        self.run_sync()
        self.write_source("claude", {"permissions": {"allow": ["shared-new"]}})
        self.run_sync()
        self.assertEqual(self.read_local("claude"), {
            "permissions": {"allow": ["shared-new", "local"], "deny": ["private"]},
            "hooks": {"SessionStart": [{"command": "local"}]}, "localOnly": True,
        })

    def test_removed_mcp_table_preserves_local_servers(self):
        self.write_source("codex", {"model": "shared", "mcp_servers": {"retired": {"command": "old"}}})
        self.write_local("codex", {"mcp_servers": {"retired": {"command": "old"},
                                                  "private": {"command": "local"}}})
        self.run_sync()
        self.write_source("codex", {"model": "new"})
        self.run_sync()
        self.assertEqual(self.read_local("codex"), {
            "model": "new", "mcp_servers": {"private": {"command": "local"}},
        })

    def test_repeated_sync_does_not_rewrite_and_app_edits_stay_local(self):
        self.write_source("pi", {"theme": "dark", "packages": ["shared"]})
        self.run_sync()
        self.write_local("pi", {"theme": "light", "packages": ["shared", "local"], "deviceId": "mine"})
        self.run_sync()
        snapshots = {path: (path.read_bytes(), path.stat().st_mtime_ns)
                     for path in self.destinations.values()}
        self.run_sync()
        self.assertEqual(self.read_local("pi"), {
            "theme": "dark", "packages": ["shared", "local"], "deviceId": "mine",
        })
        for path, snapshot in snapshots.items():
            self.assertEqual((path.read_bytes(), path.stat().st_mtime_ns), snapshot)
        self.assertEqual(json.loads(self.sources["pi"].read_text()), {"theme": "dark", "packages": ["shared"]})

    def test_toml_local_comments_and_quoted_tables_survive(self):
        destination = self.destinations["codex"]
        destination.parent.mkdir(parents=True)
        destination.write_text('# local note\nmodel = "old"\n\n# trust\n[projects."/a.b"]\ntrust_level = "trusted"\n')
        self.run_sync()
        self.assertIn("# local note", destination.read_text())
        self.assertIn("# trust", destination.read_text())
        self.assertEqual(self.read_local("codex")["projects"]["/a.b"]["trust_level"], "trusted")

    def test_invalid_config_leaves_all_destinations_untouched(self):
        self.write_local("claude", {"theme": "local"})
        self.sources["pi"].write_text("invalid JSON")
        with self.assertRaises(ValueError):
            self.run_sync()
        self.assertEqual(self.read_local("claude"), {"theme": "local"})
        self.assertFalse(self.destinations["codex"].exists())
        self.assertFalse((self.state / "claude.json").exists())

    def test_unmanaged_symlink_is_not_replaced(self):
        external = self.directory / "private.json"
        external.write_text('{"private": true}')
        destination = self.destinations["claude"]
        destination.parent.mkdir(parents=True)
        destination.symlink_to(external)
        with self.assertRaisesRegex(ValueError, "unmanaged"):
            self.run_sync()
        self.assertTrue(destination.is_symlink())
        self.assertEqual(external.read_text(), '{"private": true}')

    def test_private_managed_settings_are_untouched(self):
        managed = self.directory / "private/claude/managed-settings.json"
        managed.parent.mkdir(parents=True)
        managed.write_text('{"autoMode":{"environment":["private"]}}\n')
        drop_in = self.directory / "managed-settings.d/50-dotfiles-private.json"
        drop_in.parent.mkdir()
        drop_in.symlink_to(managed)
        self.run_sync()
        self.assertTrue(drop_in.is_symlink())
        self.assertEqual(managed.read_text(), '{"autoMode":{"environment":["private"]}}\n')


if __name__ == "__main__":
    os.umask(0o077)
    unittest.main()
