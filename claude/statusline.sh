#!/bin/bash
# Custom Claude Code status line
input=$(cat)

# Extract fields from JSON
MODEL=$(echo "$input" | jq -r '.model.display_name // "Claude"')
CWD=$(echo "$input" | jq -r '.workspace.current_dir // .cwd // ""')
USED_PCT=$(echo "$input" | jq -r '.context_window.used_percentage // empty')
VIM_MODE=$(echo "$input" | jq -r '.vim.mode // empty')
COST=$(echo "$input" | jq -r '.cost.total_cost_usd // empty')
LINES_ADDED=$(echo "$input" | jq -r '.cost.total_lines_added // empty')
LINES_REMOVED=$(echo "$input" | jq -r '.cost.total_lines_removed // empty')
WORKTREE=$(echo "$input" | jq -r '.worktree.name // empty')

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

# Lines changed
LINES=""
if [ -n "$LINES_ADDED" ] || [ -n "$LINES_REMOVED" ]; then
  LINES=" ${GREEN}+${LINES_ADDED:-0}${RESET}${RED}-${LINES_REMOVED:-0}${RESET}"
fi

# Vim mode indicator
VIM=""
[ -n "$VIM_MODE" ] && VIM=" ${MAGENTA}[${VIM_MODE}]${RESET}"

# Worktree indicator
WT=""
[ -n "$WORKTREE" ] && WT=" ${YELLOW}[wt: ${WORKTREE}]${RESET}"

# Branch display
BRANCH_STR="${CYAN}${BRANCH:-detached}${RESET}"

# Build status line
printf '%b' "${BLUE}${SHORT_CWD}${RESET} ${DIM}|${RESET} ${BRANCH_STR}${WT} ${DIM}|${RESET} ${DIM}${MODEL}${RESET}${CTX}${COST_STR}${LINES}${VIM}"
