# dotfiles

Personal dotfiles, originally forked from [holman/dotfiles](https://github.com/holman/dotfiles) and evolved over the years.

## what's inside

Cross-platform topics live at the repo root. OS-specific topics live under `linux/` or `macos/` and only load on that OS.

**Shared:**

| Topic | What it does |
|-------|-------------|
| `.agents/` | Shared skills for Claude Code, Codex, and pi |
| `bin/` | Scripts added to `$PATH` — `git-tree`, `git-sync`, `code-intel`, etc. |
| `claude/` | Claude Code config, agents, and Claude-only skills |
| `code-intel/` | Installs the code-intelligence stack — vera, codegraph, graphify |
| `codex/` | Codex config, hooks, agents, and Codex-only skills |
| `gh/` | GitHub CLI config, and installs extensions — `gh-stack` |
| `ghostty/` | Ghostty terminal config (`config.linux` and `config.macos` siblings handle OS-specific bindings) |
| `git/` | Git aliases, global gitconfig, gitignore |
| `jj/` | Jujutsu VCS config — aliases, completion, config |
| `kubernetes/` | kubectl completion (cached for speed) |
| `mise/` | Global mise tool versions |
| `nvim/` | Neovim config |
| `pi/` | pi config, extensions, and pi-only skills |
| `ssh/` | SSH config |
| `starship/` | Starship prompt config |
| `system/` | PATH, EDITOR, ls aliases, keybindings |
| `zed/` | Zed editor settings |
| `zellij/` | Zellij terminal multiplexer config |
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
- Tailscale installs and enables `tailscaled`, but you need to authenticate the machine once: `sudo tailscale up`

## maintenance

Run `dots` periodically for unattended maintenance. It pulls `main`, updates Homebrew and global mise tools, then runs topic installers. It also updates Pi, its configured packages, local extension dependencies, Codegraph, and installed Rust toolchains. Version pins stay unchanged. Meridian tracks the latest eligible release.

`dots` disables stdin prompts and requires existing sudo authorization. It skips machine setup, macOS system updates, and interactive Omarchy package and system updates. Use `dots --interactive` for those tasks. Use `script/bootstrap` for initial setup. Use `dots -e` to open the dotfiles in your editor.

Each run shows output live on stdout and writes a private log under `${XDG_STATE_HOME:-~/.local/state}/dots/`. `dots --log-path` prints the path to `latest.log` without running maintenance. Set `DOTS_LOG_DIR` to change the directory. Logs remain until you remove them. They contain tool output, so review them before sharing.

For an agent investigation, provide the path from `dots --log-path` and ask the agent to read that file. Logs show step boundaries, exit codes, skips, and a final status. Failed steps do not stop independent updates. A failed update or installer gives a nonzero exit status. A failed Git pull remains a warning and does not block maintenance.

Some existing topic installers still hide errors internally. A zero exit status does not prove that every third-party installer completed its work. Scripts that bypass stdin or invoke sudo by absolute path can bypass the prompt controls.

Run the maintenance regression tests without changing installed tools:

```sh
python3 script/test-dots.py
python3 script/test-maintenance.py
```

## coding agents

Claude Code, Codex, and pi use one shared skill catalog: `.agents/skills`. Codex and pi load its links from `~/.agents/skills`. Claude loads matching links from `~/.claude/skills`. Portable skills belong in `.agents/skills`. Native skill directories contain compatibility links and explicit agent-only exceptions listed in `.agents/agent-specific-skills.json`. Register an exception before installing a genuinely agent-specific skill.

Both custom and downloaded skills live in the shared catalog. The [skills CLI](https://skills.sh/) records source and hash details for downloaded skills in `skills-lock.json`. It leaves custom entries alone. Global installs through `npx skills add <source> -g` write through the `~/.agents/skills` directory link. The global `.skill-lock.json` also links into `.agents/`.

Bootstrap links the native skill and instruction directories too:

| Install location | Repository directory |
|------------------|----------------------|
| `~/.claude/rules` | `claude/config/rules` |
| `~/.claude/skills` | `claude/config/skills` |
| `~/.codex/skills` | `codex/config/skills` |
| `~/.pi/agent/skills` | `pi/config/skills` |

New files installed in these locations appear in `git status`. Portable native copies move into `.agents/skills`, with relative links left in the native directories. An existing shared skill wins on conflict; the complete native copy stays in a private backup. The migration does not invent upstream update records.

Use `npx skills add <source> -g` for an immediate shared install. Direct native installs are consolidated at the end of `dots` or `script/install`. To consolidate sooner, run `script/migrate-agent-directories --skills-only`. This mode leaves global directory links unchanged.

Review changes before committing; installation does not commit anything. Claude's generated `skills/synced` catalog and skill trash are ignored, as are Codex's bundled `.system` skills. Declared agent-only skills stay native even when a shared skill has the same name.

`script/migrate-agent-directories` merges existing directories without overwriting repository files, then consolidates portable skills. It saves originals under `~/.local/state/dotfiles/migrations/` and creates relative directory links. Bootstrap runs the shared migration first. To apply only these migrations, without package updates or machine setup:

```sh
script/migrate-agent-skills
script/migrate-agent-directories
git status --short
```

Claude/Codex agent definitions and hooks already use directory links. Pi extensions stay linked per entry so package installs can coexist. Plugins, dependencies, auth, sessions, and caches remain separate. Use the same directory-link pattern for custom commands, prompts, or themes if you add them later.

Run `npx skills@latest update -p` from the dotfiles root to refresh package-managed skills, then review and commit the resulting `.agents/skills` and `skills-lock.json` changes. Run `python3 script/test-migrate-agent-skills.py` and `python3 script/test-migrate-agent-directories.py` to test the migrations without changing your installed skills.

Use `claude-yolo` or `codex-yolo` for an unrestricted session. `codex-auto` keeps Codex's workspace sandbox and sends approval requests to its automatic reviewer. Use `claude-review` or `codex-review` to review a PR or branch in an isolated worktree. Use `claude-work` or `codex-work` to start new work on a branch in an isolated worktree.

Codex requires a one-time review of personal hooks. Start a new Codex session and use `/hooks` to inspect and trust them after bootstrap.

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
