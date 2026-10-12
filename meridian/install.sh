#!/bin/sh
# Meridian server plugins (separate from Pi's provider extension).
set -eu

if ! command -v npm >/dev/null 2>&1; then
  echo "  Skipping Meridian plugins — npm not found"
  exit 0
fi

PLUGIN_ROOT="$HOME/.local/share/meridian"
PLUGIN_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/meridian/plugins"

# Keep the package intact: its entry point imports sibling files and metadata.
echo "  Installing Meridian pi-scrub plugin..."
npm install --prefix "$PLUGIN_ROOT" --ignore-scripts --omit=dev --no-audit --no-fund \
  @rynfar/meridian-plugin-pi-scrub@0.2.2
mkdir -p "$PLUGIN_DIR"
plugin_path="$PLUGIN_ROOT/node_modules/@rynfar/meridian-plugin-pi-scrub/dist/index.js"
relative_path=$(perl -MFile::Spec -e 'print File::Spec->abs2rel($ARGV[0], $ARGV[1])' \
  "$plugin_path" "$PLUGIN_DIR")
ln -sfn "$relative_path" "$PLUGIN_DIR/pi-scrub.js"

echo "  Meridian pi-scrub installed — restart Meridian or reload its plugins"
