#!/bin/bash
# Custom Claude Code status line with colors and PR links
input=$(cat)

# Extract fields from JSON
MODEL=$(echo "$input" | jq -r '.model.display_name // "Claude"')
CWD=$(echo "$input" | jq -r '.workspace.current_dir // .cwd // ""')
USED_PCT=$(echo "$input" | jq -r '.context_window.used_percentage // empty')
VIM_MODE=$(echo "$input" | jq -r '.vim.mode // empty')
COST=$(echo "$input" | jq -r '.cost.total_cost_usd // empty')

# Colors
BLUE='\033[34m'
CYAN='\033[36m'
GREEN='\033[32m'
YELLOW='\033[33m'
RED='\033[31m'
MAGENTA='\033[35m'
DIM='\033[2m'
RESET='\033[0m'

# Shorten home directory to ~
SHORT_CWD="${CWD/#$HOME/~}"
SHORT_CWD="${SHORT_CWD#/}"

# Detect current branch using the session's cwd
REPO_ROOT=$(git -C "$CWD" rev-parse --show-toplevel 2>/dev/null)
BRANCH=""
if [ -n "$REPO_ROOT" ]; then
  BRANCH=$(git -C "$CWD" branch --show-current 2>/dev/null)
fi

# Detect open PR for current branch (cached 5 min per branch)
PR=""
if [ -n "$BRANCH" ] && [ "$BRANCH" != "main" ] && [ -n "$REPO_ROOT" ]; then
  CACHE_DIR="${TMPDIR:-/tmp}/claude-statusline-cache"
  mkdir -p "$CACHE_DIR"
  CACHE_KEY=$(echo "${REPO_ROOT}:${BRANCH}" | md5 -q 2>/dev/null || echo "${REPO_ROOT}:${BRANCH}" | md5sum | cut -d' ' -f1)
  CACHE_FILE="${CACHE_DIR}/${CACHE_KEY}"

  # Use cache if fresh (< 300 seconds)
  if [ -f "$CACHE_FILE" ] && [ $(( $(date +%s) - $(stat -f %m "$CACHE_FILE" 2>/dev/null || stat -c %Y "$CACHE_FILE" 2>/dev/null || echo 0) )) -lt 300 ]; then
    PR_DATA=$(cat "$CACHE_FILE")
  else
    PR_DATA=$(GIT_OPTIONAL_LOCKS=0 gh pr list --head "$BRANCH" --json number,url -q '.[0] | "\(.number) \(.url)"' 2>/dev/null)
    echo "$PR_DATA" > "$CACHE_FILE"
  fi

  PR_NUM=$(echo "$PR_DATA" | cut -d' ' -f1)
  PR_URL=$(echo "$PR_DATA" | cut -d' ' -f2-)
  if [ -n "$PR_NUM" ] && [ -n "$PR_URL" ] && [ "$PR_NUM" != "null" ]; then
    PR=" \e]8;;${PR_URL}\aPR #${PR_NUM}\e]8;;\a"
  fi
fi

# Context usage with color based on usage level
CTX=""
if [ -n "$USED_PCT" ]; then
  printf -v USED_INT "%.0f" "$USED_PCT"
  if [ "$USED_INT" -ge 80 ]; then
    CTX_COLOR=$RED
  elif [ "$USED_INT" -ge 50 ]; then
    CTX_COLOR=$YELLOW
  else
    CTX_COLOR=$GREEN
  fi
  CTX=" ${CTX_COLOR}ctx:${USED_INT}%${RESET}"
fi

# Cost indicator
COST_STR=""
if [ -n "$COST" ] && [ "$COST" != "0" ]; then
  COST_STR=" ${DIM}\$${COST}${RESET}"
fi

# Vim mode indicator
VIM=""
[ -n "$VIM_MODE" ] && VIM=" ${MAGENTA}[${VIM_MODE}]${RESET}"

# Branch display
BRANCH_STR="${CYAN}${BRANCH:-detached}${RESET}"

# Build status line
printf '%b' "${BLUE}${SHORT_CWD}${RESET} ${DIM}|${RESET} ${BRANCH_STR}${PR} ${DIM}|${RESET} ${DIM}${MODEL}${RESET}${CTX}${COST_STR}${VIM}"
