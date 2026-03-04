# dotfiles

Personal dotfiles, originally forked from [holman/dotfiles](https://github.com/holman/dotfiles) and evolved over the years.

## what's inside

| Topic | What it does |
|-------|-------------|
| `bin/` | Scripts added to `$PATH` — `tree-me`, `git-sync`, `git-promote`, etc. |
| `claude/` | Claude Code config — settings, skills, commands, agents |
| `gh/` | GitHub CLI config |
| `ghostty/` | Ghostty terminal config |
| `git/` | Git aliases, global gitconfig, gitignore |
| `jj/` | Jujutsu VCS config — aliases, completion, config |
| `karabiner/` | Karabiner-Elements config (macOS only) |
| `kubernetes/` | kubectl completion (cached for speed) |
| `macos/` | macOS defaults and install scripts |
| `mise/` | Global mise tool versions |
| `nvim/` | Neovim config |
| `ssh/` | SSH config |
| `starship/` | Starship prompt config |
| `system/` | PATH, EDITOR, ls aliases, keybindings |
| `zed/` | Zed editor settings |
| `zsh/` | Shell config, completion, prompt |

## how it works

The topic-centric structure from holman/dotfiles:

- **topic/\*.zsh** — loaded into your shell automatically
- **topic/path.zsh** — loaded first, sets up `$PATH`
- **topic/completion.zsh** — loaded last, after `compinit`
- **topic/\*.symlink** — symlinked into `$HOME` as dotfiles
- **bin/** — added to `$PATH`
- **functions/** — autoloaded zsh functions

## install

```sh
git clone https://github.com/bnferguson/dotfiles.git ~/.dotfiles
cd ~/.dotfiles
script/bootstrap
```

### dependencies

Install these before running bootstrap, or let `dot` handle it on macOS:

- [starship](https://starship.rs) — `brew install starship` or `curl -sS https://starship.rs/install.sh | sh`
- [mise](https://mise.jdx.dev) — `brew install mise` or `curl https://mise.run | sh`

### post-install

- Machine-specific env vars go in `~/.localrc` (not committed)
- Git author info goes in `git/gitconfig.local.symlink` (created by bootstrap)

## maintenance

Run `dot` periodically to update homebrew and run installers. Use `dot -e` to open the dotfiles in your editor.

## origins

Forked from [holman/dotfiles](https://github.com/holman/dotfiles). The topic-centric architecture remains, but most of the contents have been replaced or removed over the years.
