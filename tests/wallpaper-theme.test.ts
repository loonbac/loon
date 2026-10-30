import test from 'node:test';
import assert from 'node:assert/strict';
import { contrastRatio, oklchToHex, rgbToOklch, hexToRgb, relativeLuminance } from '../extensions/lib/oklch.ts';
import {
	CARD_SURFACE_CONTRAST,
	CARD_SURFACE_STEP,
	BORDER_SURFACE_CONTRAST_TARGET,
	CARD_SURFACES,
	CONTRAST_FLOORS,
	DIM_SURFACE_CONTRAST_TARGET,
	ACCENT_SURFACE_CONTRAST_TARGET,
	LOON_THEME_SUFFIX,
	WALLPAPER_THEME_NAME,
	deriveWallpaperTheme,
	isLoonThemeName,
	loonThemeName,
	themeFileName,
} from '../extensions/lib/wallpaper-theme.ts';

/* S4: one naming rule for every theme this package ships. */

test('every LOON theme name ends with the suffix and can be a file name', () => {
	assert.equal(LOON_THEME_SUFFIX, ' (LOON)');
	assert.equal(loonThemeName('Wallpaper'), 'Wallpaper (LOON)');
	assert.equal(WALLPAPER_THEME_NAME, 'Wallpaper (LOON)');
	assert.ok(isLoonThemeName(WALLPAPER_THEME_NAME));
	assert.ok(!isLoonThemeName('Gentleman-Sexy'));
	for (const base of ['Wallpaper', 'Paper', 'A B']) {
		const name = loonThemeName(base);
		assert.ok(name.endsWith(LOON_THEME_SUFFIX), name);
		assert.ok(!name.includes('/'), 'pi reserves / for light and dark settings');
		assert.equal(themeFileName(name), name + '.json');
	}
});

/* S5: conversions and contrast, the numbers the floors are asserted on. */

test('sRGB round-trips through OKLCH and hex', () => {
	for (const hex of ['#9B484A', '#D5A9F0', '#1E90FF', '#000000', '#FFFFFF']) {
		const rgb = hexToRgb(hex);
		assert.ok(rgb);
		const lch = rgbToOklch(rgb!);
		assert.ok(Math.abs(lch.L) <= 1.0001 && lch.L >= 0, hex);
		assert.equal(oklchToHex(lch), hex, hex + ' did not round-trip');
	}
});

test('contrast follows the WCAG ratio', () => {
	assert.equal(Math.round(contrastRatio([255, 255, 255], [0, 0, 0])), 21);
	assert.equal(Math.round(contrastRatio([0, 0, 0], [0, 0, 0])), 1);
	assert.ok(Math.abs(relativeLuminance([255, 255, 255]) - 1) < 1e-9);
});

/* S5: the derivation is pure and always legible. */

test('the derivation is deterministic and does no IO', () => {
	const a = deriveWallpaperTheme([155, 72, 74]);
	const b = deriveWallpaperTheme([155, 72, 74]);
	assert.deepEqual(a, b);
	const c = deriveWallpaperTheme([30, 144, 255]);
	assert.notDeepEqual(a.vars, c.vars, 'two wallpapers must not produce the same palette');
});

test('the theme is named for the rule and carries a full key set', () => {
	const theme = deriveWallpaperTheme([155, 72, 74]);
	assert.equal(theme.name, WALLPAPER_THEME_NAME);
	assert.ok(theme.name.endsWith(LOON_THEME_SUFFIX));
	assert.equal(Object.keys(theme.vars).length >= 25, true, 'too few vars for pi to fill');
	// The same colour key set pi's own themes use: 55 entries.
	assert.equal(Object.keys(theme.colors).length, 55);
	assert.ok(theme.colors.accent, 'the accent must be bound');
	assert.deepEqual(Object.keys(theme.export).sort(), ['cardBg', 'infoBg', 'pageBg']);
});

