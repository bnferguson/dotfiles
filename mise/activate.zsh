if (( $+commands[mise] )); then
  # Auto-trust dotfiles mise config wherever it's found — covers both the
  # home-relative path and the CWD path (sandvault CDs to the host directory)
  local _cfg
  for _cfg in "${ZSH:A}/mise/config.toml" "${PWD}/mise/config.toml"; do
    [[ -f "$_cfg" ]] && mise trust "$_cfg" &>/dev/null
  done
  eval "$(mise activate zsh)"
fi
