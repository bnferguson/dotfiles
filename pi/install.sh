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

# Recognize the old auto-installing mise wrapper, but leave unknown launchers alone.
legacy_pi_wrapper=""
if [ -f "$HOME/.local/bin/pi" ] && [ ! -L "$HOME/.local/bin/pi" ] &&
   grep -Fq 'exec mise x "pi" -- "pi" "$@"' "$HOME/.local/bin/pi"; then
  legacy_pi_wrapper="$HOME/.local/bin/pi"
fi

# Skip the interactive upstream installer when managed Pi already works.
# Install first: deleting mise releases could break an active Pi session or
# leave the machine without Pi if the download fails.
if [ -x "$PI_MANAGED_BIN" ] && "$PI_MANAGED_BIN" --version >/dev/null 2>&1; then
  echo "  Pi managed install is available"
else
  echo "  Installing Pi with Pi's managed installer..."

  # Hide mise's direct Pi paths, universal shim, and known legacy wrapper.
  # The upstream installer refuses to replace another installer's executable.
  pi_install_path=$(printf '%s' "$PATH" | awk -v RS=: -v ORS=: -v mise_data_dir="$MISE_DATA_DIR" \
      -v wrapper_dir="${legacy_pi_wrapper%/*}" '
    $0 != "" && $0 != wrapper_dir && $0 != mise_data_dir "/shims" &&
      index($0, mise_data_dir "/installs/pi/") != 1 { print }
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

# Only retire mise's request and wrapper after the managed launcher is verified.
[ -x "$PI_MANAGED_BIN" ] && "$PI_MANAGED_BIN" --version >/dev/null 2>&1 || exit 1
if command -v mise >/dev/null 2>&1; then
  mise unuse --global --no-prune pi || exit 1
fi
if [ -n "$legacy_pi_wrapper" ]; then
  pi_wrapper_backup="$legacy_pi_wrapper.mise-backup.$(date +%s).$$"
  mv "$legacy_pi_wrapper" "$pi_wrapper_backup" || exit 1
  ln -s ../../.pi/agent/bin/pi "$legacy_pi_wrapper" || {
    mv "$pi_wrapper_backup" "$legacy_pi_wrapper"
    exit 1
  }
  echo "  Replaced legacy Pi wrapper (backup: $pi_wrapper_backup)"
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
