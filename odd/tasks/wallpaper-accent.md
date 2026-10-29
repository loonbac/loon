# Wallpaper accent as a banner colour

LOON can paint its accent with the colour of the current wallpaper: the same
`#RRGGBB` the desktop already publishes for niri, waybar, swaync and GTK, read from
one file and offered as a fifth `Banner color` row.

## Specs

**S1 (user, verbatim)**: "ok funciona bien, te comento tengo un sistema de adaptacion de
color segun accent de sistema del wallpaper que use, asi que en banner color necesito
una nueva opcion de Banner Color: Wallpaper Accent"

**S2 — the source of truth (measured, do not re-investigate)**:
`~/.config/mpvpaper/accent.txt`, one line, uppercase `#RRGGBB` plus a newline
(now `#9B484A`). It is written by `~/.nixos/pkgs/accent-wallpaper/default.nix` through
`atomic_write()` = write `.tmp.<pid>` + `fsync` + `os.replace()`. Therefore **the inode is
replaced on every wallpaper change**: a watch on the file dies after the first update, a
watch on the directory `~/.config/mpvpaper` survives. The same script also writes
`~/.config/niri/accent.kdl`, `~/.config/waybar/accent.css`, `~/.config/swaync/accent.css`,
`~/.config/gtk-4.0/gtk.css` and `~/.config/waybar/colors.css` — LOON reads **only**
`accent.txt`.

**S3 — the option and its label**: the menu row reads exactly `Banner color: wallpaper`,
with `(current)` appended only while LOON's accent is `wallpaper`; its preview title is
`Wallpaper accent · #9B484A (static)` (the hex actually read, or `unavailable` when the
file cannot be read) and its sample paints the mark with that colour. Rationale for the
label: the group already uses one lowercase token per colour (`pink`, `cyan`, `yellow`,
`green`) and the right pane is about 40 columns at 80 total, so
`Banner color: wallpaper accent (current)` would truncate; the words "Wallpaper accent"
appear in the preview title instead.

**S4 — where the choice is stored, and it stays exclusive**: selecting the row writes
`{"accent": "wallpaper"}` into `loon-tui.json` through the existing read-merge-write
helper (`{...loonSettings, accent}`, mode `0o600`, tmp + rename), preserving `enabled`,
`mark` and `source`. Selecting **any of the four named colours** writes
`{"accent": "banner"}` back the same way, so that picking `pink` after `wallpaper` is not
a silent no-op. `banner.json` keeps its own `color` key and its four-value format:
nothing new is ever written there.

**S5 — rendering**: with `accent: "wallpaper"`, the accent-bound roles (`frame`,
`divider`, `heading`, `logo` inside the box) are painted with the RGB read from
`accent.txt`; `text`, `muted` and `dim` keep coming from the active theme. The SGR
sequence keeps being built in exactly one place (`extensions/lib/accent.ts`): generalise
the painter to take an RGB triple and leave `accentPainter(color)` a thin wrapper, with no
second copy of the escape string anywhere. A missing, unreadable or malformed file (any
value that is not `/^\s*#?([0-9a-fA-F]{6})\s*$/`) must fall back to the theme accent —
never a crash, never black — and `/loon:tui status` must say which of the two is in effect.

**S6 — live update**: while `accent: "wallpaper"` is in effect, changing the wallpaper
(running `accent-wallpaper`, which replaces `accent.txt` atomically) recolours a running
session's header without restarting pi. Watch the **directory** per S2, debounce like the
existing config watches, and re-render through the existing header path. If the file
disappears, fall back to the theme accent on the next render.

**S7 — the menu patch must survive its own upgrade**: today's installed file is the v1
patch (`gentle-shell.ts` md5 `8ae96c97de14436e9755608a81579441`), not the pristine
`ad1bfce79b655fc4f7cae71449d05d88`. `scripts/gentle-pi-patch.ts` must report four states —
`clean`, `patched-v1`, `patched`, `different-version` — and `apply` must accept both
`clean` and `patched-v1`, the latter by verifying the recorded backup against the pristine
md5 and restoring it before patching v2. `revert` still ends at the pristine md5 of both
files. `different-version` still refuses with exit 2 and touches nothing. Keep the existing
jiti import gate: the v2 output must import before it is substituted.

**S8 — checks**: expect RED first for each new rule (parser accept/reject, theme fallback,
palette binding, settings round-trip, exclusivity of the four named colours, the patch
state machine including `patched-v1`, and one test that a directory-level rename is
noticed). `header-80.txt` and `header-120.txt` must stay byte-identical for the default
configuration. Update README, `/loon:tui` help and the status text for the new value.
Artifacts in English.

**S9 — boundaries**: do not change `banner.json`'s format or gentle-pi's own palette;
`rose` mode keeps gentle-pi's four colours (its banner reads `banner.json`, not our
accent) and the new row must simply have no effect on its rendering — say so in the docs.
Do not add a dependency. Do not read anything outside `~/.config/mpvpaper/accent.txt` and
the two config homes unless a test injects a path.

## Tasks

| ID | Specs | Route | Commit |
| --- | --- | --- | --- |
| T1 | S1-S9 (this document) | inline | pending |
| T2 | S5 | inline | pending |
| T3 | S3, S4, S5, S6, S8 | inline | pending |
| T4 | S3, S4, S7 | inline | pending |
| T5 | S8, S9 | inline | pending |

## Log

L1 — the user's request, verbatim:

> "ok funciona bien, te comento tengo un sistema de adaptacion de color segun accent de sistema del wallpaper que use, asi que en banner color necesito una nueva opcion de Banner Color: Wallpaper Accent"

L2 — product decisions already taken, not to be changed without asking: the row is
`Banner color: wallpaper` with `Wallpaper accent · #9B484A (static)` as the preview title;
the value lives in `loon-tui.json` as `accent: "wallpaper"` and never in `banner.json`;
picking any named colour writes `accent: "banner"`; a missing or invalid file falls back
to the theme accent and `status` says so; the patch must upgrade over its own v1.
