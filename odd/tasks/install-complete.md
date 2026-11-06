# Instalación completa: parche automático y acoplamientos genéricos

LOON se instala sobre gentle-pi, siempre, y se instala **completo**. Gentle-pi es
requisito, el parche se aplica solo, y no hay variantes: no existe una «recomendada» a
la que le falte algo.

## Specs

S1. Gentle-pi es requisito, no opción. Si no está instalado, LOON no tiene sentido
    instalarlo y la instalación lo dice; no se ofrece una variante sin gentle-pi.
    Verbatim: «este plugin espera tener gentle pi instalado, si no lo tienes no tiene
    sentido instalarlo».

S2. El parche es **estado que se repara solo**, no un paso de instalación. En cada
    arranque LOON comprueba si sus marcadores siguen en los archivos de gentle-pi y, si
    no están, vuelve a aplicar. Un update de gentle-pi o de pi que reemplace esos
    archivos se repara en el siguiente arranque, sin pedir nada. Instalar LOON es el
    consentimiento; no hay un segundo permiso por update.
    Verbatim: «el instalador debe parchar gentle pi automaticamente, poralgo lo estas
    instalando de manera voluntaria» y «lo del parche eso si no deberia ser manual ni
    romperse conn cada update eh, deberia ser automatico, si sale una update de gentle
    pi o de pi actualizamos, luego con mi agente reviso que rompio estas updates y
    cuando lo haga publico update de loon, actualizo el plugin y ya».

S2b. Si los anchors ya no encajan (gentle-pi cambió de forma y hace falta un LOON
     nuevo), se aplica **nada**, se conserva la copia de seguridad y se informa una sola
     vez con el archivo y el motivo exactos. Ese aviso es el que dispara el trabajo de
     publicar una update de LOON. Nunca un parche a medias.

S3. Un solo perfil: completo. Banner, color automático, barras, tema derivado, las filas
    de LOON en `/gentle:customize` (`Banner source`, `Banner color: theme (LOON)`,
    `Banner color: wallpaper (LOON)`, `Mark`), card style LOON y el trabajo inline en el
    panel de Agents. Sin selector, sin archivo de perfil.
    Verbatim: «ningun otro plugin que he creado usa o le pide algo a loon entonces no hay
    problema, me estoy haciendo bolas nomas, que se instale completo».

S4. El acento no está atado a mpvpaper. `loon-tui.json` acepta `accentFile`, una ruta
    absoluta a un archivo de una línea `#RRGGBB`, y `ACCENT_SOURCES` acepta `file`. Sin
    `accentFile`, la fuente `wallpaper` conserva su ruta histórica. Sin fuente `file`
    configurada, nada cambia. Ninguna integración por herramienta (pywal, matugen,
    wallust): una ruta configurable.
    Verbatim: «no todos tienen mi sistema puede que otros usen otro programa no mvpaper
    entonces hay que hacer eso mas generico no, y si alguien quiere cambiarlo lo podra
    cambiar sin problema».

S5. El tema generado no exige que exista un tema llamado `Wallpaper`. Se deriva del
    tema **activo** y se nombra `<nombre del activo> (LOON)`; con `Wallpaper` activo el
    resultado es idéntico al de hoy. Si el tema activo es ya uno de LOON, no se deriva
    de sí mismo.

S6. `scripts/` se publica en el paquete. Hoy no está en `files`, así que la herramienta
    que aplica el parche no existe en el tarball y el parche automático es imposible.

S7. Un parche ausente o fallido nunca impide arrancar y nunca cuesta más de un intento
    por proceso: el banner no depende del parche. Si no se pudo aplicar, se informa una
    vez, con el motivo, y la sesión sigue; el siguiente arranque lo vuelve a intentar.

S8. El router no es un acoplamiento: LOON no lo referencia, y ningún otro plugin de la
    familia llama a LOON ni LOON a ellos. Medido: las únicas importaciones externas son
    `@earendil-works/pi-coding-agent` y `@earendil-works/pi-tui`.

## Tasks

