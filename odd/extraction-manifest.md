# Manifiesto de extracción de LOON

Documento de decisión, no de ejecución. Cada dato está medido sobre `HEAD = 9d51720`
(`git rev-parse HEAD` == `git rev-parse origin/master`), extension/ byte-idéntico a lo
desplegado en `/nix/store/x7bkkga9xwd6gv0fynqwfp6ixcmig7wh-loon-0.1.9/extension`
(`diff -rq` sin diferencias). Ninguna línea de código se ha movido todavía.

---

## 0. Lo que contradice tu encargo

Cinco cosas. Las dos primeras cambian el plan; las demás cambian el orden y el coste.

### 0.1 `gentle-agents.ts` no existe en este repo — `pi-subagents` no tiene fuente aquí

```
$ rg -l 'gentle-agents|gentleAgents' extension/     → 0 coincidencias
$ ls extension/gentle-agents.ts                     → No such file
```

El inventario dice «`gentle-agents.ts` + retorno» (~1.900 líneas) y que ahí vive
`agent_settled`. El fichero no está, no se ha movido y no aparece en `git log`. `agent_settled`
existe en tres sitios reales:

| Fichero:línea | Qué hace | ¿Vivo? |
| --- | --- | --- |
| `extension/antigravity-quota-fallback.ts:934` | cierra la decisión adaptativa y admite el resultado verificado | **sí** |
| `extension/turn-footer.ts:58` | imprime `✻ Worked for Ns` por petición | **no** (módulo no registrado) |
| `extension/spinner.ts:483` | detiene el spinner de trabajo | **no** (módulo no registrado) |

El lanzamiento y retorno de subagentes no vive en LOON: `loon` no registra ningún hook de
subagente, no importa `subagents.json` y no menciona `subagent` en ninguna parte. Ese
comportamiento está en `npm:gentle-pi` y en el host `pi`, que LOON solo decora.

**Consecuencia para el bucle de resultados:** el punto de «trabajo terminado» que necesita
`pi-router-glue` para medir qué modelo hizo bien la tarea **ya está a mano y no requiere
`pi-subagents`**: es `agent_settled` en `antigravity-quota-fallback.ts:934`, que es además
donde ya se empaqueta la evidencia (`VerificationGateTracker` + `RunMetricsTracker`). Lo que
falta no es extraer un paquete: es que el router reciba esa evidencia de forma estable. Eso
se resuelve en `pi-router-glue` (punto 5.3), no creando `pi-subagents`.

Si de verdad quieres `pi-subagents` como paquete propio, su fuente hay que sacarla de
`gentle-pi`, no de este repo. No se puede extraer lo que no está.

### 0.2 El reparto de 4 destinos cubre el 51% de las líneas

`extension/` tiene 15.138 líneas de `.ts` en 46 ficheros. El inventario asigna nombre a 7.757
líneas (51%). Quedan **5.566 líneas de producción sin destino** (37%), más 1.719 de tests.

| Bloque sin asignar | Líneas | Por qué no encaja en ninguno de los 4 |
| --- | --- | --- |
| `tools/builtins.ts` + `diff.ts` + `grouping.ts` + `collapse.ts` | 4.055 | código muerto (ver 0.3) |
| `gentle-header.ts` | 410 | chrome visual **implementado** parcheando internals del host |
| `session-summary.ts` | 226 | chrome visual (banner de salida) |
| `status-line.ts` + `session-format.ts` | 160 | chrome visual |
| `commands.ts` | 69 | fuerza el tema `loon` (visual) y expone E/S de settings (nada) |
| `verified-outcome.ts` | 149 | evidencia del router, consumida solo por cuota |
| `run-metrics.ts` | 104 | **lo consumen dos paquetes** (ver 2.3) |
| `bounded-search.ts` | 54 | ni visual ni cuota ni router ni parche del host |
| `thinking.ts` + `turn-footer.ts` | 181 | código muerto |

### 0.3 Hay 4.896 líneas de código muerto que no se extraen: se borran

No alcanzables desde `extension/index.ts` ni importados por ningún módulo vivo. Lo confirma
`odd/tasks/revert-pi-ui-overrides.md`: «Módulos are left on disk and simply not registered»
(commit `8fd3b9c`).

| Fichero | Líneas |
| --- | --- |
| `tools/builtins.ts` | 1.412 |
| `tools/grouping.ts` | 1.116 |
| `tools/diff.ts` | 1.092 |
| `spinner.ts` | 488 |
| `tools/collapse.ts` | 435 |
| `prompt-editor.ts` | 115 |
| `thinking.ts` | 107 |
| `turn-footer.ts` | 74 |
| `image-layout.ts` | 57 |
| **Total** | **4.896** |

Moverlos a `pi-loon-ui` sería trasladar basura a un repo nuevo y obligar a mantenerla. El
paso 0 del plan los borra, y ese borrado está **autorizado por el dueño** en estos términos:
«Bórralos: git ya es el archivo». Sustituye la decisión registrada en
`odd/tasks/revert-pi-ui-overrides.md` («Deleting them was offered and declined»), que queda
*Superseded*: conservarlos era defendible con un solo repo y deja de serlo al repartir el código
en cuatro.

**Plan B, si esa decisión vuelve a cambiar.** El PR del paso 0 se queda entonces solo con
`a64a8cb` —el script de alcanzabilidad— y pierde el commit de borrado, que repone los nueve
módulos y su test. **No es una alternativa equivalente y no debe presentarse como tal**: deja las
4.896 líneas en disco y en el store. Su única virtud, que conviene no perder de vista, es que *la
mitad valiosa —la invariante de alcanzabilidad— no necesita borrar nada para funcionar*: la
comprobación sigue valiendo con el código muerto presente, y por eso se puede ceder el borrado sin
ceder la red.

Efecto colateral: las dos únicas dependencias de `package.json:29-32` las usa **solo**
`tools/diff.ts` (`from "diff"` en `diff.ts:11`) y `tools/builtins.ts` (shiki). Tras el borrado
quedan **sin uso pero se dejan**: quitarlas exige regenerar `package-lock.json` y el
`npmDepsHash` de `default.nix:11`, y confirmarlo con un build. Es una unidad de trabajo aparte,
no un efecto colateral de esta.

### 0.4 La cadena de carga real no es la que asume el inventario

El inventario dice «se carga desde el store de Nix» y sospecha de un repo `loon-flakes`. Es
cierto en parte, pero la cadena exacta es más larga y pasa por **otro repo**:

