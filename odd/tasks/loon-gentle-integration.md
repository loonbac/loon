# LOON-Pi x gentle-pi integration

Read gentle-pi's own configuration files and follow them: its menu keeps command of the
banner, LOON stops fighting it. It reads their files only; no module of gentle-pi is
imported and no code is copied.

## Specs

S1 — LOON reads `visual-customization.json` from gentle-pi's config home tolerantly:
absent file, malformed JSON, a different schema or unknown keys must break nothing; in
all those cases the behaviour is exactly today's, byte for byte.

S2 — `density` changes what LOON draws, with exactly these three shapes:

- `comfortable` = exactly today's layout (12 body rows with the wrapped model label).
- `compact` = no top blank row and no tagline: 4 logo rows + model·effort + cwd.
  Sidebar: `Getting started`, `Ask Pi to build it`, `Commands` and its commands, without
  the short rule.
- `minimal` = a single content row: `provider/model · effort`, truncated when it does not
  fit, with no logo, no tagline, no cwd and no sidebar. A three-row box: top border, that
  row, bottom border.

S3 — `headerPlacement: below-input`: LOON does not take the top slot. It returns the
native header with `setHeader(undefined)` and draws itself as a `belowEditor` widget,
following gentle-pi. Back on `top`, the header is restored. Both directions must work
without restarting the session.

**SUPERSEDED by S10**: the owner reported that the banner slid under the editor together
with gentle-pi's bar, which is not what a startup banner should do.

S4 — `banner.json`: `color` overrides the accent of the box, the divider, the headings
and the logo, keeping `text`/`muted`/`dim` from the theme. `showTextLogo` and `showRose`
are **not applicable**: both were written for gentle-pi's own banner (its ASCII wordmark
and its rose), never for the Pi mark. They are read, validated and ignored, and the
README says why.

S7 — The Pi mark is LOON's own setting: `/loon:tui mark on|off`, default `on`, persisted
in LOON's own file with the same atomic write and the same tolerance to an unreadable
file. Honouring `showTextLogo` here once deleted the mark, and the mark is exactly the
glyph the owner has been resizing; a flag from another product must not remove it.

S8 — gentle-pi's own menu becomes the place the banner is chosen, through a reversible
patch of the installed package: `scripts/gentle-pi-patch.ts` with `apply|check|revert`.
The two Banner rows collapse into one — `Banner: loon` / `Banner: rose` / `Banner: off`,
cycling on select — with the same notice and a preview of what will paint. `Banner text
logo:` only appears in `rose`; `Banner color:` stays in every state. The tool pins the
4.5.1 build by md5, requires every anchor exactly once, imports the patched copy in a
child process with pi's own loader before replacing anything, backs the originals up
timestamped, and `revert` restores them and verifies their md5.

S9 — Who paints lives in LOON's file as `source: "loon" | "rose" | "off"`, default
`loon`. LOON paints only when `enabled && source === "loon"`; on `rose` and `off` it
releases the slot it owns and never reclaims it. `source` is never written into
`banner.json`, whose writes keep only gentle-pi's three keys.

S5 — A `/loon:tui` command with the two things gentle-pi's menu does not have: banner on
or off, and accent source (theme vs `banner.json`). Own persistence in pi's config home,
atomic write, unreadable file = defaults (no crash).

S6 — When LOON is off it must not reclaim the slot: gentle-pi must be able to paint its
banner.

Invariants that never break:

- Without gentle-pi installed, or without its files, LOON behaves exactly as today. The
  current 80 and 120 goldens must keep passing unchanged.
- The watchdog stays the startup mechanism.
- Zero raw ANSI: the overridden accent also goes through a painter, never hand-written SGR
  in a renderer.
- No code copied from gentle-pi: their files are read, their modules never imported.

## Tasks

