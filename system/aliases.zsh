# ls — detect GNU vs BSD ls for color flag
if ls --color=auto &>/dev/null 2>&1; then
  alias ls="ls -F --color=auto"
  alias l="ls -lAh --color=auto"
  alias ll="ls -l --color=auto"
  alias la="ls -A --color=auto"
else
  alias ls="ls -F -G"
  alias l="ls -lAh -G"
  alias ll="ls -l -G"
  alias la="ls -A -G"
fi

# cd
alias ..="cd .."
alias cdd="cd -"
alias -g ...='../..'
alias -g ....='../../..'
alias -g .....='../../../..'
