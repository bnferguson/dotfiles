#!/bin/sh
#
# pi coding agent — extension dependencies.
#
# The `lsp` extension (pi/extensions/lsp) speaks LSP directly over JSON-RPC,
# since pi ships no MCP client and every off-the-shelf LSP bridge is MCP-only.
# That needs vscode-jsonrpc at runtime. pi loads extensions through jiti, which
# resolves node_modules from a parent directory, so a single install at
# pi/extensions/ covers every extension in the topic.
#
# node_modules/ here is gitignored — it's a per-machine build artifact.

DOTFILES_ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
EXT_DIR="$DOTFILES_ROOT/pi/extensions"

if [ ! -f "$EXT_DIR/package.json" ]; then
  echo "  Skipping pi extensions — no package.json"
  exit 0
fi

if command -v npm >/dev/null 2>&1; then
  echo "  Installing pi extension deps..."
  (cd "$EXT_DIR" && npm install --silent --no-audit --no-fund) || \
    echo "  pi extension deps failed — the lsp extension will not load"
else
  echo "  Skipping pi extension deps — npm not found"
fi

# Language servers are what the lsp extension actually drives. It discovers them
# on PATH and in nvim's mason bin dir, so anything already installed for the
# editor is reused — nothing to install here. Report the gap instead of
# silently pretending the tool works everywhere.
echo "  Language servers visible to the lsp extension:"
found=""
for s in typescript-language-server rust-analyzer gopls pyright-langserver \
         lua-language-server clangd ruby-lsp terraform-ls zls; do
  if command -v "$s" >/dev/null 2>&1 || [ -x "$HOME/.local/share/nvim/mason/bin/$s" ]; then
    found="$found $s"
  fi
done
if [ -n "$found" ]; then
  echo "   $found"
else
  echo "    none — install via mise, mason (:MasonInstall), or your package manager"
fi
