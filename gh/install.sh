#!/bin/sh
#
# Install gh CLI extensions.
#
#   gh-stack  stacked branches/PRs — pairs with the gh-stack skill in
#             .agents/skills/gh-stack, which documents the CLI.
#   gh-image  uploads files to GitHub's user-attachments endpoint and prints a
#             pasteable markdown reference — the drag-and-drop flow, in a shell.

if ! command -v gh >/dev/null 2>&1; then
  echo "  Skipping gh extensions — gh not found"
  exit 0
fi

installed="$(gh extension list 2>/dev/null)"

for repo in github/gh-stack drogers0/gh-image; do
  name="${repo#*/}"

  # `extension list` names the repo, not the command, so match on that.
  if echo "$installed" | grep -q "$repo"; then
    gh extension upgrade "$name" 2>/dev/null || true
  else
    echo "  Installing $name extension..."
    gh extension install "$repo" || true
  fi
done
