return {
  "nvim-neo-tree/neo-tree.nvim",
  branch = "v3.x",
  dependencies = {
    "nvim-lua/plenary.nvim",
    "nvim-tree/nvim-web-devicons",
    "MunifTanjim/nui.nvim",
  },
  event = "VimEnter",
  keys = {
    { "<Leader>n", "<cmd>Neotree toggle<CR>", desc = "File tree" },
  },
  config = function(_, opts)
    require("neo-tree").setup(opts)

    -- Open neo-tree automatically when nvim is launched without a file
    if vim.fn.argc() == 0 then
      vim.cmd("Neotree show")
    end

    -- Quit nvim if neo-tree is the only window left
    vim.api.nvim_create_autocmd("WinClosed", {
      callback = function()
        vim.schedule(function()
          local wins = vim.api.nvim_tabpage_list_wins(0)
          if #wins == 1 then
            local buf = vim.api.nvim_win_get_buf(wins[1])
            if vim.bo[buf].filetype == "neo-tree" then
              vim.cmd("qa")
            end
          end
        end)
      end,
    })
  end,
  opts = {
    filesystem = {
      filtered_items = {
        visible = true,
        hide_dotfiles = false,
        hide_gitignored = false,
      },
    },
  },
}
