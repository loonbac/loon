# LOON-Pi

A pi package that gives the TUI a **theme-aware startup banner**: the
pi-claude-code-tui look, painted entirely by the theme you already use.

```
╭─── LOON Pi v1.4.0 ───────────────────────────────────────────────────────────╮
│                                                      │                       │
│                                                      │ Getting started       │
│                    █████████                         │ Ask Pi to build it    │
│                    ███   ███                         │ ──────────────────────│
│                    ██████   ███                      │ Commands              │
│                    ███      ███                      │ loon:default          │
│                                                      │ /model                │
│             Let’s build something great              │ /theme                │
│           gentle/gentleman · high effort             │ /compact              │
│              ~/Proyectos/pi-loon/loon                │                       │
╰──────────────────────────────────────────────────────────────────────────────╯
```

## What it does

- Replaces the startup header with an animated logo (22 frames, 120 ms), a
  centered tagline, the model and effort line, the current directory and a tips
  sidebar.
- Resolves every colour from the active theme through one mapping
  (`extensions/lib/palette.ts`): cyan -> `accent`, red -> `error`, green ->
  `success`, orange and flash -> `warning`, white -> `text`, brand -> `accent`;
  box and rules use `border`, `borderMuted`, text uses `accent`, `muted` and
  `dim`. The banner emits no SGR colour of its own, so it reads correctly with
  the three gentle-pi themes, with system/dark/light and with any user theme.
- Installs after `session_start` on the next macrotask and re-asserts twice, so
  it wins over another extension's startup header (gentle-pi paints its own).

## Commands

| Command | Effect |
| --- | --- |
| `/loon:look` | Reapply the LOON banner (refreshes model, effort, cwd and tips). |
| `/loon:default` | Restore pi's own header, footer and spinner. |

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
the three gentle-pi themes define, a golden render of the banner at 80 columns,
and the absence of raw colour escapes in every animation frame.

## What it does NOT do

- **No own theme.** There is no `pi.themes` entry and no JSON theme in this
  repository: LOON-Pi is an extension, and the colours come from whichever
  theme is active.
- No footer or spinner replacement of its own (the restore command clears them).
- No working-message verbs, no keyboard overrides, no patches to pi internals.
- No changes outside the header: your transcript, editor and tools stay standard.

## Licence

MIT. The logo animation and the box layout derive from
[pi-claude-code-tui](https://github.com/Phoobobo/pi-claude-code-tui) (MIT);
see `NOTICE` for the attribution and the upstream licence text.
