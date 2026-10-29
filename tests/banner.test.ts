import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { visibleWidth } from '@earendil-works/pi-tui';
import { MIN_BANNER_WIDTH, renderBanner, type BannerInput } from '../extensions/lib/banner.ts';
import { DIVIDER_RATIO, MIN_LEFT_WIDTH, MIN_TIPS_WIDTH } from '../extensions/lib/layout.ts';
import { LOGO_GRID, LOGO_WIDTH, renderLogo } from '../extensions/lib/logo.ts';
import { resolvePalette } from '../extensions/lib/palette.ts';
import { ansiTheme, darkTheme, lightTheme, plainTheme, strictTheme } from './support/themes.ts';

const TIPS = ['/use-default-tui', '/model', '/theme', '/compact'];


function bannerInput(overrides: Partial<BannerInput> = {}): BannerInput {
	return {
		width: 80,
		version: '1.4.0',
		model: 'openai-codex/gpt-5.5',
		effort: 'high',
		cwd: '~/Workspace/mypi',
		tips: TIPS,
		palette: resolvePalette(plainTheme()),
		...overrides,
	};
}

/** Golden files are the plain render: structure without any colour. */
function golden(name: string): string[] {
	return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
		.replace(/\n$/, '')
		.split('\n');
}

/** The interior of the box, one string per body row, borders and divider out. */
function splitColumns(width: number, lines: string[]): { left: string[]; right: string[] } {
	const innerWidth = width - 2;
	const dividerIndex = Math.round(innerWidth * DIVIDER_RATIO);
	return {
		left: lines.slice(1, -1).map((line) => line.slice(1, 1 + dividerIndex - 1)),
		right: lines.slice(1, -1).map((line) => line.slice(1 + dividerIndex + 1, width - 1)),
	};
}

test('renders the golden header at 80 columns', () => {
	assert.deepEqual(renderBanner(bannerInput()), golden('header-80.txt'));
});

test('renders the golden header at 120 columns', () => {
	assert.deepEqual(renderBanner(bannerInput({ width: 120 })), golden('header-120.txt'));
});

test('the divider sits at 69% of the interior and spans every body row', () => {
	for (const width of [80, 120]) {
		const innerWidth = width - 2;
		const dividerIndex = Math.round(innerWidth * DIVIDER_RATIO);
		const body = renderBanner(bannerInput({ width })).slice(1, -1);
		for (const line of body) {
			assert.equal([...line][dividerIndex + 1], '│', `no divider in ${JSON.stringify(line)}`);
		}
	}
});

test('the sidebar keeps the literal order of the capture', () => {
	const { right } = splitColumns(80, renderBanner(bannerInput()));
	const trimmed = right.map((cell) => cell.trim());
	assert.deepEqual(trimmed.slice(0, 9), [
		'',
		'Getting started',
		'Ask Pi to build it',
		'─'.repeat(22),
		'Commands',
		'/use-default-tui',
		'/model',
		'/theme',
		'/compact',
	]);
});

test('the left half centres the mark, the tagline, the model and the cwd', () => {
	const lines = renderBanner(bannerInput());
	const { left } = splitColumns(80, lines);
	const cell = '███';
	// The captured vertical rhythm: two blank rows, the four mark rows, one blank
	// row, then the tagline, the model line and the cwd.
	assert.deepEqual(left.slice(0, 2).map((line) => line.trim()), ['', '']);
	assert.deepEqual(left.slice(2, 6).map((line) => line.trim()), [
		'█████████',
		'███   ███',
		'██████   ███',
		'███      ███',
	]);
	assert.equal(left[6]!.trim(), '');
	assert.equal(left[7]!.trim(), "Let's build something great");
	assert.equal(left[8]!.trim(), 'openai-codex/gpt-5.5 · high effort');
	assert.equal(left[9]!.trim(), '~/Workspace/mypi');

	// The mark is one rectangle: all four rows start in the same column, so its
	// left edge is straight. Centring each row on its own ink would stagger it.
	const starts = lines.slice(3, 7).map((line) => line.indexOf('█'));
	assert.deepEqual(starts, [21, 21, 21, 21], `staggered mark: ${JSON.stringify(starts)}`);

	// The text lines stay centred within the half, within a column of slack.
	for (const line of [left[7]!, left[8]!, left[9]!]) {
		const content = line.trim();
		const start = line.length - line.trimStart().length;
		const slack = line.length - content.length - start;
		assert.ok(Math.abs(start - slack) <= 1, `not centred: ${JSON.stringify(line)}`);
	}
});

