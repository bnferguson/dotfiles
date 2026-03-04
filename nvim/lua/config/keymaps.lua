local map = vim.keymap.set

-- Visual line movement (navigate wrapped lines)
map("n", "j", "gj")
map("n", "k", "gk")

-- Yank to system clipboard
map({ "n", "v" }, "<Leader>y", '"*y')

-- Toggle quotes (' <-> ")
map("n", "<Leader>'", [[""yls<C-r>={'"': "'", "'": '"'}[@"]<CR><Esc>]])

-- Move between splits
map("n", "<C-j>", "<C-w>j")
map("n", "<C-k>", "<C-w>k")
map("n", "<C-h>", "<C-w>h")
map("n", "<C-l>", "<C-w>l")

-- Esc from insert with C-c
map("i", "<C-c>", "<Esc>")

-- Toggle previous buffer
map("n", ",,", "<C-^>")

-- Equalize splits
map("n", "<Leader>=", "<C-w>=")
map("i", "<Leader>=", "<Esc><C-w>=")

-- Save
map("n", "<Leader>s", ":w<CR>")
map("i", "<Leader>s", "<Esc>:w<CR>")

-- Quit
map("n", "<Leader>w", ":q<CR>")
map("i", "<Leader>w", "<Esc>:q<CR>")

-- Kill F1 help
map({ "n", "i" }, "<F1>", "<Esc>")

-- Zoom toggle (replaces zoomwintab.vim)
local zoom_state = {}
map("n", "<Leader><Leader>", function()
  local tab = vim.api.nvim_get_current_tabpage()
  if zoom_state[tab] then
    vim.cmd("tabclose")
    zoom_state[tab] = nil
  else
    vim.cmd("tab split")
    zoom_state[vim.api.nvim_get_current_tabpage()] = true
  end
end, { desc = "Zoom toggle" })