```
~/.pi/agent/settings.json  packages[] = "/home/loonbac/.local/share/loon-pi-packages/better-claude-code-ui"
   └─ symlink  → /nix/store/x7bkkga9xwd6gv0fynqwfp6ixcmig7wh-loon-0.1.9
        └─ construido por default.nix (buildNpmPackage, pname="loon", version="0.1.9")
             └─ desde el input de flake  ~/.nixos/flake.nix:47   loon = "github:loonbac/loon"
                  └─ pinneado en          ~/.nixos/flake.lock:179-196
   └─ symlink creado por  ~/.nixos/pkgs/gentle-ai-bootstrap/default.nix:39
```

`loon-flakes` **es** `~/.nixos` (su `flake.nix:2` se describe como «loon-flakes»). No existe
`~/Proyectos/loon-flakes`.

Lo importante: **lo que Pi carga es el repo pusheado, no `~/Proyectos`**. `~/Proyectos` está
idéntico al store solo porque `HEAD == origin/master`. Cualquier cambio local es invisible a
Pi hasta: commit → push → `nix flake update loon` → `nixos-rebuild` → el bootstrap recrea el
symlink. Esto no es un detalle: define el orden de extracción (punto 6) y multiplica por 4 el
cableado fuera de este repo (punto 4.2).

### 0.5 Línea base: 83 pasan, 1 falla (y ya fallaba)

```
$ node --experimental-strip-types --test extension/*.test.ts
ℹ tests 84   ℹ pass 83   ℹ fail 1
✖ natural-adaptive-routing.test.ts:76  «/adaptive model-add ... --dry-run --offline
   reaches the existing router command»
   esperado /MODEL ONBOARDING DRY RUN/, obtenido «provider policy denies fixture/test-model»
```

La suite **depende de un `HOME` real** (`/home/loonbac`): `session-summary.test.ts` compara rutas
`~/...` y `natural-adaptive-routing.test.ts` resuelve `~/Proyectos/gentle-jev-adaptive-routing`. Con
un `HOME` falso no falla: devuelve **otros números**, que se leerían como un delta propio del cambio
que estés midiendo. Toda medición de este plan va con el `HOME` del operador, nunca en un sandbox
limpio con el entorno mínimo.

Ninguna comprobación de este plan puede ser «todos los tests en verde». La comprobación es
**comparación contra esta línea base** (punto 6).

Dos detalles menores pero reales, encontrados de paso:

- **Tres ficheros de producción tienen bytes NUL literales**: `palette.ts:288` (2),
  `banner.ts:299` (1) y `tools/grouping.ts` (1, en el código que el paso 0 borra: offset 3678,
  línea 103, `const GROUP_BREAK = "\x00group-break";`; los otros nueve ficheros que ese paso borra
  no tienen ninguno). Son **separadores intencionados** que se unen con `.join("\x00")`, no
  corrupción, y al moverlos se trasladan tal cual. Quien los «limpie» cambiará **claves de caché en
  silencio**: la `cacheKey` de `palette.ts:288` es `themeName`, NUL, `colorMode`, NUL,
  `wallpaperAccentRevision`, así que sustituir el byte por un separador visible fragmenta la caché
  sin fallar en ningún test de este repo. `grouping.ts` da igual porque se borra; `palette.ts` y
  `banner.ts` sobreviven al paso 0 y viajan en el paso 1. Efecto doble, y el segundo es peor que
  el primero.
  1. `rg`, `grep` y `git diff` los tratan como **binarios** y no muestran su contenido:
     una edición se revisa a ciegas. Al mover hay que usar `rg -a` y `git diff --text`. Ojo con
     el alcance: de los diez ficheros que el paso 0 borra, **solo `grouping.ts`** tiene NUL. Para
     los otros nueve `--text` no hace falta, y sobre ese uno imprime basura en vez de código, así
     que quien intente revisar el borrado entero con `--text` verá un fichero roto que no lo está.
     `palette.ts` y `banner.ts` siguen en el árbol con el mismo problema.
  2. Un fichero binario aporta **cero líneas** al diffstat, y con eso el paso 0 produce tres cifras
     que no son intercambiables: los diez ficheros borrados suman **4.936 líneas** (`wc -l`), sus
     borrados se reportan como **3.820** porque `grouping.ts` no se cuenta, y el total del PR es
     **3.838** (3.820 + 16 de `README.md` + 2 de `revert-pi-ui-overrides.md`). Quien revise por el
     número concluirá que se borraron 1.116 líneas menos de las que se borraron.
