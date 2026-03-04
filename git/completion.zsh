# Git completion — use Homebrew's if available
if [[ -f /opt/homebrew/share/zsh/site-functions/_git ]]; then
  source /opt/homebrew/share/zsh/site-functions/_git
elif [[ -f /usr/local/share/zsh/site-functions/_git ]]; then
  source /usr/local/share/zsh/site-functions/_git
fi

compdef _git gco=git-checkout

# git-tree and gt alias completion (function defined via shellenv in tree-me.zsh)
if (( $+functions[_git_tree_complete_zsh] )); then
  compdef _git_tree_complete_zsh git-tree gt
fi
