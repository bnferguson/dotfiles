#!/usr/bin/env python3
"""Maintenance regressions: real scripts, disposable homes and stub tools."""
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class MaintenanceTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        self.repo = self.home / "dotfiles"
        self.repo.mkdir()
        self.commands = self.home / "commands"
        self.commands.mkdir()
        self.env = {**os.environ, "HOME": str(self.home),
                    "PATH": f"{self.commands}:/usr/bin:/bin",
                    "DOTFILES_UNATTENDED": "1", "DOTFILES_UPDATE": "1"}
        self.stub("uname", "echo Darwin")
        self.stub("brew", "exit 0")
        self.stub("mise", "exit 0")
        self.stub("npm", 'echo "npm:$*:$PWD" >> "$HOME/calls"')
        self.stub("node", 'echo "node:$*" >> "$HOME/calls"')

    def stub(self, name, body):
        path = self.commands / name
        path.write_text("#!/bin/sh\n" + body + "\n")
        path.chmod(0o755)

    def copy(self, name):
        path = self.repo / name
        path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / name, path)
        path.chmod(0o755)
        return path

    def run_script(self, path, **env):
        return subprocess.run(["bash", str(path)], env={**self.env, **env},
                              cwd=self.home, stdin=subprocess.DEVNULL,
                              text=True, capture_output=True, timeout=10)

    def topic(self, name, body):
        path = self.repo / name / "install.sh"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("#!/bin/sh\n" + body + "\n")
        path.chmod(0o755)

    def pi_setup(self, body='echo "pi:$*:$PWD" >> "$HOME/calls"'):
        script = self.copy("pi/install.sh")
        ext = self.repo / "pi/config/extensions"
        ext.mkdir(parents=True)
        (ext / "package.json").write_text('{"dependencies": {}}')
        pi = self.home / ".pi/agent/bin/pi"
        pi.parent.mkdir(parents=True)
        pi.write_text("#!/bin/sh\n" + body + "\n")
        pi.chmod(0o755)
        return script

    def test_pi_and_global_packages_update_with_pins_preserved(self):
        result = self.run_script(self.pi_setup())
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        calls = (self.home / "calls").read_text()
        self.assertIn("pi:update --all --no-approve:/\n", calls)
        self.assertIn("npm:install --ignore-scripts --no-audit --no-fund:", calls)
        self.assertIn("npm:update --ignore-scripts --no-audit --no-fund:", calls)

    def test_pi_update_failure_is_reported(self):
        script = self.pi_setup('case "$1" in update) echo update-failed >&2; exit 8;; esac')
        result = self.run_script(script)
        self.assertEqual(result.returncode, 8)
        self.assertIn("update-failed", result.stderr)

    def test_bootstrap_does_not_request_pi_update(self):
        result = self.run_script(self.pi_setup(), DOTFILES_UPDATE="0")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertNotIn("update", (self.home / "calls").read_text())

    def test_missing_pi_defers_interactive_setup(self):
        script = self.copy("pi/install.sh")
        self.stub("curl", 'echo network > "$HOME/network"; exit 9')
        result = self.run_script(script)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.home / "network").exists())
        self.assertIn("initial setup", result.stderr)

    def test_npm_failure_is_not_swallowed(self):
        script = self.pi_setup()
        self.stub("npm", "exit 6")
        self.assertEqual(self.run_script(script).returncode, 6)

    def test_pi_dependency_import_failure_is_reported(self):
        script = self.pi_setup()
        self.stub("node", "exit 5")
        self.assertEqual(self.run_script(script).returncode, 5)

    def test_topic_failure_continues_and_filters_os_and_generated_trees(self):
        script = self.copy("script/install")
        self.topic("a-fails", "exit 7")
        self.topic("b-succeeds", 'echo ran > "$HOME/ran"')
        for name in ["linux/wrong-os", ".agents/skills/example", "topic/node_modules/pkg", ".cache/generated",
                     "claude/config/skills/example", "codex/config/skills/example", "pi/config/skills/example"]:
            self.topic(name, 'echo unexpected > "$HOME/unexpected"')
        result = self.run_script(script)
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue((self.home / "ran").exists())
        self.assertFalse((self.home / "unexpected").exists())
        self.assertIn("a-fails/install.sh (exit=7)", result.stdout)

    def test_package_failure_does_not_skip_topics(self):
        script = self.copy("script/install")
        self.stub("brew", "exit 9")
        self.topic("topic", 'echo ran > "$HOME/ran"')
        result = self.run_script(script)
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue((self.home / "ran").exists())
        self.assertIn("packages (exit=9)", result.stdout)

    def test_maintenance_consolidates_direct_installs_after_topics(self):
        script = self.copy("script/install")
        self.copy("script/migrate-agent-directories")
        self.stub("python3", f'exec "{sys.executable}" "$@"')
        self.topic("example", '''mkdir -p "$HOME/dotfiles/pi/config/skills/new-portable"
printf portable > "$HOME/dotfiles/pi/config/skills/new-portable/SKILL.md"''')
        result = self.run_script(script)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        native = self.repo / "pi/config/skills/new-portable"
        shared = self.repo / ".agents/skills/new-portable"
        self.assertTrue(native.is_symlink())
        self.assertEqual(native.resolve(), shared.resolve())
        self.assertEqual((shared / "SKILL.md").read_text(), "portable")
        self.assertFalse((self.home / ".claude").exists())
        self.assertFalse((self.home / ".pi").exists())

    def test_consolidation_failure_is_reported_after_topics(self):
        script = self.copy("script/install")
        self.copy("script/migrate-agent-directories")
        self.stub("python3", "exit 8")
        self.topic("example", 'echo ran > "$HOME/ran"')
        result = self.run_script(script)
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue((self.home / "ran").exists())
        self.assertIn("shared skill consolidation (exit=8)", result.stdout)
        self.assertIn("Shared skill consolidation failed", result.stderr)

    def rust_setup(self, update_status=0, component="rust-analyzer-aarch64-apple-darwin"):
        self.stub("rustup", f'''echo "rustup:$*:$PWD" >> "$HOME/calls"
case "$1" in
  default) echo 'stable-aarch64-apple-darwin (default)';;
  update) exit {update_status};;
  component) echo '{component}';;
esac''')
        return self.copy("rust/install.sh")

    def test_rust_updates_without_self_update_or_project_override(self):
        result = self.run_script(self.rust_setup())
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        calls = (self.home / "calls").read_text()
        self.assertIn("rustup:update --no-self-update:/", calls)
        self.assertIn("component list --toolchain stable-aarch64-apple-darwin --installed", calls)
        self.assertNotIn("component add", calls)

    def test_rust_update_failure_is_not_hidden(self):
        result = self.run_script(self.rust_setup(update_status=7))
        self.assertEqual(result.returncode, 7)

    def test_rust_bootstrap_does_not_update(self):
        result = self.run_script(self.rust_setup(), DOTFILES_UPDATE="0")
        self.assertEqual(result.returncode, 0)
        self.assertNotIn("rustup:update", (self.home / "calls").read_text())

    def codegraph_setup(self, current="0.9.4", installer_status=0, latest="v1.6.2"):
        self.stub("codegraph", f'echo "{current}"')
        installer = self.home / "upstream-installer"
        installer.write_text(f'''#!/bin/sh
exit_status={installer_status}
[ "$exit_status" = 0 ] || exit "$exit_status"
printf '#!/bin/sh\\necho %s\\n' "${{CODEGRAPH_VERSION#v}}" > "$HOME/commands/codegraph"
chmod +x "$HOME/commands/codegraph"
''')
        self.stub("curl", f'''echo "curl:$*" >> "$HOME/calls"
case "$*" in
  *--head*) echo 'https://github.com/colbymchenry/codegraph/releases/tag/{latest}';;
  *) while [ "$#" -gt 0 ]; do
       if [ "$1" = --output ]; then cp "$HOME/upstream-installer" "$2"; exit; fi
       shift
     done; exit 8;;
esac''')
        return self.copy("code-intel/update-codegraph.sh")

    def test_codegraph_updates_existing_install(self):
        result = self.run_script(self.codegraph_setup())
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("0.9.4 -> v1.6.2", result.stdout)
        version = subprocess.check_output([str(self.commands / "codegraph")], text=True)
        self.assertEqual(version.strip(), "1.6.2")

    def test_code_intel_updates_existing_codegraph_during_dots(self):
        self.codegraph_setup()
        result = self.run_script(self.copy("code-intel/install.sh"))
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("Updating Codegraph", result.stdout)

    def test_codegraph_current_version_does_not_download_bundle(self):
        result = self.run_script(self.codegraph_setup(current="1.6.2"))
        self.assertEqual(result.returncode, 0)
        self.assertNotIn("raw.githubusercontent", (self.home / "calls").read_text())

    def test_codegraph_installer_failure_keeps_old_launcher(self):
        result = self.run_script(self.codegraph_setup(installer_status=9))
        self.assertEqual(result.returncode, 9)
        version = subprocess.check_output([str(self.commands / "codegraph")], text=True)
        self.assertEqual(version.strip(), "0.9.4")

    def test_codegraph_unresolved_release_is_an_error(self):
        result = self.run_script(self.codegraph_setup(latest="latest"))
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("raw.githubusercontent", (self.home / "calls").read_text())

    def test_system_updates_are_deferred(self):
        script = self.copy("macos/scripts/install.sh")
        self.stub("sudo", 'echo prompted > "$HOME/prompted"; exit 3')
        result = self.run_script(script)
        self.assertEqual(result.returncode, 0)
        self.assertFalse((self.home / "prompted").exists())
        result = self.run_script(script, DOTFILES_UNATTENDED="0")
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue((self.home / "prompted").exists())


if __name__ == "__main__":
    unittest.main()
