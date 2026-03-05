alias jst='jj status'
alias jl='jj git fetch --all-remotes'
alias jp='jj git push'
alias jd='jj diff'
alias jlog='jj log'
alias jn='jj new'
alias je='jj edit'
alias jbl='jj bookmark list'
alias jdes='jj describe -m'
alias jsh='jj show'
alias jab='jj abandon'

# Check out a remote branch for review (tracks + creates new change on top)
jco() {
  jj bookmark track "$1" --remote "${2:-origin}" 2>/dev/null
  jj new "$1"
}