| ID | Specs | Route | Commit |
| --- | --- | --- | --- |
| T1 | S1 | inline | ed90d9c (PR #26 → f35010f) |
| T2 | S5 | inline | ed90d9c |
| T3 | S4 | inline | 81628d7 |
| T4 | S2, S4 | inline | 81628d7 |
| T5 | S3, S5, S6 | inline | 9bb311c |
| T6 | - | inline | 9bb311c |
| T7 | S4, S7 | inline | ea6df5e (PR #29) |
| T8 | S8 | inline | pending |
| T9 | S9 | inline | pending |

## Log

L1 — owner's original request, verbatim:

> "no veo que sea compatible con gentle pi, en el menu de /gentle:customization no sale nada de mi tema ni del banner ni nada, debes usar parches en este plugin para que funcione bien e integro de gentle pi"

After being told that injecting rows into that menu would mean copying the whole menu, the
owner chose that gentle-pi's menu outranks the LOON banner instead of a fork.
L2 — delivery evidence (issue #25, PR #26, squash `f35010f`):

- Three reviewable commits instead of one 1554-line slice, each green on its own
  in a detached worktree: `ed90d9c` 58 tests (tolerant readers, LOON config,
  watcher, accent painter), `81628d7` 68 (densities, mark flag, palette accent),
  `9bb311c` 80 (placement, widget, off without reclaim, `/loon:tui`, live reload,
  README). `tsc --noEmit` clean at every one.
- Goldens 80 and 120 not touched: `comfortable` with no gentle files is the old
  render byte for byte, and an explicit `density: comfortable` test compares the
  two renders and the golden.
- Real pi at 80x32 with `GENTLE_PI_CONFIG_HOME` pointing at a temporary home, so
  the user's files were never written to. Measured frames: comfortable identical
  to today except the three randomly sampled tips; compact 8 body rows (the real
  42-column id wraps to three rows there) with no tagline and no short rule;
  minimal a three-row box with one row; below-input with an empty top slot, the
  editor at rows 15-17 and the banner under it; `color: cyan` painting
  `38;2;95;210;255` with the mark hidden by `showTextLogo: false`; LOON off
  leaving gentle-pi's rose banner and its info block in place.
- Live reload in a single session: comfortable -> minimal (3 rows) -> comfortable
  -> below-input, each captured 4 s after writing the file.
- Integrity: `banner.json` copied and hashed before the work, `sha256sum -c` ok
  afterwards, `visual-customization.json` still absent, `loon-tui.json` removed,
  so the real config home is byte-identical. LOON's own file is the only one it
  ever writes, and only when a setting changes.
- Run against the real config home afterwards, with no gentle files touched: the
  user's own `banner.json` (`showTextLogo: false`, `color: pink`) now drives the
  banner, so the mark is hidden and the accent is `38;2;255;118;195`. That is the
  integration working; `/loon:tui accent theme` restores the theme accent.

L3 — known limits recorded in the README: switching `headerPlacement` while pi
runs leaves pi's built-in header at the top until the next start (gentle-pi only
installs its banner at session start), and LOON never writes into gentle-pi's
files, so `/gentle:customization` stays the only place they are written from.
L4 — defect found by the owner on `f35010f`: mapping `showTextLogo` to the Pi mark.
Their real `banner.json` says `{"color":"pink","showRose":false,"showTextLogo":false}`,
and the flag was set while gentle-pi's ASCII wordmark ruled that file; honouring it
made the header lose the mark (`filas_marca=4` with no files, `0` with theirs). Fix:

- `showTextLogo` left the resolution entirely (the same treatment `showRose` always
  had). `parseBannerConfig` still reports what the file says, so the parsing tests keep
  their meaning; `GentleSettings` no longer carries the key at all, which makes
  "honour it again by accident" a type error rather than a review catch.
- The mark became `LoonSettings.mark` (default true) with `/loon:tui mark on|off`, the
  same atomic file, the same tolerant read.
- Tests: `showTextLogo:false` in a temp home resolves without the key and the render
  keeps four mark rows; `mark off` gives zero and `mark on` brings back four; compact
  keeps its mark while the flag is on (and loses it when off); the status line reports
  the mark.
- 84 tests, `tsc --noEmit` clean. The accent default stays `banner` until the owner
  decides between its menu colour and the theme.
L5 — real verification of the mark fix (issue #28, PR #29, squash `ea6df5e`):

- `GENTLE_PI_CONFIG_HOME` pointed at a copy of the owner's real `banner.json`
  (`{"color":"pink","showRose":false,"showTextLogo":false}`), the file that caused
  the defect. One session, 80x32, `pi --use-theme Gentle`:

| moment | rows with `█` |
| --- | --- |
| start, mark on (default) | 4 |
| `mark:false` written while pi runs | 0 |
| `mark:true` written again | 4 |

- Their `banner.json` is `sha256sum -c` clean afterwards and `loon-tui.json` was
  removed, so the real config home is byte-identical.
- 84 tests, `tsc --noEmit` clean.
L6 — owner asked to patch gentle-pi's own menu after all, verbatim:

> "veo en el comando del gentle que dice banner rose off, yo creo que seria mejor inyectar ahi parcharlo para que diga solo Banner: y ahi ponerle 3 opciones, Rose, LOON y Off"

This supersedes the earlier "never touch their menu" decision. Their code is still
never copied: the patch is a text edit of their own rows plus a guard in their own
banner, nothing imported.
S10 — The banner never follows `headerPlacement`. That setting moves gentle-pi's own bar
(`gentle-shell.ts:2281-2297` registers it as a `belowEditor` widget); pi's header slot is a
different thing and the banner belongs there, on top, in both placements. LOON stops reading
the setting for anything but the status line.

L7 — the defect and the decision:

- Reported by the user: «cuando voy a la opcion de layout y lo pongo abajo tambien se mueve
  el banner de pi, eso no deberia moverse junto con el header».
- Measured before the fix: with `headerPlacement: below-input` the banner title sat at row
  31 and the tagline at row 39 of a 160x46 frame, under the prompt at row 29.
- Cause, from the code: `extensions/loon-startup.ts` had its own `below-input` branch that
  released the header with `setHeader(undefined)` and re-drew the banner as a
  `belowEditor` widget, so it moved with gentle-pi's bar. gentle-pi itself only moves its
  own widget and its own hoisted header component (`lib/shell-sidebar-layout.ts:372`); the
  banner was never theirs to move.
- Decision: this is LOON's defect, not gentle-pi's. The fix is in `loon-startup.ts` and the
  patch stays at three targets - no fourth patch of a third party's layout module.
- After the fix: at 160x46 the banner title is row 4 with `top` (bar row 1) and row 0 with
  `below-input` (bar row 43, under the prompt at 38); at 100x34, rows 4 / 0, prompt 30 / 26,
  bar 1 / 31. The banner is on top in both, the bar is what moves.
- Tests: below-input keeps the header installed and sets no widget; a live placement change
  does not move it; the watchdog keeps defending it there.
- `visual-customization.json` was changed for the frames and restored: sha
  `e7e7b652520db77bf6c7146a7771794f205b2589f1da1bf19282d5298fbe01f4` before and after.