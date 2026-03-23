#!/bin/bash
# PreToolUse hook: block rm -rf, suggest trash instead
CMD=$(jq -r '.tool_input.command')

if echo "$CMD" | grep -qiE '(^|;|&&|\|)rm[[:space:]]' \
  && echo "$CMD" | grep -qiE '-[a-zA-Z]*[rR]|--recursive' \
  && echo "$CMD" | grep -qiE '-[a-zA-Z]*[fF]|--force'; then
  echo 'BLOCKED: Use trash instead of rm -rf' >&2
  exit 2
fi
