#!/bin/bash
# PostToolUse hook: log file mutations to JSONL for audit trail
# Logs Write, Edit, and Bash commands that modify files

TOOL=$(jq -r '.tool_name')
SESSION=${CLAUDE_SESSION_ID:-unknown}
TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
LOG_DIR="$HOME/.claude/audit"
LOG_FILE="$LOG_DIR/mutations.jsonl"

mkdir -p "$LOG_DIR"

case "$TOOL" in
  Write|Edit)
    FILE_PATH=$(jq -r '.tool_input.file_path // .tool_input.path // "unknown"')
    jq -nc \
      --arg ts "$TIMESTAMP" \
      --arg session "$SESSION" \
      --arg tool "$TOOL" \
      --arg file "$FILE_PATH" \
      '{timestamp: $ts, session: $session, tool: $tool, file: $file}' \
      >> "$LOG_FILE"
    ;;
  Bash)
    CMD=$(jq -r '.tool_input.command')
    # Only log commands that look like they modify files
    if echo "$CMD" | grep -qiE '(>|>>|mv |cp |mkdir |touch |chmod |chown |ln |install |tee )'; then
      jq -nc \
        --arg ts "$TIMESTAMP" \
        --arg session "$SESSION" \
        --arg tool "$TOOL" \
        --arg cmd "$CMD" \
        '{timestamp: $ts, session: $session, tool: $tool, command: $cmd}' \
        >> "$LOG_FILE"
    fi
    ;;
esac
