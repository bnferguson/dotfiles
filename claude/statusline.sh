#!/bin/bash
# Custom Claude Code status line with JJ support, colors, and PR links
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

# Detect current branch/bookmark using the session's cwd
REPO_ROOT=$(git -C "$CWD" rev-parse --show-toplevel 2>/dev/null)
BRANCH=""
if [ -n "$REPO_ROOT" ] && [ -d "$REPO_ROOT/.jj" ]; then
  BRANCH=$(jj --no-pager --repository "$REPO_ROOT" bookmark list -r '@' -T 'name ++ "\n"' 2>/dev/null | head -1)
  [ -z "$BRANCH" ] && BRANCH=$(jj --no-pager --repository "$REPO_ROOT" bookmark list -r '@-' -T 'name ++ "\n"' 2>/dev/null | head -1)
elif [ -n "$REPO_ROOT" ]; then
  BRANCH=$(git -C "$CWD" branch --show-current 2>/dev/null)
fi

# Detect open PR for current branch (skip if on main to avoid noise)
PR=""
if [ -n "$BRANCH" ] && [ "$BRANCH" != "main" ] && [ -n "$REPO_ROOT" ]; then
  REMOTE_URL=$(git -C "$REPO_ROOT" remote get-url origin 2>/dev/null)
  PR_NUM=$(GIT_OPTIONAL_LOCKS=0 gh pr list --head "$BRANCH" --json number,url -q '.[0].number' 2>/dev/null)
  PR_URL=$(GIT_OPTIONAL_LOCKS=0 gh pr list --head "$BRANCH" --json number,url -q '.[0].url' 2>/dev/null)
  if [ -n "$PR_NUM" ] && [ -n "$PR_URL" ]; then
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