test('the contrast floors hold for a wide range of wallpapers', () => {
	const accents: [number, number, number][] = [
		[155, 72, 74],
		[213, 169, 240],
		[30, 144, 255],
		[0, 0, 0],
		[255, 255, 255],
		[8, 8, 8],
		[255, 0, 0],
		[0, 255, 0],
	];
	for (const accent of accents) {
		const theme = deriveWallpaperTheme(accent);
		const vars = theme.vars as Record<string, string>;
		const bg = hexToRgb(vars.bg!)!;
		const text = hexToRgb(vars.text!)!;
		const muted = hexToRgb(vars.muted!)!;
		const accentRgb = hexToRgb(vars.accent!)!;
		assert.ok(contrastRatio(text, bg) >= 7, 'text/bg ' + contrastRatio(text, bg).toFixed(2) + ' for ' + accent);
		assert.ok(contrastRatio(muted, bg) >= 4.5, 'muted/bg ' + contrastRatio(muted, bg).toFixed(2) + ' for ' + accent);
		assert.ok(contrastRatio(accentRgb, bg) >= 3, 'accent/bg ' + contrastRatio(accentRgb, bg).toFixed(2) + ' for ' + accent);
		assert.ok(contrastRatio(hexToRgb(vars.dim!)!, bg) >= 3, 'dim/bg must stay readable');
	}
});

test('syntax hues are rotations that stay apart and keep chroma in check', () => {
	const theme = deriveWallpaperTheme([155, 72, 74]);
	const hues = ['syntaxComment', 'syntaxKeyword', 'syntaxFunction', 'syntaxString', 'syntaxNumber', 'syntaxType'].map(
		(key) => rgbToOklch(hexToRgb((theme.vars as Record<string, string>)[key]!)!).H,
	);
	for (let index = 0; index < hues.length; index += 1) {
		for (let other = index + 1; other < hues.length; other += 1) {
			const distance = Math.abs(((hues[index]! - hues[other]! + 540) % 360) - 180);
			assert.ok(distance > 12, 'two syntax hues are too close: ' + hues[index] + ' vs ' + hues[other]);
		}
	}
	for (const key of ['syntaxComment', 'syntaxKeyword', 'syntaxString']) {
		const lch = rgbToOklch(hexToRgb((theme.vars as Record<string, string>)[key]!)!);
		assert.ok(lch.C <= 0.14, key + ' chroma ' + lch.C.toFixed(3) + ' is too loud');
	}
});

/* The prompt card paints its band with `selection` and its edge with `border`, so both
 * have to read as the accent rather than as a borrowed signal colour. */

test('selection is the accent-tinted surface, and text stays legible on it', () => {
	const accents: [number, number, number][] = [
		[213, 169, 240],
		[155, 72, 74],
		[30, 144, 255],
		[0, 0, 0],
		[255, 255, 255],
		[255, 0, 0],
		[0, 255, 0],
		[171, 154, 94],
		[255, 215, 0],
		[0, 128, 128],
	];
	for (const accent of accents) {
		const theme = deriveWallpaperTheme(accent);
		const vars = theme.vars as Record<string, string>;
		const source = rgbToOklch(accent);
		const bg = hexToRgb(vars.bg!)!;
		const text = hexToRgb(vars.text!)!;
		const selection = hexToRgb(vars.selection!)!;
		const lch = rgbToOklch(selection);
		const hueDelta = Math.abs(((lch.H - source.H + 540) % 360) - 180);
		const ratio = contrastRatio(selection, bg);
		assert.ok(hueDelta <= 20, 'selection hue ' + lch.H.toFixed(1) + ' is ' + hueDelta.toFixed(1) + ' away from ' + source.H.toFixed(1));
		assert.ok(lch.C >= 0.35 * source.C, 'selection chroma ' + lch.C.toFixed(3) + ' is below 0.35 x ' + source.C.toFixed(3));
		// The selected row carries two floors: it has to read as a highlight against the
		// background, and stay dark enough for dim to clear its own floor on top of it. The
		// second floor is what moved the lower bound down from 1.9 to the agreed 1.5.
		assert.ok(ratio >= 1.5 && ratio <= 3.2, 'selection/bg ' + ratio.toFixed(2) + ' is outside 1.5..3.2');
		assert.ok(contrastRatio(text, selection) >= 4.5, 'text/selection is ' + contrastRatio(text, selection).toFixed(2));
	}
});

