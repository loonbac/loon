# LOON-Pi v1 — theme-aware startup header

Extension package for Pi whose only feature is the startup header, repainted from the active theme. No own theme JSON.

## Specs

Scope of the first brief (S1–S12) was corrected by the owner in L5; S3, S5 and S8 are superseded there.

S1 — Scope. "un paquete de extensión para Pi cuyo único feature es el banner de arranque de pi-claude-code-tui, adaptado para leerse con los temas de gentle-pi. NO es un tema JSON propio: no agregues pi.themes."

S2 — Defect to fix. "el texto de la caja usa ctx.ui.theme.fg(\"accent\"|\"muted\"|\"dim\"), pero las celdas del logo usan ANSI crudo (\\x1b[36m cian, 31 rojo, 32 verde, 33 naranja, 39 default). Eso ignora cualquier tema y es exactamente lo que choca con gentle-pi."

S3 — Palette. SUPERSEDED by S13 and S16 (the logo is one colour, so the per-cell mapping no longer applies). Original: "Cero SGR de color crudo en el render: todo por theme.fg/theme.bg. El mapeo vive en una función pura y testeable, en un solo punto."

S4 — Themes. "Debe verse correcto con los tres temas de gentle-pi y con cualquier otro tema (system/dark/light) sin tocar nada."

S5 — Commands. SUPERSEDED by S20. Original: "Comandos: uno para reaplicar el look y otro para restaurar header/footer/spinner nativos de pi."

S6 — License. "Licencia: el grid de la animación deriva de pi-claude-code-tui (MIT). Incluye LICENSE MIT propio y un NOTICE con la atribución a Phoobobo/pi-claude-code-tui." (The animation is gone; NOTICE now attributes what is actually derived.)

S7 — Manifest. "package.json con \"pi\": { \"extensions\": [\"./extensions/loon-startup.ts\"] } y peerDependencies en @earendil-works/pi-coding-agent y @earendil-works/pi-tui."

S8 — Tests. SUPERSEDED by S21 (the golden covers the final frame at 80 and 120, not the animation frames). Original: "Tests con node --experimental-strip-types --test: (a) mapeo de paleta contra un tema stub … (b) golden render del banner a ancho fijo 80 columnas, (c) que ningún frame emita códigos ANSI de color crudos."

S9 — README. "README breve: qué hace, cómo se instala y prueba (pi -e .), y qué NO hace (no define tema propio)."

S10 — Ordering. "Tu header debe aplicarse DESPUÉS (setTimeout 0) para ganar, y ofrecer un comando para restaurar el header nativo."

S11 — Boundary. "Trabaja solo dentro de /home/loonbac/Proyectos/pi-loon/loon. No toques otros repos ni ~/.pi/agent."

S12 — Reset. "Los 48 archivos anteriores aparecen como borrados sin commitear: son intencionales, el contenido viejo se reemplaza por completo. Puedes commitear ese reset como primer slice."

S13 — Static mark. "Logo \"Pi\" grande y estático: marca de bloques cuadrados (celdas tipo \"███\") formando la P y la i, en UN SOLO color = acento del tema. En la captura ocupa unas 7 filas de alto y ~10 celdas de ancho." Grid corrected against the measured reference: **4 x 4 cells** (12 columns x 4 rows), rows `###.` / `#.#.` / `##.#` / `#..#`. The first reading (10 x 7) was wrong; see L7. The mark centres as one 12-column rectangle: every row keeps its trailing blanks so the left edge stays straight (L9).

S14 — Box. "Caja de borde fino redondeado, con el color de acento del tema activo, ocupando el ancho completo. En el borde superior, cerca de la izquierda, la etiqueta \"─ Pi v<version> ─\" con los guiones y el texto en acento".

S15 — Left column. "todo centrado horizontalmente dentro de su mitad: … \"Let's build something great\" en bold, color de texto normal. \"openai-codex/gpt-5.5 · high effort\" en muted (formato: provider/modelo · <effort> effort). \"~/Workspace/mypi\" en dim (cwd con ~ abreviado)." The tagline uses the **straight apostrophe** U+0027, as the capture does; see L7.

