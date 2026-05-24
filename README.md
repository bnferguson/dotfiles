# dotfiles

Personal dotfiles, originally forked from [holman/dotfiles](https://github.com/holman/dotfiles) and evolved over the years.

## what's inside

Cross-platform topics live at the repo root. OS-specific topics live under `linux/` or `macos/` and only load on that OS.

**Shared:**

| Topic | What it does |
|-------|-------------|
| `bin/` | Scripts added to `$PATH` — `git-tree`, `git-sync`, `code-intel`, etc. |
| `claude/` | Claude Code config — settings, skills, commands, agents |
| `code-intel/` | Installs the code-intelligence stack — vera, codegraph, graphify |
| `gh/` | GitHub CLI config |
| `ghostty/` | Ghostty terminal config (`config.linux` and `config.macos` siblings handle OS-specific bindings) |
| `git/` | Git aliases, global gitconfig, gitignore |
| `jj/` | Jujutsu VCS config — aliases, completion, config |
| `kubernetes/` | kubectl completion (cached for speed) |
| `mise/` | Global mise tool versions |
| `nvim/` | Neovim config |
| `ssh/` | SSH config |
| `starship/` | Starship prompt config |
| `system/` | PATH, EDITOR, ls aliases, keybindings |
| `zed/` | Zed editor settings |
| `zsh/` | Shell config, completion, prompt |
| `shell.env` | Single source of truth for `$SHELL` — read by `script/install` and (via symlink) by `linux/environment.d/shell.conf` |

**Linux-only (`linux/`):**

| Topic | What it does |
|-------|-------------|
| `linux/environment.d/` | systemd-user env (currently the `$SHELL` override; symlinks to root-level `shell.env`) |
| `linux/hyprland/` | Hyprland WM overrides — bindings + input |
| `linux/keyd/` | keyd keyboard remapper config (Caps → Hyper) |
| `linux/vpn/` | OpenVPN systemd-unit aliases |

**macOS-only (`macos/`):**

| Topic | What it does |
|-------|-------------|
| `macos/bettertouchtool/` | BTT preset export/import scripts |
| `macos/karabiner/` | Karabiner-Elements config |
| `macos/scripts/` | macOS defaults, duti file associations, hostname, sudoers, MAS install |

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

BTT presets are not auto-synced. Run `macos/bettertouchtool/export` after making changes in BTT, and `macos/bettertouchtool/import` to restore on a new machine. Bootstrap will import automatically if BTT is running with its Socket Server enabled.

## origins

Forked from [holman/dotfiles](https://github.com/holman/dotfiles). The topic-centric architecture remains, but most of the contents have been replaced or removed over the years.
