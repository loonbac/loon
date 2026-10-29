# A wallpaper theme: `Wallpaper (LOON)`

LOON can install a real pi theme generated from the wallpaper accent, so picking
`Theme: Wallpaper (LOON)` in gentle-pi's menu recolours the whole interface - and
keeps following the wallpaper while it is active.

## Specs` below quoted verbatim and
`## Log` starting with L1 = the user's message.

## Specs

**S1 (user, verbatim)**: "tambien necesito que en themes haya una nueva opcion Theme:
Wallpaper que cambie de color todo como los otros temas, pero quiero que los nuevos temas
que meta mi plugin terminen asi con un (LOON)"

**S2 — what pi already gives us (measured, do not re-investigate)**:
- gentle-pi's Themes category is **generated at runtime**, not a fixed list
  (`gentle-shell.ts` ~2567): it calls `ctx.ui.getAllThemes()` and pushes one
  `Theme: <name>` row per installed theme, whose action calls `ctx.ui.setTheme(name)` and
  lets Pi persist the choice. **The new option therefore needs no third patch of
  gentle-pi**: a real installed theme named `Wallpaper (LOON)` produces the row
  `Theme: Wallpaper (LOON)` by itself.
- `getCustomThemeInfos()` (`dist/modes/interactive/theme/theme.js` ~320) does
  `readdirSync(getCustomThemesDir())` **on every call**, and `getCustomThemesDir()` is
  `<agentDir>/themes` = `~/.pi/agent/themes`. A valid JSON written there is listed without
  restarting pi.
- `startThemeWatcher()` (same file, ~585) watches
  `path.join(customThemesDir, currentThemeName + ".json")` and hot-reloads it through
  `loadThemeFromPath` + `setGlobalTheme`. So while our theme is active, rewriting its file
  recolours the running session. The file name must be exactly `<name>.json`, and the
  theme's own `name` field must equal `<name>` (S3 fixes that name).
- pi validates theme JSON (`setThemeJsonValidator`) and fills missing tokens from
  `withThemeTokenFallbacks`. Do not invent a shape: copy the key set of a known-good theme
  (gentle-pi ships `Gentle.json`, `Gentleman-Cute.json`, `Gentleman-Sexy.json` at
  `~/.pi/agent/npm/node_modules/gentle-pi/themes/`; `Gentleman-Sexy` has 25 `vars` and
  55 `colors` entries using var references).
- There is **no theme-change notification** in the extension API (no
  `onThemeChange` in the `.d.ts` the extension sees; only `settings-manager.setTheme`).
  But `ctx.ui.theme` is readable at paint time, and picking a theme rewrites
  `~/.pi/agent/settings.json`, which LOON already watches through `piConfigHome()`. Use
  those two facts, not a new subscription.

**S3 — the deliverable is a real theme, not a menu hack**: LOON generates
`~/.pi/agent/themes/Wallpaper (LOON).json` (file name = `name` + `.json`), with
`"name": "Wallpaper (LOON)"`. Consequences to keep working: the menu row reads
`Theme: Wallpaper (LOON)` (and `... (current)` when active), Pi persists
`"theme": "Wallpaper (LOON)"` in `settings.json`, and the theme survives restarts because
LOON regenerates it at session start if it is missing or stale.

**S4 — the naming rule the user asked for**: every theme LOON ships or generates has a
`name` ending in ` (LOON)`. Implement it once, in one helper (for example
`loonThemeName(base)`), and derive the file name from it so name and file cannot drift.
A test asserts the suffix for every theme LOON knows about, and forbids a "/" in the name
(pi reserves it for light/dark settings).

**S5 — the palette, and that it really recolours everything**: the generated theme must
be a **complete** theme (same key set as a shipped one), derived only from the colour in
`~/.config/mpvpaper/accent.txt`:
- UI roles (backgrounds, panels, borders, text, muted, dim, accent, heading, secondary,
  selection, warnings/success/error) come from the wallpaper colour's hue in OKLCH, with
  the wallpaper colour itself as `accent`. Backgrounds at very low lightness, text near
  the top, muted/dim in between: nothing is left as a copy of another theme.
- Syntax roles are hue rotations of the wallpaper hue with clamped chroma, chosen so the
  hues stay distinguishable from each other and legible; the code must not become
  unreadable.
- Hard floors, asserted by tests on the computed palette: text/background contrast >= 7:1,
  muted/background >= 4.5:1, accent/background >= 3:1. A wallpaper whose hue cannot reach
  the floors still yields a valid theme (clamp lightness/chroma), never an invalid one.
- The derivation is a pure function (accent RGB in, theme object out): deterministic, no
  randomness, no clock, no IO.

**S6 — regeneration and live follow**: generate at session start when the file is absent,
invalid, or older than `accent.txt`; regenerate whenever the wallpaper changes (the
existing directory watch on `~/.config/mpvpaper` already fires). While `Wallpaper (LOON)`
is the active theme, the rewrite must recolour the open session without restarting pi —
that is pi's own watcher. Verify that with a real frame; do not assume it.

