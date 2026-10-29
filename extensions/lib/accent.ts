/**
 * The one place that emits an SGR colour LOON did not get from a theme.
 *
 * Everything else in this package paints through `resolvePalette()`, which binds
 * logical roles to theme roles. When gentle-pi's `banner.json` asks for one of its
 * four accent colours instead, the accent roles are bound to the painter below:
 * a renderer still only calls a closure, and the escape sequence is built here
 * and nowhere else.
 */

/** The four accents gentle-pi's `banner.json` accepts. */
export const BANNER_COLORS = ['pink', 'cyan', 'yellow', 'green'] as const;

export type BannerColor = (typeof BANNER_COLORS)[number];

/** gentle-pi's own accent RGB per colour, so both banners agree. */
export const ACCENT_RGB: Record<BannerColor, readonly [number, number, number]> = {
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
 * renders its banner also renders ours.
 */
export function accentPainter(color: BannerColor): Painter {
	const [r, g, b] = ACCENT_RGB[color];
	const open = `\x1b[38;2;` + r + ';' + g + ';' + b + 'm';
	const close = `\x1b[39m`;
	return (text) => (text.length === 0 ? '' : open + text + close);
}
