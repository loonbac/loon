# band-top-padding

The prompt band opens on the hint row, so the surface starts on the label: the human reads it
as text pressed against the top edge. The band needs an empty surface row above the hint,
symmetric to the one it already has below.

## Specs

- **S1.** The orchestrator's authorization, verbatim:
  > **El defecto real, medido por mí en el frame a 160 (filas 36-38 del band):**
  >
  > ```
  > fila 36  ' ▎✿ waiting for input'   <- primera fila de la superficie
  > fila 37  ' ▎  type, or / for commands'
  > fila 38  ' ▎'                      <- fila de relleno, sí existe abajo
  > ```
  >
  > Hay relleno **abajo** y no hay relleno **arriba**. La causa está en `framePromptLines` (instalado `lib/shell-prompt.ts:240-245`): …
  >
  > **Arreglo pedido:** una fila de relleno **antes** de la fila del hint, en la misma rama (`layout.background`), simétrica a la de abajo …
  >
  > **Antes de escribirlo, contéstame una cosa con evidencia:** quién consume el array que devuelve `framePromptLines`. Si el editor de gentle-pi mapea clics o filas por **índice** (posición del cursor, selección, arrastre), añadir una fila al principio desplaza ese índice y puede romper la interacción aunque el frame se vea bien. …
  >
  > **Lo que me devuelves:**
  > - filas del band antes y después (índice y contenido), con la altura total antes y después: el band debe crecer **exactamente una fila**;
  > - que el ancho pintado de cada fila no cambió ni una columna y que el borde derecho sigue donde estaba;
  > - que las filas del bar, la `▁` y las tarjetas no se movieron;
  > - frame real a 160 y, si puedes, un segundo frame a 100 para descartar que el aire dependa del ancho;
  > - md5 nuevo de `lib/shell-prompt.ts` tras `apply`, siete `patched` en `check`;
  > - test RED primero: una aserción sobre bytes pintados que exija que la primera fila del band no lleve texto, y que la fila del hint no sea la primera — verificado revirtiendo solo la fila nueva.

- **S2.** The band opens with an empty surface row above the hint, in the shared
  `layout.background` branch, symmetric to the closing row.
- **S3.** The geometry comment states that the band opens and closes with an empty surface row.
- **S4.** The editor's mouse rows shift by exactly that row, so a click still lands on the
  line it aimed at; the two edits travel together and a test pins the pairing.
- **S5.** A RED test on painted bytes: band row 0 carries no text and the hint is not row 0.

## Tasks

| ID | Specs | Route | Commit |
| --- | --- | --- | --- |
| T1 | S2, S3 | Pad row in `framePromptLines`, comment updated | one commit |
| T2 | S4 | `y: event.y - 1` in the editor's mouse override, new anchor | same commit |
| T3 | S5 | RED test plus the pairing test | same commit |

## Log

- **L1.** The orchestrator's correction: the reported defect is the top edge, not the left
  rule; the horizontal fix already merged is not to be reverted.
- **L2.** Consumer answer, with evidence. `framePromptLines` has one caller,
  `extensions/gentle-shell.ts:1274`, inside the editor's `render()`.
  `Editor.handleMouse` (pi-tui `dist/components/editor.js:511-514`) treats row 0 as
  non-content and maps `event.y - 1` to a visual line; the autocomplete zone starts at
  `renderedVisibleLineCount + 2`. The frame is `[hint, content 1…N, pad]`, so row 0 is
  ignored and content k sits at row k: adding a row above shifts every content row by one and
  a click lands one line off. Hence S4: the row and the `y` translation are one change.
- **L3.** Measured with the previous patch and with this one, at 160 and at 100 columns: band
  3 → 4 rows, every band row still painted 1..106 at 160, and the right-hand column (bar,
  `▁`, cards) identical row by row.
- **L4.** Digests: `extensions/gentle-shell.ts` `7da141c8…`, `lib/shell-prompt.ts`
  `040c2b8c…`; the previous ones join `md5PatchedV1`.
