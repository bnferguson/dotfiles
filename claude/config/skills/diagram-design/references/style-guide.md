# Style Guide

**The single source of truth for colors, typography, and tokens.** Every diagram draws from this — not from hex values inlined in other reference files. If you want to change the visual skin of Schematic, change this file.

**Active skin: Soffi** — onboarded from `https://soffi.ai` on 2026-08-12. Extracted from the site's rendered CSS: the default `:root` / `.light` theme, the `--soffi-landing-*` namespace that skins the marketing pages, and the `.dusk` theme for the dark variant.

Soffi's brand is **deliberately monochrome** — a warm-neutral paper, near-black Atacama serif headings, and a slate body ramp, with no saturated brand color anywhere. That single fact drives the two ways this skin departs from the shipped default; both are recorded in "Focal without hue" below.

To re-skin from a different source, see [`onboarding.md`](onboarding.md).

---

## Tokens

### Semantic roles

Every token is referred to by **semantic role**, not by its hex value. Type references (`type-*.md`) and SKILL.md say `accent`, not `#1c1d21`.

| Role | Purpose | Light | Dark | Source token |
|---|---|---|---|---|
| `paper` | Page background, default node fill | `#fafafa` | `#1c1d21` | `--soffi-landing-surface-subtle` / `.dusk --surface-0` |
| `paper-2` | Diagram container bg, secondary fill | `#ececed` | `#232428` | `--soffi-landing-surface-muted` / `.dusk --surface-1` |
| `ink` | Primary text, primary stroke | `#37383e` | `#c5c6ce` | `--soffi-landing-text-heading` / `.dusk --text-medium` |
| `muted` | Secondary text, default arrow stroke | `#506a76` | `#999ba5` | `--text-faint` / `.dusk --text-primary` |
| `soft` | Sublabels, boundary labels | `#757f8a` | `#8a8a91` | `--text-disabled` / `.dusk --text-faint` |
| `rule` | Hairline borders | `rgba(55,56,62,0.14)` | `rgba(197,198,206,0.14)` | derived from `ink` |
| `rule-solid` | Stronger borders, baselines | `#d6dbde` | `#3a3b41` | `--soffi-landing-border` / `.dusk --border-1` |
| `accent` | Focal / 1–2 max per diagram | `#1c1d21` | `#f0f0f4` | `--soffi-landing-btn-primary` / `.dusk --button-primary` |
| `accent-text` | Text/glyphs *inside* a focal fill | `#fafafa` | `#1c1d21` | reversed `paper` |
| `link` | HTTP/API calls, external arrows | `#1447e6` | `#7b9fd4` | `--text-link` |

> **Brand palette source:** soffi.ai ships a 16-step neutral ramp (`--smoke-0` `#fff` → `--smoke-1000` `#000`) and no brand hue. The tokens above pull from the landing-page namespace where one exists, because that's the register a diagram sits in; the product app's slightly cooler ink (`--text-primary` `#3e515b`) is the same family one step bluer.
>
> **Deliberately unused:** `#2da08c` (teal) is the only saturated color on soffi.ai, appearing once as `--soffi-landing-accent-glow: #2da08c24` — a 14%-alpha hero glow. It is not a brand accent and must not be promoted to one. `#1447e6` is claimed by `link` (HTTP/API arrows) and is not available as a focal color. Status hues (`--status-error` `#c10007`, `--status-success` `#008236`, `--status-warning` `#a65f00`) are semantic and stay out of diagrams unless the diagram is literally about status.

> **Note:** The pre-baked example HTML files in `assets/` were built under an earlier skin. New diagrams the skill produces use the tokens above.

### Focal without hue

The shipped default marked focal nodes with a coral stroke + tint fill. Soffi has no hue to spend, so **focal is carried by fill and weight instead of color**:

1. **Focal nodes are solid-filled.** Fill `accent`, no separate stroke, and set every glyph inside to `accent-text`. This is exactly how soffi.ai renders its primary button (`--soffi-landing-btn-primary` `#1c1d21` with white text) — the focal treatment is borrowed from the real interface, not invented.
2. **Focal arrows differentiate by weight.** `stroke-width: 1.2` in `accent`, against `stroke-width: 1` in `muted` for everything else. Same color, different presence.

