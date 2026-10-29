import test from 'node:test';
import assert from 'node:assert/strict';
import { LOGO_CELL_ROLE, LOON_THEME_ROLES, resolvePalette } from '../extensions/lib/palette.ts';
import { GENTLE_ROLES, strictTheme } from './support/themes.ts';

test('logo colours map to the roles the spec fixes', () => {
	assert.deepEqual(LOGO_CELL_ROLE, {
		cyan: 'accent',
		red: 'error',
		green: 'success',
		orange: 'warning',
		flash: 'warning',
		white: 'text',
		brand: 'accent',
	});
});

test('every role the banner may use exists in the three gentle-pi themes', () => {
	for (const role of LOON_THEME_ROLES) {
		assert.ok(
			(GENTLE_ROLES as readonly string[]).includes(role),
			`${role} is missing from the gentle-pi themes`,
		);
	}
});

test('each palette painter resolves through the theme', () => {
	const palette = resolvePalette(strictTheme());

	assert.equal(palette.logoCell('cyan', 'X'), 'accent<X>');
	assert.equal(palette.logoCell('red', 'X'), 'error<X>');
	assert.equal(palette.logoCell('green', 'X'), 'success<X>');
	assert.equal(palette.logoCell('orange', 'X'), 'warning<X>');
	assert.equal(palette.logoCell('flash', 'X'), 'warning<X>');
	assert.equal(palette.logoCell('white', 'X'), 'text<X>');
	assert.equal(palette.logoCell('brand', 'X'), 'accent<X>');

	assert.equal(palette.frame('X'), 'border<X>');
	assert.equal(palette.label('X'), 'accent<X>');
	assert.equal(palette.body('X'), 'muted<X>');
	assert.equal(palette.subtle('X'), 'dim<X>');
	assert.equal(palette.divider('X'), 'borderMuted<X>');
});

test('the palette never asks the theme for a role outside the gentle set', () => {
	const theme = strictTheme();
	const palette = resolvePalette(theme);
	// strictTheme throws on an unknown role; painting every painter proves the set.
	palette.frame('x');
	palette.label('x');
	palette.body('x');
	palette.subtle('x');
	palette.divider('x');
	for (const color of ['cyan', 'red', 'green', 'orange', 'flash', 'white', 'brand'] as const) {
		palette.logoCell(color, 'x');
	}
	assert.deepEqual([...new Set(theme.requested)].sort(), [...LOON_THEME_ROLES].sort());
});

test('an unknown role surfaces the theme error instead of a colour', () => {
	const theme = { ...strictTheme(), fg: () => { throw new Error('Unknown theme color: nope'); } };
	assert.throws(() => resolvePalette(theme).frame('x'), /Unknown theme color/);
});
