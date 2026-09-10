#!/bin/sh

set -eu

DOTFILES_ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
TEST_ROOT="$(mktemp -d)"
cleanup() {
  exit_status=$?
  rm -rf "$TEST_ROOT"
  trap - EXIT
  exit "$exit_status"
}
trap cleanup EXIT

mkdir -p "$TEST_ROOT/bin" "$TEST_ROOT/home" "$TEST_ROOT/log"

cat > "$TEST_ROOT/bin/mise" <<'EOF'
#!/bin/sh
printf '%s\n' "$*" >> "$TEST_LOG/mise"
EOF

cat > "$TEST_ROOT/bin/curl" <<'EOF'
#!/bin/sh
printf '%s\n' "$*" >> "$TEST_LOG/curl"
printf '%s\n' \
  'printf '\''%s\n'\'' "$CODEX_NON_INTERACTIVE" > "$TEST_LOG/non-interactive"' \
  'mkdir -p "$HOME/.local/bin"' \
  'touch "$HOME/.local/bin/codex"' \
  'chmod +x "$HOME/.local/bin/codex"'
EOF

chmod +x "$TEST_ROOT/bin/mise" "$TEST_ROOT/bin/curl"

HOME="$TEST_ROOT/home" \
PATH="$TEST_ROOT/bin:/bin:/usr/bin" \
TEST_LOG="$TEST_ROOT/log" \
CODEX_NON_INTERACTIVE='' \
  sh "$DOTFILES_ROOT/codex/install.sh"

grep -qx 'uninstall -a codex' "$TEST_ROOT/log/mise"
grep -qx -- '-fsSL https://chatgpt.com/codex/install.sh' "$TEST_ROOT/log/curl"
grep -qx '1' "$TEST_ROOT/log/non-interactive"
test -x "$TEST_ROOT/home/.local/bin/codex"

grep -Eq 'CODEX_NON_INTERACTIVE=(1|true|yes)' "$DOTFILES_ROOT/codex/install.sh"

if grep -Eq '^codex[[:space:]]*=' "$DOTFILES_ROOT/mise/config.toml"; then
  echo "mise/config.toml still manages Codex" >&2
  exit 1
fi
