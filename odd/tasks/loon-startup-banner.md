# LOON-Pi v1 — theme-aware startup banner

Extension package for Pi whose only feature is pi-claude-code-tui's startup banner, repainted from the active theme.
No own theme JSON: `pi.themes` is never declared.

## Specs

S1 — Scope. "un paquete de extensión para Pi cuyo único feature es el banner de arranque de pi-claude-code-tui, adaptado para leerse con los temas de gentle-pi. NO es un tema JSON propio: no agregues pi.themes."

S2 — Defect to fix. "el texto de la caja usa ctx.ui.theme.fg(\"accent\"|\"muted\"|\"dim\"), pero las celdas del logo usan ANSI crudo (\\x1b[36m cian, 31 rojo, 32 verde, 33 naranja, 39 default). Eso ignora cualquier tema y es exactamente lo que choca con gentle-pi."

S3 — Palette. "Paleta derivada del tema activo: mapea los colores del logo a roles del tema (cyan->accent, red->error, green->success, orange y flash->warning, white->text, brand->accent). Cero SGR de color crudo en el render: todo por theme.fg/theme.bg. El mapeo vive en una función pura y testeable, en un solo punto."

S4 — Themes. "Debe verse correcto con los tres temas de gentle-pi y con cualquier otro tema (system/dark/light) sin tocar nada."

S5 — Commands. "Comandos: uno para reaplicar el look y otro para restaurar header/footer/spinner nativos de pi."

S6 — License. "Licencia: el grid de la animación deriva de pi-claude-code-tui (MIT). Incluye LICENSE MIT propio y un NOTICE con la atribución a Phoobobo/pi-claude-code-tui."

S7 — Manifest. "package.json con \"pi\": { \"extensions\": [\"./extensions/loon-startup.ts\"] } y peerDependencies en @earendil-works/pi-coding-agent y @earendil-works/pi-tui."

S8 — Tests. "Tests con node --experimental-strip-types --test: (a) mapeo de paleta contra un tema stub que solo define los roles que definen los temas de Gentle, (b) golden render del banner a ancho fijo 80 columnas, (c) que ningún frame emita códigos ANSI de color crudos."

S9 — README. "README breve: qué hace, cómo se instala y prueba (pi -e .), y qué NO hace (no define tema propio)."

S10 — Ordering. "Tu header debe aplicarse DESPUÉS (setTimeout 0) para ganar, y ofrecer un comando para restaurar el header nativo."

S11 — Boundary. "Trabaja solo dentro de /home/loonbac/Proyectos/pi-loon/loon. No toques otros repos ni ~/.pi/agent."

S12 — Reset. "Los 48 archivos anteriores aparecen como borrados sin commitear: son intencionales, el contenido viejo se reemplaza por completo. Puedes commitear ese reset como primer slice."

## Tasks

| ID | Spec | Route | Commit |
| --- | --- | --- | --- |
| T1 | S12 | inline | 331ec1c |
| T2 | S6, S7 | inline | pending |
| T3 | S3, S8a | inline | pending |
| T4 | S2, S3, S8b, S8c | inline | pending |
| T5 | S1, S4, S5, S10 | inline | pending |
| T6 | S9 | inline | pending |
| T7 | S8, S4 | inline | pending |

## Log

L1 (user request, verbatim):

