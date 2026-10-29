# Hide the header brand under a LOON theme

Fourth destination of the gentle-pi patch: with a theme LOON generated (its name ends
in `" (LOON)"`) the header bar drops `✿ Gentle Shell`, because the header already says
which tool this is. Every other theme keeps the bar exactly as it is today.

## Specs

S1. The bar hides its brand when the active theme's name ends with `" (LOON)"`. The
    name comes from `theme.name`, which pi's `Theme` class exposes even though
    gentle-pi's `ShellBarTheme` does not declare it.
S2. Three paint points, all of them: `:179` (the one-line bar, minimal density),
    `:277` (the header's left stages) and `:412` (the header's last-resort widths).
S3. Fail open: a theme with no name, or a name that is not a string, shows the brand.
S4. No double spaces, no blank rows and no empty `[brand]` stage when the brand is
    hidden; the narrowest stage becomes the bare model id.
S5. With a stock theme the header rows are identical to today. That is the case that
    protects everyone else.
S6. The patch stays inside `scripts/gentle-pi-patch.ts`: one more target with its
    pristine md5, the patched md5, and the same paranoid apply/revert contract.

## Tasks

T1 (S6) Fourth target in the patch script, with md5 and patched md5 — commit `?`
T2 (S1-S4) The three paint points and the shared helper — commit `?`
T3 (S5) Tests: stock stages unchanged, minimal density equivalent, LOON brand hidden
   with no empty stage, missing name fails open — commit `?`
T4 (S5) Real pi captures at 80x32 and 120x32: stock baseline vs patched, and the LOON
   theme — commit `?`
T5 Delivery: issue, branch, PR, merge, report — commit `?`

## Log

L1. "Cuarto destino del parche en `lib/shell-bar.ts`: la marca del header se oculta
    cuando el nombre del tema termina en `" (LOON)"`, usando `theme.name`. Tres puntos:
    `:179` (barra de una línea, densidad minimal), `:277` y `:412`. Falla abierto si el
    nombre no está: marca visible. Sin espacios dobles, sin filas en blanco y sin tramo
    `[brand]` vacío cuando la marca se oculta. Con tema stock las filas del header deben
    quedar idénticas a hoy: eso es el caso que protege a los demás."

## Ampliación: la pista de uso

Con el mismo tema LOON activo, el header deja de anunciar el atajo de uso.

S7. La pista `· alt+u` no se pinta en el header. El atajo sigue registrado
    (`extensions/gentle-shell.ts:1991-1993`): ocultar la pista no es desregistrar.
S8. Sin ventanas de uso (sin datos del proveedor, o cuerpo vacío) el segmento entero
    desaparece: nunca un `usage` huérfano sin gauges.
S9. Con datos, los gauges se pintan como hoy; lo único que se calla es la pista.
    Con tema stock, comportamiento idéntico al de hoy.
S10. Una sola condición de «tema LOON activo» (`loonThemeActive`), compartida por la
    marca y la pista; no dos copias del `endsWith`.

T6 (S7-S9) `usageSegmentText` devuelve `undefined` cuando no hay nada que contar, y
   nunca pinta la pista bajo LOON — commit `?`
T7 (S10) `loonThemeActive()` extraído y usado por `barBrandSegments` y por el uso —
   commit `?`
T8 (S9) Frames reales por combinación de tema y densidad — commit `?`

Una corrección de rumbo: la primera versión quitaba el tramo final `[brand]` para
*todos* los temas, y eso desplazaba la cascada de respaldo — con tema stock y densidad
minimal a 80 columnas el header pasaba de `model` a `~ ⟡ model`. El tramo final se
conserva para todo tema que pueda pintar marca; bajo LOON desaparece porque quedaría
vacío. La densidad minimal vuelve a tomar exactamente la misma lista que antes.

L2 (usuario, verbatim): "tambien que borra del header usage · alt+u".
L3. Interpretación declarada y no silenciosa: ambas reglas son condicionales al tema
    LOON; con tema stock nada cambia. Si el usuario quería la pista fuera siempre,
    se cambia.
