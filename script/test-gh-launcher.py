#!/usr/bin/env python3
"""Keep gh invocation independent of installation and network access."""
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LEGACY = '''#!/bin/bash
export MISE_MINIMUM_RELEASE_AGE=0
mise use -g --quiet "gh" || exit 1
exec mise x "gh" -- "gh" "$@"
'''


class GhLauncherTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.commands = self.root / "commands"
        self.commands.mkdir()
        self.local = self.root / ".local/bin"
        self.local.mkdir(parents=True)
        self.gh = self.local / "gh"
        self.selected = self.root / "selected gh"
        self.selected.write_text('#!/bin/sh\nprintf "%s\\n" "$@"\nexit "${GH_STATUS:-0}"\n')
        self.selected.chmod(0o755)
        mise = self.commands / "mise"
        mise.write_text('''#!/bin/sh
printf '%s\\n' "$*" >> "$HOME/mise-calls"
[ "$*" = 'which gh' ] || exit 99
[ "${MISSING_GH:-0}" = 0 ] || exit 42
printf '%s\\n' "$HOME/selected gh"
''')
        mise.chmod(0o755)
        self.env = {**os.environ, "HOME": str(self.root),
                    "PATH": f"{self.local}:{self.commands}:/usr/bin:/bin"}

    def run_command(self, command, **env):
        return subprocess.run(command, env={**self.env, **env}, cwd=self.root,
                              text=True, capture_output=True, timeout=5)

    def launcher(self, *args, **env):
        return self.run_command(["sh", str(ROOT / "gh/gh"), *args], **env)

    def test_passes_arguments_and_exit_status_without_installation(self):
        result = self.launcher("api", "a b", "$(literal)", GH_STATUS="7")
        self.assertEqual(result.returncode, 7, result.stderr)
        self.assertEqual(result.stdout, "api\na b\n$(literal)\n")
        self.assertEqual((self.root / "mise-calls").read_text(), "which gh\n")

    def test_missing_selected_version_fails_without_installing(self):
        result = self.launcher("--version", MISSING_GH="1")
        self.assertEqual(result.returncode, 42, result.stderr)
        self.assertEqual(result.stdout, "")
        self.assertEqual((self.root / "mise-calls").read_text(), "which gh\n")

    def test_migrates_legacy_wrapper_before_extension_commands_and_keeps_backup(self):
        self.gh.write_text(LEGACY)
        self.gh.chmod(0o755)
        result = self.run_command(["sh", str(ROOT / "gh/install.sh")])
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(self.gh.read_text(), (ROOT / "gh/gh").read_text())
        backups = list(self.local.glob("gh.mise-backup.*"))
        self.assertEqual(len(backups), 1)
        self.assertEqual(backups[0].read_text(), LEGACY)
        again = self.run_command(["sh", str(ROOT / "gh/install.sh")])
        self.assertEqual(again.returncode, 0, again.stderr)
        self.assertEqual(len(list(self.local.glob("gh.mise-backup.*"))), 1)

    def test_leaves_unknown_launcher_untouched(self):
        custom = '#!/bin/sh\nexit 0\n'
        self.gh.write_text(custom)
        self.gh.chmod(0o755)
        result = self.run_command(["sh", str(ROOT / "gh/install.sh")])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.gh.read_text(), custom)
        self.assertEqual(list(self.local.glob("gh.mise-backup.*")), [])


if __name__ == "__main__":
    unittest.main()
