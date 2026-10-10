export PATH="$HOME/bin:$HOME/.local/bin:$ZSH/bin:$PATH"

# ./bin goes last so system commands win. starship bakes the first PATH hit
# into PROMPT, so in a shell started from / it found ./bin/starship (the
# /bin -> usr/bin symlink) and the prompt broke after the first cd. Strip any
# copy inherited from a parent shell before appending.
path=(${path:#./bin} ./bin)

if [[ "$(uname -s)" == "Darwin" ]]; then
  export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/local/sbin:$PATH"
  export MANPATH="/usr/local/man:/usr/local/mysql/man:/usr/local/git/man:$MANPATH"
fi
