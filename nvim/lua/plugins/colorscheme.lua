return {
  {
    "ellisonleao/gruvbox.nvim",
    priority = 1000,
    config = function()
      require("gruvbox").setup({
        contrast = "hard",
      })
      vim.o.background = "dark"
      vim.cmd.colorscheme("gruvbox")

      -- Soft Paper option lives at colors/soft-paper.lua — switch with
      -- `:colorscheme soft-paper` (`:set background=light` for the paper
      -- face). Shares the Ghostty/Zed Soft Paper palette.
    end,
  },
}
