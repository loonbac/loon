import { resolveAccentRgb } from '../extensions/loon-startup.ts';
import test from 'node:test';
import assert from 'node:assert/strict';

/* S5: the accent roles follow the setting, and every external accent falls back
 * to the theme instead of painting black. */

test('the theme accent is the absence of an override', () => {
	assert.equal(resolveAccentRgb('theme', [1, 2, 3], [4, 5, 6]), undefined);
});

test('banner follows gentle-pi and falls back to the theme without a colour', () => {
	assert.deepEqual(resolveAccentRgb('banner', [255, 118, 195], [4, 5, 6]), [255, 118, 195]);
	assert.equal(resolveAccentRgb('banner', undefined, [4, 5, 6]), undefined);
});

test('wallpaper follows the file and falls back to the theme when it is unreadable', () => {
	assert.deepEqual(resolveAccentRgb('wallpaper', [255, 118, 195], [155, 72, 74]), [155, 72, 74]);
	assert.equal(resolveAccentRgb('wallpaper', [255, 118, 195], undefined), undefined);
});
