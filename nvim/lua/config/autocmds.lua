local augroup = vim.api.nvim_create_augroup
local autocmd = vim.api.nvim_create_autocmd

-- Strip trailing whitespace on save
augroup("StripWhitespace", { clear = true })
autocmd("BufWritePre", {
  group = "StripWhitespace",
  pattern = "*",
  callback = function()
    local pos = vim.api.nvim_win_get_cursor(0)
    vim.cmd([[%s/\s\+$//e]])
    vim.api.nvim_win_set_cursor(0, pos)
  end,
})

-- Auto-read files changed outside vim
augroup("AutoRead", { clear = true })
autocmd({ "FocusGained", "BufEnter" }, {
  group = "AutoRead",
  pattern = "*",
  command = "checktime",
})
