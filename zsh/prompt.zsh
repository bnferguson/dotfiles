# Starship prompt — install with: brew install starship (or curl -sS https://starship.rs/install.sh | sh)
if (( $+commands[starship] )); then
  eval "$(starship init zsh)"
fi
