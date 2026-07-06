#!/bin/sh
#
# Install / update the Miren CLI (https://miren.dev) — deploy apps to any Linux
# box, bare metal or cloud VM.
#
# Linux only: on macOS the mirendev/tap cask in the Brewfile owns Miren (and
# handles updates via `brew upgrade`). Our Linux setup is pacman-based with no
# Homebrew, and Miren has no pacman package, so here we do what upstream's
# install does — a raw binary download — plus arch detection, sha256
# verification against the published version.json, and a skip when the
# installed version already matches so `dots` reruns stay cheap.
#
# Lands the binary in ~/.local/bin (already on PATH via system/path.zsh), so no
# sudo — unlike upstream's /usr/local/bin.

set -e

BASE_URL="https://api.miren.cloud/assets/release/miren/latest"
BIN_DIR="$HOME/.local/bin"

case "$(uname -s)" in
  Linux) : ;;
  Darwin) echo "  Skipping Miren install — managed by Homebrew on macOS"; exit 0 ;;
  *) echo "  Skipping Miren install — unsupported OS: $(uname -s)"; exit 0 ;;
esac

command -v jq >/dev/null 2>&1 || { echo "  Skipping Miren install — jq not found"; exit 0; }

platform="linux"

case "$(uname -m)" in
  x86_64|amd64)  arch="amd64" ;;
  arm64|aarch64) arch="arm64" ;;
  *) echo "  Skipping Miren install — unsupported arch: $(uname -m)"; exit 0 ;;
esac

asset="miren-${platform}-${arch}.tar.gz"

manifest="$(curl -fsSL "$BASE_URL/version.json" 2>/dev/null)" || {
  echo "  Skipping Miren install — couldn't fetch release manifest (offline?)"
  exit 0
}

target_version="$(printf '%s' "$manifest" | jq -r '.version')"
want_sha="$(printf '%s' "$manifest" | jq -r --arg n "$asset" '.artifacts[] | select(.name == $n) | .sha256')"

if [ -z "$want_sha" ] || [ "$want_sha" = "null" ]; then
  echo "  Skipping Miren install — no $asset in release manifest"
  exit 0
fi

# Already current? `miren version` prints the version in its output; match the
# manifest's number loosely so we skip the re-download on every `dots` run.
if command -v miren >/dev/null 2>&1 \
  && miren version 2>/dev/null | grep -qF "${target_version#v}"; then
  echo "  Miren already at ${target_version}"
  exit 0
fi

echo "  Installing Miren ${target_version} (${platform}/${arch})"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

curl -fsSL -o "$tmp/$asset" "$BASE_URL/$asset"

# Verify the download against the manifest's sha256 before trusting it.
# shasum ships on macOS, sha256sum on Linux; use whichever is present.
if command -v sha256sum >/dev/null 2>&1; then
  got_sha="$(sha256sum "$tmp/$asset" | awk '{print $1}')"
else
  got_sha="$(shasum -a 256 "$tmp/$asset" | awk '{print $1}')"
fi
if [ "$got_sha" != "$want_sha" ]; then
  echo "  Miren download failed checksum verification; aborting" >&2
  echo "    expected $want_sha" >&2
  echo "    got      $got_sha" >&2
  exit 1
fi

tar xzf "$tmp/$asset" -C "$tmp"
mkdir -p "$BIN_DIR"
install -m 755 "$tmp/miren" "$BIN_DIR/miren"

echo "  Miren ${target_version} installed to $BIN_DIR/miren"
