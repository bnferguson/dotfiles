#!/bin/sh
#
# pi coding agent — extension dependencies.
#
# The `lsp` extension (pi/config/extensions/lsp) speaks LSP directly over JSON-RPC,
# since pi ships no MCP client and every off-the-shelf LSP bridge is MCP-only.
# That needs vscode-jsonrpc at runtime. pi loads extensions through jiti, which
# resolves node_modules from a parent directory, so a single install at
# pi/config/extensions/ covers every extension in the topic.
#
# node_modules/ here is gitignored — it's a per-machine build artifact.

DOTFILES_ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
EXT_DIR="$DOTFILES_ROOT/pi/config/extensions"
PI_MANAGED_BIN="$HOME/.pi/agent/bin/pi"
MISE_DATA_DIR="${MISE_DATA_DIR:-$HOME/.local/share/mise}"

# Pi's managed installation keeps immutable releases under ~/.pi/agent and
# lets `pi update` switch between them. Mise's release bundle cannot update
# itself, so remove any old mise releases before the first managed install.
if [ -x "$PI_MANAGED_BIN" ] && "$PI_MANAGED_BIN" --version >/dev/null 2>&1; then
  echo "  Pi managed install is available"
else
  if command -v mise >/dev/null 2>&1 && [ -d "$MISE_DATA_DIR/installs/pi" ]; then
    echo "  Migrating Pi from mise to Pi's managed installer..."
    mise uninstall --all --yes pi
  else
    echo "  Installing Pi with Pi's managed installer..."
  fi

  # Hide mise's direct Pi paths and universal shim. The upstream installer
  # refuses to replace another package manager's Pi executable.
  pi_install_path=$(printf '%s' "$PATH" | awk -v RS=: -v ORS=: -v mise_data_dir="$MISE_DATA_DIR" '
    $0 != "" && $0 != mise_data_dir "/shims" && index($0, mise_data_dir "/installs/pi/") != 1 { print }
  ')
  pi_install_path="$HOME/.pi/agent/bin:${pi_install_path%:}"

  pi_installer="$(mktemp "${TMPDIR:-/tmp}/pi-install.XXXXXX")" || exit 1
  if curl --fail --silent --show-error --location https://pi.dev/install.sh --output "$pi_installer"; then
    PATH="$pi_install_path" sh "$pi_installer"
    pi_install_status=$?
  else
    pi_install_status=1
  fi
  rm -f "$pi_installer"
  [ "$pi_install_status" -eq 0 ] || exit "$pi_install_status"
fi

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
