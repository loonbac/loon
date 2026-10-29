/**
 * `Wallpaper (LOON)`: a complete pi theme derived from one accent colour.
 *
 * The derivation is a pure function - accent RGB in, theme object out - so a
 * palette is reproducible and testable without a filesystem. The palette works in
 * OKLCH: UI roles stay near the wallpaper hue with very low chroma, syntax roles
 * rotate that hue with a clamp so six hues stay distinguishable instead of turning
 * the code into one loud colour.
 *
 * The contrast floors are hard: text on background >= 7:1, muted >= 4.5:1, accent
 * >= 3:1. A wallpaper that cannot meet them keeps its hue and has its lightness
 * pushed until it does, so an unfortunate colour still yields a valid theme.
 */
import { contrastRatio, hexToRgb, oklchToHex, rgbToOklch, rotateHue, type Oklch, type Rgb } from './oklch.ts';

/** Every theme this package ships or generates ends with this suffix. */
export const LOON_THEME_SUFFIX = ' (LOON)';

/** The base name of the generated theme, before the suffix. */
export const WALLPAPER_THEME_BASE = 'Wallpaper';

/** The generated theme's name: `Wallpaper (LOON)`. */
export const WALLPAPER_THEME_NAME = loonThemeName(WALLPAPER_THEME_BASE);

/** Apply the naming rule once, so a name and its file cannot drift apart. */
export function loonThemeName(base: string): string {
	return base.trim() + LOON_THEME_SUFFIX;
}

/** True when a theme name is one of ours. */
export function isLoonThemeName(name: unknown): name is string {
	return typeof name === 'string' && name.length > LOON_THEME_SUFFIX.length && name.endsWith(LOON_THEME_SUFFIX);
}

/** pi looks for `<name>.json` in its themes directory. */
export function themeFileName(name: string): string {
	return name + '.json';
}

/** The shape pi accepts: the same keys its own shipped themes use. */
export interface LoonThemeFile {
	$schema: string;
	name: string;
	vars: Record<string, string>;
	colors: Record<string, string>;
	export: Record<string, string>;
}

const SCHEMA = 'https://raw.githubusercontent.com/earendil-works/pi-mono/main/packages/coding-agent/src/modes/interactive/theme/theme-schema.json';

/** The 55 colour keys pi's shipped themes bind, in their order. */
const COLOR_KEYS = [
	'accent', 'border', 'borderAccent', 'borderMuted', 'success', 'error', 'warning', 'muted',
	'dim', 'text', 'thinkingText', 'selectedBg', 'scrollbarThumb', 'searchMatchBg',
	'searchMatchText', 'userMessageBg', 'userMessageText', 'customMessageBg',
	'customMessageText', 'customMessageLabel', 'toolPendingBg', 'toolSuccessBg',
	'toolErrorBg', 'toolTitle', 'toolOutput', 'mdHeading', 'mdLink', 'mdLinkUrl', 'mdCode',
	'mdCodeBlock', 'mdCodeBlockBorder', 'mdQuote', 'mdQuoteBorder', 'mdHr', 'mdListBullet',
	'toolDiffAdded', 'toolDiffRemoved', 'toolDiffContext', 'syntaxComment', 'syntaxKeyword',
	'syntaxFunction', 'syntaxVariable', 'syntaxString', 'syntaxNumber', 'syntaxType',
	'syntaxOperator', 'syntaxPunctuation', 'thinkingOff', 'thinkingMinimal', 'thinkingLow',
	'thinkingMedium', 'thinkingHigh', 'thinkingXhigh', 'thinkingMax', 'bashMode',
] as const;

