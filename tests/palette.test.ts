import test from 'node:test';
import assert from 'node:assert/strict';
import { BANNER_COLORS } from '../extensions/lib/accent.ts';
import {
	LOON_THEME_ROLES,
	PALETTE_ROLES,
	resolvePalette,
} from '../extensions/lib/palette.ts';
import { GENTLE_ROLES, strictTheme } from './support/themes.ts';

test('every painter maps to the role the capture fixes', () => {
	assert.deepEqual(PALETTE_ROLES, {
		frame: 'accent',
		divider: 'accent',
		heading: 'accent',
		logo: 'accent',
		tagline: 'text',
		body: 'muted',
		subtle: 'dim',
	});
});

test('every role the header may use exists in the three gentle-pi themes', () => {
	for (const role of LOON_THEME_ROLES) {
		assert.ok(
			(GENTLE_ROLES as readonly string[]).includes(role),
			`${role} is missing from the gentle-pi themes`,
		);
	}
});

test('each palette painter resolves through the theme', () => {
	const palette = resolvePalette(strictTheme());

	assert.equal(palette.frame('X'), 'accent<X>');
	assert.equal(palette.divider('X'), 'accent<X>');
	assert.equal(palette.heading('X'), 'accent<X>');
	assert.equal(palette.logo('X'), 'accent<X>');
	assert.equal(palette.tagline('X'), 'text<X>');
	assert.equal(palette.body('X'), 'muted<X>');
	assert.equal(palette.subtle('X'), 'dim<X>');
});

test('the palette never asks the theme for a role outside the gentle set', () => {
	const theme = strictTheme();
	const palette = resolvePalette(theme);
	// strictTheme throws on an unknown role; painting every painter proves the set.
	palette.frame('x');
	palette.divider('x');
	palette.heading('x');
	palette.logo('x');
	palette.tagline('x');
	palette.body('x');
	palette.subtle('x');
	assert.deepEqual([...new Set(theme.requested)].sort(), [...LOON_THEME_ROLES].sort());
});

test('an unknown role surfaces the theme error instead of a colour', () => {
	const theme = { ...strictTheme(), fg: () => { throw new Error('Unknown theme color: nope'); } };
	assert.throws(() => resolvePalette(theme).frame('x'), /Unknown theme color/);
});
test('gentle-pi’s accent overrides exactly the four accent roles', () => {
	const theme = strictTheme();
	const palette = resolvePalette(theme, { accentColor: 'cyan' });
	const painted = '\x1b[38;2;95;210;255m';

	for (const paint of [palette.frame, palette.divider, palette.heading, palette.logo]) {
		assert.equal(paint('X'), painted + 'X\x1b[39m');
	}
	// The other roles still come from the theme, so text, muted and dim keep it.
	assert.equal(palette.tagline('X'), 'text<X>');
	assert.equal(palette.body('X'), 'muted<X>');
	assert.equal(palette.subtle('X'), 'dim<X>');
	assert.deepEqual(theme.requested, ['text', 'muted', 'dim']);
});

test('the theme accent is used when no colour is asked for', () => {
	const palette = resolvePalette(strictTheme(), { accentColor: undefined });
	assert.equal(palette.frame('X'), 'accent<X>');
	assert.equal(palette.logo('X'), 'accent<X>');
});

test('each of gentle-pi’s four accents has its own painter', () => {
	const expected: Record<string, string> = {
		pink: '\x1b[38;2;255;118;195m',
		cyan: '\x1b[38;2;95;210;255m',
		yellow: '\x1b[38;2;255;210;95m',
		green: '\x1b[38;2;110;220;145m',
	};
	for (const [colour, open] of Object.entries(expected)) {
		const palette = resolvePalette(strictTheme(), { accentColor: colour as never });
		assert.equal(palette.frame('X'), open + 'X\x1b[39m', colour);
	}
	assert.deepEqual([...BANNER_COLORS], ['pink', 'cyan', 'yellow', 'green']);
});

test('the accent painter emits nothing for an empty run', () => {
	const palette = resolvePalette(strictTheme(), { accentColor: 'pink' });
	assert.equal(palette.frame(''), '');
});
