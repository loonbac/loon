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
| T1 | S1 | inline | pending |
| T2 | S5 | inline | pending |
| T3 | S4 | inline | pending |
| T4 | S2, S4 | inline | pending |
| T5 | S3, S5, S6 | inline | pending |
| T6 | - | inline | pending |

## Log

L1 — owner's original request, verbatim:

> "no veo que sea compatible con gentle pi, en el menu de /gentle:customization no sale nada de mi tema ni del banner ni nada, debes usar parches en este plugin para que funcione bien e integro de gentle pi"

After being told that injecting rows into that menu would mean copying the whole menu, the
owner chose that gentle-pi's menu outranks the LOON banner instead of a fork.