S16 — Divider. "Divisor vertical de una columna, en acento, a ~69% del ancho interior, recorriendo toda la altura interior de la caja."

S17 — Sidebar. "Columna derecha, alineada a la izquierda, con este contenido literal y en este orden: una línea vacía, \"Getting started\" en acento, \"Ask Pi to build it\" en muted, una línea horizontal corta de acento (~22 caracteres de \"─\"), \"Commands\" en acento, y 4 líneas de comandos slash en muted: /use-default-tui más 3 comandos reales del pi en ejecución (usa el pool de pi.getCommands(), como hace el upstream con pickSlashCommandTips; fíjalos una sola vez por sesión para que no bailen)."

S18 — Narrow widths. "Si el ancho no alcanza para la columna derecha, la columna de tips se omite y la izquierda se centra a ancho completo."

S19 — Out of scope. "No toques footer, spinner, ni el indicador de trabajo. No implementes los verbos rotativos ni ctx.ui.setWorkingMessage. No es un paquete de temas: sin pi.themes. No cambies el input box ni el título de la ventana salvo que sea necesario para aplicar el header."

S20 — Two commands. "Nada de /use-claude-code-tui con ese nombre: solo dos comandos, uno para reaplicar el banner y otro para restaurar header/footer/spinner nativos de pi."

S21 — Acceptance. "a 80 y a 120 columnas, el render del frame final coincide con la estructura descrita y todos los colores salen del tema activo (probar con Gentle, Gentleman-Cute y Gentleman-Sexy)."

S22 — Animation. "La animación de 15 frames del upstream está permitida si termina exactamente en ese estado, pero el criterio de aceptación es el frame final: logo en un único color del tema, sin ANSI crudo." — resolved by dropping the animation: the only frame is the accepted one.

S23 — Vertical rhythm. Measured from the reference (L8): the mark occupies interior rows 3-6 (level with `Ask Pi to build it`, the rule, `Commands` and the first tip), row 7 is blank, the tagline is row 8, the model line row 9 and the cwd row 10. Two blank rows sit above the mark, and the body is the sidebar's ten lines.

S24 — Startup race. The 120 ms re-assert must land after gentle-pi installs its own header; its install is `setTimeout(..., 50)` opened at `gentle-pi/extensions/startup-banner.ts:757` and closed at line 1113, after `await readBannerConfig()` at line 666 inside its async `session_start` (line 652). Its resize handler (lines 784-801) only calls `tui.requestRender()` (line 794), so nothing re-registers the header later.

## Tasks

| ID | Spec | Route | Commit |
| --- | --- | --- | --- |
| T1 | S12 | inline | 331ec1c |
| T2 | S6, S7 | inline | 86fbeca |
| T3 | S3, S8a | inline | 67e4d76 |
| T4 | S2, S3, S8b, S8c | inline | 0ca16bb |
| T5 | S1, S4, S5, S10 | inline | 298b1d2 |
| T6 | S9 | inline | 86fbeca |
| T7 | S8, S4 | inline | 298b1d2 (evidence in L3) |
| T8 | S3, S13, S15, S16, S19 | inline | 64475db |
| T9 | S2, S14, S16, S17, S18 | inline | 64475db |
| T10 | S5, S20, S22 | inline | 64475db |
| T11 | S8, S21 | inline | 64475db |
| T12 | S6, S9 | inline | 2ef6b01 |
| T13 | S13, S15, S21, S23, S24 | inline | 1768abb |
| T14 | S13, S21 | inline | pending |
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

L3 (verification evidence, T7):

- `npm test` (node --experimental-strip-types --test): 18 tests, 18 pass, 0 fail.
  - palette: mapping, role set, painter-by-painter resolution, no role outside the Gentle set, unknown-role error.
  - banner: golden render at 80 columns, no raw colour escape in any of the 22 frames at widths 24/40/80/120/200, every escape in a themed render is one the theme emitted, every row is exactly the requested width, dark and light stubs render differently, the Gentle-only stub renders every frame.
  - extension: both commands registered, install happens after the event (not synchronously), the installed header renders and keeps the restore tip, restore clears header/footer/spinner and no pending re-assert reinstalls the banner, look re-applies, non-TUI contexts are untouched.
