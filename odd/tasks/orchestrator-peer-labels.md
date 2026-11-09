# Install complete: sesiones que resuelven solas a qué sesión hablan

## Header

Orden de trabajo de la sesión `01a18bee` (vía elegida por el dueño: parche en loon, no PR upstream). Problema: los agentes preguntan al dueño qué sesión es por UID porque no saben qué sesión es cuál. Medido contra gentle-pi 4.6.0; verificado que el código existe igual en 4.7.0 (`extensions/gentle-agents.ts`: selector ~línea 2970, `recipientSelectionLabels` ~línea 108, filas de `orchestrator_list` ~línea 2893).

## Specs

S1. Labels legibles. «Labels legibles: el selector de destinatario y cualquier texto que pida elegir sesión debe mostrar `Current alias (subject) · Session name · workspace · topic`, nunca el UUID crudo como etiqueta visible (el ID queda solo como valor interno).»

S2. Sin trasladar al dueño. «Sin trasladar al dueño: si el emisor es subagente/background/child o hay más de un peer sin resolver, NO abrir el selector de usuario; devolver error que ordene resolver vía `orchestrator_list` (por subject/topic/workspace) y reintentar con `recipient_session_id` explícito.»

S3. Disciplina propia. «Disciplina propia: las sesiones de loon declaran su subject vía `orchestrator_session_id` al arrancar y antes de coordinar; regla en el repo: antes de enviar, listar, matchear por subject/topic, enviar con ID explícito; si hay ambigüedad se pregunta a la sesión de origen, jamás al dueño por UID.»

S4. Causa raíz (contexto, no cambia). «1. `orchestrator_send_message` sin `recipient_session_id` y con más de un peer abre `ctx.ui.select("Select recipient orchestrator", labels)` (≈línea 2960-2992); sin UI devuelve "Ask the user to choose one of these recipient labels" con los sessionId crudos en `candidates`. Su propia descripción lo dice: "If recipient_session_id is omitted, the sole peer is selected or the user selects one." El agente obedece literalmente y le traslada la elección al dueño. 2. Los labels no sirven porque los peers no publican subject/estado: las filas de `orchestrator_list` (≈línea 2842+) salen como "unnamed"/"unknown"/"never published". Publicar vía `orchestrator_session_id` con subject es obligatorio para trabajo clasificado (≈línea 2745) pero nada lo exige al arrancar. 3. Los UUID crudos aparecen en labels y candidatos, así que ni el dueño puede identificar nada.»

S5. Entregable (orden labels). «Entregable: parche + tests (labels sin UUID visible; fallback sin recipient no pide usuario y exige resolución; filas list legibles), `npm test` + typecheck, `apply` + `check` final, commit/PR coherente.»

S6. ACK perdido no es fallo (defecto 1). «No tratar la pérdida de ACK como fallo cuando el frame ya se escribió con éxito — resolver tras el write, ACK como confirmación best-effort (warning, no error). Alternativa/complemento lado receptor: responder el ACK tras encolar, sin esperar la entrega completa.» Test: «receptor mock que acepta pero retrasa/omite el ACK >2s → la herramienta debe devolver accepted (o aviso blando), nunca "not accepted".»

S7. Resiliencia por-peer (defecto 2). «`rejected` solo falla a los peers afectados, nunca a los sanos; reintento con backoff corto ante `unavailable` transitorio; `overflow` solo marca lo no escaneado.» Test: «un `.header.json` corrupto en el perfil → los peers sanos siguen mostrando nombre/alias.»

S8. Entregable (orden reparación). «Entregable: parches idempotentes en `scripts/gentle-pi-patch.ts` con digests, tests de cada defecto, `npm test` + typecheck, `apply` + `check` final, commit/PR.»

## Tasks

| ID | Specs | Ruta | Commit |
| --- | --- | --- | --- |
| T1 | S1, S2 | delegada (explore): forma del peer descubierto, topic disponible, qué ediciones mínimas cumplen A/B | — |
| T2 | S1, S2, S5 | delegada (worker): nuevo target `extensions/gentle-agents.ts` en el parche + fixtures + tests | hecho: 3 ediciones (peerIdentity, compuerta, fila) + backup completo; suite 385/385 |
| T3 | S3 | inline: regla en el repo + subject propio declarado | hecho (bullet en `~/.pi/agent/AGENTS.md`, subject publicado) |
| T4 | S5 | inline: apply a la instalación, check, suite, commit/PR | hecho: 8/8 patched, backup con el archivo nuevo |
| T5 | S6, S7, S8 | delegada (worker), BLOQUEADA hasta T2: targets nuevos `lib/agents-session-transport.ts` + `lib/orchestrator-discovery.ts` (+ receptor si hace falta) | pendiente |

