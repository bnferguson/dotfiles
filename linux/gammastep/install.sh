#!/bin/sh
#
# Enable gammastep as a per-user service.
# Package install is handled in script/install (pacman).
# Config is symlinked in script/bootstrap.

[ "$(uname -s)" = "Linux" ] || exit 0

if ! command -v gammastep >/dev/null 2>&1; then
  echo "  Skipping gammastep service enable — binary not found"
  exit 0
fi

if ! command -v systemctl >/dev/null 2>&1; then
  exit 0
fi

if systemctl --user is-enabled --quiet gammastep.service 2>/dev/null; then
  echo "  gammastep user service already enabled"
else
  echo "  Enabling gammastep user service"
  systemctl --user enable --now gammastep.service
fi
