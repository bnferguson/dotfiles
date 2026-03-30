#!/usr/bin/env bash
#
# Adds a sudoers rule so softwareupdate can run without a password.
# This only needs to run once (idempotent — skips if already in place).

SUDOERS_FILE="/etc/sudoers.d/softwareupdate"

if [ -f "$SUDOERS_FILE" ]; then
  echo "  sudoers rule for softwareupdate already exists, skipping"
  exit 0
fi

echo "  Adding passwordless sudo for /usr/sbin/softwareupdate"
echo "  (you may be prompted for your password once)"

sudo tee "$SUDOERS_FILE" > /dev/null <<'EOF'
%admin ALL=(ALL) NOPASSWD: /usr/sbin/softwareupdate
EOF
sudo chmod 0440 "$SUDOERS_FILE"
