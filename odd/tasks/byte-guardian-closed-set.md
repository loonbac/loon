# byte-guardian-closed-set

The byte guardian in tests/card-style-bytes.test.ts closes the escape set so hand-written SGRs cannot pass.

## Specs

- **S1.** The orchestrator's authorization, verbatim:
  > **Unidad B — el guardián de bytes crudos solo ve `48/49/0`**
  >
  > Defecto: en `tests/card-style-bytes.test.ts` lo que detecta escapes crudos es `/\[48;2;[0-9;]*m/` (y `[49m`). Un `\u001b[38;2;1;2;3m`, un `\u001b[31m` o un `\u001b[1m` inyectado en una fila pintada **pasa el guardián sin queja**, y el guardián existe justo para demostrar que el color sale del tema y no de un SGR escrito a mano.
  >
  > **Arreglo pedido:**
  > - La aserción deja de enumerar formas conocidas y pasa a **cerrar el conjunto**: parsea todos los `\u001b[...m` de una fila pintada y exige que cada uno pertenezca a lo que el tema puede producir (fondo de superficie `48;2;…`, reset `49`, y los que emita el propio callback del tema en la prueba). Cualquier otro falla e imprime la secuencia ofensora.
  > - **RED primero**, y el rojo tiene que ser del defecto, no del test: una fila con `\u001b[31m` inyectado debe fallar el guardián nuevo y hoy no falla. Verifícalo revirtiendo solo la aserción.
  > - Las aserciones actuales siguen verdes; no las debilites para acomodar el cambio.

## Tasks

| ID | Specs | Route | Commit |
| --- | --- | --- | --- |
| T1 | S1 | Recording theme factory and closed-set strayEscapes helper | one commit |
| T2 | S1 | Closed-set assertion across all card styles in card-style-bytes test | same commit |
| T3 | S1 | Focused test proving bareBackground misses \u001b[31m while strayEscapes catches it | same commit |

## Log

- **L1.** The orchestrator's authorization, verbatim:
  > **Unidad B — el guardián de bytes crudos solo ve `48/49/0`**
  >
  > Defecto: en `tests/card-style-bytes.test.ts` lo que detecta escapes crudos es `/\[48;2;[0-9;]*m/` (y `[49m`). Un `\u001b[38;2;1;2;3m`, un `\u001b[31m` o un `\u001b[1m` inyectado en una fila pintada **pasa el guardián sin queja**, y el guardián existe justo para demostrar que el color sale del tema y no de un SGR escrito a mano.
  >
  > **Arreglo pedido:**
  > - La aserción deja de enumerar formas conocidas y pasa a **cerrar el conjunto**: parsea todos los `\u001b[...m` de una fila pintada y exige que cada uno pertenezca a lo que el tema puede producir (fondo de superficie `48;2;…`, reset `49`, y los que emita el propio callback del tema en la prueba). Cualquier otro falla e imprime la secuencia ofensora.
  > - **RED primero**, y el rojo tiene que ser del defecto, no del test: una fila con `\u001b[31m` inyectado debe fallar el guardián nuevo y hoy no falla. Verifícalo revirtiendo solo la aserción.
  > - Las aserciones actuales siguen verdes; no las debilites para acomodar el cambio.

- **L2.** Why `bareBackground` stays: `bareBackground` detects a fundamentally different defect than `strayEscapes`. It catches a malformed background sequence where the leading `\u001b` (ESC) character was stripped or trimmed (matching `/\[48;2;[0-9;]*m/` without a preceding ESC). The closed-set guardian `strayEscapes` parses valid ANSI escape sequences matching `\u001b\[([0-9;]*)m`. A stripped sequence like `[48;2;61;56;35m` contains no ESC character and thus cannot be detected by `strayEscapes` alone. Both guardians are necessary and complementary.

- **L3.** What the closed set allows and why `1`/`22` are legitimate: `strayEscapes` parses all `\u001b[...m` sequences in a painted row and strictly allows only plain resets (`''` or `'0'`) and the exact SGR parameters emitted by the recording theme's callbacks during rendering. The test's recording theme provides wrapper functions `fg`, `bg`, and `bold` that record their emitted SGR parameters (`38;2;172;168;154`, `39`, `48;2;61;56;35`, `49`, `1`, `22`) into an allowed set. Parameters `1` (bold open) and `22` (bold close) are legitimate because the test's own theme explicitly writes them in `bold: (text: string) => \u001b[1m${text}\u001b[22m`. If the renderer uses the theme's `bold` callback, the parameters are recorded in `allowed` and accepted. If the renderer were to inject an unrecorded hand-written SGR (such as raw `\u001b[31m` or arbitrary raw RGB parameters), the parameter would not be in `allowed` and `strayEscapes` would report the offending sequence along with the row prefix.

- **L4.** RED evidence observed: In the new focused test, injecting `\u001b[31m` into a painted card row results in `bareBackground` returning `[]` (missing the raw color escape entirely). Reverting the assertion to use `bareBackground` produces an AssertionError because `bareBackground` cannot detect `\u001b[31m`. Restoring the assertion to `strayEscapes` passes cleanly as `strayEscapes` catches the unexpected `31` parameter and reports it.
