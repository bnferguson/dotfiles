#!/bin/bash
# SessionStart + PostToolUse hook: keep the vera index fresh without being asked.
#
# Starts one detached `vera watch` per worktree if none is running. Everything
# else is already covered: codegraph runs its own file watcher for as long as
# its MCP server is up, and graphify rebuilds on commit via `graphify hook
# install`. So this hook is vera-only by design.
#
# It no-ops when the repo has no .vera/ index (opting a repo out is just not
# indexing it), when vera or code-intel is missing, and when a watcher is
# already alive — the hot path is one `kill -0`, which is why it is cheap
# enough to also fire after every file edit and re-arm a self-reaped watcher.

INPUT=$(cat)
CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)
DIR=${CLAUDE_PROJECT_DIR:-${CWD:-$PWD}}

command -v code-intel >/dev/null 2>&1 || exit 0
cd "$DIR" 2>/dev/null || exit 0
code-intel watch --ensure >/dev/null 2>&1
exit 0
