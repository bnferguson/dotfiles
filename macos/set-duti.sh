#!/bin/sh
#
# Set default applications for file types using duti.
#
# Uses UTIs (Uniform Type Identifiers) where macOS has them registered.
# Extensions without a known UTI get dynamic UTIs that duti can't set,
# so we only include types that actually work.
#
# Intentionally excluded:
#   public.html         — also controls web link handling, leave to browser
#   public.source-code  — parent UTI, too broad, grabs unexpected types
#   public.swift-source, public.objective-c-source, public.c-source,
#     public.c-plus-plus-source, public.c-header — leave to Xcode
#
# Bundle IDs for common editors:
#   Zed:          dev.zed.Zed
#   VS Code:      com.microsoft.VSCode
#   Sublime Text: com.sublimetext.4
#   TextMate:     com.macromates.TextMate
#
# Find yours with: osascript -e 'id of app "App Name"'
EDITOR_BUNDLE_ID="dev.zed.Zed"

if ! command -v duti >/dev/null 2>&1; then
  echo "  duti not installed, skipping file associations"
  exit 0
fi

# Format: UTI role
# Using UTIs directly since extension-based mapping fails for unregistered types.
utis="
  net.daringfireball.markdown            editor
  public.json                            editor
  public.yaml                            editor
  public.xml                             editor
  public.shell-script                    editor
  public.python-script                   editor
  public.ruby-script                     editor
  public.perl-script                     editor
  public.css                             editor
  public.plain-text                      editor
  com.netscape.javascript-source         editor
"

echo "$utis" | while read -r uti role; do
  [ -z "$uti" ] && continue
  duti -s "$EDITOR_BUNDLE_ID" "$uti" "$role" 2>/dev/null
done
