#!/usr/bin/env python3
"""PreToolUse(Bash): pre-resolve relative read paths so credential deny globs
don't halt the run.

Claude Code checks Bash commands against `Read(...)` deny globs statically,
before execution. After a `cd`, a relative path has no fixed base, so the
checker cannot prove the read misses `~/.ssh/**` and friends -- and it stops
for approval, even under bypass mode. This hook does the resolution the static
checker cannot: it walks the `cd` chain, resolves every path-shaped argument,
and only then decides.

Fail-closed by design. It emits `allow` for a command it has fully understood
and proven clean; for anything else it prints nothing and exits 0, leaving the
normal permission flow exactly as it was. It never denies -- narrowing is
somebody else's hook -- and it can never grant more than SAFE_COMMANDS.
"""

import fnmatch
import json
import os
import re
import shlex
import sys

# Commands that only read. Anything able to write, exec, or spawn stays out:
# no tee, no xargs, no awk (print > file), no git (push/clean), no docker.
SAFE_COMMANDS = {
    "cat", "head", "tail", "grep", "egrep", "fgrep", "rg", "ls", "wc",
    "sort", "uniq", "cut", "nl", "tr", "basename", "dirname", "file",
    "stat", "jq", "yq", "echo", "column", "sed", "find",
}

# Command substitution expands even inside double quotes, so it is checked
# against the raw string. Redirections and other operators are checked as
# lexed tokens instead, so a `>` or `;` inside a grep pattern stays harmless.
SUBSTITUTION = re.compile(r"\$\(|`|\$\{[^}]*\(")
OPERATORS = {"&&", "|"}

# Per-command escape hatches back into arbitrary execution or writes.
FORBIDDEN_ARGS = {
    "sed": {"-i", "--in-place"},
    "find": {"-exec", "-execdir", "-ok", "-okdir", "-delete", "-fls",
             "-fprint", "-fprintf"},
}


def read_deny_globs(project_dir):
    """Collect Read(...) deny patterns from global and project settings.

    Read the same files the checker reads, so the hook and the deny list cannot
    drift apart.
    """
    sources = [
        os.path.expanduser("~/.claude/settings.json"),
        os.path.join(project_dir, ".claude", "settings.json"),
        os.path.join(project_dir, ".claude", "settings.local.json"),
    ]
    globs = []
    for path in sources:
        try:
            with open(path) as fh:
                data = json.load(fh)
        except (OSError, ValueError):
            continue
        for rule in data.get("permissions", {}).get("deny", []):
            match = re.fullmatch(r"Read\((.*)\)", str(rule).strip())
            if match:
                globs.append(os.path.expanduser(match.group(1)))
    return globs


def denied(path, globs):
    for pattern in globs:
        if pattern.endswith("/**"):
            root = pattern[:-3]
            if path == root or path.startswith(root + os.sep):
                return True
        elif path == pattern or fnmatch.fnmatch(path, pattern):
            return True
    return False


def resolve(cwd, token):
    return os.path.normpath(os.path.join(cwd, os.path.expanduser(token)))


def lex(command):
    """Split into shell words, keeping `&&` and `|` as their own tokens."""
    lexer = shlex.shlex(command, posix=True, punctuation_chars=True)
    lexer.whitespace_split = True
    try:
        return list(lexer)
    except ValueError:
        return None


def segments(tokens):
    """Split a token list on `&&`/`|`; None if any other operator appears."""
    out, current = [], []
    for token in tokens:
        if token in OPERATORS:
            out.append(current)
            current = []
        elif re.fullmatch(r"[;&|<>()]+", token):
            return None  # redirection, subshell, background, `||`
        else:
            current.append(token)
    out.append(current)
    return out


def verdict(command, cwd, globs):
    """True only when every segment is a known-safe read of a non-denied path."""
    if SUBSTITUTION.search(command):
        return False

    tokens = lex(command)
    if tokens is None:
        return False

    parts = segments(tokens)
    if parts is None:
        return False

    for part in parts:
        if not part:
            return False

        name = os.path.basename(part[0])

        # `cd` moves the base every later relative path resolves against --
        # which is the whole reason the static checker gave up.
        if name == "cd":
            if len(part) != 2:
                return False
            cwd = resolve(cwd, part[1])
            continue

        if name not in SAFE_COMMANDS:
            return False

        for bad in FORBIDDEN_ARGS.get(name, ()):
            if any(arg == bad or arg.startswith(bad + "=") for arg in part[1:]):
                return False

        # Every non-flag argument is treated as a path. A grep pattern resolves
        # to a harmless non-existent path; a credential file does not. Guessing
        # wrong here only costs us the allow.
        for arg in part[1:]:
            if arg.startswith("-"):
                continue
            if denied(resolve(cwd, arg), globs):
                return False

    return True


def main():
    try:
        payload = json.load(sys.stdin)
    except ValueError:
        return

    command = payload.get("tool_input", {}).get("command", "")
    cwd = payload.get("cwd") or os.getcwd()
    if not command.strip():
        return

    globs = read_deny_globs(cwd)
    if not globs or not verdict(command, cwd, globs):
        return

    json.dump({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "allow",
            "permissionDecisionReason": (
                "Read-only command; every path resolves outside the "
                "credential deny globs."
            ),
        }
    }, sys.stdout)


if __name__ == "__main__":
    main()
