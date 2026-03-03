# Pipe my public key to my clipboard.
if [[ "$(uname -s)" == "Darwin" ]]; then
  alias pubkey="more ~/.ssh/id_ed25519.pub | pbcopy | echo '=> Public key copied to pasteboard.'"
else
  alias pubkey="cat ~/.ssh/id_ed25519.pub | xclip -selection clipboard && echo '=> Public key copied to clipboard.'"
fi
