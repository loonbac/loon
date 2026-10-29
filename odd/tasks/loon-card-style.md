# Card style `loon`

A third conversation-card style in gentle-pi, so the chrome stops using three different
indents. The human chose the full style over just aligning the notices.

## Specs

S1. One content box across the chrome — notices, prompt band, bar, cards and panels:
    two columns of left indent and two of right margin.
S2. A card's border sits in column 0 and its text in column 2; the prompt band's rule
    `▎` sits in column 0 and its text in column 2, so the rule consumes no indent.
S3. The bar draws its left content from column 2 and ends its right block at
    `width - 2`.
S4. Honest degradation: what does not fit is shortened in stages, never mid-glyph and
    never leaving a lone `▱`.
S5. No gentle-pi brand, consistent with the rest of this theme.
S6. Correct with a sidebar (>= 140 columns) and with `headerPlacement: below-input`.
S7. `float` and `neon` keep painting exactly as they do today.
S8. Shared helpers, not a copied renderer: `loon` is a geometry the existing
    `floatRows`/`panelInnerWidth`/`panelHeaderRow`/`panelExtraRows`/`renderCard` read,
    never a parallel pipeline.

## Measured today (the defect)

- notices: indent 1
- status bar: indent 2
- prompt band: rule in column 1, text in column 3
- at 120 columns the band paints 1..118 and the bar 2..117

Three indents, hence the crooked look. (Measured by the human before this document.)

## Targets the patch must cover

Existing four: `extensions/gentle-shell.ts`, `lib/visual-customize-view.ts`,
`extensions/startup-banner.ts`, `lib/shell-bar.ts`.

Two new, as instructed: `lib/shell-card.ts` (the enum and the drawing) and
`lib/card-style-policy.ts` (accept `loon` when reading and writing `card-style.json`,
keeping old `float`/`neon` files valid).

### A third new target is required for S2 — decision pending

`lib/shell-prompt.ts:149` gates the prompt band's painted geometry on the style by name:

```ts
if (style === CARD_STYLE.FLOAT && width >= 10 && bg) { ... }
```

With `loon` active that branch is skipped, so the band falls back to the outlined frame:
rule in column 1, text in column 3, no band background. S2 asks for the rule in column 0 and
the text in column 2, and S1 asks for the background across the chrome, so the band cannot
reach the spec without editing that file.

Consequence: the patch would grow from four to **seven** targets, not six, and
`lib/shell-prompt.ts` is the file that was patched and reverted in #44, so it would need its
pristine md5, anchors, backup and revert entry again.

Alternative if a sixth target is mandatory: `loon` keeps the `float` prompt band exactly
(rule at column 1, text at column 3) and gains the new geometry only for cards, panels and
the bar. Then S2 is only half true and the band is 1 column out of line with the rest.

## Log

L1 (human, verbatim): «yo veo que hay problemas de tamano de ancho, no se ve bonito ni
centrado algunas cosas … para solucionar esto debo ir a la configuracion de Cards · 1/4 Card
style: LOON hay que crear uno nuevo y ahi poner nuestra customizacion de las cards».
L2: the human chose the complete `loon` card style over aligning the indents only.
L3: measurement of the current geometry (notices 1, bar 2, band rule 1 / text 3, band
1..118 and bar 2..117 at 120 columns).
