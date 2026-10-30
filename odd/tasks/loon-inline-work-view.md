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


S7. **The unit survives a reload, through gentle-pi's own history.**
"on unit close, write `{ task, thread }` into gentle-pi's history dir, `task` being the carrier
we already write (status `completed`, `mode: "inline"`, id `loon-inline-<sessionId>`) and
`thread` a real `TaskThread` with the unit's actual activity. Read `lib/agents-protocol.ts`
for the exact item shape and how `applyTaskEvent` builds a thread; do not approximate it."
The history file is `<agentHome>/gentle-agents/tasks/<id>.json`, shaped `{ task, thread }`,
which gentle-pi's `loadHistory` re-adds to its store on resume; the overlay panel renders
`store.list()` and the detail pane renders `store.thread(id)`, so a persisted record is both
the card and its transcript.

S8. **The thread is the transcription, and it is bounded.**
"The thread must be the transcription the owner asked for: the tool calls it made with their
names and a bounded summary, and the closing result text. Bounded, because a full tool output
in a panel line is noise."

S9. **Persistence replaces "display state in memory".**
"Keep the live carrier file as it is, and stop deleting the persisted history on reload or
shutdown. A unit that closed stays readable; that is the whole point." And: "Do not modify
gentle-pi's files: we write into its history directory, which is data, not code. No new
`node_modules` patch."

S10. **The overlay shows the unit while it runs, and flips when it closes.**
The panel lists `store.list()` filtered to this session (`lib/agents-view.ts:573`) and draws
the detail from `store.thread(task.id)` (`:743`). Our record never enters the store, so the
panel only sees it after a resume restored it — unusable for real work. Two lines of
`lib/agents-view.ts` are patched behind one provider on `globalThis`
(`__loonInlinePanel`): the list merges our records, the detail asks our thread before the
store's. While the unit runs, the card is the live carrier as `running` with the live thread;
when the turn ends it is the history file as `completed`, with the same thread plus the
closing text. No restart at either step: the view calls `refreshTasks()` and
`requestRender()` on the presence tick it reschedules every second (`:246-258`), so a
running card and its status change appear on their own.

S11. **One card per unit, whatever the sources.**
"One card per unit, always: dedupe by id across the three possible sources (live carrier,
history file, store-restored record). A restored record must not double the card, and a
running unit must not appear twice because its history file already exists from an earlier
unit." The key is the unit number in `loon-inline-<sessionId>-<n>`. Same unit in two
sources is one card, the history record winning for status and summary; ids the store already
serves are excluded; a numberless id — a carrier written before units existed — is a legacy
key, dropped as soon as the session has a numbered history record.

S12. **The patched panel fails closed, exactly like the patched card list.**
"Fail closed on an unknown shape. If `lib/agents-view.ts` (or whatever file you patch) does
not match the expected anchor exactly, the script must refuse to apply and say which anchor
failed, exactly as the hardened argument parsing does. A patch that half-applies to a newer
gentle-pi is worse than no patch." One script, one backup directory, one manifest, both files
in it; `check` reports every patched file and its state; every anchor appears exactly once;
`revert` restores only the exact bytes the patch wrote.

S13. **Nothing throws into the panel, and a broken record is absent.**
"Nothing may throw into the panel, and a malformed or unreadable record must render as absent
rather than as an error card." A read, a parse or a shape check that fails yields no task and
no thread, never an entry and never an exception. With the patch absent, or the provider
absent, the panel behaves exactly as it does today.

S14. **One card per job, not one per request.**
"one card per job, not one per message the model launches". A session is one job. The card stays
open for the session and accumulates: every stretch of work between two closing turns appends
its thread items to the same transcript, in order, behind a divider marking where a new request
began. The record id is the job, `loon-inline-<sessionId>`, rewritten at every close.

S15. **Totals and status describe the job.**
"Totals aggregate (tokens, cost, wall time) instead of showing the last unit's numbers, and the
label reflects the current step, so a running card still looks alive." Tokens, cost and calls
sum across the session; the wall time is the job's span, so `createdAt`/`startedAt` are set
once. "Status: running while any unit is open, completed when none is. Do not let a closing unit
mark the job completed while another is running."

S16. **The records the previous design wrote are merged, not resurrected.**
"a restore must not resurrect one per unit": gentle-pi restores every file it finds, so the
numbered files from the previous design are merged into the job record at session start — their
transcripts in order, behind dividers — and removed once their content is inside.

S17. **Dedupe is keyed by job.**
"Dedupe stays keyed by job, so the live carrier, the history and the restored record are one
card." Every inline id of a session resolves to that session's job; when the store already
serves any of them, the provider adds nothing, and otherwise the newest description wins.

