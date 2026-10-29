import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { visibleWidth } from '@earendil-works/pi-tui';
import { MIN_BANNER_WIDTH, renderBanner, type BannerInput } from '../extensions/lib/banner.ts';
import {
	MAX_LEFT_WIDTH,
	MIN_LEFT_WIDTH,
	MIN_TIPS_WIDTH,
	headerColumnWidths,
	wrapLabel,
} from '../extensions/lib/layout.ts';
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

/** Split by column, so colour escapes must be out of the way first. */
function stripAnsi(line: string): string {
	return line.replace(/\x1b\[[0-9;]*m/g, '');
}

/** The interior of the box, one string per body row, borders and divider out. */
function splitColumns(width: number, lines: string[]): { left: string[]; right: string[] } {
	const { leftWidth, rightWidth } = headerColumnWidths(width - 2);
	const body = lines.slice(1, -1).map(stripAnsi);
	return {
		left: body.map((line) => line.slice(1, 1 + leftWidth)),
		right: body.map((line) => line.slice(1 + leftWidth + 3, 1 + leftWidth + 3 + rightWidth)),
	};
}

test('renders the golden header at 80 columns', () => {
	assert.deepEqual(renderBanner(bannerInput()), golden('header-80.txt'));
});

test('renders the golden header at 120 columns', () => {
	assert.deepEqual(renderBanner(bannerInput({ width: 120 })), golden('header-120.txt'));
});

test('the divider closes the left half and spans every body row', () => {
	for (const width of [80, 120]) {
		const { leftWidth } = headerColumnWidths(width - 2);
		const body = renderBanner(bannerInput({ width })).slice(1, -1);
		for (const line of body) {
			assert.equal([...stripAnsi(line)][leftWidth + 2], '│', `no divider in ${JSON.stringify(line)}`);
		}
	}
});

test('the left half stays square instead of stretching on wide screens', () => {
	// Ten body rows read square at roughly the mark width plus breathing room; a
	// share of the interior alone would keep widening the empty band.
	assert.equal(headerColumnWidths(78).leftWidth, 32);
	assert.equal(headerColumnWidths(118).leftWidth, MAX_LEFT_WIDTH);
	assert.ok(MAX_LEFT_WIDTH <= 40, 'the left half grew past the square ceiling');
});

test('the sidebar keeps the literal order of the capture', () => {
	const { right } = splitColumns(80, renderBanner(bannerInput()));
	const trimmed = right.map((cell) => cell.trim());
	assert.deepEqual(trimmed.slice(0, 9), [
		'',
		'Getting started',
		'Ask Pi to build it',
		// The rule fills the sidebar, stopping one column short of the border.
		'─'.repeat(headerColumnWidths(78).rightWidth - 1),
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
	// At 32 columns the model line wraps over two rows; the cwd closes the block.
	assert.equal(
		[left[8]!, left[9]!].map((line) => line.trim()).join(' '),
		'openai-codex/gpt-5.5 · high effort',
	);
	assert.equal(left[left.length - 1]!.trim(), '~/Workspace/mypi');

	// The mark is one rectangle: all four rows start in the same column, so its
	// left edge is straight. Centring each row on its own ink would stagger it.
	// The expected column is derived from the layout, never copied from a frame.
	const { leftWidth } = headerColumnWidths(78);
	const expectedStart = 1 + Math.floor((leftWidth - LOGO_WIDTH) / 2);
	const starts = lines.slice(3, 7).map((line) => line.indexOf('█'));
	assert.deepEqual(
		starts,
		Array<number>(4).fill(expectedStart),
		`staggered mark: ${JSON.stringify(starts)}`,
	);

	// The text lines stay centred within the half, within a column of slack.
	for (const line of [left[7]!, left[8]!, left[9]!, left[left.length - 1]!]) {
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
		// pi-tui appends a reset when it truncates a row; it sets no colour.
		if (escape === '\x1b[0m') continue;
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
	// Ten sidebar rows are the floor; a wrapped model label can add rows. The exact
	// height is pinned by the goldens, not here.
	assert.ok(lines.length >= 12, `short header: ${lines.length} rows`);
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

test('a label that fits stays on one row', () => {
	assert.deepEqual(wrapLabel('openai/gpt-5.5 · high effort', 30), ['openai/gpt-5.5 · high effort']);
});

test('a label that does not fit breaks at the slash, then keeps the words together', () => {
	assert.deepEqual(wrapLabel('river/deepseek-ai/DeepSeek-V4.1-Flash-1017', 30), [
		'river/deepseek-ai/',
		'DeepSeek-V4.1-Flash-1017',
	]);
	// The real user label, 57 columns in a 30-column window: three rows, and the
	// effort is not attached to the tail of the id.
	assert.deepEqual(wrapLabel('river/deepseek-ai/DeepSeek-V4.1-Flash-1017 · high effort', 30), [
		'river/deepseek-ai/',
		'DeepSeek-V4.1-Flash-1017',
		'· high effort',
	]);
});

test('the last row never keeps a single word on its own', () => {
	// Greedy packing would give "… · high" and leave "effort" alone on the last
	// row, which reads as a broken label rather than a wrapped one.
	assert.deepEqual(wrapLabel('openai-codex/gpt-5.5 · high effort', 30), [
		'openai-codex/gpt-5.5 ·',
		'high effort',
	]);
	// The fix must not touch the real 42-column id: same three rows as before.
	assert.deepEqual(
		wrapLabel('river/deepseek-ai/DeepSeek-V4.1-Flash-1017 · high effort', 30),
		['river/deepseek-ai/', 'DeepSeek-V4.1-Flash-1017', '· high effort'],
	);
});

test('the widow retry stops at half the width and keeps the original result', () => {
	// No width down to the floor brings a second word onto the last row, so the
	// greedy result stands instead of shrinking the label further.
	assert.deepEqual(wrapLabel('aaaa bbbb cccc', 10), ['aaaa bbbb', 'cccc']);
});

test('a long run with no separator is cut at the width, without an invented ellipsis', () => {
	// A single token that does not fit is a whole row by nature, never a widow.
	assert.deepEqual(wrapLabel('abcdefghij', 4), ['abcd', 'efgh', 'ij']);
	assert.deepEqual(wrapLabel('alpha-beta-gamma', 8), ['alpha-', 'beta-', 'gamma']);
	for (const line of wrapLabel('abcdefghij', 4)) assert.ok(!line.includes('…'));
});

test('a model label wider than the half wraps and the box stays rectangular', () => {
	const input = bannerInput({ model: 'river/deepseek-ai/DeepSeek-V4.1-Flash-1017' });
	for (const width of [80, 120]) {
		const lines = renderBanner({ ...input, width });
		assert.ok(
			lines.every((line) => visibleWidth(line) === width),
			`ragged box at ${width}: ${JSON.stringify(lines.map(visibleWidth))}`,
		);
		assert.ok(!lines.join('\n').includes('…'), 'the wrap must not invent an ellipsis');
	}

	// At 80 columns the wrap adds two rows; the sidebar keeps its rows and only
	// gains blank ones below, so its labels do not move.
	const lines = renderBanner({ ...input, width: 80 });
	const { left, right } = splitColumns(80, lines);
	assert.equal(right.filter((line) => line.trim() !== '').length, 8);
	assert.equal(left.length, right.length);
	assert.deepEqual(right.slice(-2).map((line) => line.trim()), ['', '']);
	for (const line of lines.slice(1, -1)) assert.ok(line.startsWith('│') && line.endsWith('│'));
});
