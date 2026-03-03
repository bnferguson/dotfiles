if [ $commands[kubectl] ]; then
  # Cache kubectl completions — regenerate when kubectl binary changes
  local _kubectl_comp="$ZSH/.cache/kubectl_completion.zsh"
  local _kubectl_bin="$(which kubectl)"
  if [[ ! -f "$_kubectl_comp" || "$_kubectl_bin" -nt "$_kubectl_comp" ]]; then
    mkdir -p "$ZSH/.cache"
    kubectl completion zsh > "$_kubectl_comp"
  fi
  source "$_kubectl_comp"
fi
