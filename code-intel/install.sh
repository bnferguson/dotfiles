#!/bin/sh
#
# Install the code-intelligence stack — three complementary tools that give an
# AI agent a better map of a codebase than grep/Read alone:
#
#   vera      LOCATE     — semantic search: find code by meaning (embeddings)
#   codegraph TRAVERSE   — structural graph over MCP: callers/callees/impact
#   graphify  COMPREHEND — multimodal knowledge graph: architecture + docs
#
# The `code-intel` skill (.agents/skills/code-intel) routes between them.
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
  # Potion Code static embeddings everywhere, skipping the interactive wizard.
  # Don't "upgrade" this to an ONNX/Jina backend without measuring first. The
  # jina-v5 export is built from com.microsoft contrib ops (MultiHeadAttention,
  # RotaryEmbedding, SkipSimplifiedLayerNormalization), and only the CPU and
  # CUDA providers have kernels for them. On Apple Silicon the CoreML EP claims
  # 6 nodes out of ~1700 and times identically to plain CPU, so --onnx-jina-coreml
  # bought nothing and cost ~120x: 60s vs 0.5s for the same 848 chunks. Vera's
  # own docs claim the embedding model is GPU-accelerated under CoreML; it isn't.
  # Only worth revisiting on a box with a real NVIDIA GPU, where --onnx-jina-cuda
  # does have kernels for those ops.
  # (Skip vera's agent-install step — the vera skill ships with these dotfiles.)
  vera backend --potion-code --yes 2>/dev/null || true
else
  echo "  Skipping vera — uv not found"
fi

# --- codegraph: structural graph over MCP (TRAVERSE) ----------------------
# Install the standalone bundled-runtime build (ships its own Node), NOT
# `npm i -g`: under mise, an npm-global bin becomes a shim that fails in any
# project pinning a different node version ("No version is set for shim"), and
# it needs node present at all (not guaranteed on Linux). The launcher resolves
# symlinks, so a ~/.local/bin symlink into the bundle is the supported install.
if ! command -v codegraph >/dev/null 2>&1; then
  echo "  Installing codegraph (standalone)..."
  cg_os=$(uname -s | tr '[:upper:]' '[:lower:]')
  cg_arch=$(uname -m); case "$cg_arch" in x86_64|amd64) cg_arch=x64;; aarch64) cg_arch=arm64;; esac
  cg_dir="codegraph-${cg_os}-${cg_arch}"
  cg_url="https://github.com/colbymchenry/codegraph/releases/latest/download/${cg_dir}.tar.gz"
  mkdir -p "$HOME/.local/lib" "$HOME/.local/bin"
  if curl -fsSL "$cg_url" | tar -xz -C "$HOME/.local/lib"; then
    ln -sf "$HOME/.local/lib/$cg_dir/bin/codegraph" "$HOME/.local/bin/codegraph"
  else
    echo "  codegraph download failed (${cg_dir}.tar.gz)"
  fi
fi
# Register the MCP server ourselves (user scope, machine-local) rather than
# `codegraph install`, which would append instructions into the
# dotfiles-managed ~/.claude/CLAUDE.md. Tool permissions live in settings.json.
if command -v codegraph >/dev/null 2>&1 && command -v claude >/dev/null 2>&1 \
  && ! claude mcp list 2>/dev/null | grep -qi '^codegraph'; then
  echo "  Registering codegraph MCP server..."
  claude mcp add -s user codegraph -- codegraph serve --mcp || true
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
