/**
 * The one place that emits an SGR colour LOON did not get from a theme.
 *
 * Everything else in this package paints through `resolvePalette()`, which binds
 * logical roles to theme roles. When an accent comes from outside the theme - one
 * of gentle-pi's four `banner.json` colours, or the wallpaper accent - the accent
 * roles bind to the painters below: a renderer still only calls a closure, and the
 * escape sequence is built here and nowhere else.
 */

/** The four accents gentle-pi's `banner.json` accepts. */
export const BANNER_COLORS = ['pink', 'cyan', 'yellow', 'green'] as const;

export type BannerColor = (typeof BANNER_COLORS)[number];

/** An 8-bit-per-channel colour, the shape every painter here takes. */
export type Rgb = readonly [number, number, number];

/** gentle-pi's own accent RGB per colour, so both banners agree. */
export const ACCENT_RGB: Record<BannerColor, Rgb> = {
	pink: [255, 118, 195],
	cyan: [95, 210, 255],
	yellow: [255, 210, 95],
	green: [110, 220, 145],
};

/** A function that paints text; the header never sees the escape itself. */
export type Painter = (text: string) => string;

/**
 * Truecolour foreground painter. The sequence is a 24-bit foreground and the
 * matching foreground reset, the same pair gentle-pi emits, so a terminal that
 * renders its banner also renders ours. Every other painter in this package is a
 * call to this one.
 */
export function rgbPainter(rgb: Rgb): Painter {
	const open = '\x1b[38;2;' + rgb[0] + ';' + rgb[1] + ';' + rgb[2] + 'm';
	const close = '\x1b[39m';
	return (text) => (text.length === 0 ? '' : open + text + close);
}

/** gentle-pi's named accent as a painter; a thin wrapper over `rgbPainter`. */
export function accentPainter(color: BannerColor): Painter {
	return rgbPainter(ACCENT_RGB[color]);
}

/**
 * Parse one `#RRGGBB` value - the wallpaper script writes exactly that, one line,
 * uppercase, with a trailing newline - and nothing else. Surrounding whitespace and
 * a missing hash are tolerated; six hex digits are required.
 */
export function parseHexColor(value: string | undefined | null): Rgb | undefined {
	if (typeof value !== 'string') return undefined;
	const match = /^\s*#?([0-9a-fA-F]{6})\s*$/.exec(value);
	if (match === null) return undefined;
	const hex = match[1] as string;
	return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
}