- `npx tsc --noEmit`: clean.
- Real themes: loaded the three gentle-pi themes plus pi's dark.json and light.json with pi's own `loadThemeFromPath` and rendered frame 21 at 80 columns. For all five: every escape belongs to that theme's role set (`foreign=none`), the plain shape is identical, and the code sets differ per theme (Gentle accent #7FB4CA, Cute #F095C8, Sexy #F43888, dark #A798D7, light #7489B4). Script kept outside the repo (`/tmp`), not committed.
- pi loader smoke test: `pi -e . -p x --api-key ...` produced no extension error, while the negative control `pi -e . -e /tmp/broken-ext.ts ...` printed a parse error for the broken extension, so pi did load and parse both files.
- NOT verified: the rendered banner in a real terminal session (no TUI was started), and the ordering race against gentle-pi's banner in a live run. The 120 ms / 400 ms re-assert is designed for it and the clock is frame-preserving, but only a real startup can show which header wins.

L4 (native review): `assess` over the committed range master..feat/loon-startup-banner returned risk medium, reviewDue false (under_budget), plan writerSelfVerification with no independent verifier. Self-verification above is the applied plan.
L5 (owner correction, verbatim; replaces the requirements part of L1, the research stays valid):

> CORRECCIÓN DE ALCANCE (reemplaza la parte de requisitos del brief anterior; la investigación sigue válida).
>
> ALCANCE REAL: SOLO el header de arranque, tal cual se ve en la captura que me pasó el humano. Nada más.
>
> FUERA DE ALCANCE (no lo implementes):
> - No toques footer, spinner, ni el indicador de trabajo.
> - No implementes los verbos rotativos ni ctx.ui.setWorkingMessage.
> - No es un paquete de temas: sin pi.themes.
> - No cambies el input box ni el título de la ventana salvo que sea necesario para aplicar el header.
> - Nada de /use-claude-code-tui con ese nombre: solo dos comandos, uno para reaplicar el banner y otro para restaurar header/footer/spinner nativos de pi.
>
> LOOK EXACTO QUE HAY QUE REPRODUCIR (captura del humano, terminal ancha):
> - Caja de borde fino redondeado, con el color de acento del tema activo, ocupando el ancho completo. En el borde superior, cerca de la izquierda, la etiqueta "─ Pi v<version> ─" con los guiones y el texto en acento (v0.80.7 en la captura).
> - Columna izquierda, todo centrado horizontalmente dentro de su mitad:
>   1. Logo "Pi" grande y estático: marca de bloques cuadrados (celdas tipo "███") formando la P y la i, en UN SOLO color = acento del tema. En la captura ocupa unas 7 filas de alto y ~10 celdas de ancho.
>   2. "Let's build something great" en bold, color de texto normal.
>   3. "openai-codex/gpt-5.5 · high effort" en muted (formato: provider/modelo · <effort> effort).
>   4. "~/Workspace/mypi" en dim (cwd con ~ abreviado).
> - Divisor vertical de una columna, en acento, a ~69% del ancho interior, recorriendo toda la altura interior de la caja.
> - Columna derecha, alineada a la izquierda, con este contenido literal y en este orden: una línea vacía, "Getting started" en acento, "Ask Pi to build it" en muted, una línea horizontal corta de acento (~22 caracteres de "─"), "Commands" en acento, y 4 líneas de comandos slash en muted: /use-default-tui más 3 comandos reales del pi en ejecución (usa el pool de pi.getCommands(), como hace el upstream con pickSlashCommandTips; fíjalos una sola vez por sesión para que no bailen).
> - La captura es el FRAME FINAL con la animación ya asentada. La animación de 15 frames del upstream está permitida si termina exactamente en ese estado, pero el criterio de aceptación es el frame final: logo en un único color del tema, sin ANSI crudo.
>
> CRITERIO DE ACEPTACIÓN VISUAL: a 80 y a 120 columnas, el render del frame final coincide con la estructura descrita y todos los colores salen del tema activo (probar con Gentle, Gentleman-Cute y Gentleman-Sexy). Si el ancho no alcanza para la columna derecha, la columna de tips se omite y la izquierda se centra a ancho completo.
>
> Licencia y tests siguen como en el brief anterior, pero el golden render debe cubrir el frame final, no los 15 frames.
L6 (verification evidence for the corrected scope, T8–T12):

