# dotfiles

Personal dotfiles, originally forked from [holman/dotfiles](https://github.com/holman/dotfiles) and evolved over the years.

## what's inside

| Topic | What it does |
|-------|-------------|
| `bettertouchtool/` | BTT preset export/import scripts — run `export` and `import` manually |
| `bin/` | Scripts added to `$PATH` — `git-tree`, `git-sync`, `git-promote`, etc. |
| `bun/` | Bun JS runtime completion + path setup |
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
| `vera/` | Vera code-search tool installer |
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

Install these before running bootstrap, or let `dots` handle it on macOS:

- [starship](https://starship.rs) — `brew install starship` or `curl -sS https://starship.rs/install.sh | sh`
- [mise](https://mise.jdx.dev) — `brew install mise` or `curl https://mise.run | sh`

### post-install

- Machine-specific env vars go in `~/.localrc` (not committed)
- Git author info goes in `git/gitconfig.local.symlink` (created by bootstrap)

## maintenance

Run `dots` periodically to update homebrew and run installers. Use `dots -e` to open the dotfiles in your editor.

## keyboard setup

Karabiner-Elements and BetterTouchTool work together to create a Hyper key system for launching apps, managing windows, and vim-style navigation.

### karabiner — key remapping

Karabiner turns Caps Lock (and Escape) into a **Hyper key** (Cmd+Ctrl+Opt+Shift). Tap either key alone and you get Escape.

On top of that, Hyper activates vim-style navigation everywhere:

| Shortcut | Action |
|----------|--------|
| Hyper+H/J/K/L | Arrow keys (left/down/up/right) |
| Fn+Hyper+H/J/K/L | Home / Page Down / Page Up / End |

There's also a per-device config that swaps Cmd/Opt on an external keyboard (vendor 9494, product 39) to match Mac layout expectations.

### bettertouchtool — app launching and window management

The active BTT preset (`bttsettings_70697`) uses the Hyper key from Karabiner to launch apps and manage windows.

**App launchers:**

| Shortcut | App |
|----------|-----|
| Hyper+Q | Toggle Mail / Calendar (AppleScript) |
| Hyper+W | Show/Hide Ghostty (resizes to right half) |
| Hyper+E | Zed |
| Hyper+R | Firefox |
| Hyper+T | Things 3 |
| Hyper+A | Toggle Slack / Discord (AppleScript) |
| Hyper+S | Spotify |
| Hyper+D | Cycle WhatsApp → Signal → Telegram (AppleScript) |
| Hyper+F | Finder |
| Hyper+G | Ghostty |
| Hyper+C | Obsidian |
| Hyper+V | Conductor |
| Hyper+X | Conductor |

**Window management:**

| Shortcut | Action |
|----------|--------|
| Hyper+Up | Maximize window |
| Hyper+Down | Restore previous window size |
| Hyper+Left | Left half |
| Hyper+Right | Right half |

**Other:**

| Shortcut | Action |
|----------|--------|
| Hyper+Esc | Sleep display |

BTT presets are not auto-synced. Run `bettertouchtool/export` after making changes in BTT, and `bettertouchtool/import` to restore on a new machine. Bootstrap will import automatically if BTT is running with its Socket Server enabled.

## origins

Forked from [holman/dotfiles](https://github.com/holman/dotfiles). The topic-centric architecture remains, but most of the contents have been replaced or removed over the years.