The 1–2-focal-elements budget is **unchanged and matters more here**, not less. A colored accent that appears five times is merely loud; a solid black block that appears five times destroys the page's figure/ground entirely.

Two knock-on adjustments, since `accent` and `ink` are now the same hue family:

- **Security / boundary** regions can no longer be "accent dashed". They use `ink @ 0.45` dashed `4,4` with an `ink @ 0.04` fill — read as a boundary by dash pattern, not by color.
- **Never put `accent`-colored *text* on `paper`.** `#1c1d21` on `#fafafa` is indistinguishable from `ink`. Accent only ever appears as a fill, a marker, or a 1.2-weight stroke.

### Inversion rule (light → dark)

Any `rgba(55,56,62, X)` in light becomes `rgba(197,198,206, X)` in dark. Same opacities, RGB flipped. `accent` and `paper` **swap roles** across themes — `#1c1d21` is the light-mode focal fill and the dark-mode page background; `#f0f0f4` is the dark-mode focal fill. Soffi's own `.dusk` theme does the same thing with `--button-primary`, so the inversion is the brand's, not an invention.

### Contrast (verified against `paper`)

| Pair | Ratio | Verdict |
|---|---|---|
| `ink` `#37383e` on `paper` `#fafafa` | 11.2:1 | AAA |
| `muted` `#506a76` on `paper` | 5.5:1 | AA |
| `soft` `#757f8a` on `paper` | 3.9:1 | Sublabels only (9px eyebrow/mono) — never body text |
| `accent-text` `#fafafa` on `accent` `#1c1d21` | 15.9:1 | AAA |

### Series palette (multi-series chart types only)

A small set of desaturated, editorial-tone colors for chart types that genuinely need to distinguish multiple overlapping entities (currently: **radar**). The "1-focal" rule still holds — `accent` is reserved for the focal series; the palette below covers the rest.

Because `accent` is monochrome in this skin, the focal series is the **solid `accent` stroke at weight 1.2** — same rule as focal nodes. The tokens below cover the *non-focal* series only, and they're drawn from colors soffi.ai already ships rather than a generic editorial set.

| Token | Light | Dark | Soffi source |
|---|---|---|---|
| `series-1` | `#506a76` (smoke-550) | `#8fa6b0` | `--smoke-550` — the neutral ramp |
| `series-2` | `#2da08c` (teal) | `#5cbfae` | `--soffi-landing-accent-glow` base |
| `series-3` | `#a65f00` (amber) | `#e0a84c` | `--status-warning` |
| `series-4` | `#0369a1` (deep blue) | `#7ba3e0` | `--status-info` |
| `series-5` | `#8a6ba8` (violet) | `#a98cc4` | derived — no Soffi equivalent, lowest-confidence token here |

Fills sit at `0.18` opacity light, `0.22` dark; strokes use the full color. **Don't backfill these tokens to non-chart types** — architecture, swimlane, etc. continue to use muted-ink variants. This is the one place the Soffi skin permits hue, and only because overlapping radar polygons are unreadable without it. Everywhere else, monochrome holds.

### Terminal skin (opt-in alternate)

A self-contained palette for the terminal-window primitive (see [primitive-terminal.md](primitive-terminal.md)) — a CLI-chrome register for dev-tool posts and technical social cards. It does not replace the default skin above and isn't affected by onboarding; it's a second, fixed skin you opt into per-diagram.

| Token | Hex | Purpose |
|---|---|---|
| `terminal-page` | `#0a0a0a` | Page background behind the window |
| `terminal-paper` | `#141414` | Window body, node fill |
| `terminal-bar` | `#1b1b1b` | Titlebar strip |
| `terminal-border` | `#2b2b2b` | Window border, hairlines |
| `terminal-ink` | `#f5f5f5` | Primary text, primary stroke (same white-smoke as default `ink`) |
| `terminal-muted` | `#9a9a9a` | Secondary text, sublabels, ring stroke |
| `terminal-soft` | `#5c5c5c` | Tertiary — inactive dots, spokes |
| `terminal-accent` | `#ff5a36` | The one accent — focal station, prompt sign, active dot |
| `terminal-accent-tint` | `rgba(255,90,54,0.12)` | Fill for accent-bordered boxes |

