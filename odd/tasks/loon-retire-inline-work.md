# Feature: retire the inline work view (`loon-retire-inline-work`)

The owner asked for the inline subsystem to be deleted, not adjusted: the
`▸ … · inline · /gentle:agents` line collapses his own prose, which was the whole
point of the feature and is now exactly what he does not want. The transcript goes
back to Pi's own drawing, with the full text and every tool row.

## Specs

S1. The inline subsystem does not exist. No carrier record is written, no live
    thread sidecar, no history record in gentle-pi's history directory, no
    `globalThis.__loonInlinePanel` provider, no markdown transformer, no tool
    renderer registration.
S2. The transcript is Pi's own. The user's message and the assistant's message are
    drawn in full, byte for byte as Pi produces them, and no row carries the
    `· inline · /gentle:agents` marker. Every tool row is drawn by Pi's built-in
    renderer for that tool, including `read`, `bash`, `grep`, `find`, `ls`, `edit`,
    `write` and `codemode`.
S3. No patch teaches gentle-pi anything about inline work: `visibleTasks()` and the
    Agents panel of `/gentle:agents` stay exactly as gentle-pi ships them for this
    feature, and no `loon-inline-carrier-patch.mjs` is installed, applied, checked
    or reverted.
S4. `package.json` ships LOON's own extensions only. `pi.extensions` carries
    `./extensions/loon-startup.ts` and nothing else; `files` and `scripts` carry
    neither `scripts/inline-job.mjs` nor `scripts/apply-inline-carrier-patch.mjs`.
S5. The README does not document the removed subsystem, and no document asserts it
    as shipped. What remains describes what the package still does.
S6. `LOON_INLINE_WORK` and `LOON_INLINE_TRANSCRIPT` have no reader left: setting
    them changes nothing because nothing reads them.
S7. The sections of the README and the paragraph of "Cuando gentle-pi cambia" that
    were only about this feature are removed, not neutralised; the banner patch and
    its self-repair keep their full documentation.

## Tasks

| ID | Specs | Route | Commit |
| --- | --- | --- | --- |
| T1 | S1, S2, S6 | inline | eb25c63 | Drop the extension, its five libs, both scripts and the eight test files. |
| T2 | S4 | inline | eb25c63 | `package.json`: one extension, no inline scripts. `tests/package-contents.test.ts`: the shipped-file assertions name what ships today. |
| T3 | S5, S7 | inline | eb25c63 | Remove the inline documentation from `README.md`. |
| T4 | S1-S7 | inline | eb25c63 | Verify: full suite, typecheck, no `LOON_INLINE` reader, and the surviving extension still loads. |

## Log

L1. Request, verbatim: "[Image#3] no me gusta que esto salga asi, corrigelo para que si
salga completo, porque supuestamente sale algo ahi y deberia verse como subagente, quiero
que borres esa funcionalidad, ya no quiero que se vea trabajo inline en subagentes,
corrige eso"

L2. Scope decision, answered by the owner when asked how far the deletion goes: "Todo el
subsistema inline" — the carrier, the panel overlay, the history, the markdown
transcript collapse, the tool-row collapse, both scripts, their tests, `package.json`
and the README. The partial option (keep the collapse, drop the card) was offered and
rejected, because it keeps the line the owner objects to.

L3. Diagnosis before deleting: the row in the screenshot is produced by
`extensions/lib/inline-transcript.ts`, not by the Agents panel. `node
scripts/apply-inline-carrier-patch.mjs check` reports both gentle-pi files unpatched
("the inline unit would not be drawn there"), so no card is drawn today and the collapse
is the only visible half. Deleting only the carrier patch would have left the row intact.

L4. One work unit, commit `eb25c63`: 204 insertions, 6661 deletions. Deletion of the
feature is one indivisible slice; splitting it would leave a revision where the panel
claims a card that the extension no longer writes. `npm test`: 286 pass, 0 fail, 0
skipped (baseline on master before the deletion: 398 pass, 0 fail; the 112 removed
assertions are the eight deleted inline test files). `npx tsc --noEmit`: exit 0. RED
was observed once on the new retirement guard: it matched its own forbidden literals,
and the guard now excludes itself and the ODD record explicitly.

L5. Runtime state produced by the retired feature is display data, not source: 131
`loon-inline-*.json` history files under `~/.pi/agent/gentle-agents/tasks/` and 9 live
state files under `~/.pi/agent/state/loon-inline/`. No reader remains, so they are
inert. Cleaning them is outside the requested source change and would destroy the
owner's own history; leave them unless the owner asks.

L6. Delivery evidence. Issue #232 (`Retirar el trabajo inline: el transcript debe
mostrar el texto completo`) created against `github.com/loonbac/loon` with the
verification evidence and `Risk: none`, read back and confirmed. The repository has
no issue forms, no PR template, no `type:*` or `status:approved` labels, no
workflows and no branch protection on `master`; those skill gates are therefore
inapplicable and no label or approval was invented. `assess` on `HEAD~2..HEAD`
returned `risk: medium`, `reviewDue: false` (`under_budget`), so no native review
lineage was opened.
