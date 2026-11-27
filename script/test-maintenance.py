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
        # These fixtures exercise maintenance ordering, without installing an overlay.
        overlay = self.repo / "script/link-private-overlay"
        overlay.parent.mkdir()
        overlay.write_text("# No private overlay in this disposable repository.\n")
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
        self.copy("pi/apply-powerline-patch.sh")
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

    def test_tools_are_installed_and_activated_before_consumers(self):
        script = self.copy("script/install")
        self.copy("mise/install.sh")
        self.copy("mise/config.toml")
        tools = self.home / "managed-bin"
        tools.mkdir()
        for name in ["npm", "go", "gh"]:
            tool = tools / name
            tool.write_text("#!/bin/sh\nexit 0\n")
            tool.chmod(0o755)
        self.stub("mise", '''case "$*" in
  *install*)
    grep -q '^go = ' "$MISE_GLOBAL_CONFIG_FILE" || exit 17
    touch "$HOME/tools-installed";;
  *env*)
    test -f "$HOME/tools-installed" || exit 18
    echo "export PATH=\\\"$HOME/managed-bin:$PATH\\\"";;
esac''')
        self.topic("a-consumer", '''test -f "$HOME/tools-installed" || exit 19
for tool in npm go gh; do
  test "$(command -v "$tool")" = "$HOME/managed-bin/$tool" || exit 20
done''')
        result = self.run_script(script)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertLess(result.stdout.index("mise/install.sh"), result.stdout.index("a-consumer"))

    def test_settings_are_detached_before_agent_installers(self):
        script = self.copy("script/install")
        self.copy("script/sync-agent-settings")
        self.stub("uv", '''test "$*" = "run --no-project --script script/sync-agent-settings" || exit 18
touch "$HOME/settings-synced"''')
        self.topic("agent", 'test -f "$HOME/settings-synced" || exit 19')
        result = self.run_script(script)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_settings_migration_failure_stops_agent_installers(self):
        script = self.copy("script/install")
        self.copy("script/sync-agent-settings")
        self.stub("uv", "exit 7")
        self.topic("agent", 'touch "$HOME/agent-updated"')
        result = self.run_script(script)
        self.assertEqual(result.returncode, 7)
        self.assertFalse((self.home / "agent-updated").exists())

    def debian_setup(self):
        script = self.copy("script/install-debian")
        (self.commands / "mise").unlink()
        self.stub("apt-get", 'echo "apt:$*" >> "$HOME/calls"')
        self.stub("id", "echo 0")
        # Each downloaded installer creates its executable in the documented
        # destination. Nothing touches the host's package manager or network.
        self.stub("curl", '''echo "curl:$*" >> "$HOME/calls"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --output) destination="$2"; shift;;
    https://mise.run) tool=mise;;
    https://astral.sh/uv/install.sh) tool=uv;;
    https://sh.rustup.rs) tool=rustup;;
    https://starship.rs/install.sh) tool=starship;;
  esac
  shift
done
printf '#!/bin/sh\\nmkdir -p "$HOME/.local/bin" "$HOME/.cargo/bin"\\nprintf "#!/bin/sh\\\\nexit 0\\\\n" > "$HOME/.local/bin/%s"\\nchmod +x "$HOME/.local/bin/%s"\\n' "$tool" "$tool" > "$destination"
''')
        return script

    def test_debian_installs_prerequisites_and_reruns_without_downloads(self):
        script = self.debian_setup()
        result = self.run_script(script)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        for tool in ["mise", "uv", "rustup", "starship"]:
            self.assertTrue((self.home / ".local/bin" / tool).is_file())
        calls = (self.home / "calls").read_text()
        self.assertIn("build-essential", calls)
        self.assertIn("syncthing", calls)
        (self.home / "calls").unlink()
        result = self.run_script(script)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertNotIn("curl:", (self.home / "calls").read_text())

    def test_debian_download_failure_is_reported(self):
        script = self.debian_setup()
        self.stub("curl", "exit 22")
        result = self.run_script(script)
        self.assertEqual(result.returncode, 22)
        self.assertFalse((self.home / ".local/bin/uv").exists())

    def test_debian_package_failure_stops_prerequisite_downloads(self):
        script = self.debian_setup()
        self.stub("apt-get", "exit 9")
        self.stub("curl", 'touch "$HOME/downloaded"')
        result = self.run_script(script)
        self.assertEqual(result.returncode, 9)
        self.assertFalse((self.home / "downloaded").exists())

    def test_debian_non_root_uses_sudo(self):
        script = self.debian_setup()
        self.stub("id", "echo 1000")
        self.stub("sudo", 'echo "sudo:$*" >> "$HOME/calls"; exec "$@"')
        result = self.run_script(script)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("sudo:apt-get update", (self.home / "calls").read_text())

    def test_failed_mise_environment_is_reported_and_topics_continue(self):
        script = self.copy("script/install")
        self.stub("mise", 'case "$*" in *env*) exit 8;; esac')
        self.topic("topic", 'echo ran > "$HOME/ran"')
        result = self.run_script(script)
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue((self.home / "ran").exists())
        self.assertIn("Could not load the mise tool environment", result.stderr)

    def test_package_failure_does_not_skip_topics(self):
        script = self.copy("script/install")
        self.stub("brew", "exit 9")
        self.topic("topic", 'echo ran > "$HOME/ran"')
        result = self.run_script(script)
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue((self.home / "ran").exists())
        self.assertIn("packages (exit=9)", result.stdout)

    def test_omarchy_sets_the_browser_behind_its_launcher(self):
        script = self.copy("script/install")
        (self.commands / "brew").unlink()
        self.stub("omarchy", "exit 0")
        self.stub("sudo", "exit 0")
        self.stub("xdg-settings", '''case "$1" in
  get)
    if [ -n "$XDG_CURRENT_DESKTOP" ] || [ -n "$BROWSER" ]; then
      echo omarchy-browser.desktop
    elif [ -f "$HOME/browser" ]; then
      cat "$HOME/browser"
    fi
    ;;
  set)
    [ -z "$XDG_CURRENT_DESKTOP$BROWSER" ] || exit 4
    [ "$*" = "set default-web-browser firefox.desktop" ] || exit 5
    echo firefox.desktop > "$HOME/browser"
    echo set-browser >> "$HOME/calls"
    ;;
esac''')
        for _ in range(2):
            result = self.run_script(
                script, DOTFILES_UNATTENDED="0", XDG_CURRENT_DESKTOP="Hyprland", BROWSER="omarchy-launch-browser",
            )
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn("packages (exit=0)", result.stdout)
        self.assertEqual((self.home / "calls").read_text(), "set-browser\n")

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
