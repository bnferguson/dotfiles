#!/bin/sh
#
# Install Claude Code via the official installer.
# This runs as a topic installer during script/install.

claude_bin="$HOME/.local/bin/claude"

# Omarchy installs a wrapper here that runs `mise use -g claude` every time.
# Because ~/.config/mise/config.toml is symlinked into these dotfiles, that
# wrapper writes Claude into the repository's mise config. Claude owns its own
# updates, so remove the wrapper and any mise-managed copy before installing the
# official self-managed binary.
if [ -f "$claude_bin" ] \
  && grep -q 'mise use -g .*claude' "$claude_bin" 2>/dev/null; then
  echo "  Replacing Omarchy's mise wrapper with self-managed Claude Code..."
  rm -f "$claude_bin"
  if command -v mise >/dev/null 2>&1; then
    mise unuse -g claude >/dev/null 2>&1 || true
    mise uninstall -a claude >/dev/null 2>&1 || true
  fi
fi

if [ ! -x "$claude_bin" ]; then
  echo "  Installing Claude Code via official installer..."
  curl -fsSL https://claude.ai/install.sh | bash
else
  echo "  Claude Code already installed, updating..."
  "$claude_bin" update
fi