test('the mark is a single colour of the theme, on a 4 x 4 grid', () => {
	assert.deepEqual([...LOGO_GRID], ['###.', '#.#.', '##.#', '#..#']);
	assert.equal(LOGO_WIDTH, 12);
	const lines = renderLogo(resolvePalette(strictTheme()));
	assert.equal(lines.length, 4);
	for (const line of lines) {
		const painted = line.replace(/accent<███>/g, '');
		assert.ok(!painted.includes('<'), `the mark used another role: ${JSON.stringify(line)}`);
	}
});

test('no render emits a raw ANSI colour', () => {
	for (const width of [MIN_BANNER_WIDTH, 40, 60, 80, 120, 200]) {
		for (const line of renderBanner(bannerInput({ width }))) {
			const raw = line.replace(/\x1b\[0m/g, '').match(/\x1b\[[0-9;]*m/g) ?? [];
			assert.deepEqual(raw, [], `width ${width} painted a raw colour: ${JSON.stringify(line)}`);
		}
	}
});

test('with a painting theme every escape comes from the theme itself', () => {
	const theme = ansiTheme();
	const lines = renderBanner(bannerInput({ palette: resolvePalette(theme) }));
	const escapes = lines.join('\n').match(/\x1b\[[0-9;]*m/g) ?? [];
	assert.ok(escapes.length > 0, 'expected the themed header to paint something');
	for (const escape of escapes) {
		assert.ok(theme.sequences.has(escape), `unexpected escape ${JSON.stringify(escape)}`);
	}
});

test('every rendered row is exactly the requested width', () => {
	for (const width of [MIN_BANNER_WIDTH, 40, 60, 80, 120]) {
		for (const line of renderBanner(bannerInput({ width }))) {
			assert.equal(visibleWidth(line), width, `row ${JSON.stringify(line)} at width ${width}`);
		}
	}
});

test('the header follows whichever theme is active', () => {
	const dark = renderBanner(bannerInput({ palette: resolvePalette(darkTheme()) }));
	const light = renderBanner(bannerInput({ palette: resolvePalette(lightTheme()) }));
	assert.notDeepEqual(dark, light);
	assert.match(dark.join('\n'), /\x1b\[38;5;109m/);
	assert.match(light.join('\n'), /\x1b\[38;5;25m/);
});

test('a theme restricted to the gentle roles renders the whole header', () => {
	const lines = renderBanner(bannerInput({ palette: resolvePalette(strictTheme()) }));
	assert.equal(lines.length, 12);
});

test('the sidebar is dropped when the columns do not fit', () => {
	const width = MIN_LEFT_WIDTH + MIN_TIPS_WIDTH + 3;
	const lines = renderBanner(bannerInput({ width }));
	assert.ok(!lines.join('\n').includes('Getting started'));
	// No divider inside the body: the left half owns the whole interior.
	for (const line of lines.slice(1, -1)) {
		assert.equal([...line].slice(1, -1).join('').includes('│'), false);
	}
});

test('below the mark width only the version label is printed', () => {
	const lines = renderBanner(bannerInput({ width: MIN_BANNER_WIDTH - 1 }));
	assert.deepEqual(lines, ['Pi v1.4.0']);
});

test('a model label wider than the half is clipped and keeps its padding', () => {
	const lines = renderBanner(
		bannerInput({ model: 'river/deepseek-ai/DeepSeek-V4.1-Flash-1017' }),
	);
	const modelLine = lines[9] ?? '';
	assert.equal(visibleWidth(modelLine), 80);
	assert.match(modelLine, /…/, 'a label that does not fit must be clipped');
	assert.ok(!/│river/.test(modelLine), 'the label is flush against the border');
	assert.ok(modelLine.startsWith('│ '), `no leading padding: ${JSON.stringify(modelLine)}`);
});
