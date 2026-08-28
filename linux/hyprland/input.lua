-- Input config — keyd handles Caps Lock remapping, so keep Omarchy's compose
-- behavior untouched and override only the settings owned by these dotfiles.
hl.config({
  input = {
    kb_layout = "us",
    repeat_rate = 40,
    repeat_delay = 200,
    numlock_by_default = true,
    touchpad = {
      scroll_factor = 0.4,
      natural_scroll = false,
    },
  },
})

o.window("(Alacritty|kitty)", { scroll_touchpad = 1.5 })
o.window("com.mitchellh.ghostty", { scroll_touchpad = 0.2 })