test('border keeps the accent hue and is no longer mud', () => {
	for (const accent of [[213, 169, 240], [171, 154, 94], [30, 144, 255], [255, 0, 0]] as [number, number, number][]) {
		const theme = deriveWallpaperTheme(accent);
		const vars = theme.vars as Record<string, string>;
		const source = rgbToOklch(accent);
		const bg = hexToRgb(vars.bg!)!;
		const border = hexToRgb(vars.border!)!;
		const lch = rgbToOklch(border);
		const hueDelta = Math.abs(((lch.H - source.H + 540) % 360) - 180);
		const ratio = contrastRatio(border, bg);
		assert.ok(hueDelta <= 20, 'border hue is ' + hueDelta.toFixed(1) + ' away from the accent');
		assert.ok(lch.C >= 0.5 * source.C, 'border chroma ' + lch.C.toFixed(3) + ' is below 0.5 x ' + source.C.toFixed(3));
		// Against `bg` the role only has to stay visible. The upper bound it used to carry
		// came from solving it against `bg` alone: the card surfaces are lighter than
		// `bg`, so clearing them necessarily lifts the role past 3.2 here.
		assert.ok(ratio >= 1.8, 'border/bg ' + ratio.toFixed(2) + ' is below 1.8: the border reads as mud');
		// The band paints its rule with `border` over the `selection` surface, so the lift
		// must not quieten it. 1.40 was the measured value before the role answered to the
		// card surfaces; a rule that gets quieter than that is a regression.
		const onSelection = contrastRatio(border, hexToRgb(vars.selection!)!);
		assert.ok(
			onSelection >= 1.4,
			'border/selection is ' + onSelection.toFixed(2) + ' for accent ' + accent.join(',') + ', below the 1.40 it had before the card lift',
		);
	}
});

/* `border` is ink that lands on card surfaces: the frame of a card, the prompt band's
 * rule, a quote edge. Solved against `bg` alone it read 1.49 on the lightest card while
 * the role's own floor was green - the same defect `dim` had before dd24afe. A border is
 * a non-text component, so WCAG 1.4.11 asks 3.0 and not 4.5. */

test('border clears its floor on the card surfaces, for every accent', () => {
	for (const accent of SURFACE_ACCESSENTS) {
		const vars = deriveWallpaperTheme(accent).vars as Record<string, string>;
		const border = hexToRgb(vars.border!)!;
		for (const surface of CARD_SURFACES) {
			const ratio = contrastRatio(border, hexToRgb(vars[surface]!)!);
			assert.ok(
				ratio >= CONTRAST_FLOORS.borderSurface,
				'border/' + surface + ' is ' + ratio.toFixed(2) + ' for accent ' + accent.join(',') + ' (' + vars.border + '); the floor is ' + CONTRAST_FLOORS.borderSurface.toFixed(1) + ' and the target ' + BORDER_SURFACE_CONTRAST_TARGET.toFixed(1),
			);
		}
	}
});

/* A var that no role of `colors` reads and no `export` token names is a colour that never
 * gets painted: `accentDim` was one and `bgSubtle` was another. Naming them one at a time
 * only catches the dead var somebody already noticed, so the rule is what gets asserted -
 * and `bg`/`bgPanel` stay legal through `export` (`pageBg`, `infoBg`). */
test('every derived var is read by a role or named by an export token', () => {
	for (const accent of [[158, 159, 161], [155, 72, 74], [30, 144, 255]] as [number, number, number][]) {
		const theme = deriveWallpaperTheme(accent);
		const read = new Set([...Object.values(theme.colors), ...Object.values(theme.export)]);
		const unread = Object.keys(theme.vars).filter((name) => !read.has(name));
		assert.deepEqual(unread, [], 'vars nobody reads: ' + unread.join(', ') + ' for accent ' + accent.join(','));
	}
});

/* A card surface is not a status: gentle-pi paints INFO/SUCCESS/PENDING/ERROR card
 * backgrounds with the tool*Bg roles and carries the tone in the border and title. */