**1-accent rule still holds.** Everything that isn't `terminal-ink` or `terminal-muted`/`terminal-soft` should be `terminal-accent` — never introduce a second hue.

---

## Typography

Soffi already ships the serif + sans + mono trio, so every role maps to a real brand font. No substitutes needed.

| Role | Family | Size | Weight | Usage |
|---|---|---|---|---|
| `title` | **Atacama** (serif) | 1.75rem | 400 | Page H1 |
| `node-name` | **Instrument Sans** | 12px | 600 | Human-readable labels |
| `sublabel` | Geist Mono | 9px | 400 | Port, protocol, URL, field type |
| `eyebrow` | Geist Mono | 7–8px | 500, tracked 0.18em, uppercase | Type tags, axis labels |
| `arrow-label` | Geist Mono | 8px | 400, tracked 0.06em | Arrow annotations |
| `callout` | **Atacama** *italic* | 14px | 400 | Editorial asides only |

### Font stack

Instrument Sans and Geist Mono load from Google Fonts:

```html
<link href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600&family=Geist+Mono:wght@400;500;600&display=swap" rel="stylesheet">
```

**Atacama must be embedded, not linked.** soffi.ai self-hosts it at `/fonts/atacama/Atacama-VF.woff2` and serves it **without an `Access-Control-Allow-Origin` header**. `@font-face` fetches are CORS-restricted (unlike `<img>`), so a remote `url()` pointing at soffi.ai fails in every context a generated diagram actually opens in — including `file://`, where the origin is `null`.

Paste both `@font-face` blocks from [`../assets/fonts/atacama-embed.css`](../assets/fonts/atacama-embed.css) into each diagram's inline `<style>`. That file carries the roman and italic faces as base64 `data:` URIs — the variable originals instanced at `wght=400` and subset to Latin, which takes 538 KB down to 162 KB (~216 KB base64). Diagrams then render correctly offline, in email, and dropped into a deck.

To regenerate after a font update, see "Refreshing Atacama" below.

**Load-bearing rule:** Mono is for *technical* content (ports, commands, URLs, field types). Names go in Instrument Sans. Page title is Atacama. Italic Atacama is reserved for annotation callouts (see [primitive-annotation.md](primitive-annotation.md)). **Never JetBrains Mono** as a blanket "dev" font.

### Refreshing Atacama

The embedded subset is pinned to whatever soffi.ai served on 2026-08-12. If the typeface is updated, rebuild it — the pipeline needs `fonttools[woff]` and `brotli`:

```bash
curl -sLO https://soffi.ai/fonts/atacama/Atacama-VF.woff2
curl -sLO https://soffi.ai/fonts/atacama/Atacama-Italic-VF.woff2

for f in Atacama-VF Atacama-Italic-VF; do
  fonttools varLib.instancer $f.woff2 wght=400 -o $f.400.ttf
  pyftsubset $f.400.ttf --output-file=$f.400.woff2 --flavor=woff2 \
    --layout-features='kern,liga,calt' --drop-tables+=DSIG \
    --unicodes="U+0020-007E,U+00A0-00FF,U+2010-2015,U+2018-201D,U+2022,U+2026,U+2032-2033,U+2039-203A,U+2044,U+20AC,U+2190-2193,U+2212,U+00D7"
done
```

Then base64 each result into the two `src:` fields of `assets/fonts/atacama-embed.css`.

Subsetting the variable font alone only saves ~27% — the weight-axis deltas dominate, not the glyph set. **Instancing at a single weight is what makes it small**, so don't drop that step. The consequence is that only weight 400 exists: diagrams must never ask Atacama for bold. Titles get their presence from size, not weight.

---

## Stroke, radius, spacing

