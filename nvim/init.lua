-- Bootstrap lazy.nvim
local lazypath = vim.fn.stdpath("data") .. "/lazy/lazy.nvim"
if not vim.uv.fs_stat(lazypath) then
  vim.fn.system({
    "git", "clone", "--filter=blob:none",
    "https://github.com/folke/lazy.nvim.git",
    "--branch=stable",
    lazypath,
  })
end
vim.opt.rtp:prepend(lazypath)

-- Pull in the Quakefile runtime files (syntax/ftplugin/indent) from
-- the quake repo so edits there take effect without copying.
local quake_nvim = vim.fn.expand("~/dev/quake/nvim")
if vim.uv.fs_stat(quake_nvim) then
  vim.opt.rtp:prepend(quake_nvim)
end

-- Load core config before plugins
require("config.options")
require("config.keymaps")
require("config.autocmds")

-- Load plugins from lua/plugins/
require("lazy").setup("plugins", {
  change_detection = { notify = false },
})
