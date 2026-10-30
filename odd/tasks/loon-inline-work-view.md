# Feature: inline work shown as an agent (`loon-inline-work-view`)

While the parent works inline, its tool calls and reasoning should read as one agent
card in the Agents panel, closing with a single summary — without pretending a subagent
was launched and without moving execution or context elsewhere.

## Specs

S1. **Inline work appears where a subagent appears.**
User: "cuando comience a programar la ia inline salga como si fuera un gentleman-worker aunque no lo es".
User: "todo el trabajo saldria en el menu de gentle:agents como si de verdad se hubiera lanzado un subagente".
The parent's inline work unit shows as one entry in the Agents panel while it runs, and
as one finished entry with a summary when it ends.

S2. **Display only.**
User: "se supone que ya no delegar mucho ahorra tokens, por eso no quiero delegar".
Nothing moves out of the parent: no child process, no second model call, no change to
token accounting. The feature changes what is drawn, never what is executed. It must not
be described as delegation, and the entry must not claim a real subagent ran.

S3. **The render stops being noise.**
User: "llena el render principal de basura".
Consecutive tool calls of one work unit collapse into a single card that keeps a call
count and can be expanded on demand, so the transcript stays readable after the fact.

S4. **The patch survives package updates.**
A local patch to `gentle-pi` is lost on every install. It ships as a script that backs
up the file first, applies the smallest possible change and verifies it, mirroring the
existing banner-patch backups under `~/.pi/agent/backups/`.

S5. **Expansion is available.**
User: "a mi me gusta leer lo que hace la ia".
Collapsed by default, expandable at any time. Collapsing never destroys the detail.

## Design

Two pieces, one repository each:

1. **Carrier record (LOON).** An extension writes a `TaskRecord`-shaped entry for the
   active session into the state directory while the parent is inside a work unit, and
   rewrites it as finished with a summary when the unit ends.
2. **Reader patch (gentle-pi).** `extensions/gentle-agents.ts:721` defines
   `visibleTasks = () => store.list(activeSessionId())`, unfiltered by ownership, and
   that is what the sidebar and the panel render. The patch merges carrier records into
   that list. Nothing else in the package changes.

Why not edit only the prompt: the fires are display and policy. The display half is this
feature. The policy half — work staying inline until the context is two thirds full — is
not a rendering problem and is measured separately (see S6).

S6. **The inline-first policy is a separate lever.**
User: "bastante de mi trabajo no se esta delegando y aun asi el orquestador edita en
inline hasta llegar a limites de contexto del 70 por ahi".
Collapsing the render does not reduce context. If the context burn itself must drop, the
work has to be delegated or split, which is a policy decision taken with its own
evidence; this feature must not be sold as a fix for it.

## Tasks

| ID | Spec | Route | Commit | Outcome |
| --- | --- | --- | --- | --- |
| T1 | S1-S6 | inline | pending | This document. |
| T2 | S1, S2 | worker | pending | Carrier record writer in LOON: schema, session-scoped path, start/update/finish, and removal of stale records at shutdown. |
| T3 | S1, S2 | worker | pending | `gentle-agents` patch merging carrier records into `visibleTasks()`, marked read-only and never counted as an owned subagent. |
| T4 | S4 | inline | pending | Apply/verify script with backup and a re-apply check, plus a note in the repository on when it must be rerun. |
| T5 | S3, S5 | worker | pending | Renderer collapsing consecutive tool calls of one unit into one expandable card with a closing summary. |
| T6 | S6 | inline | pending | Measure the actual inline/delegated split of recent sessions and report before changing any policy. |

## Log

L1. User: "es que se supone que ya no delegar mucho ahorra tokens, por eso no quiero delegar, pero quiero que cuando comience a programar la ia inline salga como si fuera un gentleman-worker aunque no lo es, eso me ayudaria a no llenar de basura el render principal, y todo el trabajo saldria en el menu de gentle:agents como si de verdad se hubiera lanzado un subagente aunque enrealidad el inline se movio ahi por un rato porque esta programando, se puede no?".

L2. Discovery: `/gentle:agents` is fed by `store.list(activeSessionId())` through `visibleTasks()` (`extensions/gentle-agents.ts:721`); the ownership filter applies to presence and counts, not to this list. `TaskRecord` comes from `lib/agents-protocol.ts:117` and records live under `historyDir`. A carrier record with the active session id therefore renders without touching the ownership rules.

L3. User: "bastante de mi trabajo no se esta delegando y aun asi el orquestador edita en inline hasta llegar a limites de contexto del 70 por ahi, y llena el render principal de basura, entonces hay que parchar mas el gentle agents".
