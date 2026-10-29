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

S4 — `banner.json`: `showTextLogo: false` hides the mark; `color` overrides the accent of
the box, the divider, the headings and the logo, keeping `text`/`muted`/`dim` from the
theme. `showRose` has no LOON equivalent: it is not invented and is documented as not
applicable.

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