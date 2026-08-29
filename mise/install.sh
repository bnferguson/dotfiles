#!/bin/sh
#
# Install the development tools declared in mise/config.toml. The file is the
# source of truth for command-line language servers used by Pi and Claude Code;
# unlike Neovim's private Mason directory, these servers must be visible to
# headless agent sessions on PATH.

if ! command -v mise >/dev/null 2>&1; then
  echo "  Skipping mise tools — mise not found"
  exit 0
fi

echo "  Installing mise-managed tools..."
mise install
