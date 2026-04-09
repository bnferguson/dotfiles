#!/bin/bash
# PostToolUse hook: log when dangerouslyDisableSandbox is used
# Captures the command, description, and context for audit

INPUT=$(cat)
TOOL=$(echo "$INPUT" | jq -r '.tool_name')

# Only care about Bash calls
[ "$TOOL" != "Bash" ] && exit 0

BYPASS=$(echo "$INPUT" | jq -r '.tool_input.dangerouslyDisableSandbox // false')
[ "$BYPASS" != "true" ] && exit 0

SESSION=${CLAUDE_SESSION_ID:-unknown}
TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
LOG_DIR="$HOME/.claude/audit"
LOG_FILE="$LOG_DIR/sandbox-bypasses.jsonl"

mkdir -p "$LOG_DIR"

echo "$INPUT" | jq -nc \
  --arg ts "$TIMESTAMP" \
  --arg session "$SESSION" \
  --arg cwd "$(echo "$INPUT" | jq -r '.cwd // "unknown"')" \
  --arg cmd "$(echo "$INPUT" | jq -r '.tool_input.command')" \
  --arg desc "$(echo "$INPUT" | jq -r '.tool_input.description // ""')" \
  '{timestamp: $ts, session: $session, cwd: $cwd, command: $cmd, description: $desc}' \
  >> "$LOG_FILE"
