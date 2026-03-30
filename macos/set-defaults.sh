# Sets reasonable macOS defaults.
#
# Or, in other words, set shit how I like in macOS.
#
# The original idea (and a couple settings) were grabbed from:
#   https://github.com/mathiasbynens/dotfiles/blob/master/.macos
#
# Run ./set-defaults.sh and you'll be good to go.
#
# NOTE: Safari settings require your terminal to have Full Disk Access.
#   System Settings > Privacy & Security > Full Disk Access > add your terminal

# Disable press-and-hold for keys in favor of key repeat.
defaults write -g ApplePressAndHoldEnabled -bool false

# Use AirDrop over every interface. srsly this should be a default.
defaults write com.apple.NetworkBrowser BrowseAllInterfaces 1

# Always open everything in Finder's list view. This is important.
defaults write com.apple.Finder FXPreferredViewStyle Nlsv

# Show the ~/Library folder.
chflags nohidden ~/Library

# Set a really fast key repeat.
defaults write NSGlobalDomain KeyRepeat -int 1

# Set the Finder prefs for showing a few different volumes on the Desktop.
defaults write com.apple.finder ShowExternalHardDrivesOnDesktop -bool true
defaults write com.apple.finder ShowRemovableMediaOnDesktop -bool true

# Run the screensaver if we're in the bottom-left hot corner.
defaults write com.apple.dock wvous-bl-corner -int 5
defaults write com.apple.dock wvous-bl-modifier -int 0

# Safari settings require Full Disk Access for your terminal.
# Without FDA the sandboxed plist isn't readable and `defaults` can hang, so check the file directly.
_safari_plist="$HOME/Library/Containers/com.apple.Safari/Data/Library/Preferences/com.apple.Safari.plist"
if [ -r "$_safari_plist" ]; then
  # Hide Safari's bookmark bar.
  defaults write com.apple.Safari ShowFavoritesBar -bool false

  # Always show Safari's URL preview in the lower left on mouseover.
  defaults write com.apple.Safari ShowOverlayStatusBar -bool true

  # Set up Safari for development.
  defaults write com.apple.Safari IncludeDevelopMenu -bool true
  defaults write com.apple.Safari WebKitDeveloperExtrasEnabledPreferenceKey -bool true
  defaults write com.apple.Safari "com.apple.Safari.ContentPageGroupIdentifier.WebKit2DeveloperExtrasEnabled" -bool true
  defaults write com.apple.Safari.SandboxBroker ShowDevelopMenu -bool true
  defaults write NSGlobalDomain WebKitDeveloperExtras -bool true
else
  echo "  Skipping Safari defaults — terminal needs Full Disk Access."
  echo "  System Settings > Privacy & Security > Full Disk Access > add your terminal"
fi

# Set default editor for dev file types.
"$(dirname "$0")/set-duti.sh"
