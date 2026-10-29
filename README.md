# LOON-Pi

A pi package that gives the TUI a **theme-aware startup header**, and nothing
else: the pi-claude-code-tui box, painted entirely by the theme you already use.

```
╭─── Pi v1.4.0 ────────────────────────────────────────────────────────────────╮
│                                 │                                            │
│                                 │ Getting started                            │
│          █████████              │ Ask Pi to build it                         │
│          ███   ███              │ ────────────────────────────────────────── │
│          ██████   ███           │ Commands                                   │
│          ███      ███           │ /use-default-tui                           │
│                                 │ /model                                     │
│  Let's build something great    │ /theme                                     │
│  openai/gpt-5.5 · high effort   │ /compact                                   │
│        ~/Workspace/mypi         │                                            │
╰──────────────────────────────────────────────────────────────────────────────╯
```

## What it does

- Draws one rounded box across the terminal width: the `Pi v<version>` label in
  the top border, then on the left the block Pi mark, `Let's build something
  great` in bold, the `provider/model · <effort> effort` line and the
  `~`-shortened cwd, with one accent divider and the tips sidebar on the right.
- The left section stays square: the divider sits at 42% of the interior but the
  left half never grows past 40 columns, because ten body rows read square at
  roughly the mark plus breathing room. At 80 columns that is 32 + 44, at 120 it
  is 40 + 76, so the mark never floats in an empty band and the sidebar gets
  enough width for real command names.
- The short rule under `Ask Pi to build it` fills the sidebar and stops one
  column short of the border.
- The mark is static and single-coloured: a 4 × 4 grid of three-column cells,
  12 columns wide and 4 rows tall, drawn in the theme accent. No animation. It
  starts two rows below the top border, level with `Ask Pi to build it`, with one
  blank row before the tagline, so the rhythm matches the captured header.
- Resolves every colour from the active theme through one mapping
  (`extensions/lib/palette.ts`): box, label, divider, headings and the mark use
  `accent`, the tagline uses `text` in bold, tips and the model line use `muted`,
  the cwd uses `dim`. The header emits no SGR colour of its own, so it reads
  correctly with the three gentle-pi themes, with system/dark/light and with any
  user theme.
- When the terminal is too narrow for both columns, the sidebar is dropped and
  the left half takes the whole width. Below the mark width only the version
  label is printed.
- Installs on the next macrotask after `session_start` and then watches the
  header instead of guessing the boot time. pi calls `render` on the installed
  component, so a render gap is proof that the header on screen is not ours: the
  watchdog re-asserts (at most once a second) for up to 10 s and stops as soon as
  a render follows a reclaim.
- Fixed delays do not work and are not used: measured in a real start, the TUI
  begins painting ~1.9 s in and gentle-pi registers its own banner ~2.7 s in
  (`setTimeout(..., 50)` opened at `gentle-pi/extensions/startup-banner.ts:757`
  after `await readBannerConfig()` at line 666 — the awaits, not the 50 ms, are
  what push it that late). Re-asserts at 0/120/400 ms were spent during boot and
  gentle-pi kept the header; the watchdog reclaims it at ~1.6 s into its watch.

## Commands

| Command | Effect |
| --- | --- |
| `/use-loon-tui` | Reapply the LOON header (refreshes model, effort, cwd and tips). |
| `/use-default-tui` | Restore pi's own header, footer and spinner. |

## Install

Load it straight from a checkout:

```sh
pi -e /home/loonbac/Proyectos/pi-loon/loon
```

Or install it as a package and list it in `packages` in your pi settings:

```sh
pi install /home/loonbac/Proyectos/pi-loon/loon
```

`package.json` declares one extension (`./extensions/loon-startup.ts`) and no
themes, images or prompts.

## Test

```sh
npm install   # dev dependencies for the tests and the type checker
npm test      # node --experimental-strip-types --test
npm run typecheck
```

The tests pin the palette mapping against a stub theme that only knows the roles
the three gentle-pi themes define, the golden header at 80 and 120 columns, the
divider position, the mark grid, the literal sidebar order, the vertical rhythm
of the left column, and the absence of raw colour escapes.

## What it does NOT do

- **No own theme.** There is no `pi.themes` entry and no JSON theme here: the
  colours come from whichever theme is active.
- No animation, no working-message verbs (`ctx.ui.setWorkingMessage` is never
  called), no footer or spinner of its own.
- No editor, input box or window-title changes.
- Applying the header touches nothing but `ctx.ui.setHeader`; only
  `/use-default-tui` clears the header, footer and spinner.

## Licence

MIT. The box layout, the tips sidebar and the width helpers derive from
[pi-claude-code-tui](https://github.com/Phoobobo/pi-claude-code-tui) (MIT); the
static Pi mark is LOON's own. See `NOTICE` for the attribution and the upstream
licence text.
