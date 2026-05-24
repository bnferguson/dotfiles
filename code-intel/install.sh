#!/bin/sh
#
# Install the code-intelligence stack — three complementary tools that give an
# AI agent a better map of a codebase than grep/Read alone:
#
#   vera      LOCATE     — semantic search: find code by meaning (embeddings)
#   codegraph TRAVERSE   — structural graph over MCP: callers/callees/impact
#   graphify  COMPREHEND — multimodal knowledge graph: architecture + docs
#
# The `code-intel` skill (claude/config/skills/code-intel) routes between them.
# Per-project indexes (.vera/, .codegraph/, graphify-out/) are built on demand,
# not here — see the skill for the workflow.
#
# Note: vera's setup wizard needs a TTY; the backend step below is guarded so a
# non-interactive `dots` run won't abort. It works during `script/bootstrap`.

# --- vera: semantic search (LOCATE) ---------------------------------------
if command -v uvx >/dev/null 2>&1; then
  if ! command -v vera >/dev/null 2>&1; then
    echo "  Installing vera..."
    uvx vera-ai install || true
  else
    echo "  vera present — checking for updates..."
    vera upgrade --apply 2>/dev/null || true
  fi
  # Local embedding backend + models, skipping the interactive wizard.
  # CoreML on Apple Silicon, CPU elsewhere. (Skip vera's agent-install step —
  # the vera skill ships with these dotfiles.)
  if [ "$(uname -s)" = "Darwin" ] && [ "$(uname -m)" = "arm64" ]; then
    vera backend --onnx-jina-coreml --yes 2>/dev/null || true
  else
    vera backend --onnx-jina-cpu --yes 2>/dev/null || true
  fi
else
  echo "  Skipping vera — uv not found"
fi

# --- codegraph: structural graph over MCP (TRAVERSE) ----------------------
if command -v npm >/dev/null 2>&1; then
  if ! command -v codegraph >/dev/null 2>&1; then
    echo "  Installing codegraph..."
    npm install -g @colbymchenry/codegraph || true
  fi
  # Register the MCP server ourselves (user scope, machine-local) rather than
  # `codegraph install`, which would append instructions into the
  # dotfiles-managed ~/.claude/CLAUDE.md. Tool permissions live in settings.json.
  if command -v claude >/dev/null 2>&1 \
    && ! claude mcp list 2>/dev/null | grep -qi '^codegraph'; then
    echo "  Registering codegraph MCP server..."
    claude mcp add -s user codegraph -- codegraph serve --mcp || true
  fi
else
  echo "  Skipping codegraph — npm (node) not found"
fi

# --- graphify: knowledge graph (COMPREHEND) -------------------------------
if command -v uv >/dev/null 2>&1; then
  if ! command -v graphify >/dev/null 2>&1; then
    echo "  Installing graphify..."
    uv tool install graphifyy || true
  else
    uv tool upgrade graphifyy 2>/dev/null || true
  fi
  # Native /graphify skill for Claude Code. The generated skill dir is
  # gitignored so it doesn't churn the repo (regenerated per-machine).
  graphify install >/dev/null 2>&1 || true
else
  echo "  Skipping graphify — uv not found"
fi