S18. **The gate is the session, not the carrier.**
"The content of the inline unit must be hidden from the main render and live only in the
subagents menu." pi constructs a call's `ToolExecutionComponent` while the assistant message
streams (`interactive-mode.js:2815`, in the `message_update` branch), which is strictly before
the tool runs and therefore before LOON's `tool_call` handler can write the carrier. A gate
that waits for the carrier (`written && !closed`) lets the first row of every unit through, and
a unit driven through `codemode` can be a single call. So: collapse for the whole session,
from its first call, gated on `sessionId !== undefined && !closed`.

S19. **`renderShell: "self"` is honoured, and that is not the problem.**
"Confirm whether `renderShell: "self"` is honoured for the real `codemode` tool in this host
version, by reading how the host builds the component for that tool rather than assuming from
the earlier probe." It is: `ToolExecutionComponent.getRenderShell()` returns
`this.toolDefinition?.renderShell ?? "default"` (`tool-execution.js:71`), the constructor adds
only `selfRenderContainer` for that shell (`:54-56`), and `render()` returns `[]` when that
container draws nothing and there are no images (`:159-168`). The definition is whatever
`interactive-mode.js:1706` resolves, i.e. our resolver followed by
`withBuiltInRenderers(toolName, ...)`; `withBuiltInRenderers` supplies renderers only for
read, bash, powershell, edit, write, grep, find and ls, so `codemode` arrives with whatever its
own definition has.

