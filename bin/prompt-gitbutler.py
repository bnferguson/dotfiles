#!/usr/bin/env python3
"""Read GitButler's local workspace names without loading commit history."""
import subprocess
import tomllib
from pathlib import Path


def git(*args):
    return subprocess.run(["git", *args], check=True, capture_output=True).stdout


def summary():
    metadata = Path(git("rev-parse", "--git-path",
                        "gitbutler/virtual_branches.toml").decode().strip())
    with metadata.open("rb") as file:
        branches = tomllib.load(file).get("branches", {})
    names = []
    # GitButler stores applied stacks in workspace order, including empty heads.
    for branch in sorted(branches.values(), key=lambda branch: branch.get("order", 0)):
        if not branch.get("in_workspace", False):
            continue
        heads = branch.get("heads", [{"name": branch.get("name", "")}])
        for head in heads:
            if head.get("archived", False):
                continue
            name = "".join(char for char in head["name"] if char.isprintable())
            if name:
                names.append(name[:37] + "…" if len(name) > 40 else name)

    # NUL-delimited porcelain handles filenames with newlines and rename pairs.
    records = iter(git("--no-optional-locks", "status", "--porcelain=v1", "-z",
                       "--untracked-files=all").split(b"\0"))
    changed = 0
    for record in records:
        if not record:
            continue
        changed += 1
        if b"R" in record[:2] or b"C" in record[:2]:
            next(records)  # A rename/copy has a second path, not a second change.

    text = "🤵 " + (" + ".join(names[:3]) if names else "workspace")
    if len(names) > 3:
        text += " +…"
    if changed:
        text += f" · {changed} changed"
    return text


if __name__ == "__main__":
    try:
        print(summary())
    except (OSError, ValueError, KeyError, TypeError, AttributeError, StopIteration,
            subprocess.CalledProcessError):
        print("🤵 workspace · unavailable")
