# Core tools — needed for this dotfiles setup to work
brew "starship"     # prompt
brew "mise"         # tool version manager
brew "neovim"       # editor
brew "gh"           # github cli
brew "jq"           # json processing
brew "yq"           # yaml processing
brew "fzf"          # fuzzy finder
brew "fd"           # find alternative

# Safety
brew "macos-trash"  # move to Trash instead of rm -rf
brew "duti"         # set default apps for file types

# Sync
brew "syncthing"    # peer-to-peer file sync

# Development
brew "jj"           # jujutsu vcs (checkpointing safety net)
brew "zellij"       # terminal multiplexer
brew "ast-grep"     # structural code search
brew "actionlint"   # github actions linter
brew "uv"           # python package manager
brew "rustup"       # rust toolchain manager

# Third-party taps
tap "mirendev/tap"  # miren deploy CLI (Linux gets it via the miren/ topic)

# macOS casks
if OS.mac?
  cask "ghostty"        # terminal
  cask "1password-cli"  # secrets
  cask "jordanbaird-ice" # menubar manager
  cask "tailscale-app"  # mesh vpn
  cask "miren"          # deploy CLI for Miren runtime
end
