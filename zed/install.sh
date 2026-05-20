#!/bin/sh
#
# Provide a `zed` CLI shim on Linux.
#
# Arch ships the editor as /usr/bin/zeditor to avoid a name conflict
# with an older `zed` package. Zed's own docs and tooling expect the
# binary to be `zed`, so symlink it into ~/.local/bin (which is on
# both the shell PATH and the systemd-user PATH).

if [ "$(uname -s)" != "Linux" ]; then
  exit 0
fi

if [ ! -x /usr/bin/zeditor ]; then
  exit 0
fi

if command -v zed >/dev/null 2>&1 && [ "$(command -v zed)" != "$HOME/.local/bin/zed" ]; then
  exit 0
fi

mkdir -p "$HOME/.local/bin"
ln -sf /usr/bin/zeditor "$HOME/.local/bin/zed"
echo "  linked ~/.local/bin/zed → /usr/bin/zeditor"
