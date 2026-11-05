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

## Corrección del coordinador (L5) y estado del port

El coordinador corrigió su propia premisa: `loon` **sí** fue un estilo válido en la instalación
parcheada de 4.5.1, y el fichero `card-style.json` **no hay que tocarlo**: la causa es que la
actualización borró el parche. Medido aquí, coincide: cero marcas LOON en los archivos instalados
y 8 anclas sin resolver. El plan cambia de «escribir `float`» a «reancolar el parche y reaplicarlo».

Estado del reancolado, medido con `check`:

| Destino | Anclas | 4.6.0 |
| --- | --- | --- |
| `extensions/gentle-shell.ts` | 4 | reancoladas: `shellRows` (el menú nuevo usa filas explícitas) y `shellMouse` (el editor ganó panel y filas superiores) |
| `lib/visual-customize-view.ts` | 2 | intactas |
| `extensions/startup-banner.ts` | 2 | intactas |
| `lib/shell-bar.ts` | 11 | reancoladas: el import creció y las etapas ganaron el escalón de esfuerzo |
| `lib/shell-card.ts` | 7 | reancoladas: `paintFloat` delega en `paintSurfaceRow` |
| `lib/card-style-policy.ts` | 1 | intacta |
| `lib/shell-prompt.ts` | 5 | reancolada: `PromptLayout` ganó `panel` |

`apply` corrió sobre 4.6.0: los siete destinos leen `patched` y cada copia parcheada carga con
jiti. Con eso, `loon` vuelve a ser un estilo válido y `card-style.json` del dueño se lee sin
tocarlo. Pendiente: reancolar las aserciones de `tests/gentle-pi-patch.test.ts` a 4.6.0 (trece
fallan porque describen el menú y las etapas de 4.5.1), y decidir si el parche se reaplica solo.

## Las seis anclas que se movieron, y por qué la nueva es el mismo sitio lógico

Medido: de 32 anclas, **6** no existen en 4.6.0 — `shellRows`, `shellMouse`,
`shellBarMarginImport`, `shellBarStagesTail`, `shellcard4`, `shellprompt3`. Las otras 26 son
idénticas byte a byte. (El coordinador incluyó `SHELL_PROMPT_4` en la lista; **no** se movió: la
fila de la banda es idéntica en 4.6.0. Lo que cambió es la interfaz, `SHELL_PROMPT_3`.)

| Ancla | Qué cambió en 4.6.0 | Por qué la nueva es el mismo sitio |
| --- | --- | --- |
| `shellRows` | Las dos filas propias del banner (`Banner rose`, `Banner text logo`) pasaron de dos `add(…)` sueltos a **un bucle** `for (const [setting, key] of …) { for (const enabled of [true,false]) add(…, explicitChoice(…)) }`, con un quinto argumento `meta` que el menú nuevo usa para dibujar una elección explícita en vez de un ciclo. | Es el bloque que declara las filas del banner de gentle-pi y nada más. La sustitución conserva la disposición de LOON **literal**: una fila `Banner:` que cicla la fuente, la fila del logotipo solo dentro de `rose`, las filas de acento de tema y wallpaper con etiqueta que mira el ancho, los cuatro colores con nombre devolviendo el acento, y `Mark:`. No inventamos `meta`: es opcional y las propias filas de temas de 4.6.0 no lo llevan. |
| `shellMouse` | El override de `handleMouse` ganó hover del panel, botón de panel y el bloque de filas superiores; el trayecto que traduce la coordenada sobrevivió con la misma forma. | El ancla vuelve a ser **el método entero** (miembro de clase, así que se sostiene en el fixture), y la sustitución cambia solo la cola: el único punto que decide cómo entra un clic en la banda. Respeta el `layout.panel` que escribió upstream y conserva el desplazamiento de fila que la banda ya necesitaba. |
| `shellBarMarginImport` | El import de `./shell-card.ts` creció: 4.6.0 centralizó el pintado de superficie y añadió `paintSurfaceRow` y `surfaceOpener`. | Es el único import de la geometría de tarjeta en la barra. La sustitución añade `CARD_STYLE` y `cardStyle` a esa misma lista. |
| `shellcard4` | `paintFloat` ya no re-arma el fondo: esa fila se movió a `paintSurfaceRow`, y `paintFloat` solo pone los márgenes. | Es la función que envuelve **toda** fila pintada. La sustitución conserva la envoltura, toma izquierda y derecha de `cardGeometry()` y delega el repintado en `paintSurfaceRow`: exactamente la capa que eligió upstream, sin duplicar el re-armado. |
| `shellBarStagesTail` | La cascada de etapas del header ganó un escalón: `...(model.effort ? [[brand, withEffort]] : [])` — esfuerzo sin ubicación. | Es la lista de etapas que la barra cae cuando no cabe. La sustitución mapea el escalón nuevo con `withBrand` como los demás, así que la cascada conserva su forma y el tema LOON sigue eliminando la etapa de marca sola. |
| `shellprompt3` | `PromptLayout` ganó `panel?: boolean` para el editor ancho del IDE. | Es la interfaz que transporta `prefixWidth`, el valor que leen la banda y el ratón. La sustitución conserva `panel` y añade `chrome`. |

## Verificación con frames reales, no con el diff

La geometría no se declara desde el parche: la miden los tests de `tests/probe-frame.test.ts`,
que dibujan frames reales y cuentan secuencias de fondo y distribución de columnas. Tres de ellos
son los que prueban esto, y **estaban en rojo con 4.6.0 sin parche**:

- `no painted row starts with an escape, in any card style`
- `the loon band surface ends where the bar surface ends`
- `the band opens with an empty surface row and the hint is not the first row`

Corren con `tmux` en el PATH (`tmux` está en esta máquina; en la caja no, y por eso allí fallan
dos de `probe-frame`). Con el parche aplicado, la suite local queda en **303/303, cero saltados**.

## Regla: no vendorizar un paquete ajeno en un commit de trabajo

Aprendido midiendo: el candidato de revisión de este port fueron **7.779 líneas, 6.900 de ellas
copias byte a byte de `lib/` de gentle-pi** en `tests/fixtures/gentle-pi-4.6.0/`. El proveedor
nativo rechazó el START con `lens_context_budget_exceeded`: el cambio real eran unas 880 líneas y
quedó **sin segunda vista** por culpa del relleno.

Así que, a partir de aquí:

- **Nunca se commitea un paquete ajeno dentro de un commit de trabajo.** El candidato se mide en
  líneas propias; meter un paquete entero lo saca del presupuesto del revisor.
- Los bytes prístinos se **resuelven en tiempo de ejecución** (`tests/support/pristine.ts`) desde
  fuentes en orden explícito: `GENTLE_PI_ROOT`, el backup más nuevo del parche, y el paquete
  instalado **solo mientras esté sin parchear**.
- Lo que se commitea es **el hash**: `tests/fixtures/pristine-digests.json`, un SHA-256 por
  archivo. Unos cientos de bytes que hacen verificable la procedencia.
- **Verificar antes de usar**: cada archivo se hashea contra el registro. Un archivo ausente es un
  *skip visible* con su motivo; un byte distinto es **rojo**, porque no son los bytes medidos y
  recalcular un digest contra ellos sería mentir.
- En la caja, donde no hay paquete, se apunta `GENTLE_PI_ROOT` a una copia prístina (el backup):
  sin eso, esos tests se saltan con motivo en vez de fingir verde.

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
