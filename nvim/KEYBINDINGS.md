# Neovim Keybindings & Workflows

Leader key is `\` (default vim leader).

## Everyday Essentials

| Key | Action |
|-----|--------|
| `\s` | Save file (works from insert mode too) |
| `\w` | Smart quit — closes current code buffer; exits nvim if it's the last one (skips sidebars) |
| `,,` | Toggle between current and previous buffer |
| `\y` | Yank selection to system clipboard |
| `\'` | Toggle quote style under cursor (`'` <-> `"`) |
| `F1` | Disabled (no accidental help popups) |
| `Ctrl-c` | Escape from insert mode |

## Navigation

| Key | Action |
|-----|--------|
| `j` / `k` | Move by visual line (respects word wrap) |
| `Ctrl-h` | Move to left split |
| `Ctrl-j` | Move to split below |
| `Ctrl-k` | Move to split above |
| `Ctrl-l` | Move to right split |

## Windows & Splits

| Key | Action |
|-----|--------|
| `\\` | Zoom toggle — fullscreen the current split (press again to restore) |
| `\=` | Equalize all split sizes |

## Finding Things (Telescope)

| Key | Action |
|-----|--------|
| `\p` | **Find files** — fuzzy filename search (like Ctrl-P) |
| `\f` | **Live grep** — search file contents with ripgrep |
| `\b` | **Buffers** — pick from open buffers |

Inside Telescope:
- `Ctrl-n` / `Ctrl-p` — move up/down in results
- `Ctrl-x` — open in horizontal split
- `Ctrl-v` — open in vertical split
- `Esc` — close picker

## File Tree (Neo-tree)

| Key | Action |
|-----|--------|
| `\n` | Toggle file tree sidebar |

Inside Neo-tree:
- `Enter` — open file
- `a` — add file/directory
- `d` — delete
- `r` — rename
- `H` — toggle hidden files
- `?` — show help

## Code Intelligence (LSP)

These activate when an LSP server attaches to the buffer (Ruby, Go, Terraform, Zig, Lua).

### Go To

| Key | Action |
|-----|--------|
| `gd` | Go to **definition** |
| `gy` | Go to **type definition** |
| `gi` | Go to **implementation** |
| `gr` | Go to **references** |

### Actions

| Key | Action |
|-----|--------|
| `K` | Hover docs (show type info / documentation) |
| `\rn` | **Rename** symbol across project |
| `\ac` | **Code action** menu (refactors, imports, etc.) |
| `\qf` | **Quick fix** — apply the preferred code action |

### Diagnostics

| Key | Action |
|-----|--------|
| `[g` | Jump to previous diagnostic (error/warning) |
| `]g` | Jump to next diagnostic |

## Completion (nvim-cmp)

Completion pops up automatically in insert mode.

| Key | Action |
|-----|--------|
| `Tab` | Next completion item (or expand snippet) |
| `Shift-Tab` | Previous completion item |
| `Enter` | Accept completion |
| `Ctrl-Space` | Manually trigger completion menu |

Sources (in priority order): LSP, snippets, buffer words, file paths.

## Comments

| Key | Mode | Action |
|-----|------|--------|
| `\/` | Normal | Toggle comment on current line |
| `\/` | Visual | Toggle comment on selected lines |

## Symbols Outline

| Key | Action |
|-----|--------|
| `\tt` | Toggle symbols outline sidebar (functions, classes, etc.) |

## Automatic Behaviors

- **Trailing whitespace** is stripped on every save
- **Auto-read** — files changed outside nvim are reloaded on focus
- **Autopairs** — brackets, quotes, etc. close automatically
- **Gitsigns** — git diff markers appear in the sign column
- **Neo-tree auto-open** — opens the file tree when nvim launches without a file
- **Neo-tree auto-close** — if neo-tree is the only window left, nvim exits

## LSP Servers (via Mason)

| Server | Language |
|--------|----------|
| `lua_ls` | Lua (nvim config) |
| `ruby_lsp` | Ruby |
| `gopls` | Go |
| `terraformls` | Terraform |
| `zls` | Zig |

Run `:Mason` to manage servers. Run `:LspInfo` to see what's attached to the current buffer.

## Plugin Management (lazy.nvim)

| Command | Action |
|---------|--------|
| `:Lazy` | Open plugin manager UI |
| `:Lazy sync` | Install/update all plugins |
| `:Lazy health` | Check plugin health |

## Config File Map

```
nvim/
  init.lua                  # Bootstrap + load modules
  lua/config/
    options.lua             # Editor settings (tabs, search, etc.)
    keymaps.lua             # Everything in "Everyday Essentials" + "Navigation" + "Windows"
    autocmds.lua            # Strip whitespace, auto-read
  lua/plugins/
    colorscheme.lua         # Gruvbox dark
    telescope.lua           # Fuzzy finder
    treesitter.lua          # Syntax highlighting
    lsp.lua                 # LSP + Mason
    completion.lua          # Autocomplete
    neo-tree.lua            # File tree
    lualine.lua             # Status line
    comment.lua             # Comment toggling
    gitsigns.lua            # Git gutter signs
    editor.lua              # Outline + autopairs
```