**S7 — never clobber a foreign file**: write only when the target is absent, or when its
existing `name` ends with ` (LOON)`. If a file with our name exists but is not ours, skip
it, keep it untouched, and say so in `/loon:tui status`. Writes are atomic (tmp + rename),
directories created if missing.

**S8 — the banner must not fight the theme**: while the active theme's name ends with
` (LOON)` and it is the wallpaper theme, LOON's banner accent follows the wallpaper
(subject to the existing fallback), so box and theme agree. This is derived at paint time
from the active theme name; it must not silently rewrite `loon-tui.json`.

**S9 — checks, docs and boundaries**: RED first for each new rule (name suffix, file name
= name.json, determinism, the three contrast floors, foreign-file guard, stale
regeneration, banner accent coupling, valid JSON accepted by pi's own loader if reachable).
Update README and `/loon:tui status` (which theme is generated, its path, whether it is
active). Artifacts in English. Do not modify gentle-pi's own themes, do not change the
`banner.json` format, add no dependency, and leave `tests/fixtures/header-{80,120}.txt`
byte-identical.

## Tasks

| ID | Specs | Route | Commit |
| --- | --- | --- | --- |
| T1 | S1-S9 (this document) | inline | 5af6061 |
| T2 | S4, S5 | inline | 45fc907 |
| T3 | S3, S5, S7 | inline | 0470cba |
| T4 | S6, S8 | inline | 0470cba |
| T5 | S9 | inline | pending |

## Log

L1 — the user's request, verbatim:

> "tambien necesito que en themes haya una nueva opcion Theme: Wallpaper que cambie de color todo como los otros temas, pero quiero que los nuevos temas que meta mi plugin terminen asi con un (LOON)"

L2 — decisions already taken, not to be changed without asking: the theme is named
`Wallpaper (LOON)`; the palette is derived from the accent in OKLCH with hue rotations
for syntax and hard contrast floors; the derivation is a pure function; the file is
regenerated when missing, stale or on a wallpaper change; a foreign file is never
clobbered; the banner follows the wallpaper while that theme is active, without
rewriting `loon-tui.json`.

L3 — implementation notes and evidence:

- `extensions/lib/oklch.ts`: sRGB to OKLab/OKLCH and back, gamut-aware chroma
  reduction, WCAG luminance and contrast. Pure, no IO.
- `extensions/lib/wallpaper-theme.ts`: `loonThemeName`, `isLoonThemeName`,
  `themeFileName` and `deriveWallpaperTheme(accent)`. The palette uses 55 colour
  keys and 33 vars; the accent is lifted in lightness until it clears 3:1 against
  the background, keeping its hue.
- `extensions/lib/theme-file.ts`: `ensureWallpaperTheme` writes atomically and only
  when absent, unparsable or older than the accent file; a file whose `name` is not
  ours is reported `skipped-foreign` and left untouched.
- Wiring: the theme is ensured on session start and on every wallpaper change; the
  banner follows the wallpaper when `ctx.ui.theme.name` is ours (paint-time, no
  settings write); `status` reports the outcome and whether it is active.
- Measured contrast for the real accent `#D5A9F0`: text 17.3:1, muted 8.1:1, accent
  10:1 against `#100B13`; for a black wallpaper the accent is lifted to `#636363`
  (3.2:1) instead of disappearing.
- pi's own `loadThemeFromPath` loads the generated file and resolves `accent` to
  the wallpaper colour, which is asserted when pi is installed.
L4 — the prompt band, and why the role is `selectedBg` and not `selection`:

- gentle-pi painted the prompt card's band with `toolSuccessBg`
(`lib/shell-prompt.ts:151`), a role that means "a tool succeeded", only because it
  needed *some* background. A surface is not a success.
- pi resolves `fg`/`bg` over **colour keys**, not over `vars`: `theme.bg("selection")`
  throws `Unknown theme color`, gentle-pi catches it into an empty background, and the
  card silently falls back to its no-background path. The colour key bound to the
  `selection` var is `selectedBg`, and `theme.bg("selectedBg", " ")` returns
  `48;2;86;77;43m` for the live palette. That is what the patch uses.
- Palette: `selection` and `border` are now tinted surfaces of the accent hue -
  selection at 2.3:1 against the background, border at 2.5:1, both inside the 3.2
  ceiling, with chroma preferred at 1.6x the floor and the floor as fallback.
  `toolSuccessBg` stays green (hue 149.6 for the live accent) and a test pins it.
- Measured with the live accent `#AB9A5E` (hue 94.1): band `#564D2B` (hue 95.0,
  delta 0.9), border `#60521E` (hue 94.1), rows 29-31 of a 100-column frame.
- The shell's top status bar still paints `#101F13` (hue 149.6): it borrows
  `toolSuccessBg` for its INFO/SUCCESS card tones in `lib/shell-card.ts:268-269`. Out
  of the scope of this slice; reported with the number.