-- Soft Paper — ported from the Obsidian theme (Nick Milo).
--
-- Light is a warm cream-paper face leaning on Rosé Pine Dawn; dark is
-- Catppuccin Frappé-based. Both share the Zed/Ghostty ports' palette,
-- with secondary tones darkened for legibility on the paper background.
--
-- Pick the face with `:set background=light|dark`, then `:colorscheme
-- soft-paper`. The companion Ghostty/Zed themes live in ../ghostty/themes
-- and ../zed/themes.

local light = {
  bg = "#eee6dd", bg_alt = "#e6dbd1", bg_dim = "#ddd0c6",
  s0 = "#dcd3cb", s1 = "#d1c9c2", s2 = "#cac1b9",
  fg = "#423e5c", muted = "#514c66", comment = "#5e5874",
  red = "#a24e68", maroon = "#ac5c75", orange = "#c8654b", yellow = "#b87b2e",
  green = "#468c66", cyan = "#4d858d", blue = "#286983", sapphire = "#1a7da4",
  purple = "#7e6699", pink = "#bc5990", sky = "#5e979f", type = "#4d858d",
  sel = "#d1c9c2", search = "#e3c79a", inc = "#c8654b",
  diff_add = "#dde5d4", diff_chg = "#e2e0d0", diff_del = "#eed9d9", diff_txt = "#cde2c1",
  term = {
    "#423e5c", "#a24e68", "#468c66", "#b87b2e", "#286983", "#7e6699", "#4d858d", "#dcd3cb",
    "#514c66", "#ac5c75", "#4e9b74", "#c8654b", "#1a7da4", "#bc5990", "#5e979f", "#eee6dd",
  },
}

local dark = {
  bg = "#303446", bg_alt = "#292c3c", bg_dim = "#232634",
  s0 = "#414559", s1 = "#51566c", s2 = "#6e748d",
  fg = "#d6dcf7", muted = "#b2bad8", comment = "#8b91ae",
  red = "#e78284", maroon = "#ea999c", orange = "#ef9f76", yellow = "#d7cb55",
  green = "#74ce9b", cyan = "#2bc6d3", blue = "#8caaee", sapphire = "#2bc6d3",
  purple = "#bb93d6", pink = "#e58bb9", sky = "#99d1db", type = "#99d1db",
  sel = "#51566c", search = "#5b5a3a", inc = "#ef9f76",
  diff_add = "#2d3a31", diff_chg = "#2c3445", diff_del = "#3b2e35", diff_txt = "#3a4a3c",
  term = {
    "#51566c", "#e78284", "#74ce9b", "#d7cb55", "#8caaee", "#e58bb9", "#2bc6d3", "#c3cae6",
    "#6e748d", "#ea999c", "#74ce9b", "#d7cb55", "#8caaee", "#bb93d6", "#99d1db", "#d6dcf7",
  },
}

