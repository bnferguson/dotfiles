#!/bin/sh
#
# Enable Syncthing as a per-user service.
# Package install is handled in script/install (Brewfile on macOS, pacman on
# Linux). Pairing devices and adding folders is a one-time manual step via
# the web UI at http://127.0.0.1:8384.

if ! command -v syncthing >/dev/null 2>&1; then
  echo "  Skipping Syncthing service enable — binary not found"
  exit 0
fi

started=0
case "$(uname -s)" in
  Darwin)
    if command -v brew >/dev/null 2>&1; then
      if brew services list 2>/dev/null | awk '$1=="syncthing" && $2=="started"{f=1} END{exit !f}'; then
        echo "  Syncthing already running via brew services"
      else
        echo "  Starting Syncthing via brew services"
        brew services start syncthing
        started=1
      fi
    fi
    ;;
  Linux)
    if command -v systemctl >/dev/null 2>&1; then
      if systemctl --user is-enabled --quiet syncthing.service 2>/dev/null; then
        echo "  Syncthing user service already enabled"
      else
        echo "  Enabling Syncthing user service"
        systemctl --user enable --now syncthing.service
        started=1
      fi
    fi
    ;;
esac

if [ "$started" = "1" ]; then
  echo "  → Web UI: http://127.0.0.1:8384 (pair devices and add folders there)"
fi
