#!/bin/sh
#
# Install Claude Code via the official installer.
# This runs as a topic installer during script/install.

if ! command -v claude >/dev/null 2>&1; then
  echo "  Installing Claude Code via official installer..."
  curl -fsSL https://claude.ai/install.sh | bash
else
  echo "  Claude Code already installed, updating..."
  claude update
fi
