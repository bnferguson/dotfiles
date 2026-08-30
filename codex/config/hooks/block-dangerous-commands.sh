#!/bin/bash
# Codex PreToolUse hook: preserve the main shell-command deny rules used by Claude.

INPUT=$(cat)
CMD=$(printf '%s' "$INPUT" | jq -r '.tool_input.command')

block() {
  echo "BLOCKED: $1" >&2
  exit 2
}

if printf '%s' "$CMD" | grep -qiE '(^|[;&|][;&|]?)[[:space:]]*sudo([[:space:]]|$)'; then
  block "sudo is not allowed from an agent session"
fi

if printf '%s' "$CMD" | grep -qiE '(^|[;&|][;&|]?)[[:space:]]*(mkfs([.][^[:space:]]*)?|dd)([[:space:]]|$)'; then
  block "raw disk and filesystem commands are not allowed"
fi

if printf '%s' "$CMD" | grep -qiE '(curl|wget)[^|]*[|][[:space:]]*(ba)?sh([[:space:]]|$)'; then
  block "piping downloaded code into a shell is not allowed"
fi

if printf '%s' "$CMD" | grep -qiE 'git[[:space:]]+push([^;&|]*[[:space:]])(--force(-with-lease)?|-f)([[:space:]]|$)'; then
  block "force-pushing is not allowed"
fi

if printf '%s' "$CMD" | grep -qiE 'git[[:space:]]+reset[[:space:]]+--hard([[:space:]]|$)'; then
  block "git reset --hard is not allowed"
fi

if printf '%s' "$CMD" | grep -qiE 'git[[:space:]]+clean[[:space:]][^;&|]*-[a-zA-Z]*f'; then
  block "git clean -f is not allowed"
fi

if printf '%s' "$CMD" | grep -qiE 'git[[:space:]]+checkout[[:space:]]+--[[:space:]]+[.]([[:space:]]|$)'; then
  block "git checkout -- . is not allowed"
fi
