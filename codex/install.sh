#!/bin/sh
#
# Install Codex with OpenAI's standalone installer. Codex owns this copy and
# can update it without waiting for mise's aqua registry.

echo "  Installing or updating self-managed Codex..."
curl -fsSL https://chatgpt.com/codex/install.sh | CODEX_NON_INTERACTIVE=1 sh

if command -v mise >/dev/null 2>&1; then
  mise uninstall -a codex >/dev/null 2>&1 || true
fi
