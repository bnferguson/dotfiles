#!/bin/bash
# Codex PostToolUse hook: log Bash calls made in bypass-permissions mode.

INPUT=$(cat)
TOOL=$(printf '%s' "$INPUT" | jq -r '.tool_name')

# Only care about Bash calls
[ "$TOOL" != "Bash" ] && exit 0

PERMISSION_MODE=$(printf '%s' "$INPUT" | jq -r '.permission_mode // "default"')
[ "$PERMISSION_MODE" != "bypassPermissions" ] && exit 0

SESSION=$(printf '%s' "$INPUT" | jq -r '.session_id // "unknown"')
TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
LOG_DIR="$HOME/.codex/audit"
LOG_FILE="$LOG_DIR/sandbox-bypasses.jsonl"

mkdir -p "$LOG_DIR"

printf '%s' "$INPUT" | jq -nc \
  --arg ts "$TIMESTAMP" \
  --arg session "$SESSION" \
  --arg cwd "$(printf '%s' "$INPUT" | jq -r '.cwd // "unknown"')" \
  --arg cmd "$(printf '%s' "$INPUT" | jq -r '.tool_input.command')" \
  --arg desc "$(printf '%s' "$INPUT" | jq -r '.tool_input.description // ""')" \
  '{timestamp: $ts, session: $session, cwd: $cwd, command: $cmd, description: $desc}' \
  >> "$LOG_FILE"
