#!/bin/bash
# PreToolUse hook: enforce the correct package manager for the project
# Detects lockfiles and blocks the wrong manager

CMD=$(jq -r '.tool_input.command')
CWD=$(jq -r '.cwd // empty')
DIR="${CWD:-$(pwd)}"

# Walk up to find the project root with a lockfile
check_dir="$DIR"
while [ "$check_dir" != "/" ]; do
  if [ -f "$check_dir/pnpm-lock.yaml" ]; then
    if echo "$CMD" | grep -qE '^(npm|yarn) (install|add|remove|run|exec|ci)\b'; then
      echo "BLOCKED: This project uses pnpm (pnpm-lock.yaml found). Use pnpm instead." >&2
      exit 2
    fi
    break
  elif [ -f "$check_dir/yarn.lock" ]; then
    if echo "$CMD" | grep -qE '^(npm|pnpm) (install|add|remove|run|exec|ci)\b'; then
      echo "BLOCKED: This project uses yarn (yarn.lock found). Use yarn instead." >&2
      exit 2
    fi
    break
  elif [ -f "$check_dir/package-lock.json" ]; then
    if echo "$CMD" | grep -qE '^(pnpm|yarn) (install|add|remove|run|exec|ci)\b'; then
      echo "BLOCKED: This project uses npm (package-lock.json found). Use npm instead." >&2
      exit 2
    fi
    break
  elif [ -f "$check_dir/Gemfile.lock" ]; then
    if echo "$CMD" | grep -qE '^gem install\b' && ! echo "$CMD" | grep -qE '^gem install bundler'; then
      echo "BLOCKED: This project uses Bundler (Gemfile.lock found). Use bundle add instead of gem install." >&2
      exit 2
    fi
    break
  fi
  check_dir=$(dirname "$check_dir")
done
