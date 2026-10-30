# card-surface-border

`border` is ink that lands on card surfaces and is solved only against `bg`; `accentDim` is a
var no role reads. Both are palette defects in `extensions/lib/wallpaper-theme.ts`.

## Specs

- **S1.** The orchestrator's authorization, verbatim:
  > ## Unidad A — `border` sobre superficies de tarjeta, y `accentDim` que no pinta nada
  >
  > **Antes de creerme, comprueba los dos hechos**, porque el primero cambia el alcance:
  >
  > 1. **`accentDim` no es un defecto de contraste: es una var muerta.** `wallpaper-theme.ts:331` la deriva, pero ningún rol de `colors` la referencia (`grep -n accentDim` → una sola línea, la de su definición), y `export` solo acepta `pageBg`/`cardBg`/`infoBg` (`docs/themes.md:116`), con lo que «Theme objects are strict: only documented tokens are accepted» (`:81`). Medido ahora: `accentDim` no aparece en ningún rol. Yo te la reporté como deuda de contraste —1.21— y era mentira por omisión mía: medí un color que no llega a pintarse. **No le inventes un rol para justificarla**; quítala de la derivación y borra el test que fije su valor, si existe. Si descubres que algún consumidor la lee fuera de `colors`, párate y dímelo antes de tocar nada.
  >
  > 2. **`border` sí es un defecto real, y es el mismo que tuvo `dim` antes de `dd24afe`.** `wallpaper-theme.ts:322` la resuelve **solo contra `bg`**: `tintedSurface(H, ..., bg, 2.5, 3.2)`. Medido por mí sobre el tema actual: `border #415379` da **1.53 / 1.51 / 1.49** sobre `toolSuccessBg`/`toolPendingBg`/`toolErrorBg`. Y `border` es la tinta de cosas que se leen: rol `border`, `scrollbarThumb`, `mdQuoteBorder`, y el marco de tarjeta de `lib/shell-card.ts` (`FRAME_ROLE`). Además gentle-pi pinta **la regla del prompt band** con `PROMPT_FRAME_ROLE = "border"` (`extensions/gentle-shell.ts:483`), así que esta unidad también la mueve.
  >
  > **Arreglo pedido:**
  > - Resolver `border` contra las **tres superficies de tarjeta**, con suelo **3.0** y objetivo **3.2**, conservando tono. Constantes nuevas siguiendo el patrón existente (`CONTRAST_FLOORS.borderSurface = 3`, `BORDER_SURFACE_CONTRAST_TARGET = 3.2`), y comentario que diga **por qué** el suelo es 3.0 (WCAG 1.4.11, contraste de componentes no textuales) y no 4.5.
  > - Reutiliza `HINT_SURFACES` si el nombre sigue siendo honesto para las dos cosas, o renómbrala a `CARD_SURFACES` si no; no dupliques la lista.
  > - **No toques `borderSubtle`** (`#252629`): es decorativa (`mdHr`, `mdCodeBlockBorder`, `borderMuted`) y no vive sobre tarjeta.
  > - Tests: **RED primero**, con un caso que hoy falle. Itera sobre varios acentos como hacen los tests actuales y **afirma el suelo medido, no un hex**. Mi predicción para el acento actual: con objetivo 3.2 el resultado cae cerca de **`#7388B1`** (`#6F83AC` con 3.0). Si te sale muy lejos de ahí, no lo ajustes: explícalo.
  >
  > **Qué me tienes que devolver con la unidad:**
  > - tabla medida de `border` sobre `bg`, `bgPanel`, `bgElement` y las tres superficies, antes y después;
  > - hex nuevo y **md5 nuevo del tema** (el json del tema es salida del producto: su md5 cambia y es legítimo, no es config del humano);
  > - contraste de la regla del band sobre la superficie del band, antes y después — es la consecuencia visible que el humano ya había aprobado de otra forma, y quiero el número al lado;
  > - captura real a **160** de columnas de una tarjeta y del band, con el aviso de siempre: en modo *thinking* la regla toma `thinkingHigh`, así que si mides un solo frame, dilo;
  > - confirmación de que `accentDim` no quedó en ninguna parte del tema generado.
  >
  > Entorno del humano: no cambies `loon-tui.json`, `card-style.json` ni `visual-customization.json` (`84c21b5f…`, `52e642af…`, `4d4c169d…`). Si una sonda necesita cambiarlos, respaldo + sha, `trap EXIT`, y `sha256sum -c` en el mismo bloque.

- **S2.** `border` resolves against the three card surfaces at floor 3.0
  (`CONTRAST_FLOORS.borderSurface`) and target 3.2
  (`BORDER_SURFACE_CONTRAST_TARGET`), keeping hue and chroma. The floor comment says
  WCAG 1.4.11 (non-text contrast), not 4.5.
- **S3.** One surface list serves both `dim` and `border`; it is named for what it is
  (`CARD_SURFACES`), not for one of its two uses.
- **S4.** `accentDim` is removed: no role reads it and no consumer outside `colors`
  reads it either. `borderSubtle` is untouched.
- **S5.** The band rule does not get quieter: `border` over `selection` keeps at least
  the contrast it had.

## Tasks

| ID | Specs | Route | Commit |
| --- | --- | --- | --- |
| T1 | S1, S4 | Confirm `accentDim` is unreferenced, remove it | one commit |
| T2 | S2, S3, S5 | RED test, then solve `border` against `CARD_SURFACES` | same commit |
| T3 | S1 | Measured table, theme md5, 160-column frame | evidence in the PR |

## Log

- **L2.** Facts confirmed before touching anything. `accentDim` occurs once in the tree - its
  own definition at `wallpaper-theme.ts:331` - and no role of `colors` binds it, no export
  token names it, and nothing outside the theme reads it. `border` is `tintedSurface(H, ...,
  bg, 2.5, 3.2)`, solved against `bg` only, and measures 2.53 / 2.34 / 2.18 on bg/bgPanel/
  bgElement against 1.53 / 1.51 / 1.49 on the three card surfaces for accent `#9E9FA1`.
- **L3.** RED observed before the fix: `border/toolSuccessBg is 1.54 for accent 213,169,240
  (#68467D); the floor is 3.0 and the target 3.2`, and `accentDim is still derived although
  no role of colors binds it`.
- **L4.** `HINT_SURFACES` is renamed `CARD_SURFACES`: the list is now read by two roles, and
  it had no consumer in the tree, so the rename costs nothing.
- **L5.** Measured after the change, accent `#9E9FA1`: border `#798DB7`, 5.83 / 5.38 / 5.01
  on bg/bgPanel/bgElement and 3.53 / 3.48 / 3.42 on the card surfaces; the band rule over
  its own surface went 1.53 -> 3.53, and `border` over `selection` 1.40 -> 3.21. The
  orchestrator predicted `#7388B1`; the 0.02 lightness steps of `liftToSurfaces` explain the
  small overshoot, not a different derivation.
- **L6.** A second dead var turned up while proving the first: `bgSubtle` is derived, no role
  of `colors` binds it, and LOON binds `customMessageBg` to `bgElement` where gentle-pi's own
  themes use `bgSubtle`. Not touched: not authorized, and it is a separate unit.