- `npm test`: 26 tests, 26 pass, 0 fail.
  - palette: the painter table is the one the capture fixes (frame/divider/heading/logo -> accent, tagline -> text, body -> muted, subtle -> dim), every role exists in the three gentle-pi themes, every painter resolves through the theme, no role outside the Gentle set, unknown-role error surfaces.
  - header: golden render at 80 and at 120 columns; the divider sits at `round(0.69 * interior)` and appears in every body row; the sidebar keeps the literal order (empty line, Getting started, Ask Pi to build it, 42-dash rule, Commands, /use-default-tui, three pool commands); the left half centres the mark, tagline, model line and cwd; the mark is 7 rows x 30 columns and uses only the accent role; no raw colour escape at six widths; every escape in a themed render is one the theme emitted; every row is exactly the requested width; dark and light stubs render differently; the sidebar is dropped when the columns do not fit; below the mark width only the version label prints.
  - extension: exactly two commands (use-loon-tui, use-default-tui), install deferred past the event, applying touches only `setHeader` (no footer, spinner, title or editor), the rendered header keeps /use-default-tui and never advertises /use-loon-tui, tips are identical across the three installs of one session, restore clears header/footer/spinner and cancels pending re-asserts, non-TUI contexts untouched.
- `npx tsc --noEmit`: clean.
- Real themes, S21: the three gentle-pi themes loaded through pi's own `loadThemeFromPath`, rendered at 80 and at 120 columns. All six renders: `foreign=none` (every escape belongs to that theme's accent/text/muted/dim), identical plain shape across themes and widths, 12 rows, and the top border is a single accent run around the whole label.
- Bold check: `theme.bold()` goes through chalk, which is a no-op on a pipe. Under a pty (`script -qec …`) the tagline emits `\x1b[1m` + the `text` colour + `\x1b[22m`, which is what the capture asks for; on a pipe it is plain, which is chalk behaviour, not the header.
- The 15-frame animation of L1 is not ported: the accepted frame is the only frame, so S22's criterion holds by construction and no timer runs after startup.
- NOT verified: the rendered header inside a live pi TUI, and the startup race against gentle-pi's own banner. Also not verified: pixel-exact agreement with the owner's capture — the mark glyph was built from the written description (7 rows, ~10 cells, P and i, single colour) because the image itself is not available in this session. `LOGO_GRID` in extensions/lib/logo.ts is the single place to adjust it.
L7 (owner review of 37e4fec, verbatim):

