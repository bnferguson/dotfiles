return {
  {
    "williamboman/mason.nvim",
    build = ":MasonUpdate",
    config = function()
      -- Prepend mise-installed runtime bins so Mason uses them instead of
      -- system Ruby 2.6 (which is too old for ruby-lsp).
      local mise_root = vim.fn.expand("~/.local/share/mise/installs")
      for _, tool in ipairs({ "ruby/latest", "go/latest" }) do
        local bin = mise_root .. "/" .. tool .. "/bin"
        if vim.uv.fs_stat(bin) then
          vim.env.PATH = bin .. ":" .. vim.env.PATH
        end
      end
      require("mason").setup()
    end,
  },
  {
    "williamboman/mason-lspconfig.nvim",
    dependencies = { "williamboman/mason.nvim" },
    opts = {
      ensure_installed = {
        "lua_ls",
        "ruby_lsp",
        "gopls",
        "terraformls",
        "zls",
      },
    },
  },
  {
    -- Still needed: provides filetypes/root_markers/cmd for vim.lsp.config
    "neovim/nvim-lspconfig",
    event = "BufReadPre",
    dependencies = {
      "williamboman/mason.nvim",
      "williamboman/mason-lspconfig.nvim",
      "hrsh7th/cmp-nvim-lsp",
    },
    config = function()
      -- Set default capabilities for all LSP clients (nvim-cmp integration)
      vim.lsp.config("*", {
        capabilities = require("cmp_nvim_lsp").default_capabilities(),
      })

      -- lua_ls needs custom settings for nvim config editing
      vim.lsp.config("lua_ls", {
        settings = {
          Lua = {
            workspace = { checkThirdParty = false },
            telemetry = { enable = false },
          },
        },
      })

      -- Quakefile: filetype detection + language server. Not managed
      -- by Mason; the binary ships from ~/dev/quake.
      vim.filetype.add({
        filename = { Quakefile = "quakefile" },
        pattern = {
          [".*%.quake"] = "quakefile",
          [".*_Quakefile"] = "quakefile",
        },
      })

      vim.lsp.config("quake_lsp", {
        cmd = { vim.fn.expand("~/dev/quake/quake"), "lsp" },
        filetypes = { "quakefile" },
        root_markers = { "Quakefile", ".git" },
      })

      vim.lsp.enable({ "lua_ls", "ruby_lsp", "gopls", "terraformls", "zls", "quake_lsp" })

      -- Keymaps on LSP attach
      vim.api.nvim_create_autocmd("LspAttach", {
        callback = function(ev)
          local buf = ev.buf
          local map = function(mode, lhs, rhs, desc)
            vim.keymap.set(mode, lhs, rhs, { buffer = buf, desc = desc })
          end

          map("n", "gd", vim.lsp.buf.definition, "Go to definition")
          map("n", "gy", vim.lsp.buf.type_definition, "Go to type definition")
          map("n", "gi", vim.lsp.buf.implementation, "Go to implementation")
          map("n", "gr", vim.lsp.buf.references, "References")
          map("n", "K", vim.lsp.buf.hover, "Hover docs")
          map("n", "<Leader>rn", vim.lsp.buf.rename, "Rename symbol")
          map("n", "<Leader>ac", vim.lsp.buf.code_action, "Code action")
          map("n", "<Leader>qf", function()
            vim.lsp.buf.code_action({
              filter = function(a) return a.isPreferred end,
              apply = true,
            })
          end, "Quick fix")
          map("n", "[g", vim.diagnostic.goto_prev, "Previous diagnostic")
          map("n", "]g", vim.diagnostic.goto_next, "Next diagnostic")
        end,
      })
    end,
  },
}
