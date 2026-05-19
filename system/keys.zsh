# Pipe my public key to my clipboard.
if [[ "$(uname -s)" == "Darwin" ]]; then
  alias pubkey="more ~/.ssh/id_rsa.pub | pbcopy | echo '=> Public key copied to pasteboard.'"
else
  if [ -n "$WAYLAND_DISPLAY" ]; then
    alias pubkey="cat ~/.ssh/id_rsa.pub | wl-copy && echo '=> Public key copied to clipboard.'"
  else
    alias pubkey="cat ~/.ssh/id_rsa.pub | xclip -selection clipboard && echo '=> Public key copied to clipboard.'"
  fi
fi