local function load()
  local p = (vim.o.background == "light") and light or dark

  if vim.g.colors_name then vim.cmd("hi clear") end
  if vim.fn.exists("syntax_on") == 1 then vim.cmd("syntax reset") end
  vim.o.termguicolors = true
  vim.g.colors_name = "soft-paper"

  local function hi(group, spec) vim.api.nvim_set_hl(0, group, spec) end

  local groups = {
    -- Editor UI
    Normal = { fg = p.fg, bg = p.bg },
    NormalNC = { fg = p.fg, bg = p.bg },
    NormalFloat = { fg = p.fg, bg = p.bg_alt },
    FloatBorder = { fg = p.s2, bg = p.bg_alt },
    FloatTitle = { fg = p.blue, bg = p.bg_alt, bold = true },
    ColorColumn = { bg = p.bg_alt },
    Cursor = { fg = p.bg, bg = p.fg },
    lCursor = { fg = p.bg, bg = p.fg },
    CursorLine = { bg = p.bg_alt },
    CursorColumn = { bg = p.bg_alt },
    CursorLineNr = { fg = p.fg, bold = true },
    LineNr = { fg = p.comment },
    SignColumn = { bg = p.bg },
    FoldColumn = { fg = p.comment, bg = p.bg },
    Folded = { fg = p.muted, bg = p.bg_alt },
    WinSeparator = { fg = p.s2 },
    VertSplit = { fg = p.s2 },
    MatchParen = { fg = p.orange, bold = true },
    NonText = { fg = p.s2 },
    Whitespace = { fg = p.s2 },
    SpecialKey = { fg = p.s2 },
    EndOfBuffer = { fg = p.bg },
    Visual = { bg = p.sel },
    VisualNOS = { bg = p.sel },
    Search = { fg = p.bg, bg = p.search },
    IncSearch = { fg = p.bg, bg = p.inc },
    CurSearch = { fg = p.bg, bg = p.inc },
    Substitute = { fg = p.bg, bg = p.orange },
    Conceal = { fg = p.muted },
    Directory = { fg = p.blue },
    Title = { fg = p.blue, bold = true },
    QuickFixLine = { bg = p.bg_alt, bold = true },
    WildMenu = { bg = p.s1 },

    -- Float/menus
    Pmenu = { fg = p.fg, bg = p.bg_alt },
    PmenuSel = { fg = p.fg, bg = p.s1, bold = true },
    PmenuSbar = { bg = p.bg_alt },
    PmenuThumb = { bg = p.s2 },

    -- Statusline / tabs
    StatusLine = { fg = p.fg, bg = p.bg_alt },
    StatusLineNC = { fg = p.muted, bg = p.bg_alt },
    TabLine = { fg = p.muted, bg = p.bg_alt },
    TabLineFill = { bg = p.bg_dim },
    TabLineSel = { fg = p.fg, bg = p.bg, bold = true },

    -- Messages
    ErrorMsg = { fg = p.red, bold = true },
    WarningMsg = { fg = p.yellow },
    ModeMsg = { fg = p.fg, bold = true },
    MoreMsg = { fg = p.green },
    Question = { fg = p.green },

    -- Legacy syntax
    Comment = { fg = p.comment, italic = true },
    Constant = { fg = p.orange },
    String = { fg = p.yellow },
    Character = { fg = p.yellow },
    Number = { fg = p.orange },
    Boolean = { fg = p.orange },
    Float = { fg = p.orange },
    Identifier = { fg = p.fg },
    Function = { fg = p.blue },
    Statement = { fg = p.purple },
    Conditional = { fg = p.purple },
    Repeat = { fg = p.purple },
    Label = { fg = p.blue },
    Operator = { fg = p.cyan },
    Keyword = { fg = p.purple },
    Exception = { fg = p.purple },
    PreProc = { fg = p.maroon },
    Include = { fg = p.purple },
    Define = { fg = p.purple },
    Macro = { fg = p.maroon },
    PreCondit = { fg = p.maroon },
    Type = { fg = p.type },
    StorageClass = { fg = p.purple },
    Structure = { fg = p.type },
    Typedef = { fg = p.type },
    Special = { fg = p.pink },
    SpecialChar = { fg = p.muted },
    Tag = { fg = p.blue },
    Delimiter = { fg = p.muted },
    SpecialComment = { fg = p.muted, italic = true },
    Debug = { fg = p.orange },
    Underlined = { fg = p.cyan, underline = true },
    Ignore = { fg = p.muted },
    Error = { fg = p.red },
    Todo = { fg = p.bg, bg = p.yellow, bold = true },

    -- Diagnostics
    DiagnosticError = { fg = p.red },
    DiagnosticWarn = { fg = p.yellow },
    DiagnosticInfo = { fg = p.blue },
    DiagnosticHint = { fg = p.cyan },
    DiagnosticOk = { fg = p.green },
    DiagnosticUnderlineError = { sp = p.red, undercurl = true },
    DiagnosticUnderlineWarn = { sp = p.yellow, undercurl = true },
    DiagnosticUnderlineInfo = { sp = p.blue, undercurl = true },
    DiagnosticUnderlineHint = { sp = p.cyan, undercurl = true },
    DiagnosticVirtualTextError = { fg = p.red, bg = p.bg_alt },
    DiagnosticVirtualTextWarn = { fg = p.yellow, bg = p.bg_alt },
    DiagnosticVirtualTextInfo = { fg = p.blue, bg = p.bg_alt },
    DiagnosticVirtualTextHint = { fg = p.cyan, bg = p.bg_alt },

    -- Diff / version control
    DiffAdd = { bg = p.diff_add },
    DiffChange = { bg = p.diff_chg },
    DiffDelete = { fg = p.red, bg = p.diff_del },
    DiffText = { bg = p.diff_txt },
    Added = { fg = p.green },
    Changed = { fg = p.blue },
    Removed = { fg = p.red },
    GitSignsAdd = { fg = p.green },
    GitSignsChange = { fg = p.blue },
    GitSignsDelete = { fg = p.red },

    -- Spell
    SpellBad = { sp = p.red, undercurl = true },
    SpellCap = { sp = p.yellow, undercurl = true },
    SpellLocal = { sp = p.blue, undercurl = true },
    SpellRare = { sp = p.purple, undercurl = true },

    -- Treesitter
    ["@comment"] = { link = "Comment" },
    ["@comment.todo"] = { link = "Todo" },
    ["@comment.error"] = { fg = p.red },
    ["@comment.warning"] = { fg = p.yellow },
    ["@comment.note"] = { fg = p.cyan },
    ["@constant"] = { fg = p.orange },
    ["@constant.builtin"] = { fg = p.orange },
    ["@constant.macro"] = { fg = p.maroon },
    ["@string"] = { fg = p.yellow },
    ["@string.escape"] = { fg = p.muted },
    ["@string.regexp"] = { fg = p.cyan },
    ["@string.special"] = { fg = p.pink },
    ["@character"] = { fg = p.yellow },
    ["@number"] = { fg = p.orange },
    ["@boolean"] = { fg = p.orange },
    ["@float"] = { fg = p.orange },
    ["@function"] = { fg = p.blue },
    ["@function.builtin"] = { fg = p.blue },
    ["@function.call"] = { fg = p.blue },
    ["@function.macro"] = { fg = p.maroon },
    ["@method"] = { fg = p.blue },
    ["@method.call"] = { fg = p.blue },
    ["@constructor"] = { fg = p.blue },
    ["@parameter"] = { fg = p.maroon },
    ["@keyword"] = { fg = p.purple },
    ["@keyword.function"] = { fg = p.purple },
    ["@keyword.return"] = { fg = p.purple },
    ["@keyword.operator"] = { fg = p.purple },
    ["@conditional"] = { fg = p.purple },
    ["@repeat"] = { fg = p.purple },
    ["@exception"] = { fg = p.purple },
    ["@operator"] = { fg = p.cyan },
    ["@variable"] = { fg = p.fg },
    ["@variable.builtin"] = { fg = p.purple },
    ["@variable.parameter"] = { fg = p.maroon },
    ["@variable.member"] = { fg = p.red },
    ["@field"] = { fg = p.red },
    ["@property"] = { fg = p.red },
    ["@type"] = { fg = p.type },
    ["@type.builtin"] = { fg = p.type },
    ["@type.definition"] = { fg = p.type },
    ["@namespace"] = { fg = p.maroon },
    ["@module"] = { fg = p.maroon },
    ["@include"] = { fg = p.purple },
    ["@punctuation.delimiter"] = { fg = p.muted },
    ["@punctuation.bracket"] = { fg = p.muted },
    ["@punctuation.special"] = { fg = p.purple },
    ["@tag"] = { fg = p.blue },
    ["@tag.attribute"] = { fg = p.yellow },
    ["@tag.delimiter"] = { fg = p.muted },
    ["@label"] = { fg = p.blue },
    ["@markup.heading"] = { fg = p.blue, bold = true },
    ["@markup.raw"] = { fg = p.yellow },
    ["@markup.link"] = { fg = p.cyan },
    ["@markup.link.url"] = { fg = p.green, underline = true },
    ["@markup.italic"] = { italic = true },
    ["@markup.strong"] = { bold = true },
    ["@markup.list"] = { fg = p.cyan },

    -- LSP semantic tokens
    ["@lsp.type.namespace"] = { link = "@namespace" },
    ["@lsp.type.function"] = { link = "@function" },
    ["@lsp.type.method"] = { link = "@method" },
    ["@lsp.type.parameter"] = { link = "@parameter" },
    ["@lsp.type.variable"] = { link = "@variable" },
    ["@lsp.type.property"] = { link = "@property" },
    ["@lsp.type.type"] = { link = "@type" },
    ["@lsp.type.keyword"] = { link = "@keyword" },
    ["@lsp.type.string"] = { link = "@string" },
    LspReferenceText = { bg = p.s0 },
    LspReferenceRead = { bg = p.s0 },
    LspReferenceWrite = { bg = p.s0, underline = true },
    LspInlayHint = { fg = p.comment, bg = p.bg_alt },

    -- Telescope
    TelescopeNormal = { fg = p.fg, bg = p.bg_alt },
    TelescopeBorder = { fg = p.s2, bg = p.bg_alt },
    TelescopePromptNormal = { fg = p.fg, bg = p.bg_dim },
    TelescopePromptBorder = { fg = p.bg_dim, bg = p.bg_dim },
    TelescopePromptTitle = { fg = p.bg, bg = p.blue, bold = true },
    TelescopePreviewTitle = { fg = p.bg, bg = p.green, bold = true },
    TelescopeResultsTitle = { fg = p.bg_alt, bg = p.bg_alt },
    TelescopeSelection = { bg = p.s1, bold = true },
    TelescopeMatching = { fg = p.orange, bold = true },

    -- Neo-tree
    NeoTreeNormal = { fg = p.fg, bg = p.bg_alt },
    NeoTreeNormalNC = { fg = p.fg, bg = p.bg_alt },
    NeoTreeDirectoryName = { fg = p.blue },
    NeoTreeDirectoryIcon = { fg = p.blue },
    NeoTreeRootName = { fg = p.purple, bold = true },
    NeoTreeFileName = { fg = p.fg },
    NeoTreeGitModified = { fg = p.yellow },
    NeoTreeGitAdded = { fg = p.green },
    NeoTreeGitDeleted = { fg = p.red },
    NeoTreeGitUntracked = { fg = p.muted },
    NeoTreeIndentMarker = { fg = p.s2 },
    NeoTreeTabActive = { fg = p.fg, bg = p.bg_alt, bold = true },
    NeoTreeTabInactive = { fg = p.muted, bg = p.bg_dim },

    -- nvim-cmp / blink
    CmpItemAbbr = { fg = p.fg },
    CmpItemAbbrDeprecated = { fg = p.muted, strikethrough = true },
    CmpItemAbbrMatch = { fg = p.blue, bold = true },
    CmpItemAbbrMatchFuzzy = { fg = p.blue, bold = true },
    CmpItemKind = { fg = p.purple },
    CmpItemMenu = { fg = p.comment },
    BlinkCmpLabel = { fg = p.fg },
    BlinkCmpLabelMatch = { fg = p.blue, bold = true },
    BlinkCmpKind = { fg = p.purple },

    -- which-key
    WhichKey = { fg = p.purple },
    WhichKeyGroup = { fg = p.blue },
    WhichKeyDesc = { fg = p.fg },
    WhichKeySeparator = { fg = p.comment },
    WhichKeyFloat = { bg = p.bg_alt },

    -- treesitter-context
    TreesitterContext = { bg = p.bg_alt },
    TreesitterContextLineNumber = { fg = p.comment, bg = p.bg_alt },

    -- Indent guides (snacks / ibl)
    SnacksIndent = { fg = p.s1 },
    SnacksIndentScope = { fg = p.s2 },
    IblIndent = { fg = p.s1 },
    IblScope = { fg = p.s2 },
  }

  for group, spec in pairs(groups) do hi(group, spec) end

  for i, color in ipairs(p.term) do
    vim.g["terminal_color_" .. (i - 1)] = color
  end
end

load()

return { load = load }
