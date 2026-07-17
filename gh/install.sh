#!/bin/sh
#
# Install gh CLI extensions.
#
#   gh-stack  stacked branches/PRs — pairs with the gh-stack skill in
#             claude/config/skills/gh-stack, which documents the CLI.

if ! command -v gh >/dev/null 2>&1; then
  echo "  Skipping gh extensions — gh not found"
  exit 0
fi

# `extension list` names the repo, not the command, so match on that.
if gh extension list 2>/dev/null | grep -q 'github/gh-stack'; then
  gh extension upgrade gh-stack 2>/dev/null || true
else
  echo "  Installing gh-stack extension..."
  gh extension install github/gh-stack || true
fi
