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

S3. **The main transcript keeps the summaries reachable.**
User: "el historial de pi al scrollear hacia arriba no es infinito, se corta, y si el trabajo inline se hace siempre en el render principal ya no puedo ver el anterior mensaje de pi".
User (work order, restating the requirement): "inline parent work must stop occupying the
main transcript... the main render must now stop flooding, leaving only a closing summary
behind". Also: "a real subagent task must keep rendering exactly as it does today, and no
renderer may hide a failure, an error or a question waiting for the owner".
The target is scrollback, not context. While the session has a carrier, the calls of the
work unit draw no rows in the main transcript at all, so a programming unit costs the
assistant's prose and its closing summary instead of hundreds of rows, and the previous
summaries stay within reach. The count and the detail belong to the Agents panel entry.
What the collapse does not do yet, and must not be described as doing: the panel entry has
no detail thread (T11), so the collapsed detail is reachable in the session's own log, not
in the panel.

S4. **The patch survives package updates, and never damages what it touches.**
A local patch to `gentle-pi` is lost on every install. It ships as a script that backs
up the file first, applies the smallest possible change and verifies it, mirroring the
existing banner-patch backups under `~/.pi/agent/backups/`.
User (work order): "Malformed or incomplete arguments must fail closed: no default to the
live install, no write of any kind, non-zero exit, and a message naming what was wrong.
Concretely, `--install` and `--backups` without a value, unknown flags, and repeated
conflicting flags must all be rejected before anything is read or written."
User (work order): "`revert` must refuse when the file on disk no longer matches the
backup it would restore: compare the recorded identity of the patched file against the
current one and fail with a clear message instead of overwriting a newer version.
Restoring must never clobber a file that changed since the backup."

S5. **Expansion is available.**
User: "a mi me gusta leer lo que hace la ia".
Collapsed by default, and the collapse is never final: the carrier entry keeps the unit's
label, its step count and its closing summary, an errored call is never collapsed, and the
session log holds every call and its output. A detail thread inside the panel entry is
T11, not this slice; until it lands, the panel shows the unit and the log holds the detail.
Expansion is pi's own global toggle (`app.tools.expand`, `Ctrl+O`), which sets `expanded` on
every tool row and on every new one; the renderer honours it, so the rows come back on
demand. A single row cannot be clicked open: a zero-height row has no hit region.

## Design

Two pieces, one repository each:

1. **Carrier record (LOON).** An extension writes a `TaskRecord`-shaped entry for the
   active session into the state directory while the parent is inside a work unit, and
   rewrites it as finished with a summary when the unit ends.
2. **Reader patch (gentle-pi).** `extensions/gentle-agents.ts:721` defines
   `visibleTasks = () => store.list(activeSessionId())`, unfiltered by ownership, and
   that is what the sidebar and the panel render. The patch merges carrier records into
   that list. Nothing else in the package changes.

### Las dos mitades degradan por separado
The carrier record and the collapsed renderer are independent, and each one degrades alone:
without the panel patch the collapse still works and only the card is missing; without the
renderer the card still works and the transcript floods again. The one combination that is
dangerous is the third —**carrier active with the panel patch absent**— because the inline
work is then invisible in the transcript and in the panel at the same time, and nothing says
so. Recovery after every gentle-pi update is `node scripts/apply-inline-carrier-patch.mjs
check` then `node scripts/apply-inline-carrier-patch.mjs apply`, never `revert`;
`LOON_INLINE_WORK=0` returns the previous transcript without touching `node_modules`. The
collapse is deliberately not armed on whether the patch is detectable: that would couple a
writer-side renderer to a file we do not own, and a patch removed on purpose would silently
bring the flood back.

Why not edit only the prompt: the fires are display and policy. The display half is this
feature. The policy half — work staying inline until the context is two thirds full — is
not a rendering problem and is measured separately (see S6).

S6. **Context is a separate lever from scrollback.**
The user already knows collapsing does not lower context, and it is not asked to.
Context burn and scrollback pressure have different fixes: this feature addresses the
second; the first needs delegation or smaller units, decided with its own evidence.
User: "bastante de mi trabajo no se esta delegando y aun asi el orquestador edita en
inline hasta llegar a limites de contexto del 70 por ahi".
Collapsing the render does not reduce context. If the context burn itself must drop, the
work has to be delegated or split, which is a policy decision taken with its own
evidence; this feature must not be sold as a fix for it.