> Revisión de mi lado, sobre 37e4fec. El banner está bien montado y cierra tus puntos 2 y 3. Dos defectos concretos, y una de tus dudas la puedo cerrar con evidencia.
>
> 1) EL GLIFO ESTÁ MAL (tu punto no verificado #3 — ahora sí medido). Yo sí tengo la captura del humano. La extraje de mi transcript, la medí a nivel de píxel (crop del logo: 228 x 212 px dentro de un banner de 80 columnas; celda ≈ 57 x 53 px; ancho de carácter ≈ 19 px, así que la marca son 12 columnas de terminal de ancho y 4 filas de alto, no 30 x 7). El glifo real es una rejilla de 4 x 4 celdas, no 10 x 7. LOGO_GRID debe ser exactamente: "###.", "#.#.", "##.#", "#..#". Lectura por celda (A=col0, B=col1, C=col2, D=col3; R0 arriba): R0: A B C → barra superior de 3 celdas; R1: A . C → el contrafuerte de la P (hueco en B); R2: A B . D → barra media de 2 celdas + bloque lejano en D; R3: A . . D → tallo y el bloque bajo de la "i". Diferencias con lo que hay hoy: el de ahora tiene 7 filas con un tallo que baja solo, una columna derecha de 3 de ancho con un hueco arriba, y el bloque bajo de la "i" pegado; la referencia tiene 4 filas, la "i" es una sola celda de ancho que arranca en R2 (no en R0), y el hueco está en R1-B, no bajo el bloque derecho. LOGO_WIDTH pasa a 12.
>
> 2) APÓSTROFO EQUIVOCADO. La captura dice "Let's build something great" con apóstrofo recto. El código usa el curvo U+2019: extensions/lib/banner.ts:73, el comentario de extensions/lib/palette.ts:35, la aserción de tests/banner.test.ts:84 y los dos goldens. Corrígelo en los cuatro sitios.
>
> 3) GOLDENS: hay que regenerarlos, porque el logo pasa de 30 a 12 columnas y cambia el centrado de la columna izquierda.
>
> 4) TU PUNTO NO VERIFICADO #2 (carrera con gentle-pi): SE PUEDE CERRAR SIN LEVANTAR TUI. Leí el banner de gentle-pi. Su "session_start" es async: hace "await readBannerConfig()", programa estadísticas a 100/150/200 ms, y luego abre "setTimeout(() => { ctx.ui.setHeader(...) }, 50)" — el timer se abre en la línea 757 y cierra en la 1113 con "}, 50);". O sea: instala su header ~50 ms después de un read de archivo. Tu re-assert a 120 ms cae después y gana; el de 400 ms es la segunda red. Y su handler de "resize" (línea ~782) solo llama a "tui.requestRender()"; NO vuelve a registrar el header. Así que no hay reconquista posterior. Documenta esto como evidencia con los números de línea, en vez de dejarlo como "no verificado".
>
> 5) TU PUNTO NO VERIFICADO #1 (TUI real) sigue abierto; no lo declares cubierto.
>
> REFERENCIA DISPONIBLE: la captura está en /home/loonbac/Proyectos/pi-loon/.scratch/ref.png (1464x702, banner de 80 columnas). Puedes leerla para comparar, pero no la muevas ni la agregues al repo sin pedirlo; el dato que manda es la rejilla de arriba.
L8 (T13 evidence, corrections applied on top of 37e4fec):

- Grid re-measured independently from `.scratch/ref.png` (raw RGBA through `magick ... rgba:-`, parsed in node, no PIL available): mark bbox x 388-615, y 190-401 = 228 x 212 px; four 53 px row bands with densities 7/5/7/5; four 57 px columns. Per-cell occupancy at 40 % threshold gives exactly `###.` / `#.#.` / `##.#` / `#..#`. The review's grid is confirmed by measurement, not only by report.
- Vertical rhythm measured the same way: sidebar line centres 165, 215, 269, 321, 375, 429, 482, 535 with a 53 px pitch; mark bands 190-243 / 243-296 / 296-349 / 349-402. So the mark's first row is level with `Ask Pi to build it`, the rule, `Commands` and the first tip; the tagline centre 483 is level with the third tip and the model line 535 with the fourth. The cwd is dim enough to fall under the brightness threshold but closes the interior (row 10). S23 implements this rhythm instead of the previous vertical centring.
- Extra defect found while implementing S23: `renderLogo` emitted trailing blank cells, so `center()` centred the padded row and the mark sat two columns left of centre in every render. It now trims the trailing blanks; the new centring assertion in `tests/banner.test.ts` is what caught it (left column start/slack 22/22 and 20/21).
- Apostrophe: U+0027 in `extensions/lib/banner.ts`, the `palette.ts` painter comment, the `banner.test.ts` assertion, both goldens and the README sample.
- Goldens regenerated at 80 and 120 columns; the left column now reads mark rows 3-6, blank 7, tagline 8, model 9, cwd 10.
- `npm test`: 26 tests, 26 pass. `npx tsc --noEmit`: clean.
- Startup race (S24), verified by reading gentle-pi's source at `~/.pi/agent/npm/node_modules/gentle-pi/extensions/startup-banner.ts`: `pi.on("session_start", async ...)` at line 652, `await readBannerConfig()` at 666, `setTimeout(() => { ctx.ui.setHeader(...)` at 757 closing with `}, 50)` at 1113; resize handler lines 784-801 calls `tui.requestRender()` at 794 only. LOON's 120 ms re-assert therefore lands after gentle-pi's install and nothing re-registers the header afterwards; the 400 ms re-assert stays as a second net.
- Still not verified: the header inside a live pi TUI (L7 point 5). Everything else above is measured or run.
L9 (owner review of 1768abb, verbatim):

