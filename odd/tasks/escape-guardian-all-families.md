# escape-guardian-all-families

Close the last known blind spot of the byte guardian: it must see every escape family, not only SGR.

## Specs

- **S1.** La guardia debe denunciar, en cualquier fila pintada, **cualquier secuencia de escape fuera del conjunto cerrado**, incluidas: OSC terminada en `BEL` (`\u001b]8;;https://example.com\u0007`), OSC terminada en ST (`\u001b]0;title\u001b\\`), designación de charset (`\u001b(B`, `\u001b(0`), y cualquier CSI cuyo byte final no sea `m` (`\u001b[2J`, `\u001b[1;2H`).
- **S2.** El conjunto cerrado no se relaja: siguen permitidos los parámetros SGR que el tema registra más `''` y `'0'`, y además una lista **explícita y nombrada** de secuencias no-SGR permitidas, **hoy vacía**. Añadir una a esa lista tiene que ser una decisión deliberada con su línea, no un efecto colateral.
- **S3.** Un escape **sin terminar** también se denuncia: un `ESC` al final de la fila, o un `ESC ]` sin `BEL` ni `ESC \`. La guardia no puede satisfacerse dejando una secuencia abierta.
- **S4.** El mensaje nombra la secuencia ofensora con `JSON.stringify` (para que un `BEL` se lea `\u0007` y no sea invisible en la salida del test) y un prefijo de la fila donde está.
- **S5.** La prueba demuestra que muerde: cada una de las seis secuencias de S1, más un `ESC` suelto al final, produce **exactamente un** offender, y los renders reales de los tres estilos en los anchos ya cubiertos siguen limpios.
- **S6.** La documentación deja de declarar el alcance viejo: `odd/tasks/byte-guardian-closed-set.md` y cualquier línea de `README.md` que diga que la guardia cubre SGR tienen que decir que cubre **todas las familias de escape**.

## Tasks

| ID | Specs | Route | Commit |
| --- | --- | --- | --- |
| T1 | S1-S5 | inline | one commit |
| T2 | S6 | inline | same commit |

## Log

- **L1.** Orden del orquestador, verbatim:

  > **Orden nueva, una unidad, y es el último punto ciego conocido del proyecto.** El humano pidió cerrarlo.
  >
  > Contexto medido en `19101c4` (tu HEAD, limpio): `tests/card-style-bytes.test.ts:77` `function strayEscapes(rows, allowed)` recorre `/\u001b\[([0-9;]*)m/g` — **sólo SGR**. `bareBackground` (`:41`) sólo busca `[48;2;…m` con el `ESC` perdido. Ninguna de las dos ve una familia de escapes distinta de `ESC [ … m`.
  >
  > **El defecto, en concreto:** un `ESC ] … BEL` (OSC: título de ventana, hipervínculo, portapapeles), un `ESC ( B` / `ESC ( 0` (charset, dibujo de líneas) o un CSI con final distinto de `m` (`ESC [ 2 J`, `ESC [ 1 ; 2 H`) pasan por delante de la guardia **sin que nada se denuncie**. Hoy LOON no emite ninguno, pero una guardia que no ve una familia entera de bytes no cierra el conjunto: es el mismo defecto que arreglamos con `strayEscapes` frente a `bareBackground`, una capa más arriba.
  >
  > **No toques la allow-list para que pase:** si un render real empieza a denunciarse, eso es un hallazgo que quiero ver, no algo que se silencie ampliando la lista.