| Token | Value | Use |
|---|---|---|
| `stroke-thin` | `0.8` | Tag-box outlines, leaf nodes |
| `stroke-default` | `1` | Most strokes |
| `stroke-strong` | `1.2` | Emphasis strokes |
| `radius-sm` | `4` | Small tags |
| `radius-md` | `6` | Node boxes |
| `radius-lg` | `8` | Containers, rings |
| `grid` | `4` | Every coord, size, and gap is divisible by 4 (hard rule) |

---

## Node type → treatment

Semantic role combinations — reference these by name in type specs.

| Type | Fill | Stroke | Text |
|---|---|---|---|
| `focal` (1–2 max) | `accent` **solid** | none | `accent-text` |
| `backend` | `#ffffff` (white) | `ink` | `ink` |
| `store` | `ink @ 0.05` | `muted` | `ink` |
| `external` | `ink @ 0.03` | `ink @ 0.30` | `muted` |
| `input` | `muted @ 0.10` | `soft` | `ink` |
| `optional` | `ink @ 0.02` | `ink @ 0.20` dashed `4,3` | `muted` |
| `security` | `ink @ 0.04` | `ink @ 0.45` dashed `4,4` | `muted` |

`focal` is the only row that reverses its text. Every tag box, sublabel, and glyph inside a focal node flips to `accent-text` — a leftover `ink` sublabel on a solid `accent` fill is invisible, and it's the most common way this treatment gets broken.

### Arrow weights

With no accent hue, arrows separate by weight:

| Arrow | Stroke | Width | When |
|---|---|---|---|
| Default | `muted` `#506a76` | 1 | Internal, generic |
| Focal | `accent` `#1c1d21` | **1.2** | Primary / highlighted path |
| Link | `link` `#1447e6` | 1 | HTTP/API calls, external systems |
| Dashed | any of the above | — | `stroke-dasharray="5,4"` for optional, passive, return, async |

Markers inherit their arrow's color. `link` is the only hue in the set and stays reserved for genuine HTTP/API hops — using it for emphasis re-introduces the color-signal confusion this skin exists to avoid.

---

## Customizing the skin

Three options:

1. **Run onboarding** — see [`onboarding.md`](onboarding.md). Drop a URL; the skill extracts the palette + fonts and rewrites this file.
2. **Edit by hand** — change the hex values in the tables above. Run the pre-output taste gate afterward to verify the accent still reads as "focal" against the new paper color.
3. **Brand handoff** — paste your existing design-token JSON into a new section here and map its tokens to the semantic roles above.

### Constraints (don't break these)

- **Contrast**: `ink` must hit WCAG AA on `paper`. `muted` must hit AA on `paper` for 11px+ text.
- **One accent**: pick one color for `accent`. Two accents erases the focal signal. Under the Soffi skin the accent isn't a hue at all — see "Focal without hue" — but the count still binds.
- **No rainbow palette**: if your brand ships 8 colors, pick 3 (paper, ink, accent). The rest become `muted` variants.
- **Serif + sans + mono**: three families, not more. If brand typography is all sans, keep a serif for `title` and `callout` anyway — the contrast is load-bearing. Soffi supplies its own serif (Atacama), so no substitute applies here.
- **Paper is warm-neutral, not pure white**: pure white turns the design sterile. Pick a cream, bone, or light grey with a hint of warmth. Soffi's surfaces are true-neutral rather than warm, so this skin uses `#fafafa` (`--soffi-landing-surface-subtle`) instead of the site's `#fff` — off-white without importing a warmth the brand doesn't have.
- **Dot pattern is optional, not default**: the 22×22 dot pattern is an opt-in "dotted paper" variant (good for long-form editorial hero diagrams). The default background is a clean `paper` fill, no pattern. When the pattern is enabled, it should sit at ~10% opacity of `ink` on `paper` — visible but quiet.
- **Container is clean by default**: the diagram sits directly on the page paper, no secondary container background or border. A framed variant (`paper-2` bg + `rule` border + 8px radius + padding) is available as an opt-in for card-heavy layouts, but don't reach for it by default — the extra chrome fights the figure.
