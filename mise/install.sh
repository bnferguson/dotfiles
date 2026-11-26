#!/bin/sh
#
# Install the development tools declared in mise/config.toml. The file is the
# source of truth for command-line language servers used by Pi and Claude Code;
# unlike Neovim's private Mason directory, these servers must be visible to
# headless agent sessions on PATH.

set -e

if ! command -v mise >/dev/null 2>&1; then
  echo "  Cannot install development tools — mise not found"
  exit 1
fi

echo "  Installing mise-managed tools..."
DOTFILES_ROOT="$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd -P)"
export MISE_GLOBAL_CONFIG_FILE="$DOTFILES_ROOT/mise/config.toml"
mise trust "$MISE_GLOBAL_CONFIG_FILE"
# Install compilers before packages that invoke them during installation.
mise -C / install --yes go node
mise -C / install --yes
