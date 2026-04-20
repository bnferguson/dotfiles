# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Personal dotfiles repo using the [holman/dotfiles](https://github.com/holman/dotfiles) topic-centric architecture. Each top-level directory is a "topic" with automatic loading conventions.

## Setup & Maintenance Commands

```sh
script/bootstrap          # Full install: gitconfig, symlinks, brew, BTT presets
script/install            # Just packages + topic installers (no symlinks/gitconfig)
dots                      # Update homebrew + run topic installers (maintenance)
dots -e                   # Open dotfiles in $EDITOR
bettertouchtool/export    # Export BTT presets after changing them in BTT
bettertouchtool/import    # Restore BTT presets on a new machine
```

There are no tests or linting. Changes are validated by running `script/bootstrap` or sourcing the shell.

## Loading Conventions

The shell (`zsh/zshrc.symlink`) loads files in this order:

1. `~/.localrc` — machine-specific env vars (not committed)
2. `*/path.zsh` — `$PATH` setup, loaded first
3. `*/*.zsh` (excluding `path.zsh` and `completion.zsh`) — general config, aliases, env
4. `compinit` runs
5. `*/completion.zsh` — completion definitions, loaded last

Other conventions:
- `*.symlink` files → symlinked to `$HOME` as dotfiles (e.g., `git/gitconfig.symlink` → `~/.gitconfig`)
- `bin/` → added to `$PATH`, contains git extensions and utilities
- `functions/` → autoloaded zsh functions (files starting with `_` are completion functions)
- Deeper paths (nvim, starship, gh, ghostty, ssh, jj, claude, karabiner, zed) are symlinked into `~/.config/` or `~/.claude/` by `install_larger_paths` in bootstrap

## Key Architecture Details

- `$ZSH` is set to `~/.dotfiles` (the repo root) — all `*.zsh` loading is relative to this
- `$PROJECTS` is `~/dev` — the `c` function tab-completes into project dirs there
- Git author config lives in `git/gitconfig.local.symlink` (created by bootstrap, gitignored)
- jj user config lives in `~/.config/jj/conf.d/local.toml` (created by bootstrap from template)
- Claude Code config files are symlinked individually (not the whole `~/.claude/` dir) to preserve session data
- The `script/install` script supports macOS (brew), Arch (pacman), and Ubuntu (apt) with graceful fallbacks

## Symlink Strategy

Bootstrap uses **relative symlinks** (via perl `File::Spec->abs2rel`) so they work regardless of absolute path. The `link_file` function handles conflicts interactively (skip/overwrite/backup).

## Things to Watch Out For

- `zsh/zshrc.symlink` has an LM Studio PATH append at the bottom that was added outside the dotfiles pattern — don't duplicate this kind of thing
- The `.cache/` directory holds generated files (like kubectl completions) — these are gitignored
- BTT presets are not auto-synced; manual export/import is required after changes
- BTT preset arrow-key bindings store an implicit Fn modifier (`BTTShortcutModifierKeys: 10354688` = Hyper+Fn) because Apple keyboards attach Fn to arrow keys at the hardware level. When documenting those shortcuts, write them as `Hyper+Up` etc. — not `Fn+Hyper+Up`.
- `nvim/lazy-lock.json` tracks neovim plugin versions — changes here are from plugin updates
