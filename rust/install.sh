#!/bin/sh
#
# Ensure a default Rust toolchain exists.
# rustup itself is installed in script/install (Brewfile on macOS, pacman on
# Linux). This just gives a fresh machine a `stable` default; it leaves an
# existing default alone so `dots` reruns don't clobber a deliberate choice.
#
# Why a *global* default and not just per-project toolchains: build tools shell
# out to whatever `rustc` is on PATH, outside any Rust project. Ruby's YJIT is
# written in Rust — ruby-build/mise probes for `rustc` at compile time and
# silently drops YJIT if it's missing — and Rust-extension gems (commonmarker,
# wasmtime, blake3, …) compile against cargo on `gem install`. The global
# default toolchain is what keeps those working. Don't remove it thinking
# nothing uses Rust directly.

if ! command -v rustup >/dev/null 2>&1; then
  echo "  Skipping Rust toolchain setup — rustup not found"
  exit 0
fi

current="$(rustup default 2>/dev/null)"
case "$current" in
  ""|*"no default"*)
    echo "  Setting default Rust toolchain to stable"
    rustup default stable
    ;;
  *)
    echo "  Default Rust toolchain already set: ${current%% *}"
    ;;
esac

# Pi's LSP extension starts rust-analyzer directly. rustup otherwise leaves a
# proxy on PATH which exists but exits immediately, making the extension report
# Rust as available before its first request hangs or fails.
if ! rustup component list --installed 2>/dev/null | grep -qx 'rust-analyzer'; then
  echo "  Installing rust-analyzer for Pi's LSP extension"
  rustup component add rust-analyzer
fi