- `extension/natural-adaptive-routing.ts:6` importaba `"./fallback-config.js"` con el fichero
  en `.ts`, y no rompía porque era `import type` (se borra al transpilar). **Corregido en el paso
  1** (#6): el tipo pasó al router y el import desapareció. Era justo la clase de import que se
  rompe sola al cambiar de resolvedor o al volverse `import` de valor, y por eso el paso 1 lo
  quitó antes de mover ningún fichero.

### 0.6 Tres comprobaciones que no podían fallar

El aprendizaje más transferible del paso 0 no es el borrado. Es que las tres comprobaciones usadas
allí **no podían fallar**, y por eso se leyeron como aprobadas: *una comprobación que no puede
fallar se lee como aprobada*.

| Comprobación | Por qué no podía fallar | Control negativo que la delata |
| --- | --- | --- |
| `node -e 'await import("./extension/index.ts")'` | En un checkout limpio falla siempre por los peer deps (`@earendil-works/pi-tui`, `pi-coding-agent`), que no se instalan: no distingue un movimiento roto del hueco normal | Romper un import relativo real y comprobar que **también** falla. Si los dos casos son indistinguibles, no mide |
| `rg -c $'\x00'` | Bash no puede poner un byte NUL en `argv`: el patrón colapsa a cadena vacía y casa **todas** las líneas | Contarlo sobre un fichero sin NUL. Devolvió `1116` sobre `grouping.ts`: su total de líneas, leído como éxito |
| `git diff --stat` con un binario | Un fichero binario aporta cero líneas: reporta `0` para un fichero de 1.116 | Sumar `wc -l` de los borrados y compararlo con el total del diffstat. Diferencia distinta de cero ⇒ hay un binario |

Los tres comparten la forma: **el instrumento devuelve un número plausible y nadie lo compara con
nada**. El remedio es el mismo y es el que ya aplica `scripts/check-imports.mjs`: cada comprobación
nueva se prueba en las dos direcciones —una copia rota a propósito debe fallar, y una sana debe
pasar— antes de confiar en ella.

---

## 1. Fichero por fichero, un solo destino

Regla: un fichero, un dueño. Donde sirve a dos, está marcado **AMBIGUO** y explicado, no
elegido en silencio.

### A. `pi-loon-ui` — lo que se queda (personalización: tema y chrome)

| Fichero | Líneas | Razón (una línea) |
| --- | --- | --- |
| `theme/loon.json` | — | el tema en sí |
| `palette.ts` | 466 | roles de color y caché de paleta |
| `banner.ts` | 649 | caja de bienvenida |
| `pi-logo.ts` | 17 | logo ASCII del banner |
| `session-summary.ts` | 226 | banner de salida de sesión |
| `session-format.ts` | 49 | formateo de tokens/duración para banner y status line |
| `status-line.ts` | 111 | línea de estado (chrome) |
| `wallpaper-sync.ts` | 424 | acento derivado del wallpaper → tema |
| `fast-mode-indicator.ts` | 193 | badge visual; **lee** estado de otro paquete, no lo posee |
| `commands.ts` | 69 | activa el tema `loon` al arrancar (`commands.ts:60-68`) |
| `gentle-header.ts` | 410 | **AMBIGUO** — ver abajo |

**AMBIGUO `gentle-header.ts`.** Es chrome (suprimir cabecera y banner del sidebar de Gentle,
formatear tarjetas), pero está implementado parcheando símbolos y nodos internos del host
(`GENTLE_SIDEBAR_STATE`, `LAYOUT_NODE`, `stripGentleHeaderLayoutNode`). Es el único fichero
cuya *responsabilidad* es visual y cuya *técnica* es de `pi-host-patches`. Su único
consumidor es `host-patches.ts:65-73`. Dos salidas honestas:

- **(a) a `pi-loon-ui`** → `pi-host-patches` depende de `pi-loon-ui` (1 arista). Encaja con
  «LOON es chrome».
- **(b) a `pi-host-patches`** → LOON no depende de nadie, y el chrome queda partido en dos
  repos. Encaja con «lo que parchea el host vive junto».

Recomiendo **(a)**: el criterio del dueño es la capacidad, no la técnica, y la capacidad es
«cómo se ve la cabecera». Con (b) LOON deja de ser el dueño de su propia cabecera.

De los 4.896 muertos, 660 están *físicamente* en territorio visual (`spinner.ts`,
`prompt-editor.ts`, `image-layout.ts`) y se borran igual.

### B. `pi-host-patches`

| Fichero | Líneas | Razón |
| --- | --- | --- |
| `host-patches.ts` | 1.736 | envuelve prototipos de exports públicos de `pi` (`AssistantMessageComponent`, `InteractiveMode`, `SessionSelectorComponent`); si se rompe, no degrada: rompe el arranque |

Depende de A (si `gentle-header` va a A) y de C (5 aristas, ver 2.1). **No es independiente
hoy**: la mitad de lo que hace es pintar datos de cuota en el panel de modelos.

### C. `pi-provider-quota`

| Fichero | Líneas | Razón |
| --- | --- | --- |
| `antigravity-quota-fallback.ts` | 1.023 | hooks `before_agent_start`/`agent_settled`: decide y aplica la ruta de fallback |
| `fallback-panel.ts` | 772 | panel interactivo de perfiles de fallback |
| `fallback-config.ts` | 462 | lee/escribe `gentle-fallbacks.json` y reconcilia el store de perfiles de gentle-pi |
| `antigravity-usage.ts` | 341 | sondeo de cuota Antigravity |
| `commandcode-usage.ts` | 347 | sondeo de cuota CommandCode |
| `opencode-go-usage.ts` | 202 | sondeo de cuota OpenCode-Go |
| `codex-usage-cache.ts` | 89 | caché en disco del % semanal de Codex |
| `fallback-defaults.json` | — | defaults que `fallback-config.ts:87` carga desde `import.meta.url` |
| **Total** | **3.236** | |

### D. `pi-router-glue`

| Fichero | Líneas | Razón |
| --- | --- | --- |
| `natural-adaptive-routing.ts` | 376 | habla con el binario de `gentle-jev-adaptive-routing`; no enruta por su cuenta |
| `repository-language.ts` | 158 | detecta el idioma del work unit; solo lo usa el router (`natural-adaptive-routing.ts:7`) |

### E. AMBIGUO — sirven a dos destinos, decide tú

| Fichero | Líneas | Sirve a | Por qué es ambiguo |
| --- | --- | --- | --- |
| `run-metrics.ts` | 104 | C **y** D | `RunMetricsTracker` (valor) lo usa cuota (`antigravity-quota-fallback.ts:31`); `RunMetrics` (tipo) lo usa el router (`natural-adaptive-routing.ts:8`). Mide «qué costó un work unit»: no es cuota, es la evidencia que el router aprende |
| `verified-outcome.ts` | 149 | C **y** D | Solo lo importa cuota (`antigravity-quota-fallback.ts:30`), pero su docstring dice literalmente que existe para que el router pueda admitir un outcome verificado. Misma naturaleza que `run-metrics.ts` |
| `bounded-search.ts` | 54 | **ninguno** | Enseña al agente a no buscar desde `/` y bloquea la búsqueda global en `tool_call`. No es visual, ni cuota, ni router, ni parche de prototipo |

**Mi recomendación, una sola:** `run-metrics.ts` y `verified-outcome.ts` van **con el router**
(D), porque son el contrato de evidencia que D publica y C consume; y `bounded-search.ts` va a
**su propio paquete** (`pi-bounded-search`, 54 líneas) o se queda en LOON hasta que exista una
razón. Meterlos en un `shared/` es justo lo que el manifiesto prohíbe.

Esto no es cosmética: es lo que rompe el ciclo del punto 2.3.

### F. Sin destino: se borran (ver 0.3)

`tools/builtins.ts` (1.412), `tools/grouping.ts` (1.116), `tools/diff.ts` (1.092),
`spinner.ts` (488), `tools/collapse.ts` (435), `prompt-editor.ts` (115), `thinking.ts` (107),
`turn-footer.ts` (74), `image-layout.ts` (57).

### G. Tests: cada uno sigue a su fuente

| Test | Líneas | Va con |
| --- | --- | --- |
| `antigravity-quota-fallback.test.ts` | 599 | C |
| `gentle-header-suppression.test.ts` | 307 | A (si `gentle-header` va a A) |
| `verified-outcome.test.ts` | 176 | D (recomendado) |
| `natural-adaptive-routing.test.ts` | 133 | D |
| `run-metrics.test.ts` | 119 | D (recomendado) |
| `repository-language.test.ts` | 84 | D |
| `session-summary.test.ts` | 84 | A |
| `wallpaper-sync.test.ts` | 83 | A |
| `bounded-search.test.ts` | 52 | paquete propio |
| `image-layout.test.ts` | 40 | **se borra** con su fuente |
| `antigravity-usage.test.ts` | 29 | C |
| `loon-identity.test.ts` | 13 | A |

### Reparto final

| Destino | Ficheros prod | Líneas | Tests |
| --- | --- | --- | --- |
| `pi-loon-ui` (queda) | 10 + theme | **2.614** | 484 |
| `pi-host-patches` | 1 | **1.736** | 0 |
| `pi-provider-quota` | 7 + json | **3.236** | 628 |
| `pi-router-glue` | 2 | **534** | 217 |
| evidencia (recomendado a D) | 2 | **253** | 295 |
| `pi-bounded-search` (o LOON) | 1 | **54** | 52 |
| borrar | 9 | **4.896** | 40 |
| `index.ts` + tests restantes | — | 96 + 1.719 | — |
| **Total** | **46** | **15.138** | 1.719 |

---

## 2. Imports que cruzarían las fronteras

Formato `fichero -> símbolo <- fichero`. Todos medidos sobre el grafo de imports relativos
resuelto a disco.

### 2.1 `pi-host-patches` → `pi-provider-quota` — **5 sentencias**

| Fichero | Símbolo | ← Fichero | Usado en |
| --- | --- | --- | --- |
| `host-patches.ts` | `antigravityUsageSnapshot`, `AntigravityUsageSnapshot` | `antigravity-usage.ts` | `host-patches.ts:1165` |
| `host-patches.ts` | `openCodeGoUsageSnapshot`, `OpenCodeGoUsageSnapshot` | `opencode-go-usage.ts` | `host-patches.ts:1163` |
| `host-patches.ts` | `commandCodeUsageSnapshot`, `CommandCodeUsageSnapshot` | `commandcode-usage.ts` | `host-patches.ts:1164` |
| `host-patches.ts` | `codexUsageSnapshot`, `observeCodexUsage` | `codex-usage-cache.ts` | `host-patches.ts:1159-1160` |
| `host-patches.ts` | `installFallbackPanelBehavior` | `fallback-panel.ts` | `host-patches.ts:756` |

Los cuatro primeros tienen **la misma forma**: `host-patches` pide el snapshot y lo convierte
en un medidor (`antigravityUsageMeter(...)`, etc.) para pintarlo dentro del panel de modelos.
`observeCodexUsage` es la dirección inversa: `host-patches:1159` **escribe** el estado que
`codex-usage-cache` guarda y luego vuelve a leer en `:1160`. Un productor en un paquete, el
almacén en otro y el consumidor en el primero: ciclo en memoria.

**Esta es la prueba de que el corte `host-patches` / `quota` está mal planteado si se hace
tal cual.** No son dos capacidades: `host-patches` es el *punto de pintado* de quota. El
arreglo no es mover ficheros, es cambiar la interfaz: quota expone **una** llamada
`renderQuotaMeters()` (o un registro de medidores) y `host-patches` la invoca una vez. Las 5
aristas pasan a 1, y desaparece el ciclo en memoria. El patrón ya existe en el código:
`installFallbackPanelBehavior(component, tui)` (`host-patches.ts:756`) es exactamente esa
forma, un callback que quota instala en el componente del host.

### 2.2 `pi-host-patches` → `pi-loon-ui` — **1 sentencia**

| Fichero | Símbolo | ← Fichero |
| --- | --- | --- |
| `host-patches.ts` | `formatGentleSidebarCards`, `parseCardRow`, `stripGentleCardBackgrounds`, `stripGentleHeaderLayoutNode`, `suppressGentleBelowInputWidget`, `suppressGentleHeader`, `withoutGentleSidebarBanner` (7) | `gentle-header.ts:65-73` |

### 2.3 `pi-provider-quota` ↔ `pi-router-glue` — **2 sentencias, y son un ciclo**

| Fichero | Símbolo | ← Fichero |
| --- | --- | --- |
| `antigravity-quota-fallback.ts` | `callNaturalRouter`, `adaptiveRecoveryRouteAllowed`, `legacyFallbackMayPreempt`, `prepareAdaptiveApplication`, `onboardedRouteAllowed`, `recordAdaptiveFailure`, `recordAdaptiveInvariant`, `recordObservedRoute`, `recordVerifiedOutcome`, `registerAdaptiveCommands`, `resolveAdaptivePrimary`, `validAdaptiveDecision`, `AdaptiveDecision`, `AdaptiveRoute` (**14**) | `natural-adaptive-routing.ts:10-29` |
| `natural-adaptive-routing.ts` | `FallbackEffort` (**1**, solo tipo, y desde `"./fallback-config.js"` que no existe) | `fallback-config.ts:6` |

Y el tercero, que no es un import pero es la misma frontera:

| Fichero | Símbolo | ← Fichero |
| --- | --- | --- |
| `antigravity-quota-fallback.ts` | `RunMetricsTracker` (valor) | `run-metrics.ts:31` |
| `natural-adaptive-routing.ts` | `RunMetrics` (tipo) | `run-metrics.ts:8` |

**Ciclo confirmado.** C depende de D con 14 símbolos; D depende de C con 1 tipo. Ningún orden
de extracción resuelve un ciclo sin romperlo primero. Se rompe **moviendo `FallbackEffort` al
vocabulario del router** (es el tipo de `AdaptiveRoute.requestedEffort` /
`effectiveEffort`, definido en `natural-adaptive-routing.ts:11`; el router ya es su dueño de
hecho y solo lo importa de vuelta por herencia histórica). Con eso queda **D ← C**, una sola
dirección.

**Hecho en el paso 1** (PR #6, `11bffaf`): `FallbackEffort` vive en `natural-adaptive-routing.ts` y
`fallback-config.ts` lo reexporta como tipo. El router no importa del config ni lo alcanza por
ningún camino intermedio; `check-imports.mjs` pasa de 1 desajuste `.js/.ts` a 0, con los mismos 24
módulos alcanzables y la suite en 79/78/1.

### 2.4 Aristas internas que **no** cruzan (y deben quedarse dentro)

| De | A | Sentencias |
| --- | --- | --- |
| `antigravity-quota-fallback.ts` | `antigravity-usage.ts`, `fallback-config.ts`, `verified-outcome.ts`, `run-metrics.ts` | 4 |
| `fallback-panel.ts` | `fallback-config.ts` | 1 |
| `banner.ts` | `palette.ts`, `pi-logo.ts`, `status-line.ts` | 3 |
| `session-summary.ts` | `session-format.ts`, `pi-logo.ts` | 2 |
| `status-line.ts` | `session-format.ts` | 1 |
| `wallpaper-sync.ts` | `palette.ts` | 1 |
| `natural-adaptive-routing.ts` | `repository-language.ts` | 1 |

### 2.5 `index.ts` — raíz de composición

`index.ts` importa **14 módulos** que pertenecen a los 4 destinos. Eso es correcto y esperado:
es el punto de composición. Lo que no es correcto es que siga siendo la raíz de composición
después de la extracción, porque cada paquete se carga solo (`pi.extensions`). Ver punto 3.

### 2.6 Veredicto sobre el corte

**No está mal, pero no está listo.** El recuento es **11 sentencias cruzadas** (48 símbolos),
que es un número sano —no es «imports por todas partes»— con dos defectos estructurales:

1. **`host-patches` es el hub**: 6 de 11 aristas salen de él. No es una capacidad
   independiente; es el renderizador de quota + chrome. Extraerlo primero arrastra C y A.
2. **Hay un ciclo C ↔ D** que ningún orden de extracción arregla.

Con los dos arreglos propuestos (interfaz única de medidores; `FallbackEffort` al router) el
reparto queda en **7 sentencias, una sola dirección**: `host-patches → {quota, loon-ui}`,
`quota → router-glue`. Eso sí es una partición válida.

Si decides no hacer los dos arreglos, el reparto funciona igual pero arrastras un ciclo entre
dos repos privados, que es deuda que se paga en cada bump de versión.

---

## 3. Qué cambia en `extension/index.ts`

Hoy `index.ts` es el arranque de las cuatro capacidades. Después solo debe arrancar LOON.

### 3.1 Imports

| Línea | Acción | Destino del símbolo |
| --- | --- | --- |
| `17` | **quitar** `installHostPatches` | → `pi-host-patches` |
| `18` | queda `registerSessionSummary` | LOON |
| `19` | queda `registerBanner`, `ccAccent` | LOON |
| `20` | queda `registerStatusLine` | LOON |
| `21` | queda `registerCommands` | LOON |
| `22` | queda `FastModeIndicator`, `FastModeIndicatorUi` | LOON |
| `23` | queda `WallpaperAccentSync`, `WallpaperThemeUi` | LOON |
| `24-27` | **quitar** los 4 `registerXUsage` | → `pi-provider-quota` |
| `28` | **quitar** `ensureFallbackConfig` | → `pi-provider-quota` |
| `29` | **quitar** `antigravityQuotaFallback` | → `pi-provider-quota` |
| `30` | **quitar** `registerBoundedSearch` | → paquete propio (o se queda) |

### 3.2 Cuerpo del default export

| Línea | Código actual | Acción |
| --- | --- | --- |
| `55` | `registerBoundedSearch(pi)` | **quitar** |
| `58` | `ensureFallbackConfig()` | **quitar** |
| `63` | `await antigravityQuotaFallback(pi)` | **quitar** |
| `64-65` | comentario + `installHostPatches()` | **quitar** |
| `66-69` | `registerAntigravityUsage` / `CommandCodeUsage` / `OpenCodeGoUsage` / `CodexUsageCache` | **quitar** |
| `72` | `registerSessionSummary(pi, { accentFromTheme: ccAccent })` | queda |
| `73` | `registerBanner(pi)` | queda |
| `74` | `if (shouldRegisterStandaloneStatusLine()) registerStatusLine(pi)` | queda |
| `77` | `registerCommands(pi)` | queda |
| `80-81` | `WallpaperAccentSync` + `FastModeIndicator` | quedan |
| `82-95` | handlers `session_start` / `session_shutdown` | quedan |

### 3.3 Lo que se rompe al partir, y no se ve en un diff

**El orden de registro se pierde.** Hoy el orden está garantizado por el orden de llamadas:

- `index.ts:64` dice literalmente «Host patches … **before any render**» y `installHostPatches()`
  va después de `antigravityQuotaFallback(pi)` (`:63`) y de los cuatro `registerXUsage`
  (`:66-69`). Al vivir en paquetes distintos, ese orden pasa a depender del orden del array
  `packages` en `~/.pi/agent/settings.json`, que nadie verifica.
- `ensureFallbackConfig()` (`:58`) queda antes de `antigravityQuotaFallback(pi)` (`:63`)
  **porque están en el mismo paquete**. Si los separas, se rompe.

**El comentario de cabecera (`index.ts:1-12`) ya es falso**: dice que chat, tools, thinking y
prompt editor usan las implementaciones nativas de Pi y que `host-patches` envuelve prototipos.
Ambas cosas dejan este fichero. Hay que reescribirlo, no ajustarlo.

**`shouldRegisterStandaloneStatusLine()` (`index.ts:33-50`)** lee `~/.pi/agent/settings.json`
y se salta el footer si el array `packages` contiene `pi-statusline`, `gentle-pi` o una entrada
que empiece por `npm:gentle-pi` (`index.ts:41-46`).
Es un contrato entre paquetes que *no* es de estado, sino de detección. Se queda en LOON, pero
es el patrón exacto que hay que reutilizar para el punto 6 (evitar doble registro durante la
transición).

`index.ts` pasa de 96 a ~45 líneas.

---

## 4. Todo lo que hay que tocar fuera de `extension/`

### 4.1 En este repo

| Fichero:línea | Qué hay | Qué cambia |
| --- | --- | --- |
| `package.json:22-27` | `files: ["extension","theme","README.md","LICENSE"]` | se mantiene; `extension/` sigue existiendo (solo visual). **Verificar tras cada extracción**: un fichero que falte aquí no llega al store y Pi falla al cargar |
| `package.json:31-35` | `pi.extensions: ["./extension/index.ts"]` | se mantiene |
| `package.json:36-38` | `pi.themes: ["./theme"]` | se mantiene |
| `package.json:29-32` | `dependencies: { "@shikijs/cli": "^4.0.2", "diff": "^9.0.0" }` | **borrar las dos**: solo las usan `tools/diff.ts` y `tools/builtins.ts` (muertos) |
| `package.json:2-9` | `name/displayName/description/keywords` = «LOON Offers Only Nuanced-gentle» + `claude-code`,`tui` | describir la capacidad real (identidad visual), no el acrónimo |
| `package.json:10-14` | `repository.url = github.com/loonbac/loon` | decide visibilidad: si LOON pasa a `pi-loon-ui`, este repo se renombra o se abandona |
| `package.json:5` / `default.nix:6` | `version: "0.1.9"` duplicada | cada bump hay que hacerlo **en dos sitios**; hoy están sincronizados por disciplina |
| `default.nix:1-5` | `pname = "loon"`, `version` | renombrar si el paquete cambia de nombre |
| `default.nix:11` | `npmDepsHash = "sha256-U6jzMGj…"` | **cambia** al borrar las 2 dependencias; hay que recalcularlo |
| `default.nix:12-13` | `npmInstallFlags = ["--ignore-scripts" "--legacy-peer-deps"]` | `--legacy-peer-deps` es la razón de que `@earendil-works/*` **no** esté en `node_modules` del store (verificado: no existe) |
| `default.nix:18-22` | `cp -r extension theme node_modules package.json README.md LICENSE "$out/"` | **lista blanca explícita**. Cualquier directorio nuevo (p. ej. `agents/`) que no se añada aquí **desaparece del store en silencio** |
| `flake.nix:2` | `description` | actualizar |
| `flake.nix:20-28` | devShell: solo `nodejs` + `nodePackages.typescript` | el comentario `:21-23` afirma que el shell trae «the pi packages this extension builds against». **Es falso**: no están. Los tests pasan porque solo usan `node:test` y las rutas relativas; los `import type` de `@earendil-works/*` se borran al transpilar |
| `flake.lock` | — | sin cambios salvo que cambien inputs |
| `README.md` | describe las 4 capacidades | reescribir al alcance visual |
| `odd/tasks/revert-pi-ui-overrides.md` | explica por qué existen los módulos muertos | actualizar cuando se borren (paso 0) |
| `.gitignore` | correcto | sin cambios |
| `.github/` | **no existe** | no hay CI. La «comprobación única» del punto 6 se ejecuta a mano, y no hay nada que rompa |

### 4.2 Fuera de este repo — el cableado que multiplica

Cada paquete nuevo necesita **5 puntos** de alta, y si falta uno **no se carga y nada avisa**:

| Punto | Fichero:línea | Qué se añade |
| --- | --- | --- |
| 1. Input de flake | `~/.nixos/flake.nix:4-70` | `piProviderQuota.url = "github:loonbac/pi-provider-quota"` |
| 2. Derivación | `~/.nixos/flake.nix:92` | `piProviderQuota = piProviderQuota.packages.${system}.default;` |
| 3. Exposición | `~/.nixos/flake.nix:261` | entrada en `packages.*` (hoy `better-claude-code-ui = betterClaudeCodeUi;`) |
| 4. Symlink + bootstrap | `~/.nixos/pkgs/gentle-ai-bootstrap/default.nix:39-51` | ruta `@HOME@/.local/share/loon-pi-packages/<nuevo>` en el array de directorios |
| 5. Carga | `~/.pi/agent/settings.json` → `packages[]` | `"/home/loonbac/.local/share/loon-pi-packages/<nuevo>"` |

Los puntos 1-3 son la razón de que el inventario sospeche de `loon-flakes`. Confirmado:
`loon-flakes` = `~/.nixos`, y el input vive en `flake.nix:47` con el pin en
`flake.lock:179-196`.

Más los que ya existen y hay que mantener coherentes: `~/.nixos/flake.nix:188` (`specialArgs
loon = betterClaudeCodeUi`) y `~/.nixos/flake.lock`. Cuatro paquetes nuevos = **20 puntos de
alta** más 4 `nix flake update` más 4 rebuilds. Es el coste real de «cada uno en su repo
privado»; la decisión es tuya y no la reabro, pero el plan de ejecución tiene que asumirlo:
no es un fin de semana de mover ficheros, es un fin de semana de cablear Nix.

---

### 4.3 Checklist de cableado, uno por paquete

Cinco puntos por paquete. Si falta uno, el paquete **no se carga y nada avisa**: ni un error, ni
un warning, ni un test. Por eso va escrito y se marca entero o no se marca.

| # | Punto | `pi-bounded-search` | `pi-router-glue` | `pi-provider-quota` | `pi-host-patches` |
| --- | --- | --- | --- | --- | --- |
| 1 | input de flake en `~/.nixos/flake.nix` | `github:loonbac/pi-bounded-search` | `github:loonbac/pi-router-glue` | `github:loonbac/pi-provider-quota` | `github:loonbac/pi-host-patches` |
| 2 | derivación en `~/.nixos/flake.nix:92` | `<input>.packages.${system}.default` + `inputs.<input>.inputs.nixpkgs.follows = "nixpkgs";` | ídem | ídem | ídem |
| 3 | exposición en `~/.nixos/flake.nix:261` | una entrada en `packages.*` | ídem | ídem | ídem |
| 4 | symlink en `~/.nixos/pkgs/gentle-ai-bootstrap/default.nix:39-51` | `@HOME@/.local/share/loon-pi-packages/pi-bounded-search` | ídem | ídem | ídem |
| 5 | carga en `~/.pi/agent/settings.json` | ruta absoluta del symlink dentro de `packages[]` | ídem | ídem | ídem |

Más `nix flake update <input>` por paquete después del primer push, y el rebuild es tuyo.

**El orden de `packages[]` no es cosmético.** `index.ts:58-69` hoy garantiza, por orden de
llamada, que `ensureFallbackConfig()` corre antes de `antigravityQuotaFallback(pi)` y que los
`registerXUsage` corren antes de `installHostPatches()` (`before any render`). Al repartirlos en
paquetes ese orden pasa a depender de la posición en el array:

```text
pi-router-glue  →  pi-provider-quota  →  pi-host-patches  →  pi-bounded-search
```

**La prueba de que carga no es el fichero `settings.json`, que solo declara la intención.** Es arrancar
Pi y contar paquetes cargados en la lista de la extensión, y en el caso de `pi-host-patches`, ver que
el rail y el panel de modelos siguen pintados. Un paquete mal cableado produce una sesión que
arranca bien y simplemente se comporta como si no existiera.

---

## 5. Contratos de estado en tiempo de ejecución

Ficheros que un paquete escribe y otro lee. Son interfaces: si cambian, cambia más de un repo.

| # | Ruta | Escribe | Lee | Estado |
| --- | --- | --- | --- | --- |
| 5.1 | `~/.pi/agent/settings.json` | `commands.ts:39-54` (LOON) | `index.ts:35-49` (LOON), `commands.ts:22` (LOON), **Pi** (carga de paquetes) | **contrato con el host**: LOON escribe la misma lista que decide qué se carga |
| 5.2 | `~/.pi/agent/state/natural-adaptive-routing/model-catalog.json` | binario externo `gentle-jev-adaptive-routing` | `natural-adaptive-routing.ts:70` | **entrante**: el contrato lo define el binario, no el JS |
| 5.3 | `~/.pi/agent/state/natural-adaptive-routing/observation-failures.jsonl` | `antigravity-quota-fallback.ts:494` (quota) | nadie en JS; lo lee una persona | **la ruta la calculan los dos paquetes por separado**: `natural-adaptive-routing.ts:69` y `antigravity-quota-fallback.ts:473-476` duplican el `join(homedir(), ".pi","agent","state","natural-adaptive-routing")` y el override `NATURAL_ROUTER_STATE_DIR`. Al separar en dos repos, esto **diverge** en cuanto uno cambie. Debe ser una función pública de `pi-router-glue` |
| 5.4 | `~/.pi/gentle-ai` (o `$GENTLE_PI_CONFIG_HOME`) | **`npm:gentle-pi`** (dueño externo) | `natural-adaptive-routing.ts:197` (`hasExplicitGentleProfilePin`), `fallback-config.ts:126` | **entrante, ajeno**: dos paquetes leen el store de perfiles de un tercero. Declararlo en los dos `AGENTS.md` |
| 5.5 | `~/.pi/agent/gentle-fallbacks.json` | `fallback-config.ts:112-113` (atómico `tmp`+`rename`) | `fallback-config.ts:87`, `antigravity-quota-fallback.ts:608` | interno de quota, pero **`fallback-config.ts` reconcilia el store de `gentle-pi`**, así que el formato es un contrato con un paquete ajeno |
| 5.6 | `~/.pi/agent/state/loon-codex-weekly-usage.json` | `codex-usage-cache.ts:52-53` (modo `0600`) | `codex-usage-cache.ts:21` | almacén en quota, pero el **productor** es `observeCodexUsage()` llamado desde `host-patches.ts:1159`: contrato en memoria entre dos paquetes (5.7) |
| 5.7 | *(en memoria)* `observeCodexUsage` → `codexUsageSnapshot` | `host-patches.ts:1159` | `host-patches.ts:1160` | **ciclo productor/consumidor con el almacén en otro paquete**. Se resuelve con la interfaz única de medidores (2.1) |
| 5.8 | `~/.pi/agent/state/pi-gpt-fast-mode.json` | **`pi-gpt-fast-mode-shared`** (externo) | `fast-mode-indicator.ts:42` | **entrante**: LOON solo pinta; el fallback en `settings.json` está replicado en `fast-mode-indicator.ts:44-57` y debe seguir igual |
| 5.9 | `~/.config/mpvpaper/accent.txt` | servicio de NixOS (`~/.nixos/modules/system/packages.nix:152`, «Acento dinámico») | `wallpaper-sync.ts:86` | **entrante**: si el servicio cambia de ruta, LOON se queda sin acento y no falla |
| 5.10 | `~/.commandcode/auth.json`, `~/.pi/agent/auth.json`, `~/.omp/agent/auth.json` | terceros | `commandcode-usage.ts:198-200` | **solo lectura de credenciales**. Al pasar a repo privado esto deja de ser un riesgo de publicación, pero sigue siendo la razón por la que `pi-provider-quota` **nace privado** |
| 5.11 | *(namespace de UI)* `loon-natural-adaptive-route` | `natural-adaptive-routing.ts:59` (`ADAPTIVE_STATUS_KEY`) | footer de Pi / `status-line.ts` cuando `shouldRegisterStandaloneStatusLine()` devuelve `true` | **contrato de nombre**: renombrar LOON no debe renombrar esta clave sin tocar el consumidor, o el footer pierde la ruta aplicada |

**La regla que sale de aquí:** 5.3, 5.4, 5.5 y 5.8 son contratos que hoy funcionan *porque
todo vive en el mismo proceso y el mismo repo*. Al partirlos hay que declararlos explícitamente
en los `AGENTS.md` y, en el caso de 5.3, dejar de duplicar la resolución de ruta.

---

## 6. Orden de extracción

### El invariante que manda

El repo se carga desde el store, y el store se construye desde el **repo pusheado**
(punto 0.4). Por tanto **un movimiento de una sola vez siempre deja un hueco**: entre el commit
que quita la capacidad de LOON y el rebuild que la entrega desde el paquete nuevo, la
capacidad no existe en la máquina. Ese hueco es exactamente el fallo que hay que evitar.

Por eso cada capacidad se hace en **dos ciclos** (expandir, luego contraer), y en el ciclo
intermedio **ambos paquetes están cargados**. Para que eso no duplique hooks ni comandos, se
usa el patrón que ya existe en el código: `shouldRegisterStandaloneStatusLine()`
(`index.ts:33-50`) se desactiva cuando detecta al otro dueño. Cada paquete que sale lleva su
equivalente: `shouldSkipBecause("pi-provider-quota" in packages)`.

### La comprobación única

Una sola, la misma en cada paso:

```bash
cd ~/Proyectos/better-claude-code-ui-loon \
  && node scripts/check-imports.mjs extension \
  && node --experimental-strip-types --test extension/*.test.ts 2>&1 | grep -E '^ℹ (tests|pass|fail)'
```

`scripts/check-imports.mjs` llega con el paso 0 y verifica las dos cosas que un movimiento
rompe: que **todo import relativo resuelve**, recorriendo subdirectorios, y que **todo módulo de
producción es alcanzable** desde `extension/index.ts`. La segunda es la invariante que
faltaba: su ausencia es cómo se acumularon 4.896 líneas muertas sin que nadie lo notara.

**La comprobación que este documento proponía antes —`node -e 'await import("./extension/index.ts")'`—
no funciona y queda retirada.** `host-patches.ts`, `status-line.ts:9` y `fallback-panel.ts:1`
hacen imports de **valor** de `@earendil-works/pi-tui` y `@earendil-works/pi-coding-agent`, que
un checkout limpio no instala: el `import()` falla sobre código sin tocar y no distingue un
movimiento roto del hueco normal de peer dependencies. Verificado sobre `9d51720` sin cambios.

- El recuento de tests se compara contra la línea base del punto 0.5: **84 / 83 / 1**. Vale
  `tests` menor solo si el test que desaparece es de código borrado (paso 0), y `fail` debe
  ser **1** con el mismo `natural-adaptive-routing.test.ts:76`.
- El chequeo avisa además de los siete especificadores `.js` que nombran ficheros `.ts`
  (`natural-adaptive-routing.ts:6` y los seis de `tools/`). Hoy los borra el type stripper;
  dejan de ser inofensivos en cuanto el import pase a ser de valor.
- Contra el store: `node scripts/check-imports.mjs <ruta-absoluta>/extension` no necesita
  dependencias y sirve igual. Para la carga real hay que arrancar Pi y contar paquetes.

### Los pasos

| # | Paso | Contenido | Por qué en este orden | Comprobación |
| --- | --- | --- | --- | --- |
| **0** | **Borrar el código muerto** — *hecho, PR abierto* | 9 ficheros / 4.896 líneas (punto 0.3) + `image-layout.test.ts` + actualizar `odd/tasks/revert-pi-ui-overrides.md` y `README.md`. Retirar `@shikijs/cli` y `diff` queda como unidad aparte: exige regenerar `package-lock.json` y `npmDepsHash`, y eso no se puede confirmar sin build | No mueve nada entre repos y reduce el árbol un 32%. Hace que los diffs siguientes sean revisables. Si algo se rompe aquí, se rompe en un sitio con tests | Medido: check **0 unresolved / 0 unreachable** (antes 9 unreachable), tests **79 / 78 / 1**. La estimación previa de 83 era mía y estaba mal: `image-layout.test.ts` tenía 5 tests, no 1. Sin rebuild ni comprobación visual: los módulos no estaban registrados |
| **1** | **Romper el ciclo C↔D** | Mover `FallbackEffort` al vocabulario de `natural-adaptive-routing.ts` y arreglar el `"./fallback-config.js"` de `:6`; decidir el destino de `run-metrics.ts` / `verified-outcome.ts` (recomendado: con el router) | Aún no se mueve ningún fichero de repo. Es el arreglo estructural sin el cual la extracción arrastra un ciclo entre dos repos privados | check ok; tests **83/1** |
| **2** | **Interfaz única de medidores en quota** | Colapsar las 5 aristas de 2.1 a una: `renderQuotaMeters()` (o registro) llamada desde `host-patches.ts:1159-1165`; quitar el ciclo en memoria de `observeCodexUsage` | Sigue sin mover ficheros. Es lo que hace que `pi-host-patches` sea extraíble como capacidad y no como hub | check ok; `antigravity-quota-fallback.test.ts` (599 líneas) cubre la ruta y el panel; verificación visual del panel de modelos en Pi |
| **3** | **Extraer `pi-bounded-search`** (54 líneas) o dejarlo | El paquete más pequeño que existe: valida el **patrón de cableado** completo (5 puntos de 4.2 + 2 ciclos) con el menor riesgo posible | Si el patrón falla, falla con 54 líneas y no con 3.236. Si funciona, los pasos 4-6 son repetición | check ok; tests **83/1**; `pi` arranca y `settings.json` tiene 20 entradas; la búsqueda global sigue bloqueada |
| **4** | **Extraer `pi-router-glue`** (2 ficheros, 534 líneas, + evidencia 253) | Depende solo de `repository-language` y del binario externo. No depende de C, A ni B | Es el paquete del que depende la cuota, así que va antes que ella. Además desbloquea el bucle de resultados (0.1) sin necesidad de `pi-subagents` | Ciclo expansión/contracción: paquete cargado y funcionando → quitar de LOON → tests **83/1**; `/adaptive` responde y el router sigue registrando observaciones |
| **5** | **Extraer `pi-provider-quota`** (7 ficheros, 3.236 líneas) | El bloque más grande y el que ya tiene la interfaz arreglada en el paso 2 | Va después del router porque **depende de él** con 14 símbolos | Ciclo expansión/contracción; `antigravity-quota-fallback.test.ts` completo; verificar que el fallback actúa en una sesión real (agotar cuota es difícil: usar el fixture offline del test) |
| **6** | **Extraer `pi-host-patches`** (1 fichero, 1.736 líneas) | Después de quota, porque depende de su interfaz de medidores y de `gentle-header` | Es lo más frágil: si se rompe, Pi **no arranca**. Se hace cuando ya no queda nada pendiente que pueda confundir el diagnóstico | Ciclo expansión/contracción; **arranque de Pi** (no solo tests) más verificación visual de: filas fantasma, residuo de `ctrl+o`, rail de Gentle, panel de modelos |
| **7** | **LOON queda como identidad visual** | Renombrar a `pi-loon-ui` si se decide, reescribir `README.md` y el comentario `index.ts:1-12` | Es el residuo, no una extracción | check ok; tests **83/1**; verificación visual: tema, banner de entrada, banner de salida, status line, acento del wallpaper, badge de fast-mode |
| **8** | **Repuntar `settings.json`** | Paso aparte y deliberado, como pediste | No es efecto secundario de nada | Arrancar Pi y **contar paquetes cargados** (el fichero no prueba nada). Comparar el orden con el que dependía `index.ts:63-69` |

### Lo que este plan no resuelve y hay que decidir aparte

1. **`pi-subagents` no se puede extraer de aquí** (0.1). O se saca de `gentle-pi`, o se aplaza.
2. **Los tres huérfanos** de `~/.pi/agent/extensions/` (`loon-notifications.ts`,
   `loon-port-panel-state.ts`, `pi-empty-response-retry.ts`) siguen sin dueño ni decisión.
   No están en este repo.
3. **`host-patches.ts` tiene dos trabajos**: los parches de rail/layout y el renderizado de
   cuota (ya documentado en `odd/tasks/revert-pi-ui-overrides.md`). El paso 2 le quita el
   segundo. Si no se hace el paso 2, el paso 6 mueve 1.736 líneas que siguen mezclando dos
   responsabilidades al repo nuevo.
4. **`.github/` no existe**: no hay CI que impida pushear con el check roto. La única red
   es la comprobación única ejecutada a mano antes de cada push.

---

## Anexo: cómo se midió

```bash
git rev-parse HEAD; git rev-parse origin/master          # 9d51720 == 9d51720
echo $HOME                                               # debe ser /home/loonbac (§0.5)
diff -rq extension /nix/store/x7bkkga9xwd6gv0fynqwfp6ixcmig7wh-loon-0.1.9/extension
node --experimental-strip-types --test extension/*.test.ts   # 84/83/1
readlink -f ~/.local/share/loon-pi-packages/better-claude-code-ui
rg -n 'loon-pi-packages' ~/.nixos/pkgs/gentle-ai-bootstrap/default.nix
rg -n 'loon = |betterClaudeCodeUi' ~/.nixos/flake.nix
```

Alcanzabilidad calculada resolviendo cada `from "./…"` a un fichero en disco y recorriendo el
grafo desde `extension/index.ts`. Un fichero no alcanzado y sin importadores vivos es muerto;
se contrastó con `odd/tasks/revert-pi-ui-overrides.md` (`8fd3b9c`, «left on disk and simply not
registered»).
