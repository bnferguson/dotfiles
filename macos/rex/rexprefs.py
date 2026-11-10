"""Sync Rex.app preferences between macOS defaults and the dotfiles repo.

Rex keeps its UI settings (fonts, themes, tab layout, server toggles) in the
com.superlogical.rex defaults domain, next to window frames, focus history,
and server routes that are per-machine runtime state. Only the settings are
synced. Custom themes are stored by Rex as a JSON blob inside a data value, so
they are decoded into themes.json to keep diffs readable. Key bindings made
in Rex's Settings window live in a separate shortcuts.json, which is copied
rather than linked because the app may replace the file when it saves.
"""

import json
import os
import plistlib
import shutil
import subprocess
import sys
from pathlib import Path

DOMAIN = os.environ.get("REX_DEFAULTS_DOMAIN", "com.superlogical.rex")
HERE = Path(__file__).resolve().parent
SETTINGS_FILE = HERE / "settings.json"
THEMES_FILE = HERE / "themes.json"
THEMES_KEY = "Workspace.customThemes"
SHORTCUTS_FILE = HERE / "shortcuts.json"
APP_SHORTCUTS_FILE = Path(
    os.environ.get(
        "REX_SHORTCUTS_FILE",
        "~/Library/Application Support/com.superlogical.rex/Shortcuts/shortcuts.json",
    )
).expanduser()

SYNCED_PREFIXES = ("Workspace.", "rex.")

# Runtime state that shares the synced prefixes but must stay per-machine.
EXCLUDED_KEYS = {
    "Workspace.lastFocusedSession",
    "Workspace.programActivitySeen",
    "rex.local-server.cached-route.v1",
    "rex.sync.hosts-migrated.v1",
}


def is_synced(key):
    return key.startswith(SYNCED_PREFIXES) and key not in EXCLUDED_KEYS


def read_domain():
    out = subprocess.run(
        ["defaults", "export", DOMAIN, "-"], check=True, capture_output=True
    ).stdout
    return plistlib.loads(out)


def export():
    prefs = read_domain()
    settings = {k: v for k, v in prefs.items() if is_synced(k) and k != THEMES_KEY}

    unsupported = [k for k, v in settings.items() if not isinstance(v, (str, bool, int, float, list))]
    if unsupported:
        sys.exit(f"error: unsupported value types for {', '.join(unsupported)}")

    SETTINGS_FILE.write_text(json.dumps(dict(sorted(settings.items())), indent=2) + "\n")
    print(f"exported {len(settings)} settings → {SETTINGS_FILE}")

    if THEMES_KEY in prefs:
        themes = json.loads(prefs[THEMES_KEY])
        THEMES_FILE.write_text(json.dumps(themes, indent=2, sort_keys=True) + "\n")
        print(f"exported {len(themes)} custom themes → {THEMES_FILE}")

    if APP_SHORTCUTS_FILE.exists():
        shutil.copyfile(APP_SHORTCUTS_FILE, SHORTCUTS_FILE)
        print(f"exported shortcuts → {SHORTCUTS_FILE}")


def write_args(value):
    # bool must be checked before int: bool is an int subclass in Python.
    if isinstance(value, bool):
        return ["-bool", "true" if value else "false"]
    if isinstance(value, int):
        return ["-int", str(value)]
    if isinstance(value, float):
        return ["-float", repr(value)]
    if isinstance(value, str):
        return ["-string", value]
    if isinstance(value, list) and all(isinstance(v, str) for v in value):
        return ["-array", *value]
    raise ValueError(f"unsupported value: {value!r}")


def write(key, args):
    subprocess.run(["defaults", "write", DOMAIN, key, *args], check=True)


def rex_running():
    return subprocess.run(["pgrep", "-xq", "Rex"]).returncode == 0


def import_():
    if not SETTINGS_FILE.exists():
        sys.exit(f"error: no settings file at {SETTINGS_FILE}")

    if rex_running():
        print("warning: Rex is running and may overwrite these settings when it quits; restart it after importing")

    settings = json.loads(SETTINGS_FILE.read_text())
    for key, value in settings.items():
        write(key, write_args(value))
    print(f"imported {len(settings)} settings")

    if THEMES_FILE.exists():
        # Rex expects compact JSON bytes, not the pretty-printed repo copy.
        themes = json.loads(THEMES_FILE.read_text())
        blob = json.dumps(themes, separators=(",", ":")).encode()
        write(THEMES_KEY, ["-data", blob.hex()])
        print(f"imported {len(themes)} custom themes")

    if SHORTCUTS_FILE.exists():
        APP_SHORTCUTS_FILE.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(SHORTCUTS_FILE, APP_SHORTCUTS_FILE)
        print(f"imported shortcuts → {APP_SHORTCUTS_FILE}")


if __name__ == "__main__":
    {"export": export, "import": import_}[sys.argv[1]]()
