#!/bin/sh
#
# Install Vera semantic code search via bun.
# Requires bun to be installed (see Brewfile).

if ! command -v bun >/dev/null 2>&1; then
  echo "  Skipping Vera install — bun not found"
  exit 0
fi

if ! command -v vera >/dev/null 2>&1; then
  echo "  Installing Vera..."
  bunx @vera-ai/cli install
else
  echo "  Vera already installed, checking for updates..."
  vera upgrade --apply 2>/dev/null || true
fi
