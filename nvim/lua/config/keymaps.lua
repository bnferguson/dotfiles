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

-- Quit — skip sidebar windows so \w always targets code buffers
local function smart_quit()
  local win = vim.api.nvim_get_current_win()
  local bt = vim.bo.buftype
  -- If we're in a sidebar (neo-tree, outline, etc.), just close it
  if bt == "nofile" or vim.bo.filetype == "neo-tree" then
    vim.cmd("q")
    return
  end
  -- Count non-sidebar windows
  local real_wins = 0
  for _, w in ipairs(vim.api.nvim_tabpage_list_wins(0)) do
    local buf = vim.api.nvim_win_get_buf(w)
    if vim.bo[buf].buftype == "" then
      real_wins = real_wins + 1
    end
  end
  -- If this is the last real window, quit nvim entirely
  if real_wins <= 1 then
    vim.cmd("qa")
  else
    vim.cmd("q")
  end
end
map("n", "<Leader>w", smart_quit)
map("i", "<Leader>w", function() vim.cmd("stopinsert"); smart_quit() end)

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