> Revisión de `1768abb`. El glifo, el apóstrofo, el ritmo vertical (S23) y la carrera quedan verificados de mi lado: correctos. Queda un defecto de alineación que el propio golden está fijando como si fuera correcto.
>
> DEFECTO: LA MARCA QUEDA ESCALONADA 2 COLUMNAS. En tests/fixtures/header-80.txt, líneas 4-7: líneas 4 y 5 (`█████████` y `███   ███`): contenido empieza en la columna 23; líneas 6 y 7 (`██████   ███` y `███      ███`): contenido empieza en la columna 21. O sea: las dos filas superiores están 2 columnas a la derecha de las dos inferiores. La marca no tiene borde izquierdo recto.
>
> CAUSA: `renderLogo` hace `.trimEnd()` por fila. Las filas 0-1 miden 9 columnas de tinta y las 2-3 miden 12, y como cada fila se centra por separado, cada una se corre distinto. El comentario dice "centres on its ink" — para un glifo de varias filas eso es justo lo incorrecto: se centra la caja de la rejilla, no la tinta de cada fila.
>
> EN LA CAPTURA el borde izquierdo es recto: la columna A arranca en x=388 en las cuatro filas (bbox medido 388-615; A ocupa 0-56 en todas). La caja de 12 columnas se centra como bloque.
>
> FIX: quita el `.trimEnd()`. Cada fila devuelve las 12 columnas (3 de relleno al final cuando corresponde) y el centrado se hace sobre 12 para todas. Los espacios finales son invisibles, así que no cambian el ancho visible.
>
> ASERCIÓN QUE HAY QUE CAMBIAR: la de `tests/banner.test.ts:97-104` valida centrado por línea (`Math.abs(start - slack) <= 1`), que es exactamente lo que permite el escalonado. Sustitúyela por: las cuatro filas del logo arrancan en la MISMA columna. Y en el golden a 80 las cuatro líneas del logo deben empezar en la columna 21.
>
> Regenera ambos goldens después del cambio; el resto del banner no debe moverse.
>
> Sobre tus apóstrofos curvos en prosa: déjalos como están, son prosa, no texto renderizado. Solo el texto de la UI va recto, y ya está.
L10 (T14 evidence):

- `.trimEnd()` removed from `renderLogo`: every row is `LOGO_WIDTH` (12) columns, blanks included, so `center()` centres one rectangle. The docstring says why, since the obvious "tidy up the trailing spaces" edit is exactly the defect.
- The per-line centring assertion is replaced by the block assertion: `renderBanner(bannerInput())` lines 3-6 must each have their first `█` at index 21 (`assert.deepEqual(starts, [21, 21, 21, 21])`). Measured in the goldens with `awk`: 80 columns -> 22/22/22/22 (1-based, i.e. index 21), 120 columns -> 36/36/36/36 (index 35). Straight left edge at both widths.
- The centring check that still runs covers only the three text lines (tagline, model line, cwd), which are single lines and are meant to be centred individually.
- Goldens regenerated: the diff is exactly the two upper mark rows shifting two columns left (`██...` starting at index 23 -> 21); no other line moves, at 80 or 120.
- `npm test`: 26 tests, 26 pass. `npx tsc --noEmit`: clean.
- Prose apostrophes (README, test titles, comments) stay as they are, per the owner: only rendered UI text uses the straight apostrophe.