S20. **The assistant's prose collapses to one line, and the answer does not.**
"the remaining complaint is about prose, not rows": the same paragraphs the panel shows as the
unit's thread were also drawn in full in the transcript. pi's `registerMarkdownTransformer` is
the supported hook ("a transformer for user and assistant Markdown before Pi renders it in the
interactive transcript") and its context distinguishes `user`, `assistant` and
`assistant-thinking`. A knob with three values: `summary` (default) draws one line with an
excerpt plus `· inline · /gentle:agents`, `off` draws the pointer alone, `full` leaves
everything as it was.

S21. **The collapse is sticky, bounded, and never eats the answer.**
"A message collapsed while the unit was live must not expand on a later repaint" and the reverse:
one that was already history must not shrink. So the first decision is remembered by content.
"The closing message of the turn stays legible in full": the exact text is exempted at unit close,
recognised by its text or its opening when a repaint normalises the edges, with one repaint
requested so it appears without a keystroke. The memory is capped at 500 decisions; at the cap the
oldest is forgotten and that message is decided again on its next render.

S22. **A job is the work, and it opens and closes on the agent's word.**
"a job is the WORK he asked for, not a turn": asking for something that takes four turns is one
worker, one card, one record, and it says `running` across all of them. "A job opens with the
first inline activity after the previous job closed" and "closes only on an explicit completion
signal from the agent, because the agent is the only party that knows the work is finished. ...
Do not infer completion from the turn ending." The signal is cheap and callable from a tool:
`node scripts/inline-job.mjs end` writes a marker next to the live carrier, and the extension
consumes it on its next event. While the job is open, every turn appends to the same thread with a
divider where the new request began, and the totals aggregate over the whole job.

S23. **Two fallbacks, both recorded.**
"Fallback for a forgotten signal: a job with no activity for a bounded idle window closes itself
as completed, and says in its record that it was closed by inactivity rather than by the agent."
Ten minutes, measured on real activity and not on the heartbeat that keeps the record fresh; the
record carries `closedBy: "idle"` and the transcript carries a note. And a session that ends with
a job open closes it as `closedBy: "session"`, because "a job that never signalled still ends up
completed rather than hanging in the panel forever".

## Tasks

| ID | Spec | Route | Commit | Outcome |
| --- | --- | --- | --- | --- |
| T1 | S1-S6 | inline | pending | This document. |
| T2 | S1, S2 | worker | cab31c8 | Carrier record writer in LOON: `extensions/lib/inline-carrier.ts` plus `extensions/inline-work.ts`, registered in `package.json`. One record per session under `<agent home>/state/loon-inline/`, created with the first tool call, heartbeating while it runs, closed as `completed` with the closing summary, deleted at shutdown, stale records pruned by pid, and `LOON_INLINE_WORK=0` as the kill switch. |
| T3 | S1, S2 | worker | 5c27faa | `gentle-agents` patch merging the active session's carrier into `visibleTasks()`. Display only: the record never enters the task store, so it is never an owned subagent, never cancellable and never launch authority. |
| T4 | S4 | inline | 5c27faa | `scripts/apply-inline-carrier-patch.mjs`: check/apply/revert, timestamped backup, verified idempotent rerun, TypeScript syntax gate, and the README note on when it must be rerun. |
| T10 | S3, S5 | inline | 8104eee | Collapsed renderer through `pi.registerToolRenderer` from `extensions/inline-work.ts`: while the session has a carrier, `read`, `bash`, `grep`, `find`, `ls`, `edit` and `write` draw zero rows (`renderShell: "self"` plus an empty component, which makes `ToolExecutionComponent.render` return no lines). Anything else delegates to `next()`, unchanged: subagent tasks, questions, `todo`, `codemode`, every non-target tool. An errored result delegates to `next()` so the failure keeps its own rows, and `LOON_INLINE_WORK=0` never registers the resolver at all. |
| T14 | S3, S5 | inline | dde0728 | `codemode` joins `COLLAPSED_TOOL_NAMES`, because an agent that works through `codemode` makes every single call through that one tool and the seven file and shell names left its transcript exactly as flooded as before. Tests first, asserting rows: the call collapses while a carrier is live, a failed `codemode` call still draws its row (pi builds the render context with the result's own error flag), `Ctrl+O` expansion brings it back, a session without a carrier is untouched, and `LOON_INLINE_WORK=0` still registers no renderer. The seven original names stay covered by the same test. Box `port`: targeted 14/14 pass, `npm run typecheck` the one pre-existing `theme-file` TS2307, suite 217 tests / 211 pass / 2 `probe-frame` tmux failures identical at base. |
| T15 | S7, S8 | inline | 49185b8 | The unit's thread, built in memory as the unit runs: one `tool` item per top-level call (`{ kind: "tool", callId, name, args, output, running, isError }`, the shape `applyTaskEvent` builds), a bounded summary instead of raw output, and the closing result text as a `text` item. Nested calls (`parentToolCallId`) are skipped, as the carrier already does. |
| T16 | S7, S9 | inline | 49185b8 | Persist the closed unit into gentle-pi's history directory as `{ task, thread }`, with per-unit ids (`loon-inline-<sessionId>-<n>`) so a second unit never overwrites the first; atomic write, no deletion on shutdown, no gentle-pi file touched. |
| T17 | S7, S9 | inline | 49185b8 | README and this file: what survives a reload, what the panel now shows and its detail thread, what the widget card shows while a unit runs (the overlay reads the store), and how unit ids are allocated. |
| T18 | S10, S11, S13 | inline | 302c445 | Provider for the overlay: `extensions/lib/inline-overlay.ts`, registered on `globalThis` from `extensions/inline-work.ts` at session start and removed at shutdown. Tasks = live carrier plus this session's history records, deduped by unit number and minus the ids the store already has; thread = the history record's, or the live one from a sidecar `<state>/loon-inline/<sessionId>.thread.json` rewritten as the unit works. Every read is wrapped: a broken file is absent, never an error card. |
| T19 | S10-S12 | inline | 302c445 | `scripts/apply-inline-carrier-patch.mjs` becomes a two-file patch: `extensions/gentle-agents.ts` (the card list) and `lib/agents-view.ts` (the panel list and its detail). Each anchor exact-once, each failure naming its anchor; `check` reports both files; same backup, same manifest, same digest-verified revert. |
| T20 | S10-S13 | inline | 302c445 | Tests first: a copy of the installed `lib/` gets the patch, is imported with jiti and rendered, so the assertions are about what the panel draws — one card while the unit runs, one after it closes, none duplicated once the store restored it, a non-inline task unchanged, a malformed record absent, and an anchor mismatch refused before any write. |
| T22 | S14, S15, S17 | inline | 608f065 | The card is the job: `jobId(sessionId)` as the record id, one file rewritten at every close, the thread accumulating with a `note` divider where a new request began, totals summed and the status taken from the newest description of the job. |
| T23 | S16 | inline | 608f065 | `consolidateLegacyHistory`: at session start, the numbered records the previous design wrote are merged into the job record and removed, so a resume brings one card. |
| T33 | S23 | inline | CODIGO | Collapse `assistant-thinking` under the same knob with its own marker, and keep the text by appending each finished block to the job thread as a `kind: "thinking"` item (bounded at 4000 chars, captured when streaming ends, deduped against repaints). Verified against the host that the hook receives thinking: `assistant-message.js:118` builds the block with `createMarkdownTransform("assistant-thinking", …)`; with thinking hidden by config the transformer never runs and nothing is captured. |
| T32 | S22 | inline | 2824730 | The reader's half of the no-flicker guarantee: the live carrier is the authority for its own job id, so a persisted record can never override it on a repaint — the "newest description" comparison is gone, which was the only path by which a finished record could win while the work continued. Tested with the dangerous pair (history `completed` and newer, carrier `running`, same id). |
| T31 | S22 | inline | 6a6fb8c | Pin the no-flicker rule with a test that reads the card between every turn of a three-turn job (running, and no record written), and close T17 in the README: the panel thread holds the assistant prose, so with the prose collapse off the same paragraph is visible twice by design — not a TUI compositing leak. |
| T29 | S22, S23 | inline | 5e72520 | The job lifecycle: numbered job ids, `openJob` on the first activity after a close, `closeJob` only on the agent's signal, the idle fallback and the shutdown, per-job totals, and `scripts/inline-job.mjs` (`end`/`status`) as the signal the agent runs. |
| T30 | S22, S23 | inline | 5e72520 | Tests and docs: three turns are one card and still running; the signal closes it with the accumulated thread; the next request opens a new card; the idle fallback records its reason; a session ending with a job open closes it; a restore brings one card; the README documents the exact command. |
| T27 | S20, S21 | inline | 67900f3 | `extensions/lib/inline-transcript.ts`: `transcriptMode` (`summary`/`off`/`full`, unknown values falling back to the default), the marker, the bounded first-decision memory, and the transformer; wired from `extensions/inline-work.ts` through `registerMarkdownTransformer`, with the closing answer exempted at `agent_end` and one repaint requested. |
| T28 | S20, S21 | inline | 67900f3 | Tests and docs: an assistant message collapses while live; the same text stays collapsed on a later repaint; the closing answer renders in full and stays that way; a user message and the thinking text are byte-identical; `full` and `LOON_INLINE_WORK=0` change nothing; with no carrier nothing is transformed; the cap forgets oldest first; the README explains the knob, the marker and the cap. |
| T25 | S18, S19 | inline | 0930de4 | The collapse gate becomes the session (`sessionId !== undefined && !closed`), so the first call of a unit collapses like the rest and a `codemode` unit that is one call leaves no row. Tests first: the first call before any carrier exists, a call mid-unit, and a call right after a unit closed; plus the narrow truth that a session which never started keeps its rows. |
| T26 | S18, S19 | inline | 0930de4 | README and this file: the gate is the session, why the carrier cannot gate it (pi builds the row while streaming), and the `renderShell` evidence that the mechanism itself was never the problem. |
| T24 | S14-S17 | inline | 608f065 | Tests and docs: two requests in one session are one card with both transcripts in order; a restore of that session brings one card; a finished stretch beside a running one says running; the totals add up; a malformed record is still absent; the README explains the job, the divider and the merge. |
| T21 | S10-S13 | inline | 302c445 | README and this file: the panel now shows a running unit and flips it, the two patched files, the two anchors, and what a version mismatch does. |
| T11 | S5 | dropped | The panel entry still has no detail thread: `agents-view.threadWindow` reads `store.thread(id)` and the carrier never enters the store, so a carrier's thread is always empty. Giving it one needs either a thread field the view reads for non-store ids or a second patch site, so it is its own slice and the collapsed detail stays in the session log until then. |
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

L16. Order (verbatim, in parts): the owner requires that "the inline worker must stay in the
Agents panel with its transcript, including after a reload. Today the carrier is deleted at
shutdown, so a reload erases it, and it never enters the store, so its detail thread is
empty. He wants both." Build on gentle-pi's history rather than inventing a second mechanism:
"one JSON file per finished task at `historyDir(home, agentHome)` =
`~/.pi/agent/gentle-agents/tasks/<id>.json`, shaped `{ task: TaskRecord, thread: TaskThread }`";
"`fileFor` requires the id to match `/^[a-z0-9-]+$/i`"; "On session start gentle-pi calls
`loadHistory(tasksDir)` and re-adds those tasks to the store (`restoredTaskIds`); the panel
renders `visibleTasks()` = `store.list(sessionId)`, while only the widget filters restored and
non-owned ids. The thread view is `store.thread(task.id)`."
Decisions: persist through that file, not a private format; the thread is the transcription,
bounded; keep the live carrier as it is and stop deleting the persisted history on reload or
shutdown; do not modify gentle-pi's files, no new `node_modules` patch; if the panel filters
restored tasks so the card still does not appear, "stop and report that with the exact filter,
and propose the smallest option — do not patch"; tests first, five named checks including "a
second unit in the same session does not overwrite the first" and "nothing is written when the
unit never started"; acceptance is the owner running a unit, reloading Pi, opening
`/gentle:agents` and finding the `gentle-ai-worker · inline` card with its transcript.

L17. The id had to change, and this is why. S7 names the id `loon-inline-<sessionId>`, and the
same order requires that "a second unit in the same session does not overwrite the first".
One fixed id per session cannot do both: the second unit's file would replace the first. The
record now carries `loon-inline-<sessionId>-<n>`, with `n` allocated one past the highest
record already on disk and never below the number this process has handed out, so a resumed
session continues the sequence. The live carrier file keeps its name
(`state/loon-inline/<sessionId>.json`, which is what the patch reads); only the `id` field
inside carries the unit, so the live card and the persisted record share an id and gentle-pi's
duplicate guard still works.
Where the card actually comes from, verified in the installed gentle-pi 4.5.1: the overlay
panel lists `store.list()` (`lib/agents-view.ts:573`) and renders `store.thread(task.id)`
(`:743`), while only the widget card above the editor goes through `visibleTasks()`. So the
persisted-and-restored record is what makes the panel work, and a unit that is still running
appears in the card but not in the panel until it closes and is restored.
The restore gate is gentle-pi's own (`extensions/gentle-agents.ts:2562`):
`event.reason === "resume" || (event.reason === "startup" && sessionManager.getEntries().length > 0)`.
`new`, `fork` and an in-process `reload` never restore; that is the behaviour the acceptance
run needs to match, and it is documented in the README rather than patched.
Verification: box `port`, targeted `tests/inline-history.test.ts` exit 0 (5 pass, 3 skipped
because they need the installed gentle-pi), `npm run typecheck` exit 2 with only the
pre-existing `theme-file` TS2307, `npm test` 225 tests / 216 pass / 2 fail / 7 skipped with the
two `probe-frame` tmux failures identical at base. On this machine, where gentle-pi is
installed, all eight tests of the file pass, including the one that loads `loadHistory` and
`TaskStore` from the installed package and checks that the restored store lists the card and
keeps its thread.
L18. Work order for T15, verbatim, because the words carry the limits:
"He sees two `gentle-ai-worker` cards for what is one unit. The panel is showing both the
record restored into the store and the one our patch merges, or the live carrier plus the
restored record. Whatever the pair is, two cards for one unit is wrong and it is the reason
dedupe must be explicit." And: "It has to appear in real time, without restarting Pi each
time. Today the overlay only sees a unit after a `session_start` with reason `resume`
restores it, which is unusable for actual work."
"Real-time means: while the unit runs it shows as running from the live carrier; when it
closes it flips to completed from the history file just written; no restart at either step."
"Keep the durable half you built: restarting still restores through gentle-pi's history. The
patch is for liveness, not for persistence, and losing it must degrade to what we have today,
not to a broken panel."
Constraints on `node_modules`, "which now becomes a second patched file": "Fail closed on an
unknown shape. ... A patch that half-applies to a newer gentle-pi is worse than no patch."
And acceptance: "I ask for work, open `/gentle:agents` while the unit is running and see it,
watch it flip to completed when the turn ends, see its thread, and see one card, not two — all
without restarting Pi."
The repaint was not something to invent: the view already refreshes on the presence tick it
reschedules every second (`lib/agents-view.ts:246-258` calls `refreshTasks()` and
`requestRender()`), so reading the provider at merge time is enough for the flip to arrive on
its own. The patch's two anchors are the `const local = this.deps.store.list()...` statement
in `refreshTasks` and the `threadLines(... store.thread(task.id) ...)` call in
`threadWindow`.

L19. What the panel patch is, and what it costs. Two anchors in
`lib/agents-view.ts`: the `const local = this.deps.store.list()...` statement in
`refreshTasks` (kept byte for byte, with the provider's records pushed after it, so the
panel's own filtering, ordering and cap still run over everything it draws) and the
`threadLines(... store.thread(task.id) ...)` line in `threadWindow` (replaced, with the
provider consulted before the store and the store kept as the fallback). Both read one
global, `__loonInlinePanel`, which `extensions/inline-work.ts` publishes on `session_start`
and withdraws on `session_shutdown`.
The three sources of a card are merged by unit, not by file: `unitKey` splits on the session
id, because a session id can itself end in digits and splitting on the last dash read a
session as a unit — the test that caught it asserts
`unitKey('loon-inline-sess-1', 'sess-1') === 'loon-inline-sess-1#legacy'`. Ids the store
already serves are dropped before anything is returned, so a restore cannot double a card, and
a numberless carrier is dropped once the session has a numbered record.
The live transcript is a sidecar, `state/loon-inline/<session>.thread.json`, rewritten on
every step and removed with the carrier at shutdown; the carrier file keeps its TaskRecord
shape so the card patch and its duplicate guard keep reading it the same way.
Verification: box `port`, targeted exit 0 (23 pass, 5 skipped — the view tests need the
installed gentle-pi and skip there), `npm run typecheck` exit 2 with only the box's
pre-existing `theme-file` TS2307 (clean on this machine), `npm test` 242 tests / 228 pass /
2 fail / 12 skipped with the two `probe-frame` tmux failures identical at base. On this
machine the five view tests run against a copy of the installed `lib/` with the real patch
applied and the real `AgentsView` rendered: one card while running (`◐` and the live thread),
one card after closing (`✓`, closing text, no second card), one card when the store restored
the same unit, byte-identical rows for a non-inline subagent, and zero cards for a malformed
record.
The live install was patched with this script (both files verified, backup
`loon-inline-carrier-patch-20261030124038`). A gentle-pi whose anchors moved is refused with
the file and the anchor named, and neither file is written.

L20. Work order for T16 and T17, verbatim where it decides behaviour. T16: "He rejects one card
per unit: 'one card per job, not one per message the model launches'. Today every turn is a unit,
so a long session piles up cards for what a human reads as one piece of work." With it: the card
stays open and accumulates with a divider; totals aggregate; "Status: running while any unit is
open, completed when none is. Do not let a closing unit mark the job completed while another is
running"; persistence keeps working and "a restore must not resurrect one per unit"; "Dedupe
stays keyed by job".
T17 is a diagnosis, not a fix: "Establish where those lines can come from: our provider writing
into the transcript, the patched `visibleTasks()` card being echoed, the overlay leaving its
content in scrollback on close, or a repaint artifact of the view. Do not patch anything to hide
it until you can name the source."
What the read establishes, so far: (1) no LOON code writes to the transcript - the extension
writes files, the patched `visibleTasks()` returns a list, and the patched `agents-view.ts`
returns strings from `Component.render()`; the collapsed renderer can only remove rows, never
add them. (2) The panel is a pi overlay (`ctx.ui.custom(..., { overlay: true, overlayOptions:
{ width: '100%', maxHeight: '100%', margin: 0 } })`) and pi-tui composites it into the last
`termHeight` rows of the frame (`pi-tui/dist/tui.js`, `renderFrame`): `workingHeight =
Math.max(result.length, termHeight, minLinesNeeded)`, `viewportStart = workingHeight -
termHeight`, overlay lines written at `viewportStart + row + i`. That function carries a comment
about a past bug where frame inflation "pushed content into scrollback on terminal widen", which
is the same class of leak and the same file. (3) In regular (scrollback) TUI mode, a frame taller
than the terminal is committed, so anything that inflates the frame while the overlay is open is
a candidate: an overlay that fills the screen (`maxHeight: 100%`, `margin: 0`), a resize, and
content that changes under it - our provider changes on every step, and the panel repaints every
second.
Not yet decided, and not patchable until it is: whether the leak comes from the compositor's
inflation path or from a repaint after `hide()`. The two facts that decide it need pixels: the
TUI mode (regular vs fullscreen) and whether the rows appear while the panel is open or only
after closing it.

L21. Verification for T22-T24. Box `port` (Node v22.23.3, `npm ci` exit 0): targeted
`inline-history`, `inline-overlay`, `inline-overlay-view` and `inline-carrier-patch` exit 0
with 29 pass and 9 skipped (the ones that need the installed gentle-pi); `npm run typecheck`
exit 2 with only the box's pre-existing `theme-file` TS2307, and 0 errors on this machine;
`npm test` 244 tests / 229 pass / 2 fail / 13 skipped, the two failures the `probe-frame`
tmux pair identical at base. On this machine all 244 pass.
One consequence worth writing down rather than discovering: when a resume has already put the
job record in gentle-pi's store, the provider defers to it, because adding ours would be the
same job twice. The card then shows the restored status until the process restarts, while its
detail keeps updating live. It is the price of never showing two cards and it is the one place
where "running while any unit is open" does not hold; a session that never disappears from the
store is not affected.

L22. Work order for T18 and T19, and the diagnosis it asked for. The owner: "The collapse is not
hiding anything on the owner's machine ... the content of the inline unit must be hidden from the
main render and live only in the subagents menu. What he pasted from the panel is exactly what
also appears in the transcript: the `codemode` tool row, its `Output`, `Script completed · 14
lines`, and the text item." T18: "diagnose before fixing, and name the mechanism". T19: "while a
unit is live, its tool rows must not reach the transcript at all, from the first call to the
last, including the moment where the carrier is being created. If the carrier cannot exist before
the first call, the fallback is to collapse unconditionally whenever this session is the inline
worker's session".
Diagnosis, from the installed pi 1.4.0 and this repository:
1. The resolver **is** invoked. `InteractiveMode.getRegisteredToolDefinition(toolName)`
   (`dist/modes/interactive/interactive-mode.js:1706`) runs `extensionRunner.resolveToolRenderers(
   toolName, () => withBuiltInRenderers(toolName, session.getToolDefinition(toolName)))`
   (`core/extensions/runner.js:542`), and that is called from each `new ToolExecutionComponent(
   ...)` site: `:2815` (`message_update`, while the assistant message streams), `:2886`
   (`tool_execution_start`) and `:3227` (history replay).
2. The suspicion was right, and it is the whole bug: the component for a call is built on
   `message_update`, i.e. **before the tool runs**, so at that moment our gate `written &&
   !closed` is still false for the first call of a unit and the resolver returns `next()` -
   pi's own renderer. From the second call of the same unit the gate is true and the row
   collapses. A unit driven through `codemode` can be a single call, so what the owner pasted
   is one unit's only call, drawn natively, with its `Output` and `Script completed · N lines`
   result.
3. `renderShell: "self"` is honoured and was never the problem: `getRenderShell()` reads
   `toolDefinition?.renderShell ?? "default"` (`components/tool-execution.js:71`), the
   constructor attaches only `selfRenderContainer` for that shell (`:54-56`), and `render()`
   returns `[]` when that container draws no lines and there are no images (`:159-168`).
   `withBuiltInRenderers` only supplies read/bash/powershell/edit/write/grep/find/ls, so
   `codemode` is rendered by whatever definition our resolver passes through.
4. The second gate is not what it looked like: nothing in this repository sets `closed` at
   `agent_end`; it flips only at `session_shutdown`, so a call after a unit closes already
   collapsed. The evidence for that is the test that now covers it.
The fix is one expression - the gate becomes `sessionId !== undefined && !closed` - and the
tests are the policy: the first call of a unit collapses before any carrier exists, a call
mid-unit collapses, and a call right after a unit closed collapses, while a session that never
started keeps its rows.
This also closes T17. The panel-shaped content in the main render was not a compositing leak: it
was the `codemode` row - the call itself, its output and its `Script completed · N lines`
result - that the collapse never hid, because the gate raced the carrier. The shapes match
exactly: a `codemode` unit is one call, and one call was precisely what leaked. The TUI
compositing path read in T17 remains a candidate only for content that survives this fix; with
the gate moved, the test that a `codemode` call draws zero rows is the measurement that
distinguishes them.

L23. Verification for T25-T26. Box `port` (Node v22.23.3, `npm ci` exit 0): targeted
`tests/inline-collapse.test.ts` exit 0 with 16 pass; `npm run typecheck` exit 2 with only the
box's pre-existing `theme-file` TS2307, 0 errors on this machine; `npm test` 246 tests / 231
pass / 2 fail / 13 skipped, the two failures the `probe-frame` tmux pair identical at base. On
this machine 246/246 pass.
What this slice cannot prove on its own: the pixels. The row is drawn by pi's TUI, and the
assertion here is the component the host would draw (zero lines for a `renderShell: "self"`
call whose self container is empty) plus the ordering fact that made the old gate wrong, read
from the host source. The acceptance is a person restarting pi, asking for work that goes
through `codemode`, and seeing no tool row in the transcript while the panel shows the unit.

L24. Work order for T20, verbatim where it decides behaviour. "Your T18 diagnosis is moot and I am
closing it: the owner's screenshots show the transcript with zero tool rows. The tool collapse
works. What he sees duplicated is the assistant prose - the same paragraphs appear in the
transcript and as Text items in the panel thread. So the remaining complaint is about prose, not
rows." Then: "`LOON_INLINE_TRANSCRIPT` with three values. `summary` is the default: while the
inline carrier is live, an assistant message renders as one compact line (the first heading or
first line, truncated, plus something like · inline · /gentle:agents), and the full text lives in
the panel thread. `off`: assistant prose renders as that marker with no excerpt. `full`: today's
behaviour, untouched." "User messages, assistant-thinking, and any message while no carrier is
live are never transformed." "The closing message of the turn stays legible in full." "Stickiness
matters: a message collapsed while the unit was live must not expand on a later repaint ... Remember
what you collapsed by content, not by live state." "Bounded memory: the remembered set must not
grow without limit over a long session; cap it and say what happens at the cap."
The hook is the one verified in the installed pi 1.4.0: `MarkdownTransformContext { messageType:
"user" | "assistant" | "assistant-thinking"; isStreaming: boolean; availableWidth: number }` and
`registerMarkdownTransformer(transformer)` (`core/extensions/types.d.ts:1160-1165, 1252`).
What the implemented rules add, and why: the first decision is remembered for **both** outcomes
(`collapsed`, `kept`, `exempt`), because remembering only the collapsed ones would let a live
repaint shrink text that was already history when the unit began. The answer is identified by its
trimmed text and, for long answers, by its first 120 characters, because a renderer can normalise
the edges of a message and the one message that must never collapse is the answer. The exemption
survives later units, so a repaint during the next request cannot eat it.
The cap is 500 decisions. At the cap the oldest is forgotten and that message is decided again on
its next render: while a unit is live that means it collapses again, and for a forgotten exempt
answer it would collapse too - stated in the README rather than hidden, and out of reach of a
normal session, since the closing message of each turn is one of the 500.

L25. Verification for T27-T28. Box `port` (Node v22.23.3, `npm ci` exit 0): targeted
`tests/inline-transcript.test.ts` and `tests/inline-collapse.test.ts` exit 0 with 31 pass;
`npm run typecheck` exit 2 with only the box's pre-existing `theme-file` TS2307, 0 errors on
this machine; `npm test` 261 tests / 246 pass / 2 fail / 13 skipped, the two failures the
`probe-frame` tmux pair identical at base. On this machine 261/261 pass.
What this slice cannot prove on its own: the pixels, and the order between pi's final render of a
message and `agent_end`. The transformer's behaviour is pinned by tests; the repaint request is
`ctx.ui.setWidget('loon-inline-prose', undefined)`, which in the installed host calls
`renderWidgets()` (`interactive-mode.js:1853-1864`); if a build ever made that a no-op the
answer would still expand on the next natural repaint (the streaming-end frame or the card's
one-second tick), so the failure mode is late, not lost.

L26. Work order for the job lifecycle, verbatim where it decides behaviour. "a job is the WORK he
asked for, not a turn. If he asks for something and it gets done inline, that is one worker, and
it must stay running across every turn it takes, marking itself completed only when all the work
is done." "A job opens with the first inline activity after the previous job closed." "A job
closes only on an explicit completion signal from the agent ... Give me a cheap way to signal it
that I can call from a tool ... Do not infer completion from the turn ending." "Fallback for a
forgotten signal: a job with no activity for a bounded idle window closes itself as completed, and
says in its record that it was closed by inactivity rather than by the agent." "While a job is
open, every turn appends to the same thread with a divider where a new request began, and totals
aggregate across the whole job." Tests: three turns one card running; the signal flips it with the
accumulated thread; a request after a closed job opens a new card; the idle fallback records its
reason; restore yields one card; "a job that never signalled still ends up completed rather than
hanging in the panel forever."
What this slice replaced: the previous S14-S17 made the job the session and closed it at every
`agent_end`. That is the same defect one level up - one card per message forwarded to the model -
so the session-wide collapse of its records is gone: `overlayTasks` now dedupes by **job id**, and
two jobs of one session are two cards on purpose.
The command the agent runs: `node scripts/inline-job.mjs end` (or the absolute path from another
repository). It resolves the session from `--session`, then `$PI_SESSION_ID`, then by matching a
live carrier's `pid` against this process's ancestors, which is what makes it work when several pi
instances are open. It writes `<agentHome>/state/loon-inline/<sessionId>.close.json`; the
extension reads and deletes it on its next event, so one signal closes one job and the next
request opens the next card.
Idle is ten minutes of **real** activity, not of heartbeats: the heartbeat keeps the record fresh
for the panel's liveness check, so `lastRealActivity` is a separate clock that only moves on tool
calls, messages and turns.

L27. Verification for T29-T30. Box `port` (Node v22.23.3, `npm ci` exit 0): targeted
`inline-history`, `inline-overlay`, `inline-overlay-view` and `inline-carrier` exit 0 with 28
pass and 9 skipped (the ones that need the installed gentle-pi); `npm run typecheck` exit 2 with
only the box's pre-existing `theme-file` TS2307, 0 errors on this machine; `npm test` 264 tests /
249 pass / 2 fail / 13 skipped, the two failures the `probe-frame` tmux pair identical at base.
On this machine 264/264 pass.
What this slice cannot prove on its own: the pixels, and the moment the agent chooses to run the
command - that is a behaviour of whoever is working, not of this code. What the tests do prove is
that the file the command writes is consumed on the next event (`tests/inline-history.test.ts`,
"the agent signal closes the job with the accumulated thread", which writes the same marker the
script writes), and that the command exists and answers (`node scripts/inline-job.mjs status`,
`--help`, and a rejected subcommand).
One consequence, stated rather than discovered later: records written by the earlier design were
one per turn, and this slice does not merge them (merging unrelated jobs would be a lie about the
work). A session that ran the earlier design may therefore show its old records as separate
completed cards; nothing new creates them, and the new numbering starts after the highest one.

L28. The order that asked for this slice said three things, and two of them were already in master
when it arrived. T17: closed as a misdiagnosis of mine - "the transcript contains no panel rows at
all ... what appears in both places is the assistant prose, which the panel records as Text
items ... there is no pi-tui compositing leak to hunt, and you should not spend another minute on
renderFrame." Recorded in the README instead of hunted: the thread holds the assistant prose, so
with the prose collapse off the same paragraph is visible twice by design.
The flicker: "while a job spans three turns, the card must never show completed in between". That
hole was closed in `5e72520`, where `agent_end` stopped completing anything - `closeJob` is the
only writer of `COMPLETED` and it is reached only from the agent's signal, the idle fallback and
the shutdown. What was missing was a test that reads the card *between* turns, so this slice adds
it: 'a job never shows completed between its turns, not for a moment' checks the carrier's status
and that no history file exists after each of three `agent_end`s, then that the signal completes it.
The explicit signal and the idle fallback were not missing: `scripts/inline-job.mjs end` and the
ten-minute idle close landed in `5e72520`, and T20's prose collapse landed in `fb41c42`. The
report that preceded this order listed them; this log records them again so the record is not
read as a gap.