const SURFACE_ACCESSENTS: [number, number, number][] = [
	[213, 169, 240], // violeta
	[171, 154, 94], // dorado
	[155, 72, 74], // rojo
	[30, 144, 255], // azul
	[34, 197, 94], // verde
	[0, 0, 0], // pared negra
];

test('the card surfaces follow the accent hue and stay low-chroma', () => {
	const CARD_SURFACES = ['toolSuccessBg', 'toolPendingBg', 'toolErrorBg'] as const;
	for (const accent of SURFACE_ACCESSENTS) {
		const theme = deriveWallpaperTheme(accent);
		const vars = theme.vars as Record<string, string>;
		const source = rgbToOklch(accent);
		const bg = hexToRgb(vars.bg!)!;
		const text = hexToRgb(vars.text!)!;
		for (const role of CARD_SURFACES) {
			const hex = vars[role];
			assert.ok(hex, role + ' is missing from the theme');
			const rgb = hexToRgb(hex!)!;
			const lch = rgbToOklch(rgb);
			const hueDelta = Math.abs(((lch.H - source.H + 540) % 360) - 180);
			const ratio = contrastRatio(rgb, bg);
			const label = role + ' on accent ' + accent.join(',') + ' (' + hex + ')';
			assert.ok(hueDelta <= 15, label + ' hue ' + lch.H.toFixed(1) + ' is ' + hueDelta.toFixed(1) + ' from the accent');
			assert.ok(lch.C >= 0.01 && lch.C <= 0.035, label + ' chroma ' + lch.C.toFixed(3) + ' is outside 0.010..0.035');
			assert.ok(
				ratio >= CARD_SURFACE_CONTRAST && ratio <= CARD_SURFACE_CONTRAST + 2 * CARD_SURFACE_STEP + 0.05,
				label + ' /bg ' + ratio.toFixed(2) + ' is outside the ladder at ' + CARD_SURFACE_CONTRAST,
			);
			assert.ok(contrastRatio(text, rgb) >= 7, label + ' text/surface ' + contrastRatio(text, rgb).toFixed(2) + ' is below 7');
		}
	}
});

test('the card surfaces are placed by contrast, not by a fixed lightness', () => {
	// The defect this replaces: one L for every background meant 1.16 against one
	// wallpaper and something else against another, so the band read as a colour cast
	// and then disappeared. Contrast is the promise now, whatever the accent is.
	for (const accent of SURFACE_ACCESSENTS) {
		const theme = deriveWallpaperTheme(accent);
		const vars = theme.vars as Record<string, string>;
		const bg = hexToRgb(vars.bg!)!;
		const text = hexToRgb(vars.text!)!;
		for (const role of ['toolSuccessBg', 'toolPendingBg', 'toolErrorBg']) {
			const rgb = hexToRgb(vars[role]!)!;
			const ratio = contrastRatio(rgb, bg);
			const label = role + ' on accent ' + accent.join(',');
			assert.ok(ratio >= CARD_SURFACE_CONTRAST, label + ' /bg ' + ratio.toFixed(3) + ' is below ' + CARD_SURFACE_CONTRAST);
			assert.ok(
				rgbToOklch(rgb).L > rgbToOklch(bg).L,
				label + ' sits at or below the background lightness, so it is not a surface',
			);
			assert.ok(rgbToOklch(rgb).L < rgbToOklch(text).L, label + ' is lighter than the text');
		}
	}
});

test('the three card surfaces never collapse into one colour', () => {
	// This is the regression that shipped once: two of the three landed on the same hex
	// and gentle-pi painted INFO, PENDING and ERROR cards in one flat colour. A test has
	// to see it, because the eye does not.
	for (const accent of SURFACE_ACCESSENTS) {
		const vars = deriveWallpaperTheme(accent).vars as Record<string, string>;
		const hexes = ['toolSuccessBg', 'toolPendingBg', 'toolErrorBg'].map((role) => vars[role]!);
		assert.equal(new Set(hexes).size, 3, 'accent ' + accent.join(',') + ' gave ' + hexes.join(' '));
	}
});