> TAREA: construir LOON-Pi v1 en /home/loonbac/Proyectos/pi-loon/loon (repo github.com/loonbac/loon, rama master).
>
> ESTADO DEL REPO: ya está clonado y vaciado. Solo quedan .git (64 commits de historial intacto) y AGENTS.md. Los 48 archivos anteriores aparecen como borrados sin commitear: son intencionales, el contenido viejo se reemplaza por completo. Puedes commitear ese reset como primer slice.
>
> QUÉ ES LOON-Pi v1: un paquete de extensión para Pi cuyo único feature es el banner de arranque de pi-claude-code-tui, adaptado para leerse con los temas de gentle-pi. NO es un tema JSON propio: no agregues pi.themes.
>
> INVESTIGACIÓN YA HECHA (verifícala, no la des por cierta a ciegas):
>
> 1. Upstream: github.com/Phoobobo/pi-claude-code-tui (MIT, npm pi-claude-code-tui@0.1.14). Es solo extensión: su package.json declara pi.extensions -> ./extensions/claude-code-startup.ts y NO declara temas. Archivos relevantes: extensions/claude-code-startup.ts (~350 líneas, el header) y extensions/render-utils.ts (helpers: center, padRight, formatCwd, formatModelLabel, formatThinkingLabel, headerColumnWidths, pickSlashCommandTips, pickWorkingVerb).
> Léelos con: gh api repos/Phoobobo/pi-claude-code-tui/contents/extensions/claude-code-startup.ts --jq .content | base64 -d
> Comportamiento: en session_start hace ctx.ui.setHeader((tui) => new PiStartupHeader(...)) dentro de setTimeout(0); dibuja una caja "╭─── Pi v<version> ─────╮" con logo animado de 15 frames de celdas "███" cada 120 ms, texto centrado "Let’s build something great", línea "modelo · effort", cwd, y una columna de tips a la derecha; comandos /use-claude-code-tui y /use-default-tui.
>
> EL DEFECTO A CORREGIR: el texto de la caja usa ctx.ui.theme.fg("accent"|"muted"|"dim"), pero las celdas del logo usan ANSI crudo (\x1b[36m cian, 31 rojo, 32 verde, 33 naranja, 39 default). Eso ignora cualquier tema y es exactamente lo que choca con gentle-pi.
>
> 2. gentle-pi 4.5.1 trae tres temas en ~/.pi/agent/npm/node_modules/gentle-pi/themes/{Gentle,Gentleman-Cute,Gentleman-Sexy}.json, formato vars + colors con 51-55 roles. Roles presentes en los tres: accent, muted, dim, text, success, warning, error, border, borderAccent, borderMuted, toolTitle, thinking*, md*.
>
> 3. gentle-pi pinta su propio banner de arranque en extensions/startup-banner.ts (1115 líneas, paletas RGB hardcodeadas pink/cyan/yellow/green, config showRose/showTextLogo, aplica ctx.ui.setHeader dentro de un setTimeout). Tu header debe aplicarse DESPUÉS (setTimeout 0) para ganar, y ofrecer un comando para restaurar el header nativo.
>
> REQUISITOS:
> - Paleta derivada del tema activo: mapea los colores del logo a roles del tema (cyan->accent, red->error, green->success, orange y flash->warning, white->text, brand->accent). Cero SGR de color crudo en el render: todo por theme.fg/theme.bg. El mapeo vive en una función pura y testeable, en un solo punto.
> - Debe verse correcto con los tres temas de gentle-pi y con cualquier otro tema (system/dark/light) sin tocar nada.
> - Comandos: uno para reaplicar el look y otro para restaurar header/footer/spinner nativos de pi.
> - Licencia: el grid de la animación deriva de pi-claude-code-tui (MIT). Incluye LICENSE MIT propio y un NOTICE con la atribución a Phoobobo/pi-claude-code-tui.
> - package.json con "pi": { "extensions": ["./extensions/loon-startup.ts"] } y peerDependencies en @earendil-works/pi-coding-agent y @earendil-works/pi-tui.
> - Tests con node --experimental-strip-types --test: (a) mapeo de paleta contra un tema stub que solo define los roles que definen los temas de Gentle, (b) golden render del banner a ancho fijo 80 columnas, (c) que ningún frame emita códigos ANSI de color crudos.
> - README breve: qué hace, cómo se instala y prueba (pi -e .), y qué NO hace (no define tema propio).
>
> LÍMITES:
> - Trabaja solo dentro de /home/loonbac/Proyectos/pi-loon/loon. No toques otros repos ni ~/.pi/agent.
> - Sigue el AGENTS.md del repo y la política de entrega que ya aplicas.
> - Reporta al cerrar: archivos que quedaron, evidencia de los tests ejecutados, y qué no pudiste verificar (por ejemplo el render real en una terminal).

L2 (verification of the briefing, run before writing code):

- Upstream read through the GitHub contents API. Confirmed: `pi.extensions -> ./extensions/claude-code-startup.ts`, no `pi.themes`, `setHeader` inside `setTimeout(0)`, raw SGR in `colorCell()` (`\x1b[36m`, `\x1b[31m`, `\x1b[32m`, `\x1b[33m`, `\x1b[39m`), theme-based text (`accent` / `muted` / `dim`).
- Correction to the briefing: `LOGO_FRAMES` holds 22 frames, not 15 (4 left + 3 top + 5 right + 10 final). The port keeps the upstream sequence verbatim and the 120 ms interval; `LOGO_FRAME_COUNT` is derived from the array, never hardcoded, so the count cannot drift silently again.
- gentle-pi registers the banner's `setHeader` after `await readBannerConfig()`, i.e. in a timer created after a synchronous `session_start` handler. A single `setTimeout(0)` from LOON can therefore be overwritten, so LOON installs on the next macrotask and re-asserts at 120 ms and 400 ms. The animation clock is shared across installs, so a re-assert never restarts the logo.
- `Theme.fg()` in pi 1.4.0 throws `Unknown theme color: <token>` for a role a theme does not carry. The test stub therefore rejects unknown roles instead of painting them, which turns 'only roles Gentle defines' into a checked property.
