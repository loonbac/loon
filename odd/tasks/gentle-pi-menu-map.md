# Adaptar la configuración de LOON al menú de gentle-pi 4.6.0

La personalización de Gentle Shell que publica este repositorio, revisada contra el menú
nuevo de 12 categorías, y el defecto medido que dejó la actualización.

## Specs

S1. El repositorio publica un payload de configuración bajo `config/gentle-ai/` y **cada
    archivo valida con los parsers de gentle-pi**, no con una copia de sus reglas.
S2. `card-style.json` lleva un estilo que gentle-pi 4.6.0 acepta. Stock solo conoce
    `neon` y `float`; la geometría `loon` **no** se declara como estilo aceptado mientras
    el parche no pueda instalarse.
S3. `visual-profiles.json` define el perfil `loon` con el tema `Wallpaper (LOON)`, banner
    rosa sin rosa y sin logotipo, `animationPolicy` en `quality`, y los ajustes visuales
    con **las ocho claves** de `visibility`.
S4. `node scripts/gentle-ai-payload.mjs verify [--dir <ruta>]` lee un directorio de
    configuración y sale distinto de cero enumerando cada problema.
S5. `apply` guarda una copia de lo que reemplaza y después verifica.
S6. Ningún agente escribe en el directorio human-controlled: lo aplica el dueño con una
    sola orden.
S7. La documentación dice qué archivo de ajustes posee cada categoría del menú.

## Medido

- gentle-pi instalado: **4.6.0**; el parche del repo está escrito contra 4.5.1.
- Marcas LOON en los archivos vivos de 4.6.0: **cero** en `gentle-shell.ts`, `shell-bar.ts`,
  `shell-card.ts`, `shell-prompt.ts`, `card-style-policy.ts`. La actualización deshizo el
  parche y con él la geometría de tarjeta, la barra sin marca y las filas de banner.
- Anclas del parche presentes en 4.6.0: 16 de 21. Faltan `SHELL_ROWS`, `SHELL_MOUSE`,
  `SHELL_BAR_MARGIN_IMPORT`, `SHELL_CARD_4`, `SHELL_PROMPT_3`, `SHELL_PROMPT_4`
  (`check` las nombra una por una). Con eso **el parche no aplica**.
- `card-style.json` vivo: `{"schema":"gentle-pi.card-style/v1","style":"loon"}`.
  `parseCardStyleFile` devuelve `undefined` → `resolveCardStyle()` da `float` con
  `malformed: true` → la categoría Cards no puede guardar
  (`Cannot update malformed or unreadable card style preference`).
- `"loon"` **nunca** fue un estilo de gentle-pi: lo añadía el parche de este repositorio a
  `lib/shell-card.ts` (`CARD_STYLE.LOON`), a `lib/card-style-policy.ts` (lectura y
  escritura) y a `lib/shell-prompt.ts` (la banda). Trabajo real, pero del parche, no del
  paquete.
- El lector del perfil **sí** tolera una clave ausente y le pone su valor por defecto; el
  validador estricto (`isVisualSettings`) exige las ocho. Escribimos las ocho para que el
  perfil sobreviva a cualquier guardado desde el menú.

## Mapa: cada ajuste que el dueño tenía, en el menú de 4.6.0

| Ajuste | Archivo que lo posee | Categoría |
| --- | --- | --- |
| tema `Wallpaper (LOON)` | `settings.theme` + `~/.pi/agent/themes/<nombre>.json` | **Themes** |
| banner rosa, sin rosa, sin logotipo | `banner.json` (`showRose`, `showTextLogo`, `color`) | **Banner** |
| política de animación | `animations.json` (`gentle-pi.animations/v1`) | **Animations** |
| colocación de estado, cabecera, densidad | `visual-customization.json` (`gentle-pi.visual-customization/v1`) | **Layout** |
| siete secciones visibles | el mismo archivo, `visibility` | **Sections** |
| estilo de tarjeta | `card-style.json` (`neon`\|`float`) | **Cards** |
| contenido de tarjeta `default` | `card-content.json` (`gentle-pi.card-content/v1`) | **Cards** |
| perfil completo | `visual-profiles.json` (`gentle-pi.visual-profiles/v1`) | **Profiles** |
| persona `neutral` | no es un ajuste visual | — |
| editor, historial, notificaciones, atajos, restaurar | sus propios archivos | **Editor, History, Notifications, Keymaps, Reset** |

`extensions/lib/gentle-config.ts` sigue leyendo los mismos dos archivos
(`visual-customization.json` y `banner.json`) y no necesita cambios: sus claves no se
movieron en 4.6.0.

## Tasks

| ID | Specs | Ruta | Commit |
| --- | --- | --- | --- |
| T1 | S1, S2 | inline | payload `config/gentle-ai/card-style.json` |
| T2 | S1, S3 | inline | payload `config/gentle-ai/visual-profiles.json` |
| T3 | S4, S5 | inline | `scripts/gentle-ai-payload.mjs` |
| T4 | S1, S4 | inline | `tests/gentle-ai-payload.test.ts` |
| T5 | S6, S7 | inline | docs: README y este documento |

## Log

L1 (coordinador, verbatim): «El dueño actualizó gentle-pi de 4.5.1 a 4.6.0 y su
personalización de Gentle Shell quedó rota. Pide que lo adapte «todo al menú nuevo, que
ahora está más organizado».»

L2: el diagnóstico del coordinador se confirma en todo menos en un punto: el lector del
perfil tolera claves ausentes (normaliza), aunque el validador estricto las exija. Lo
medido manda y el test fija las dos caras.

L3: hallazgo que el diagnóstico no cubría: el parche del repo **no aplica** a 4.6.0 (16 de
21 anclas), así que la personalización que el dueño ve rota no es solo el valor de
`card-style.json`: es que la geometría LOON, la barra sin marca y las filas de banner ya
no están instaladas. Eso se reporta y se propone aparte; no se finge adaptado.

L4: `"loon"` como estilo de tarjeta es trabajo real de este repositorio, implementado por
el parche sobre `lib/` de gentle-pi. En stock 4.6.0 no existe mientras el parche no se
reancle, así que el payload publica `float` — exactamente lo que hoy se dibuja, cambio
visual cero.
