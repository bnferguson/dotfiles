#!/bin/sh
# Apply the tracked Powerline row-layout customization after package updates.
set -eu

DOTFILES_ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
PACKAGE_DIR="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}/npm/node_modules/pi-powerline-footer"
PATCH_FILE="$DOTFILES_ROOT/pi/config/patches/powerline-pinned-rows.patch"

if [ ! -f "$PACKAGE_DIR/index.ts" ]; then
  echo "  Skipping Powerline patch — package is not installed"
  exit 0
fi

if patch --dry-run -f -R -p1 -d "$PACKAGE_DIR" < "$PATCH_FILE" >/dev/null 2>&1; then
  echo "  Powerline pinned-row patch is already applied"
elif patch --dry-run -f -p1 -d "$PACKAGE_DIR" < "$PATCH_FILE" >/dev/null 2>&1; then
  patch -f -p1 -d "$PACKAGE_DIR" < "$PATCH_FILE"
else
  echo "  Powerline patch no longer matches the installed package; update $PATCH_FILE" >&2
  exit 1
fi