## Log

L1. Orden de trabajo nueva para loon (vía elegida por el dueño: parche en loon, no PR upstream):

Problema reportado por el dueño: cuando sus agentes de Pi intentan hablar con otra sesión orquestadora, dicen que no saben qué sesión es cuál y le preguntan a ÉL qué sesión es por UID, como si él conociera esos números largos. Si van a usar la herramienta de hablar con otras sesiones, deberían resolver la info solos.

Causa raíz medida en gentle-pi 4.6.0 (`extensions/gentle-agents.ts`):
1. `orchestrator_send_message` sin `recipient_session_id` y con más de un peer abre `ctx.ui.select("Select recipient orchestrator", labels)` (≈línea 2960-2992); sin UI devuelve "Ask the user to choose one of these recipient labels" con los sessionId crudos en `candidates`. Su propia descripción lo dice: "If recipient_session_id is omitted, the sole peer is selected or the user selects one." El agente obedece literalmente y le traslada la elección al dueño.
2. Los labels no sirven porque los peers no publican subject/estado: las filas de `orchestrator_list` (≈línea 2842+) salen como "unnamed"/"unknown"/"never published". Publicar vía `orchestrator_session_id` con subject es obligatorio para trabajo clasificado (≈línea 2745) pero nada lo exige al arrancar.
3. Los UUID crudos aparecen en labels y candidatos, así que ni el dueño puede identificar nada.

Especificación del parche (en `scripts/gentle-pi-patch.ts`, idempotente, con digests recalculados):
A. Labels legibles: el selector de destinatario y cualquier texto que pida elegir sesión debe mostrar `Current alias (subject) · Session name · workspace · topic`, nunca el UUID crudo como etiqueta visible (el ID queda solo como valor interno).
B. Sin trasladar al dueño: si el emisor es subagente/background/child o hay más de un peer sin resolver, NO abrir el selector de usuario; devolver error que ordene resolver vía `orchestrator_list` (por subject/topic/workspace) y reintentar con `recipient_session_id` explícito.
C. Disciplina propia: las sesiones de loon declaran su subject vía `orchestrator_session_id` al arrancar y antes de coordinar; regla en el repo: antes de enviar, listar, matchear por subject/topic, enviar con ID explícito; si hay ambigüedad se pregunta a la sesión de origen, jamás al dueño por UID.

Entregable: parche + tests (labels sin UUID visible; fallback sin recipient no pide usuario y exige resolución; filas list legibles), `npm test` + typecheck, `apply` + `check` final, commit/PR coherente. Gracias.

L2. Verificado en 4.7.0 instalado: el selector existe (`Select recipient orchestrator`, texto `Ask the user to choose one of these recipient labels`, ~línea 2970), `recipientSelectionLabels` (~línea 108, sufijos de 4/6/8 del UUID como etiqueta) y las filas de list (~línea 2893, con `peer.sessionId` como cabeza de fila). La orden medía 4.6.0 pero el código coincide; el parche se escribe contra 4.7.0.

L4. Segunda orden (reparación completa, defectos 1 y 2; el 3 sigue vigente con T2 en curso). Verificado en 4.7.0: `CLIENT_ACK_DEADLINE_MS = 2000` y `ack_timeout` existen (`lib/agents-session-transport.ts:650/663/768-769`), y la compuerta común existe (`lib/orchestrator-discovery.ts:39`: `page.unavailable || page.overflow || page.rejected ... return unknown`). T5 queda bloqueada hasta que T2 aterrice, porque ambas tocan TARGETS y fixtures.

L3. Explore T1 (vuelta 2026-11-09): `discoverOrchestrators` vive en `lib/orchestrator-discovery.ts:15-38`; el topic NO es campo del peer (está en `workRecord.work.topic`, solo con `includeWork: true`; sin selection no llega). No hay flag child/background en ctx: el discriminador es `GENTLE_PI_AGENTS_CHILD=1` en env (`ctx.mode` cubre json/print; `hasUI` no distingue un child RPC). `recipientSelectionLabels` tiene un solo llamador (execute ~2969); labels fluyen a `ui.select` o al payload `candidates`. Contrato de target nuevo: TARGETS + PATCHED_FILES + 3 fixtures + lineage; `pristine.ts` no necesita código. Humano interactivo con UI conserva el selector (con labels de A); el resto va por error de resolución (B).
