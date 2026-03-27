compdef _git gco=git-checkout

# git-tree and gt alias completion (function defined via shellenv in tree-me.zsh)
if (( $+functions[_git_tree_complete_zsh] )); then
  compdef _git_tree_complete_zsh git-tree gt
fi
