import test from 'node:test';
import assert from 'node:assert/strict';
import { contrastRatio, oklchToHex, rgbToOklch, hexToRgb, relativeLuminance } from '../extensions/lib/oklch.ts';
import {
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
		assert.ok(ratio >= 1.9 && ratio <= 3.2, 'selection/bg ' + ratio.toFixed(2) + ' is outside 1.9..3.2');
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
		assert.ok(ratio >= 1.8 && ratio <= 3.2, 'border/bg ' + ratio.toFixed(2) + ' is outside 1.8..3.2');
	}
});

test('toolSuccessBg stays green: a success signal is not a surface', () => {
	for (const accent of [[213, 169, 240], [171, 154, 94], [30, 144, 255], [255, 0, 0]] as [number, number, number][]) {
		const theme = deriveWallpaperTheme(accent);
		const lch = rgbToOklch(hexToRgb((theme.vars as Record<string, string>).toolSuccessBg!)!);
		assert.ok(lch.H >= 100 && lch.H <= 160, 'toolSuccessBg hue ' + lch.H.toFixed(1) + ' is no longer green');
	}
});
