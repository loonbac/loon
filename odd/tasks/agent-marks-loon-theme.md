# Agent marks and the relocated activity row, under a LOON theme

Fifth destination of the gentle-pi patch: with a theme LOON generated (its name ends in
`" (LOON)"`) the rose gives way to the Agent marks, and the working activity leaves the
prompt frame for the row above it — the row where pi's own `⠼ Working` loader would be.
Every other theme keeps gentle-pi's glyphs and its frame, byte for byte.

## Specs

S1. Owner's rule, verbatim: «cuando trabaje el agente no salga ✿ este glifo, cambialo por
    ✻ · ✢ ✳ ✶ ✻ ✽ ⏺ … eso cambiara solo si tengo el theme de LOON puesto en el
    gentle:customize». The rest/primary mark is `✻` (U+273B); while working the mark spins
    through `['·', '✢', '✳', '✶', '✻', '✽', '⏺']`; the card heading mark is `✻`.
S2. Detection is the one convention the patch already uses: `theme.name` is a string
    ending in `" (LOON)"`. No second convention, and a theme with no name fails open to
    the rose.
S3. Every other theme is untouched: `✿` and `['✿', '❀', '❁', '✾']` keep their exact
    bytes, and the exported names (`PROMPT_PETAL`, `CARD_GLYPH`, `petalGlyph`) stay stable.
S4. Owner's second rule, verbatim: «ademas quiero que la animacion de ❁ exploring… que
    sale en el promptbar cuando tengo el tema de loon puesto no salga ahi sino salga en
    ves del ⠼ Working que sale cuando el agente esta haciendo algo, pero que tenga la
    misma funcion que el de gentle pi porque gentle pi cuando esta haciendo una actividad
    sale exacto que esta haciendo su animacion si lanso worker dice algo de worker y asi».
    Under a LOON theme the prompt frame paints neither the activity mark nor the label
    while working; the activity row above the prompt paints the Agent mark plus the same
    dynamic label gentle-pi reports (`oddPhaseRegistry.label()`: `exploring…`,
    `implementing…`, the worker's name).
S5. There is exactly one such row. Pi's native loader row is hidden by gentle-pi itself
    (`ctx.ui.setWorkingVisible(false)`, `extensions/gentle-shell.ts:2808` pristine), so the
    row is painted through the `topRows` mechanism the editor already calls
    (`extensions/gentle-shell.ts:1438` pristine) and appended after the rows the shell
    already owns, so their indices and clicks do not move. Inside a Herdr pane, where
    gentle-pi keeps pi's own loader row on purpose, the extension paints nothing and pi's
    row is the one that speaks.
S6. A scroll indicator is not the activity: it stays in the frame while the label moves.
S7. The patch stays inside `scripts/gentle-pi-patch.ts`: same anchors, same idempotent
    literal replacement, same paranoid apply/revert contract, `md5Patched` recomputed and
    every previously accepted digest kept in `md5PatchedV1`.

## Tasks

T1 (S1, S2) `petalGlyph` takes the flag, `AGENT_MARK_GLYPH` and the seven frames — commit `?`
T2 (S1) `PromptFrameOptions.agentMarks` and the card's `cardGlyph(theme)` — commit `?`
T3 (S4, S5) The flag travels from the theme at the factory to the frame, and the activity
   row is appended to `topRows` — commit `?`
T4 (S1-S6) Behaviour tests over the real `apply` output, imported with jiti — commit `?`
T5 (S7) Digests, lineage, fixtures — commit `?`
T6 Delivery: issue, branch, PR, merge, report — commit `?`

## Log

L1. Measured first, then implemented: the `⠼ Working` row is pi's
    (`dist/modes/interactive/components/status-indicator.js`, `WorkingStatusIndicator`),
    and gentle-pi already hides it with `ctx.ui.setWorkingVisible(false)` because its own
    frame says the same thing. So the activity was never painted by pi while gentle-pi
    owns the prompt: moving it means gentle-pi paints the row itself, which is what S5
    does. Hiding the label alone would have been half the requirement.

L2. The factory's third argument is pi-tui's `EditorTheme` (`borderColor`,
    `selectList`) and carries no name; the active pi theme is `ctx.ui.theme`. The flag is
    therefore taken from `ctx.ui.theme` at the factory and read per render, so switching
    themes needs no new editor.

L3. Non-LOON preservation is measured, not asserted: rendering 262 outputs (frames in
    every style and state, card tops, rows, panels) through the previous code and through
    this change, with the flag absent — the shipped call shape — produces identical bytes.
    With the flag on, the 36 outputs that differ are the glyph, and nothing else.

L4. Rendering is byte-level, not pixels: no pi session was driven with the LOON theme for
    this slice, so the row's on-screen look is verified by the rendered rows, not by a
    screenshot.
