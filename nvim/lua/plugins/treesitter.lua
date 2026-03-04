return {
  "nvim-treesitter/nvim-treesitter",
  build = ":TSUpdate",
  event = "BufReadPost",
  config = function()
    require("nvim-treesitter").setup({
      ensure_installed = {
        "bash", "go", "hcl", "json", "lua", "markdown",
        "ruby", "terraform", "vim", "vimdoc", "yaml", "zig",
      },
    })
  end,
}
