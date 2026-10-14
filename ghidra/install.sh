#!/bin/sh
# Brewfile installs Ghidra. Pinning has to happen here because brew bundle
# has no pin directive.
set -eu

command -v brew >/dev/null 2>&1 || exit 0
brew list --formula ghidra >/dev/null 2>&1 || exit 0

# REA validates the Ghidra release line (12.1.x) and refuses others, so an
# unattended `dots` upgrade would silently break its Ghidra provider. Unpin
# and upgrade by hand once REA supports the new line.
#
# The REA MCP registrations carry GHIDRA_INSTALL_DIR and JAVA_HOME through the
# stable opt paths, not the versioned Cellar ones `rea setup` resolves to:
#   GHIDRA_INSTALL_DIR=/opt/homebrew/opt/ghidra/libexec
#   JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
# Neither is exported to the shell: JAVA_HOME would override mise's Java.
if ! brew list --pinned | grep -qx ghidra; then
  echo "  Pinning ghidra..."
  brew pin ghidra
fi
