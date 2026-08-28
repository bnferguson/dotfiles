-- Hyper key app launchers — mirrors BetterTouchTool bindings from macOS.
-- Hyper = Caps Lock (held) via keyd, which sends CTRL+SUPER+ALT+SHIFT.
local hyper = "CTRL + SUPER + ALT + SHIFT"

local function hyper_key(key)
  return hyper .. " + " .. key
end

-- Keep stack members together on their home workspaces. app-stack creates
-- and rotates the groups; these rules only provide the initial placement.
o.window("^chrome-(mail|calendar)\\.google\\.com__-Default$", { workspace = "3 silent" })
o.window("^(slack|chrome-discord\\.com__channels_@me-Default)$", { workspace = "3 silent" })
o.window("^(signal|org\\.telegram\\.desktop|chrome-web\\.whatsapp\\.com__-Default)$", { workspace = "4 silent" })

-- app-stack builds groups explicitly, so a newly opened window should not
-- auto-join whichever group happens to be focused.
hl.config({
  group = {
    auto_group = false,
  },
})

o.bind(hyper_key("SPACE"), "Launch apps", "omarchy menu toggle apps")
o.bind(hyper_key("N"), "Toggle notification silencing", "omarchy toggle notification silencing")

o.bind(hyper_key("3"), "Screenshot full screen", "omarchy capture screenshot fullscreen")
o.bind(hyper_key("4"), "Screenshot region", "omarchy capture screenshot region")
o.bind(hyper_key("5"), "Screenshot menu", "omarchy capture screenshot smart")

o.bind(
  hyper_key("Q"),
  "Mail/Calendar stack",
  '$HOME/.dotfiles/linux/hyprland/app-stack "mail.google.com__|omarchy launch webapp https://mail.google.com" "calendar.google.com__|omarchy launch webapp https://calendar.google.com"'
)
o.bind(hyper_key("W"), "Terminal (focus or launch)", "omarchy launch or focus '^com\\.mitchellh\\.ghostty$' 'uwsm-app -- xdg-terminal-exec'")
o.bind(hyper_key("E"), "Zed (focus or launch)", "omarchy launch or focus 'dev.zed.Zed' 'uwsm-app -- zeditor'")
o.bind(hyper_key("R"), "Firefox (focus or launch)", "omarchy launch or focus '^firefox$' 'uwsm-app -- firefox'")
o.bind(
  hyper_key("A"),
  "Slack/Discord stack",
  '$HOME/.dotfiles/linux/hyprland/app-stack "slack|uwsm-app -- slack" "discord.com|omarchy launch webapp https://discord.com/channels/@me"'
)
o.bind(hyper_key("S"), "Spotify (focus or launch)", "omarchy launch or focus 'spotify' 'uwsm-app -- spotify'")
o.bind(
  hyper_key("D"),
  "Messengers stack",
  '$HOME/.dotfiles/linux/hyprland/app-stack "web.whatsapp.com__|omarchy launch webapp https://web.whatsapp.com" "signal|uwsm-app -- signal-desktop" "org.telegram.desktop|uwsm-app -- Telegram"'
)
o.bind(hyper_key("F"), "File manager (focus or launch)", "omarchy launch or focus 'org.gnome.Nautilus' 'uwsm-app -- nautilus --new-window'")
o.bind(hyper_key("G"), "Terminal", "omarchy launch terminal")
o.bind(hyper_key("C"), "Obsidian (focus or launch)", "omarchy launch or focus '^obsidian$' 'uwsm-app -- obsidian --disable-gpu --enable-wayland-ime'")

-- In apps where keyd rewrites Alt to Ctrl, Ctrl+Q closes the app itself;
-- elsewhere this Hyprland binding closes the active window.
o.bind("ALT + Q", "Close window", hl.dsp.window.close())

o.bind(hyper_key("UP"), "Toggle maximize", hl.dsp.window.fullscreen({ mode = "maximized" }))
o.bind(hyper_key("DOWN"), "Toggle floating", hl.dsp.window.float({ action = "toggle" }))
o.bind(hyper_key("LEFT"), "Tile left", hl.dsp.window.move({ direction = "l" }))
o.bind(hyper_key("RIGHT"), "Tile right", hl.dsp.window.move({ direction = "r" }))

o.bind(hyper_key("ESCAPE"), "Sleep display", "sleep 0.5 && hyprctl dispatch dpms off")
