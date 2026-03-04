return {
  "nvim-telescope/telescope.nvim",
  branch = "0.1.x",
  dependencies = { "nvim-lua/plenary.nvim" },
  keys = {
    { "<Leader>p", "<cmd>Telescope find_files<CR>", desc = "Find files" },
    { "<Leader>f", "<cmd>Telescope live_grep<CR>", desc = "Live grep" },
    { "<Leader>b", "<cmd>Telescope buffers<CR>", desc = "Buffers" },
  },
  opts = {
    defaults = {
      layout_strategy = "horizontal",
      sorting_strategy = "ascending",
      layout_config = { prompt_position = "top" },
    },
  },
}
