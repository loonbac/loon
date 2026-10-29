/**
 * Theme stubs for the tests.
 *
 * `strictTheme` only knows the roles all three gentle-pi themes define, and
 * throws for anything else the way pi’s `Theme.fg()` does. That is what turns
 * 'the header only asks for roles every theme carries' into a checked property.
 */
import type { LoonTheme, LoonThemeRole } from '../../extensions/lib/palette.ts';

/** Roles carried by Gentle, Gentleman-Cute and Gentleman-Sexy. */
export const GENTLE_ROLES = [
	'accent',
	'muted',
	'dim',
	'text',
	'success',
	'warning',
	'error',
	'border',
	'borderAccent',
	'borderMuted',
	'toolTitle',
	'thinkingText',
	'thinkingOff',
	'thinkingMinimal',
	'thinkingLow',
	'thinkingMedium',
	'thinkingHigh',
	'thinkingXhigh',
	'mdHeading',
	'mdLink',
	'mdLinkUrl',
	'mdCode',
	'mdCodeBlock',
	'mdCodeBlockBorder',
	'mdQuote',
	'mdQuoteBorder',
	'mdHr',
	'mdListBullet',
] as const;

export interface RecordingTheme extends LoonTheme {
	/** Roles the renderer asked for, in call order. */
	readonly requested: LoonThemeRole[];
}

/** Every role resolves to `role<text>`; unknown roles throw. */
export function strictTheme(): RecordingTheme {
	const requested: LoonThemeRole[] = [];
	const theme: RecordingTheme = {
		requested,
		fg(role, text) {
			if (!(GENTLE_ROLES as readonly string[]).includes(role)) {
				throw new Error(`Unknown theme color: ${role}`);
			}
			requested.push(role);
			return `${role}<${text}>`;
		},
		bold: (text) => text,
	};
	return theme;
}

/** A theme that paints nothing: any escape in the output would be raw ANSI. */
export function plainTheme(): LoonTheme {
	return {
		fg: (_role, text) => text,
		bold: (text) => text,
	};
}

/** Distinct SGR per role, so a rendering test can allow-list every sequence. */
export function ansiTheme(
	codes: Partial<Record<LoonThemeRole, number>> = {},
): LoonTheme & { readonly sequences: ReadonlySet<string> } {
	const base: Record<LoonThemeRole, number> = {
		accent: 109,
		text: 252,
		muted: 245,
		dim: 244,
	};
	const resolved = { ...base, ...codes };
	const sequences = new Set<string>();
	for (const code of Object.values(resolved)) sequences.add(`\x1b[38;5;${code}m`);
	sequences.add('\x1b[39m');
	sequences.add('\x1b[1m');
	sequences.add('\x1b[22m');
	return {
		sequences,
		fg: (role, text) => `\x1b[38;5;${resolved[role]}m${text}\x1b[39m`,
		bold: (text) => `\x1b[1m${text}\x1b[22m`,
	};
}

/** Two opposite themes, to prove the header follows whatever is active. */
export function darkTheme() {
	return ansiTheme();
}

export function lightTheme() {
	return ansiTheme({ accent: 25, text: 235, muted: 240, dim: 245 });
}
