# Git completion — use Homebrew's if available
if [[ -f /opt/homebrew/share/zsh/site-functions/_git ]]; then
  source /opt/homebrew/share/zsh/site-functions/_git
elif [[ -f /usr/local/share/zsh/site-functions/_git ]]; then
  source /usr/local/share/zsh/site-functions/_git
fi

compdef _git gco=git-checkout
