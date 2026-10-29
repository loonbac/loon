import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { visibleWidth } from '@earendil-works/pi-tui';
import { MIN_BANNER_WIDTH, renderBanner, type BannerInput } from '../extensions/lib/banner.ts';
import { LOGO_FRAME_COUNT } from '../extensions/lib/logo.ts';
import { resolvePalette } from '../extensions/lib/palette.ts';
import { ansiTheme, darkTheme, lightTheme, plainTheme, strictTheme } from './support/themes.ts';

const GOLDEN_PATH = new URL('./fixtures/banner-80.txt', import.meta.url);

function bannerInput(overrides: Partial<BannerInput> = {}): BannerInput {
	return {
		width: 80,
		frame: 0,
		version: '1.4.0',
		model: 'gentle/gentleman',
		effort: 'high',
		cwd: '~/Proyectos/pi-loon/loon',
		tips: ['loon:default', '/model', '/theme', '/compact'],
		palette: resolvePalette(plainTheme()),
		...overrides,
	};
}

test('renders the golden banner at 80 columns', () => {
	const golden = readFileSync(GOLDEN_PATH, 'utf8').replace(/\n$/, '').split('\n');
	assert.deepEqual(renderBanner(bannerInput()), golden);
});

/**
 * With a theme that paints nothing, the only escape left can be a reset that
 * pi-tui appends when it truncates a row. Anything that sets a colour or an
 * attribute would be a colour the banner invented instead of asking the theme.
 */
function rawColorEscapes(line: string): string[] {
	return line.replace(/\x1b\[0m/g, '').match(/\x1b\[[0-9;]*m/g) ?? [];
}

test('no frame of the animation emits a raw ANSI colour', () => {
	for (let frame = 0; frame < LOGO_FRAME_COUNT; frame++) {
		for (const width of [MIN_BANNER_WIDTH, 40, 80, 120, 200]) {
			const lines = renderBanner(bannerInput({ frame, width }));
			for (const line of lines) {
				assert.deepEqual(
					rawColorEscapes(line),
					[],
					`frame ${frame} at width ${width} painted a raw colour: ${JSON.stringify(line)}`,
				);
			}
		}
	}
});

test('with a painting theme every escape comes from the theme itself', () => {
	const theme = ansiTheme();
	const lines = renderBanner(bannerInput({ palette: resolvePalette(theme) }));
	const escapes = lines.join('\n').match(/\x1b\[[0-9;]*m/g) ?? [];
	assert.ok(escapes.length > 0, 'expected the themed banner to paint something');
	for (const escape of escapes) {
		assert.ok(theme.sequences.has(escape), `unexpected escape ${JSON.stringify(escape)}`);
	}
});

test('every rendered row is exactly the requested width', () => {
	for (const width of [MIN_BANNER_WIDTH, 40, 80, 120]) {
		const lines = renderBanner(bannerInput({ width, frame: 6 }));
		for (const line of lines) {
			assert.equal(visibleWidth(line), width, `row ${JSON.stringify(line)} at width ${width}`);
		}
	}
});

test('the banner follows whichever theme is active', () => {
	const dark = renderBanner(bannerInput({ palette: resolvePalette(darkTheme()) }));
	const light = renderBanner(bannerInput({ palette: resolvePalette(lightTheme()) }));
	assert.notDeepEqual(dark, light);
	assert.match(dark.join('\n'), /\x1b\[38;5;109m/);
	assert.match(light.join('\n'), /\x1b\[38;5;25m/);
});

test('a theme restricted to the gentle roles renders every frame', () => {
	const theme = strictTheme();
	for (let frame = 0; frame < LOGO_FRAME_COUNT; frame++) {
		const lines = renderBanner(bannerInput({ frame, palette: resolvePalette(theme) }));
		assert.ok(lines.length > 3);
	}
});

test('narrow widths stay inside the available columns', () => {
	for (const width of [8, 16, 23]) {
		const lines = renderBanner(bannerInput({ width }));
		assert.equal(lines.length, 1);
		assert.ok(visibleWidth(lines[0]!) <= width);
	}
});
