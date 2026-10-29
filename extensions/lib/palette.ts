/**
 * The single place where LOON maps its logical colours onto pi theme roles.
 *
 * Everything the banner paints goes through the closures `resolvePalette()`
 * returns, so no other module can emit an SGR colour of its own and every
 * theme - the three gentle-pi themes, system/dark/light or any user theme -
 * recolours the banner without extra configuration.
 */

/**
 * Roles the banner is allowed to use. The three gentle-pi themes and pi’s
 * built-in themes all carry them, and `Theme.fg()` throws on a role a theme
 * does not define, so this list is the contract with every theme.
 */
export const LOON_THEME_ROLES = [
	'accent',
	'border',
	'borderMuted',
	'muted',
	'dim',
	'text',
	'success',
	'warning',
	'error',
] as const;

export type LoonThemeRole = (typeof LOON_THEME_ROLES)[number];

/** The slice of pi’s `Theme` LOON needs; a real `Theme` satisfies it. */
export interface LoonTheme {
	fg(role: LoonThemeRole, text: string): string;
	bold(text: string): string;
}

/** Colours an animated logo cell can take. `panel` means "no cell". */
export type LogoCellColor = 'panel' | 'cyan' | 'red' | 'green' | 'orange' | 'white' | 'flash' | 'brand';

/** Logo colours that actually paint a cell. */
export type PaintedLogoCellColor = Exclude<LogoCellColor, 'panel'>;

/**
 * Logo cell colour -> theme role, fixed by the feature spec: cyan->accent,
 * red->error, green->success, orange and flash->warning, white->text,
 * brand->accent.
 */
export const LOGO_CELL_ROLE: Readonly<Record<PaintedLogoCellColor, LoonThemeRole>> = {
	cyan: 'accent',
	red: 'error',
	green: 'success',
	orange: 'warning',
	flash: 'warning',
	white: 'text',
	brand: 'accent',
};

/** Every painter the banner has, already bound to theme roles. */
export interface Palette {
	/** One logo cell, painted with the role of its logical colour. */
	logoCell(color: PaintedLogoCellColor, text: string): string;
	/** Box frame and corners. */
	frame(text: string): string;
	/** Bold accent: the title and the sidebar headings. */
	label(text: string): string;
	/** Secondary text: tips and the model line. */
	body(text: string): string;
	/** Tertiary text: the cwd line. */
	subtle(text: string): string;
	/** Sidebar rules. */
	divider(text: string): string;
}

/** Map the logical palette onto the roles of one theme. Pure by design. */
export function resolvePalette(theme: LoonTheme): Palette {
	return {
		logoCell: (color, text) => theme.fg(LOGO_CELL_ROLE[color], text),
		frame: (text) => theme.fg('border', text),
		label: (text) => theme.bold(theme.fg('accent', text)),
		body: (text) => theme.fg('muted', text),
		subtle: (text) => theme.fg('dim', text),
		divider: (text) => theme.fg('borderMuted', text),
	};
}
