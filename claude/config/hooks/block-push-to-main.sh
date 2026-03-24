#!/bin/bash
# PreToolUse hook: block direct push to main/master, enforce feature branches
CMD=$(jq -r '.tool_input.command')

if echo "$CMD" | grep -qE 'git[[:space:]]+push.*(main|master)'; then
  echo 'BLOCKED: Use feature branches, not direct push to main/master' >&2
  exit 2
fi
