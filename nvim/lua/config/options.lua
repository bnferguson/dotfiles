local opt = vim.opt

opt.clipboard = "unnamed"
opt.background = "dark"
opt.number = true
opt.ruler = true

-- Encoding
opt.encoding = "utf-8"

-- Tilde as operator
opt.tildeop = true

-- Whitespace
opt.wrap = false
opt.tabstop = 2
opt.shiftwidth = 2
opt.softtabstop = 2
opt.expandtab = true
opt.list = true
opt.listchars = { tab = "  ", trail = "·" }

-- Searching
opt.hlsearch = true
opt.incsearch = true
opt.showmatch = true
opt.ignorecase = true
opt.smartcase = true

-- UI
opt.cursorline = true
opt.cmdheight = 2
opt.switchbuf = "useopen"
opt.numberwidth = 5
opt.showtabline = 2
opt.winwidth = 79
opt.shell = "zsh"
opt.scrolloff = 3
opt.laststatus = 2
opt.mouse = "a"
opt.signcolumn = "yes"
opt.termguicolors = true

-- No bells
opt.visualbell = false

-- Tab completion
opt.wildmode = "longest,list"
opt.wildignore:append({ "*.o", "*.obj", ".git", "*.rbc", "*.class", ".svn", "vendor/gems/*" })
opt.wildmenu = true

-- Buffers
opt.hidden = true
opt.backup = false
opt.writebackup = false
opt.updatetime = 300
opt.shortmess:append("c")

-- Swap/backup dirs
opt.backupdir = vim.fn.expand("~/.vim")
opt.directory = vim.fn.expand("~/.vim")