/** Every colour the theme binds, by role; the vars they point at are built below. */
const COLOR_TO_VAR: Record<(typeof COLOR_KEYS)[number], string> = {
	accent: 'accent',
	border: 'border',
	borderAccent: 'accentBright',
	borderMuted: 'borderSubtle',
	success: 'success',
	error: 'error',
	warning: 'warning',
	muted: 'muted',
	dim: 'dim',
	text: 'text',
	thinkingText: 'muted',
	selectedBg: 'selection',
	scrollbarThumb: 'border',
	searchMatchBg: 'selection',
	searchMatchText: 'accentBright',
	userMessageBg: 'userMessageBg',
	userMessageText: 'text',
	customMessageBg: 'bgElement',
	customMessageText: 'text',
	customMessageLabel: 'accent',
	toolPendingBg: 'bgPanel',
	toolSuccessBg: 'toolSuccessBg',
	toolErrorBg: 'toolErrorBg',
	toolTitle: 'accent',
	toolOutput: 'text',
	mdHeading: 'accentBright',
	mdLink: 'accent',
	mdLinkUrl: 'syntaxComment',
	mdCode: 'syntaxString',
	mdCodeBlock: 'text',
	mdCodeBlockBorder: 'borderSubtle',
	mdQuote: 'muted',
	mdQuoteBorder: 'border',
	mdHr: 'borderSubtle',
	mdListBullet: 'accent',
	toolDiffAdded: 'success',
	toolDiffRemoved: 'error',
	toolDiffContext: 'muted',
	syntaxComment: 'syntaxComment',
	syntaxKeyword: 'syntaxKeyword',
	syntaxFunction: 'syntaxFunction',
	syntaxVariable: 'syntaxVariable',
	syntaxString: 'syntaxString',
	syntaxNumber: 'syntaxNumber',
	syntaxType: 'syntaxType',
	syntaxOperator: 'syntaxOperator',
	syntaxPunctuation: 'syntaxPunctuation',
	thinkingOff: 'thinkingOff',
	thinkingMinimal: 'thinkingMinimal',
	thinkingLow: 'thinkingLow',
	thinkingMedium: 'thinkingMedium',
	thinkingHigh: 'thinkingHigh',
	thinkingXhigh: 'thinkingXhigh',
	thinkingMax: 'thinkingMax',
	bashMode: 'warning',
};

const paint = (L: number, C: number, H: number): string => oklchToHex({ L, C, H });

/**
 * The lightest-fitting surface of one hue at one chroma: the first lightness whose
 * contrast against `background` reaches `minContrast` while its chroma survives the
 * sRGB gamut, and undefined when the range cannot hold it.
 */
function surfaceAtChroma(hue: number, chroma: number, background: Rgb, minContrast: number, maxContrast: number): string | undefined {
	for (let lightness = 0.18; lightness <= 0.7; lightness += 0.005) {
		const hex = paint(lightness, chroma, hue);
		const rgb = hexToRgb(hex) as Rgb;
		const contrast = contrastRatio(rgb, background);
		if (contrast < minContrast) continue;
		if (contrast > maxContrast) return undefined;
		if (rgbToOklch(rgb).C >= chroma * 0.98) return hex;
	}
	return undefined;
}

/**
 * A surface tinted by the accent: prefer the more chroma the gamut allows, fall back
 * to the floor the caller insists on. The prompt card paints its band with
 * `selection` and its edge with `border`, so both must read as the accent colour
 * rather than as a borrowed signal role.
 */
function tintedSurface(hue: number, floor: number, background: Rgb, minContrast: number, maxContrast: number): string {
	return (
		surfaceAtChroma(hue, floor * 1.6, background, minContrast, maxContrast) ??
		surfaceAtChroma(hue, floor, background, minContrast, maxContrast) ??
		paint(0.45, floor, hue)
	);
}

/**
 * Raise a colour's lightness until it clears `floor` against `background`,
 * keeping its hue. Returns the adjusted hex; the floor is reached, not skipped.
 */
function liftToContrast(rgb: Rgb, background: Rgb, floor: number): string {
	const lch = rgbToOklch(rgb);
	let candidate = rgb;
	let lightness = lch.L;
	let guard = 0;
	while (contrastRatio(candidate, background) < floor && guard < 40) {
		lightness = Math.min(1, lightness + 0.02);
		candidate = hexToRgb(paint(lightness, lch.C, lch.H)) as Rgb;
		guard += 1;
		if (lightness >= 1) break;
	}
	return paint(lightness, lch.C, lch.H);
}

/**
 * Derive the whole palette from one accent colour.
 *
 * Deterministic: the same accent always yields the same theme, and the result is
 * a plain object, so it can be written as JSON or compared in a test.
 */