test('the tone signal stays semantic: success, warning and error keep their hues', () => {
	for (const accent of SURFACE_ACCESSENTS) {
		const theme = deriveWallpaperTheme(accent);
		const vars = theme.vars as Record<string, string>;
		const hueOf = (role: string) => rgbToOklch(hexToRgb(vars[role]!)!).H;
		const near = (hue: number, target: number) => Math.abs(((hue - target + 540) % 360) - 180) <= 15;
		assert.ok(near(hueOf('success'), 150), 'success hue ' + hueOf('success').toFixed(1));
		assert.ok(near(hueOf('warning'), 75), 'warning hue ' + hueOf('warning').toFixed(1));
		assert.ok(near(hueOf('error'), 25), 'error hue ' + hueOf('error').toFixed(1));
	}
});

/* The hint role lands on card surfaces, not on the background: the band and every card
 * paint their text over toolSuccessBg / toolPendingBg / toolErrorBg. Solving dim against
 * bg alone let it fall to 2.43 on the lightest one. WCAG AA for large text (3.0) is the
 * honest floor for secondary text, with a margin over it so an accent that rotates and
 * rounds cannot land back underneath. */

const SURFACE_PROBES = ['toolSuccessBg', 'toolPendingBg', 'toolErrorBg'] as const;

function dimRoleMessage(label: string, ratio: number, accent: [number, number, number], floor: number): string {
	return label + ' is ' + ratio.toFixed(2) + ' for accent ' + accent.join(',') + '; the floor is ' + floor.toFixed(1) + ' and the target ' + DIM_SURFACE_CONTRAST_TARGET.toFixed(1);
}

test('dim clears its floor on the lightest surface it lands on, for every accent', () => {
	const accents: [number, number, number][] = [
		[155, 72, 74],
		[213, 169, 240],
		[30, 144, 255],
		[0, 0, 0],
		[255, 255, 255],
		[8, 8, 8],
		[255, 0, 0],
		[0, 255, 0],
	];
	for (const accent of accents) {
		const vars = deriveWallpaperTheme(accent).vars as Record<string, string>;
		const dim = hexToRgb(vars.dim!)!;
		for (const surface of SURFACE_PROBES) {
			const ratio = contrastRatio(dim, hexToRgb(vars[surface]!)!);
			assert.ok(
				ratio >= CONTRAST_FLOORS.dimSurface,
				dimRoleMessage('dim/' + surface, ratio, accent, CONTRAST_FLOORS.dimSurface),
			);
		}
		// The hierarchy is what makes a hint a hint: text > muted > dim, and muted keeps its
		// distance from dim on the background.
		const bg = hexToRgb(vars.bg!)!;
		const text = contrastRatio(hexToRgb(vars.text!)!, bg);
		const muted = contrastRatio(hexToRgb(vars.muted!)!, bg);
		const onBg = contrastRatio(dim, bg);
		assert.ok(text > muted && muted > onBg, 'the text hierarchy collapsed for accent ' + accent + ': ' + text.toFixed(2) + ' / ' + muted.toFixed(2) + ' / ' + onBg.toFixed(2));
		assert.ok(
			muted - onBg >= CONTRAST_FLOORS.mutedOverDim,
			'muted - dim on bg is ' + (muted - onBg).toFixed(2) + ' for accent ' + accent + '; the floor is ' + CONTRAST_FLOORS.mutedOverDim,
		);
	}
});
/* The accent family is ink on card surfaces: an INFO card paints its title with `accent`
 * over a card body, and the band's rule with `thinkingHigh`. Measured only against `bg`,
 * the accent read 1.86 there. The tone is the wallpaper's identity, so the lightness
 * rises and the hue stays; chroma is only clipped when it leaves the gamut. */

const ACCENT_FAMILY_PROBES: [number, number, number][] = [
	[155, 72, 74],
	[171, 154, 94],
	[213, 169, 240],
	[30, 144, 255],
	[255, 0, 0],
	[0, 255, 0],
	[0, 0, 0],
	[255, 255, 255],
	[8, 8, 8],
];

