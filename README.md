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
- A model id longer than the half wraps instead of losing its tail: it breaks at
  `/`, then `-`, then a space, and a single run with no separator left is cut at
  the width. Nothing is replaced by an ellipsis. `river/deepseek-ai/
  DeepSeek-V4.1-Flash-1017 · high effort` becomes three centred rows at 32
  columns, and the box grows a row for each extra line so the sidebar keeps its
  position. A wrap whose last line would hold a single word is retried one
  column narrower until two words fit together, down to half the width, because
  `openai-codex/gpt-5.5 · high` above a lone `effort` reads as a bug.
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
| `/use-loon-tui` | Turn the banner on and reapply it (refreshes model, effort, cwd and tips). |
| `/use-default-tui` | Turn the banner off and restore pi's own header, footer and spinner. |
| `/loon:tui` | Banner on/off and accent source; see below. |

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

## gentle-pi integration

LOON reads gentle-pi's own configuration files. It does not import a module of
gentle-pi and copies no code from it: it parses the two files that extension
already writes, so what you pick in `/gentle:customization` reaches this header.

| gentle-pi setting | File | Effect here |
| --- | --- | --- |
| `density: comfortable` | `visual-customization.json` | The captured layout: 12 body rows with the mark, tagline, model and cwd. |
| `density: compact` | `visual-customization.json` | No blank row above the mark and no tagline: mark, model, cwd; the sidebar loses the short rule. |
| `density: minimal` | `visual-customization.json` | A three-row box with one row: `provider/model · effort effort`, cut with `…` when it does not fit. No mark, no tagline, no cwd, no sidebar. |
| `headerPlacement: top` | `visual-customization.json` | LOON keeps the top slot, as it always did. |
| `headerPlacement: below-input` | `visual-customization.json` | LOON releases the top slot (`setHeader(undefined)`) and draws itself as a `belowEditor` widget. |
| `color: pink\|cyan\|yellow\|green` | `banner.json` | Overrides the accent: box, divider, headings and mark. `text`, `muted` and `dim` keep coming from the theme. |
| `showTextLogo` | `banner.json` | **Not applicable.** It hides gentle-pi's ASCII wordmark, which this package does not draw; the Pi mark has its own switch below. Read, validated, ignored. |
| `showRose` | `banner.json` | **Not applicable.** LOON has no rose. Read, validated, ignored. |

The two `Not applicable` rows are deliberate. Those flags were written by a menu
that governs gentle-pi's own banner, not the Pi mark, so honouring them here
would delete a glyph this package draws and someone sized on purpose.

Reads are tolerant on purpose. A missing file, malformed JSON, a schema from
another version, an unknown key or a value that does not validate all fall back
to the layout above (comfortable, top, mark on, theme accent) — never an error,
never a different banner. Every change is picked up live: both config homes are
watched, so editing gentle-pi's settings repaints without restarting pi.


### Who paints the banner: the optional gentle-pi patch

gentle-pi's menu is the one place a person configures its banner, so LOON can also
appear *there* — as a third state of a single row, next to gentle-pi's own banner
and pi's native header. That needs a small, reversible patch of the installed
package, applied with the tool in this repository:

```sh
node --experimental-strip-types scripts/gentle-pi-patch.ts check
node --experimental-strip-types scripts/gentle-pi-patch.ts apply
node --experimental-strip-types scripts/gentle-pi-patch.ts revert
```

What it changes, in gentle-pi 4.5.1 only:

- `/gentle:customize` gets one row, `Banner: loon` / `Banner: rose` / `Banner: off`,
  which cycles on select. `Banner rose:` and `Banner text logo:` are gone; the
  text-logo row stays reachable inside `rose`, where it still means something, and
  `Banner color:` keeps working in every state (it colours their art in `rose` and
  this header's accent in `loon`).
- gentle-pi's banner does not install its header in `loon` or `off`, so nothing
  fights over the slot.

The choice is stored as `source` in LOON's own `loon-tui.json`, never in
`banner.json`: gentle-pi rewrites that file with its three keys and would drop it.
Semantics:

| `source` | who paints |
| --- | --- |
| `loon` (default) | this header; gentle-pi stays out when patched, and loses the race when not |
| `rose` | gentle-pi's banner; LOON releases the slot and never reclaims it |
| `off` | nobody: pi's own header |

The tool refuses to touch a file that is not the exact 4.5.1 build it was written
against (md5), checks that each anchor appears exactly once, imports the patched
copy in a child process with the same loader pi uses *before* replacing anything,
and keeps a timestamped backup under `~/.pi/agent/backups/gentle-pi-banner-patch-*`
that `revert` restores and verifies. Nothing here is required: unpatched, LOON
works exactly as before.

### Settings LOON adds

gentle-pi's menu has no switch for the banner itself and none for where the
accent comes from, so LOON keeps its own file, `loon-tui.json` in pi's config
home (`$PI_CODING_AGENT_DIR`, or `~/.pi/agent`):

```json
{ "enabled": true, "accent": "banner", "mark": true, "source": "loon" }
```

- `enabled` — false means LOON paints nothing and never reclaims the header, so
  gentle-pi's own banner is free to take the slot.
- `accent` — `banner` follows gentle-pi's `color`; `theme` keeps the theme's
  `accent` role. It defaults to `banner`, so a colour already chosen in
  gentle-pi's menu is honoured out of the box.
- `mark` — the Pi mark, on by default. This is LOON's switch, not gentle-pi's
  `showTextLogo`: that flag belongs to a different banner and never reaches this
  glyph.
- `source` — who paints the banner: `loon` (default), `rose` or `off`. Written by
  the patched row in gentle-pi's menu; without the patch it simply stays `loon`.

| Command | Effect |
| --- | --- |
| `/loon:tui` | Menu: banner on or off, accent from the theme or from `banner.json`, mark on or off. |
| `/loon:tui status` | One line: banner, accent source, density, placement, mark. |
| `/loon:tui on\|off` | Same as the menu entry, without the dialog. |
| `/loon:tui accent theme\|banner` | Switch the accent source. |
| `/loon:tui mark on\|off` | Show or hide the Pi mark. |

Writes are atomic (a temporary file in the same directory, then a rename), and an
unreadable file means the defaults, never a crash.

Two limits worth knowing. Switching `headerPlacement` while pi is running leaves
pi's built-in header at the top until the next start, because gentle-pi only
installs its banner at session start; LOON's own banner moves immediately.
And when gentle-pi is not installed at all, nothing changes: no files, no
overrides, today's header.

## What it does NOT do

- **No own theme.** There is no `pi.themes` entry and no JSON theme here: the
  colours come from whichever theme is active.
- No animation, no working-message verbs (`ctx.ui.setWorkingMessage` is never
  called), no footer or spinner of its own.
- No editor, input box or window-title changes.
- Applying the header touches only `ctx.ui.setHeader` (or, under
  `headerPlacement: below-input`, one `belowEditor` widget of its own). Nothing
  else in pi's UI is replaced; `/use-default-tui` also clears the footer and the
  spinner, as it always did.
- **No writes into gentle-pi.** LOON reads `visual-customization.json` and
  `banner.json`; it never edits them and never adds rows to
  `/gentle:customization`. The integration only goes one way, by design: that
  menu stays the single place those files are written from.

## Licence

MIT. The box layout, the tips sidebar and the width helpers derive from
[pi-claude-code-tui](https://github.com/Phoobobo/pi-claude-code-tui) (MIT); the
static Pi mark is LOON's own. See `NOTICE` for the attribution and the upstream
licence text.