export function deriveWallpaperTheme(accent: Rgb): LoonThemeFile {
	const source = rgbToOklch(accent);
	const H = source.H;
	// The wallpaper's own chroma, tamed: a neon wallpaper must not turn the
	// backgrounds into a light show.
	const tint = Math.min(source.C, 0.12);
	const low = Math.min(tint * 0.25, 0.02);
	const mid = Math.min(tint * 0.35, 0.04);

	const bg = hexToRgb(paint(0.16, low, H)) as Rgb;
	const accentHex = liftToContrast(accent, bg, 3);

	const vars: Record<string, string> = {
		bg: paint(0.16, low, H),
		bgPanel: paint(0.205, low + 0.005, H),
		bgElement: paint(0.235, low + 0.008, H),
		bgSubtle: paint(0.19, low, H),
		userMessageBg: paint(0.27, mid, H),
		// A surface is not a success: these two are the accent's own hue, tinted enough to
		// read as the colour the wallpaper asked for.
		selection: tintedSurface(H, Math.max(0.38 * source.C, 0.032), bg, 2.3, 3.2),
		border: tintedSurface(H, Math.max(0.55 * source.C, 0.042), bg, 2.5, 3.2),
		borderSubtle: paint(0.27, low + 0.005, H),
		text: paint(0.96, 0.012, H),
		muted: paint(0.73, 0.02, H),
		dim: paint(0.56, 0.02, H),
		accent: accentHex,
		accentBright: liftToContrast(hexToRgb(paint(Math.min(1, source.L + 0.12), Math.min(source.C, 0.14), H)) as Rgb, bg, 3),
		accentDim: paint(Math.max(0.3, source.L - 0.2), Math.min(source.C, 0.1), H),
		warning: paint(0.82, 0.13, 75),
		error: paint(0.72, 0.15, 25),
		success: paint(0.8, 0.12, 150),
		toolSuccessBg: paint(0.22, 0.03, 150),
		toolErrorBg: paint(0.22, 0.04, 25),
		syntaxComment: paint(0.62, 0.05, rotateHue(H, 30)),
		syntaxKeyword: paint(0.78, 0.1, rotateHue(H, 60)),
		syntaxFunction: paint(0.82, 0.1, rotateHue(H, 120)),
		syntaxVariable: paint(0.8, 0.09, rotateHue(H, 180)),
		syntaxString: paint(0.82, 0.1, rotateHue(H, 240)),
		syntaxNumber: paint(0.78, 0.09, rotateHue(H, 300)),
		syntaxType: paint(0.84, 0.08, rotateHue(H, 330)),
		syntaxOperator: paint(0.86, 0.03, H),
		syntaxPunctuation: paint(0.7, 0.02, H),
		thinkingOff: paint(0.45, 0.02, H),
		thinkingMinimal: paint(0.52, 0.03, H),
		thinkingLow: paint(0.6, 0.04, H),
		thinkingMedium: paint(0.68, 0.06, H),
		thinkingHigh: paint(0.76, 0.08, H),
		thinkingXhigh: paint(0.84, 0.1, H),
		thinkingMax: paint(0.92, 0.12, H),
	};

	const colors: Record<string, string> = {};
	for (const key of COLOR_KEYS) colors[key] = COLOR_TO_VAR[key];

	return {
		$schema: SCHEMA,
		name: WALLPAPER_THEME_NAME,
		vars,
		colors,
		export: { pageBg: 'bg', cardBg: 'bgElement', infoBg: 'bgPanel' },
	};
}

/** The three floors the palette must clear, named for the tests and the docs. */
export const CONTRAST_FLOORS = { text: 7, muted: 4.5, accent: 3 } as const;

/** Measure the derived palette against its floors. */
export function measureContrast(theme: LoonThemeFile): { text: number; muted: number; accent: number; dim: number } {
	const vars = theme.vars;
	const bg = hexToRgb(vars.bg as string) as Rgb;
	return {
		text: contrastRatio(hexToRgb(vars.text as string) as Rgb, bg),
		muted: contrastRatio(hexToRgb(vars.muted as string) as Rgb, bg),
		accent: contrastRatio(hexToRgb(vars.accent as string) as Rgb, bg),
		dim: contrastRatio(hexToRgb(vars.dim as string) as Rgb, bg),
	};
}

export type { Oklch };