test('the accent family clears the card surface, and selection keeps dim readable', () => {
	for (const accent of ACCENT_FAMILY_PROBES) {
		const vars = deriveWallpaperTheme(accent).vars as Record<string, string>;
		const bg = hexToRgb(vars.bg!)!;
		const card = hexToRgb(vars.toolErrorBg!)!;
		const selection = hexToRgb(vars.selection!)!;
		const accentRgb = hexToRgb(vars.accent!)!;
		const accentRatio = contrastRatio(accentRgb, card);
		assert.ok(
			accentRatio >= CONTRAST_FLOORS.accentSurface,
			'accent/toolErrorBg is ' + accentRatio.toFixed(2) + ' for accent ' + accent.join(',') + '; the floor is ' + CONTRAST_FLOORS.accentSurface + ' and the target ' + ACCENT_SURFACE_CONTRAST_TARGET,
		);
		// The tone is the identity: the hue may not move, and the chroma only gives way to
		// the gamut, never to the floor.
		const source = rgbToOklch(accent);
		const lifted = rgbToOklch(accentRgb);
		const hueDrift = Math.abs(((lifted.H - source.H + 540) % 360) - 180);
		// Black and white carry no tone: there is no hue to preserve, so the check only
		// applies where the wallpaper actually has one.
		if (source.C > 0.01) {
			assert.ok(hueDrift <= 1, 'accent hue drifted ' + hueDrift.toFixed(2) + ' degrees for accent ' + accent.join(','));
		}
		assert.ok(lifted.L >= source.L, 'accent darkness rose instead of falling for accent ' + accent.join(','));
		// The bright variant may never be darker than the accent it accompanies, or the two
		// names would be lying about the same palette. A white wallpaper already sits at the
		// lightness ceiling, so the check is a floor, not a strict ordering.
		assert.ok(
			rgbToOklch(hexToRgb(vars.accentBright!)!).L >= lifted.L - 0.001,
			'accentBright is not brighter than accent for accent ' + accent.join(',') + ': ' + rgbToOklch(hexToRgb(vars.accentBright!)!).L.toFixed(3) + ' vs ' + lifted.L.toFixed(3),
		);
		// Two floors on one surface: readable as a highlight, and dark enough for dim.
		const dimOnSelection = contrastRatio(hexToRgb(vars.dim!)!, selection);
		assert.ok(
			dimOnSelection >= CONTRAST_FLOORS.dimOnSelection,
			'dim/selection is ' + dimOnSelection.toFixed(2) + ' for accent ' + accent.join(',') + '; the floor is ' + CONTRAST_FLOORS.dimOnSelection,
		);
		const selectionOverBg = contrastRatio(selection, bg);
		assert.ok(
			selectionOverBg >= CONTRAST_FLOORS.selectionOverBg,
			'selection/bg is ' + selectionOverBg.toFixed(2) + ' for accent ' + accent.join(',') + '; a highlight has to stay visible, floor ' + CONTRAST_FLOORS.selectionOverBg,
		);
		// The band's rule ink lands on the same card surface as the accent.
		const rule = contrastRatio(hexToRgb(vars.thinkingHigh!)!, card);
		assert.ok(
			rule >= CONTRAST_FLOORS.accentSurface,
			'thinkingHigh/toolErrorBg is ' + rule.toFixed(2) + ' for accent ' + accent.join(',') + '; the band rule would lose its ink',
		);
	}
});

test('the semantic roles do not move when the accent family does', () => {
	// Pinned by hex: these three carry the tone signal and are not surfaces, so a palette
	// change in the accent family must leave them exactly where they were.
	for (const accent of ACCENT_FAMILY_PROBES) {
		const vars = deriveWallpaperTheme(accent).vars as Record<string, string>;
		assert.equal(vars.success, '#83D494', 'success moved for accent ' + accent.join(','));
		assert.equal(vars.warning, '#F5B75B', 'warning moved for accent ' + accent.join(','));
		assert.equal(vars.error, '#F47B74', 'error moved for accent ' + accent.join(','));
	}
});