| ID | Specs | Ruta | Commit |
| --- | --- | --- | --- |
| T1 | S6 | inline | `52e4249` |
| T2 | S4 | inline | `52e4249` |
| T3 | S5 | inline | — |
| T4 | S1, S2, S2b, S7 | inline | — |
| T5 | S1-S7 | inline | — |

**Slice boundary.** T1 y T2 cierran el primer slice (`52e4249`, 471 líneas): el parche
viaja en el paquete y el acento deja de ser propiedad privada de mpvpaper. T3-T5 van en
su propio slice, porque el tema derivado y la reconciliación del parche tocan el arranque
y merecen revisión aparte.

## Log

L1. Verbatim, el pedido que abrió esto: «creo que este plugin tiene cosas que a no ser
    que alguien tenga exactamente mi misma configuracion y mis mismos plugins, no le va
    a servir muchas cosas, asi que deberia haber alguna manera de que al instalar te
    salga instalacion recomendada y otro que sea instalacion completa (familia de
    plugins LOON) y eso».

L2. Verbatim: «por ejemplo lo de el accent theme esta bien pero no todos tienen mi
    sistema puede que otros usen otro programa no mvpaper entonces hay que hacer eso
    mas generico no [...] se que por ejemplo hay algunos detalles con los profiles para
    dar compatibilidad a loon-router y esta bien pero el que no tenga ese router que va
    a pasar?».

L3. Verbatim: «el instalador debe parchar gentle pi automaticamente, poralgo lo estas
    instalando de manera voluntaria, ademas se supone que este plugin espera tener
    gentle pi instalado, si no lo tienes no tiene sentido instalarlo». Se retira la idea
    de una variante sin gentle-pi.

L4. Verbatim: «no pues, instalacion recomendada seria instalacion sin la compatibilidad
    con la familia de plugins de loon, solo compatibilidad con gentle pi, el banner, el
    color automatico, las barras, etc».

L5. Verbatim: «claro porque que conexiones tiene este repo con otros plugins de loon?,
    por ejemplo el loon router, u otros». Medido: cero. Las importaciones externas del
    paquete son solo `@earendil-works/pi-coding-agent` y `@earendil-works/pi-tui`; no hay
    una sola referencia a loon-router ni a otro plugin. La única pieza que escribe fuera
    de su espacio es el trabajo inline, que usa el store de tareas de gentle-pi.

L6. Verbatim, cerrando el eje de los perfiles: «ah si ningun otro plugin que he creado
    usa o le pide algo a loon entonces no hay problema, me estoy haciendo bolas nomas,
    que se instale completo». Se retiran los perfiles: una sola instalación (S3).

L7. Medido: `npm pack --dry-run` publica 21 archivos y ninguno es
    `scripts/gentle-pi-patch.ts`; `package.json` `files` no incluye `scripts`. Sin S6 el
    parche automático no puede existir en un paquete instalado.

L8. Medido: pi no tiene gancho de instalación (`dist/core/pi-manifest.js:3` lee solo
    `extensions`, `skills`, `prompts`, `themes`, `changelogPath`). El parche se aplica
    desde el arranque de la primera sesión, donde `missingPatches()` ya vive, no desde un
    `postinstall` que CI y `--ignore-scripts` desactivan en silencio.

L10. Verbatim: «lo del parche eso si no deberia ser manual ni romperse conn cada update
    eh, deberia ser automatico, si sale una update de gentle pi o de pi actualizamos,
    luego con mi agente reviso que rompio estas updates y cuando lo haga publico update
    de loon, actualizo el plugin y ya». El parche deja de ser instalación y pasa a ser
    reconciliación en cada arranque (S2, S2b).

L9. Medido: `extensions/lib/wallpaper-accent.ts:9` fija `~/.config/mpvpaper`,
    `extensions/lib/wallpaper-theme.ts:20` fija `WALLPAPER_THEME_BASE = 'Wallpaper'`, y
    `extensions/lib/loon-config.ts:22` define `ACCENT_SOURCES` sin `file`.
