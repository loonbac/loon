/**
 * The single place where LOON maps its logical colours onto pi theme roles.
 *
 * The header paints only through the closures `resolvePalette()` returns, so no
 * other module can emit an SGR colour of its own and every theme - the three
 * gentle-pi themes, system/dark/light or any user theme - recolours it without
 * extra configuration.
 *
 * One exception is still a painter and still lives here: when gentle-pi's
 * `banner.json` names an accent, the accent roles bind to `accentPainter()` and
 * the rest of the palette keeps coming from the theme.
 */
import { accentPainter, type BannerColor } from './accent.ts';

/**
 * Roles the header may use. The three gentle-pi themes and pi’s built-in
 * themes all carry them, and `Theme.fg()` throws on a role a theme does not
 * define, so this list is the contract with every theme.
 */
export const LOON_THEME_ROLES = ['accent', 'text', 'muted', 'dim'] as const;

export type LoonThemeRole = (typeof LOON_THEME_ROLES)[number];

/** The slice of pi’s `Theme` LOON needs; a real `Theme` satisfies it. */
export interface LoonTheme {
	fg(role: LoonThemeRole, text: string): string;
	bold(text: string): string;
}

/** Logical painter -> theme role. The header has no colour of its own. */
export const PALETTE_ROLES = {
	/** Rounded box, top label and its dashes. */
	frame: 'accent',
	/** The one-column vertical divider and the short rule in the sidebar. */
	divider: 'accent',
	/** Section lettering: the Pi mark, `Getting started`, `Commands`. */
	heading: 'accent',
	/** The large static Pi mark. */
	logo: 'accent',
	/** `Let's build something great`, in the theme's normal text colour. */
	tagline: 'text',
	/** Model line, tip lines, `Ask Pi to build it`. */
	body: 'muted',
	/** The cwd line. */
	subtle: 'dim',
} as const satisfies Record<string, LoonThemeRole>;

/** Every painter the header has, already bound to theme roles. */
export interface Palette {
	frame(text: string): string;
	divider(text: string): string;
	heading(text: string): string;
	logo(text: string): string;
	/** Bold, because the tagline is the one emphasised line. */
	tagline(text: string): string;
	body(text: string): string;
	subtle(text: string): string;
}

/** Options that change where the accent comes from, never the other roles. */
export interface PaletteOptions {
	/** gentle-pi's accent colour; when absent the theme's `accent` role is used. */
	accentColor?: BannerColor | undefined;
}

/** Bind the logical palette to the roles of one theme. Pure by design. */
export function resolvePalette(theme: LoonTheme, options: PaletteOptions = {}): Palette {
	// Every accent role shares one painter, so the override cannot half-apply.
	const accent = options.accentColor === undefined
		? (text: string) => theme.fg(PALETTE_ROLES.frame, text)
		: accentPainter(options.accentColor);
	return {
		frame: accent,
		divider: accent,
		heading: accent,
		logo: accent,
		tagline: (text) => theme.bold(theme.fg(PALETTE_ROLES.tagline, text)),
		body: (text) => theme.fg(PALETTE_ROLES.body, text),
		subtle: (text) => theme.fg(PALETTE_ROLES.subtle, text),
	};
}
