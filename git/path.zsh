# Prefer Homebrew's git completions over the system ones.
# Must be in path.zsh (loaded before compinit) so compinit picks them up.
if [[ -d /opt/homebrew/share/zsh/site-functions ]]; then
  fpath=(/opt/homebrew/share/zsh/site-functions $fpath)
elif [[ -d /usr/local/share/zsh/site-functions ]]; then
  fpath=(/usr/local/share/zsh/site-functions $fpath)
fi
