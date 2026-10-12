#!/bin/sh
# macOS uses the Homebrew formula declared in Brewfile.
set -eu

[ "$(uname -s)" = "Linux" ] || exit 0

if ! command -v uv >/dev/null 2>&1; then
  echo "  Cannot install shuck-cli — install uv first" >&2
  exit 1
fi

# Upstream's binary-backed PyPI package installs the `shuck` executable.
# uv keeps it isolated and places the command in ~/.local/bin by default.
echo "  Installing shuck-cli..."
uv tool install --upgrade shuck-cli