## Tasks

| ID | Spec | Route | Commit | Outcome |
| --- | --- | --- | --- | --- |
| T1 | S1-S6 | inline | pending | This document. |
| T2 | S1, S2 | worker | cab31c8 | Carrier record writer in LOON: `extensions/lib/inline-carrier.ts` plus `extensions/inline-work.ts`, registered in `package.json`. One record per session under `<agent home>/state/loon-inline/`, created with the first tool call, heartbeating while it runs, closed as `completed` with the closing summary, deleted at shutdown, stale records pruned by pid, and `LOON_INLINE_WORK=0` as the kill switch. |
| T3 | S1, S2 | worker | 5c27faa | `gentle-agents` patch merging the active session's carrier into `visibleTasks()`. Display only: the record never enters the task store, so it is never an owned subagent, never cancellable and never launch authority. |
| T4 | S4 | inline | 5c27faa | `scripts/apply-inline-carrier-patch.mjs`: check/apply/revert, timestamped backup, verified idempotent rerun, TypeScript syntax gate, and the README note on when it must be rerun. |
| T10 | S3, S5 | inline | 8104eee | Collapsed renderer through `pi.registerToolRenderer` from `extensions/inline-work.ts`: while the session has a carrier, `read`, `bash`, `grep`, `find`, `ls`, `edit` and `write` draw zero rows (`renderShell: "self"` plus an empty component, which makes `ToolExecutionComponent.render` return no lines). Anything else delegates to `next()`, unchanged: subagent tasks, questions, `todo`, `codemode`, every non-target tool. An errored result delegates to `next()` so the failure keeps its own rows, and `LOON_INLINE_WORK=0` never registers the resolver at all. |
| T14 | S3, S5 | inline | dde0728 | `codemode` joins `COLLAPSED_TOOL_NAMES`, because an agent that works through `codemode` makes every single call through that one tool and the seven file and shell names left its transcript exactly as flooded as before. Tests first, asserting rows: the call collapses while a carrier is live, a failed `codemode` call still draws its row (pi builds the render context with the result's own error flag), `Ctrl+O` expansion brings it back, a session without a carrier is untouched, and `LOON_INLINE_WORK=0` still registers no renderer. The seven original names stay covered by the same test. Box `port`: targeted 14/14 pass, `npm run typecheck` the one pre-existing `theme-file` TS2307, suite 217 tests / 211 pass / 2 `probe-frame` tmux failures identical at base. |
| T11 | S5 | pending | The panel entry still has no detail thread: `agents-view.threadWindow` reads `store.thread(id)` and the carrier never enters the store, so a carrier's thread is always empty. Giving it one needs either a thread field the view reads for non-store ids or a second patch site, so it is its own slice and the collapsed detail stays in the session log until then. |
| T6 | S6 | inline | pending | Measure the actual inline/delegated split of recent sessions and report before changing any policy. |
| T7 | S4 | inline | aa654cb | Harden `scripts/apply-inline-carrier-patch.mjs` after the first review: strict argument parsing (missing value, unknown flag, repeated flag, stray positional all rejected before any read or write) and a `revert` that refuses anything but the exact bytes the patch wrote. Tests first, both proving the failure by absence of a write, not by a message. |

## Log

L1. User: "es que se supone que ya no delegar mucho ahorra tokens, por eso no quiero delegar, pero quiero que cuando comience a programar la ia inline salga como si fuera un gentleman-worker aunque no lo es, eso me ayudaria a no llenar de basura el render principal, y todo el trabajo saldria en el menu de gentle:agents como si de verdad se hubiera lanzado un subagente aunque enrealidad el inline se movio ahi por un rato porque esta programando, se puede no?".

L2. Discovery: `/gentle:agents` is fed by `store.list(activeSessionId())` through `visibleTasks()` (`extensions/gentle-agents.ts:721`); the ownership filter applies to presence and counts, not to this list. `TaskRecord` comes from `lib/agents-protocol.ts:117` and records live under `historyDir`. A carrier record with the active session id therefore renders without touching the ownership rules.

L4. User: "yo se que colapsar el render no baja el contexto, era solo para que entiendas que ultimamente hay mucho trabajo inline que me llena el render principal, lo que me quita de ver el resumen de lo que hizo la ia ya que el historial de pi al scrollear hacia arriba no es infinito, se corta". Real motivation: scrollback, not tokens.

L5. Discovery: `tuiMode: fullscreen` (the current setting) scrolls the transcript inside the terminal window, so history is whatever Pi retains; `regular` mode hands scrolling to the terminal and its own scrollback. Immediate stopgap, with the trade-off that fullscreen fixes the editor and status area.

L3. User: "bastante de mi trabajo no se esta delegando y aun asi el orquestador edita en inline hasta llegar a limites de contexto del 70 por ahi, y llena el render principal de basura, entonces hay que parchar mas el gentle agents".

L6. Evidence for T2-T4, all in the `port` instabox box at `/data/workspace/loon` (Node v22.23.3) because the build rule is box-first, never this machine:
`npm ci` exit 0. `npm test` exit 1 with 201 tests, 195 pass, 2 fail, 4 skipped. The two failures are `tests/probe-frame.test.ts` ("a probe that never draws a frame fails…" and "--sgr keeps the escape sequences…") and their cause is `tmux: command not found` in the box; the same two fail identically at base `f1af63e` (182 tests, 176 pass, 2 fail), so they are environmental and not from this slice. `npx tsc --noEmit` exits 2 with one error, `tests/theme-file.test.ts(106,4): error TS2307` pointing at an absolute `/home/loonbac/.local/share/loon-pi/...` path that only exists on this machine; base `f1af63e` reports the same single error and exit 2. The 19 new tests pass on their own: `node --experimental-strip-types --test tests/inline-carrier.test.ts tests/inline-carrier-patch.test.ts` exit 0, 19 of 19.

L7. Discovery about the two readers: only the sidebar/above-editor card (`agentsCard` in `extensions/gentle-agents.ts`) renders `visibleTasks()`. The full-screen `/gentle:agents` overlay (`lib/agents-view.ts`) reads `deps.store.list()` directly and subscribes to store events, so the carrier record does not appear there. Making the overlay list it needs a second patch site and a thread source for the detail pane, which is a bigger change than this slice; T5 stays the renderer task and this gap is recorded here rather than hidden.

L9. Work order from the orchestrating session: the first native review's lineage `review-c2fa1cd599ecdab3` stays deadlocked and must be left alone (no retry of the correction-plan capture, no START, no abandon/reset/quarantine — those stay with the human), and the two deterministic findings are to be fixed here as T7, then re-reviewed on a fresh lineage. Findings, verbatim: "`parseArgs` ignores malformed options and can patch the live install"; "`revert` restores a backup over a file from a different version". The same session applied the patch to the live install (`patched and verified`, backup `loon-inline-carrier-patch-20261030050433`), which is the first real application.

L10. RED before GREEN for T7, in the `port` box: the two new tests failed for the intended reason (`a different build must not be overwritten by a stale backup`, and the malformed-argument case, whose assertion is that the decoy default installation under a scratch `HOME` keeps its exact bytes and no backup directory appears). Then the guards landed and the targeted file went to 11 of 11, exit 0. Full suite after the fix: `npm run typecheck` exit 2 with only the pre-existing `tests/theme-file.test.ts(106,4)` absolute-path error, and `npm test` exit 1 with 203 tests, 197 pass, 2 fail, 4 skipped — the same two `probe-frame` failures caused by `tmux` missing in the box, unchanged from base. The `revert` expectation is the `patchedMd5` the manifest now records, the same field `scripts/gentle-pi-patch.ts` already uses; backups written by the older script carry no such field, so the expectation is recomputed from the backed-up bytes, which is what makes the existing `…050433` backup safe to reason about.

L8. The patch was rehearsed against a copy of the real installed file: `cp ~/.pi/agent/npm/node_modules/gentle-pi/extensions/gentle-agents.ts` into a scratch install, then `check` (exit 1, "not patched"), `apply` (exit 0, +33 lines, syntax gate `typescript`), `apply` again (exit 0, "already patched and verified", no second backup), `check` (exit 0), `revert` (exit 0, md5 back to `b17799abb1d22664870d9f5591b2ab1c`). It was deliberately not applied to the live install: that is the user's terminal, and the restart is theirs.

L11. Work order for the renderer slice, verbatim: "inline parent work must stop occupying the main transcript. The carrier plus the Agents-card entry made the work visible in the panel; the main render must now stop flooding, leaving only a closing summary behind"; "Use the extension renderer API (pi.registerToolRenderer, the same mechanism gentle-pi uses in extensions/quiet-tools.ts) rather than patching node_modules again. A renderer lives in our own extension and survives updates; the carrier patch does not"; "Only inline work that has a live carrier should be affected: a real subagent task must keep rendering exactly as it does today, and no renderer may hide a failure, an error or a question waiting for the owner"; "Tests first, and they must assert what the user sees"; "LOON_INLINE_WORK=0 must return the previous behaviour in full". The order also asks whether our renderer conflicts with the applied carrier patch and whether the patch is still needed afterwards.

L12. Mechanics the renderer depends on, read from the installed pi 1.4.0 rather than assumed: `ToolExecutionComponent` picks the shell once per call from the resolved definition (`getRenderShell()`), and its `render(width)` returns `[]` when the shell is `"self"` and the component draws no lines, so a zero-row call is expressible and costs no vertical space; `MouseRegion`, which wraps every rendered component, is a pure pass-through, so the empty component survives it. Renderers are resolved once per call (`resolveToolRenderers(toolName, base)` in `dist/core/extensions/runner.js`) and re-invoked on every `updateDisplay`, which re-runs both `renderCall` and `renderResult`; that is why an error can restore the native rows after the call was collapsed. The first call of a unit still paints natively, because the shell is chosen before the carrier exists; every later call of the unit is resolved already collapsed.

L13. Evidence for T10, all in the `port` instabox box (Node v22.23.3) after `npm ci` exit 0:
`node --experimental-strip-types --test tests/inline-collapse.test.ts` exit 0 with 10 of 10;
`npm run typecheck` exit 2 with one error, the pre-existing `tests/theme-file.test.ts(106,4)`
TS2307 absolute path that does not exist in the box; `npm test` exit 1 with 213 tests, 207
pass, 2 fail, 4 skipped, the two failures being the `probe-frame` tests whose cause is `tmux`
missing in the box and which fail identically at base. RED first: the tests ran before
`extensions/lib/inline-collapse.ts` existed and failed on the missing module, and then the
typecheck caught the components written against the installed `Component` contract. GREEN only
after the renderer and its wiring landed. Merged as `8104eee` (PR #136, issue #135); native
assessment for the candidate reported tier medium, `reviewDue: false` (`under_budget`), writer
self-verification and no independent verifier. Not verified: the collapse as pixels in a real
terminal, which needs a restart of the session running it, and the panel detail thread, which
is T11.

L14. Decision on the boundary (work order): "do not add it. Arming the collapse on a
detectable node_modules patch would couple a writer-side renderer to a file we do not own,
and it would fail in the direction that matters — a patch the user removed on purpose would
silently re-enable the transcript flood"; and "the failure mode you named is real and must be
written down, because it is silent: after a gentle-pi update the patch is gone, so inline work
has no card and no rows — invisible in both places, with nothing telling the owner". Written
down here and in the README; no code. Asked whether the seven-name list could ever catch a row
a reader needs expanded by default, the answer is that the collapsed state is never the only
state: `Ctrl+O` (`app.tools.expand`) sets `expanded` on every tool component and every new one
(`interactive-mode.js`, `setToolsExpanded`), the renderer delegates when `expanded` is true, an
error restores its own row, and `LOON_INLINE_WORK=0` restores everything.

L15. T14 order (verbatim): "Owner's answer on the collapse: yes, add `codemode`. He works with
an agent whose every call is codemode, so the seven-tool list leaves the transcript flooding
exactly as before." And, to record with no code: "`extensions/gentle-agents.ts:927` counts
badge/sidebar tasks from `store.list(...).filter(ownedTaskIds.has(...))`, not from the patched
`visibleTasks()`. So the carrier draws a card in the panel while the running-count does not
include it. That is the patch's territory and it is display-only, so do not patch
`node_modules` again for it; write it down as a known inconsistency with the reason." The
count is published from `publishActivityNow` (`gentle-agents.ts:573` in 4.5.1); `:927` is the
same predicate reused for the standalone-sleep block, so both stay blind to the carrier by the
same design. And: "The carrier file is removed at shutdown, so a Pi reload or restart drops the
card until the next tool call re-creates it... Say so in the README, next to the
double-invisible warning." Both limits are now in the README; neither adds code.
