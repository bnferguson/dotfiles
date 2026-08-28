# Omarchy Quattro Migration Plan

Created 2026-08-28. Complete this after the official Omarchy Quattro upgrade
and reboot; do not run `dots` until steps 1–3 are complete.

Status: complete on 2026-08-28. A pre-migration repository/config snapshot is
stored in `.migration-backups/20260828-221438/` (ignored by Git).

## Current pre-upgrade state

- `omarchy version` reported `3.8.5`.
- `omarchy` resolved to `~/.local/share/omarchy/bin/omarchy` (the legacy,
  Git-managed installation).
- Hyprland was already `0.56.2`, but the Quattro `omarchy` package,
  `/usr/share/omarchy`, and Quickshell were absent.
- The old Waybar/Walker/Mako/SwayOSD/Hyprlock/Hypridle/Swaybg stack remains
  installed.

This is a mixed state. Let Omarchy perform the transition rather than deleting
or modifying the legacy installation manually.

## 1. Complete the official upgrade

- [x] Run `Update > Omarchy` and `Update > Omarchy to Quattro`, then reboot.
- [x] Verify packaged Omarchy 4.0.1 at `/usr/share/omarchy/bin/omarchy`.
- [x] Verify `hyprctl configerrors` is clean.

In the Omarchy menu, run:

```text
Update > Omarchy
Update > Omarchy to Quattro
```

Reboot when prompted. Before continuing, verify:

```sh
omarchy version
command -v omarchy
pacman -Q omarchy
test -d /usr/share/omarchy && echo "packaged Omarchy present"
hyprctl configerrors
```

Expected: `command -v omarchy` must not point into `~/.local/share/omarchy`.
Address any `hyprctl configerrors` before changing dotfiles.

## 2. Preserve a clean baseline

1. [x] Back up the repository's dirty state without committing unrelated user
   changes. The snapshot contains the starting HEAD, status, tracked patch, and
   untracked files.
2. [x] Copy the generated Quattro user files somewhere safe for comparison:

   ```text
   ~/.config/hypr/hyprland.lua
   ~/.config/hypr/bindings.lua
   ~/.config/hypr/input.lua
   ~/.config/hypr/autostart.lua
   ~/.config/omarchy/shell.json
   ~/.config/omarchy/shell.toml
   ```

   `shell.toml` was absent on this installation; all five generated files that
   existed were archived.
3. [x] Leave `/usr/share/omarchy` untouched; it belongs to the pacman package.

## 3. Convert the tracked Hyprland overrides to Lua

- [x] Replace the three tracked `.conf` overrides with Lua equivalents.
- [x] Update `script/bootstrap` to link the Lua files.
- [x] Install the Lua links and remove the obsolete `.conf` links.
- [x] Reload Hyprland, confirm clean config errors, and verify every personal
  binding in both the printed menu and `hyprctl binds -j`.

Quattro does not load the existing tracked `.conf` overrides. Replace these:

```text
linux/hyprland/bindings.conf
linux/hyprland/input.conf
linux/hyprland/autostart.conf
```

with `bindings.lua`, `input.lua`, and `autostart.lua`, then update
`script/bootstrap` to link the Lua files.

Keep only personal overrides. Quattro loads its defaults before the user files.
Use `hl.unbind("MODIFIERS + KEY")` before replacing a stock shortcut and use
`o.bind(...)` for bindings. Translate the existing rules with `o.window(...)`.

Example input conversion:

```lua
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
```

The custom autostart becomes:

```lua
o.launch_on_start("keyd-application-mapper -d")
```

After each change:

```sh
hyprctl reload
hyprctl configerrors
omarchy menu keybindings --print
hyprctl binds -j
```

## 4. Retire Waybar and Gammastep management

- [x] Delete the Waybar linking section from `script/bootstrap` and stop tracking
  `linux/waybar/config.jsonc`. Quickshell replaces Waybar; configure the bar
  through `~/.config/omarchy/shell.json` and visual tweaks through
  `~/.config/omarchy/shell.toml`.
- [x] Remove `gammastep` from `script/install`, remove the Gammastep bootstrap
  block, and retire `linux/gammastep/`. Use Omarchy's Hyprsunset/night-light
  controls so only one component adjusts display gamma.

- [x] Verify Quickshell is active and Waybar is absent.
- [x] Verify Omarchy night light at 4000K, then stop and disable Gammastep.

Do not remove packages or disable the service until the Quattro shell and
night light work correctly.

## 5. Adapt package installation

- [x] Confirm the documented Quattro package commands with `omarchy pkg --help`.
- [x] Use `omarchy pkg add`, `omarchy pkg aur add`, and `omarchy update` from the
  Linux dotfiles workflows.

The Linux installer currently calls `pacman` and `yay` directly. Quattro
expects package and update operations to go through Omarchy. Replace these
with the currently documented equivalents, typically:

```sh
omarchy pkg add <packages>
omarchy pkg aur add <aur-packages>
omarchy update
```

Check `omarchy pkg --help` after upgrading before changing the installer.

## 6. Decide on terminal integration

- [x] Retain the intentional Ghostty font, size, and theme pins.
- [x] Set Ghostty as Quattro's default terminal with
  `omarchy default terminal ghostty`.

Ghostty is intentionally pinned to a font, size, and theme in
`ghostty/config`. Keep that if desired. Remove those settings if Ghostty should
follow Quattro's integrated theme and text scaling. Quattro defaults to Foot,
so explicitly choose Ghostty as the default terminal if retaining it.

## Completion check

The migration is complete when:

- [x] Quattro's packaged `omarchy` and Quickshell are active.
- [x] No custom `.conf` Hyprland file is relied on.
- [x] All personal bindings appear in `hyprctl binds -j`.
- [x] `hyprctl configerrors` is clean.
- [x] Waybar and Gammastep are no longer managed by this repository.
- [x] `dots` uses Quattro-compatible package commands.

## References

- https://github.com/basecamp/omarchy/releases/tag/v4.0.0
- https://github.com/basecamp/omarchy/blob/quattro/manual/31-dotfiles.md
- https://github.com/basecamp/omarchy/issues/6933
