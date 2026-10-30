import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * The rule this pins: a painted row may never START with an escape sequence. The prompt
 * editor trims the first cell of a row, and when that cell is an escape the ESC goes with
 * it and the terminal prints the parameter - the `[48;2;61;56;35m` that reached the screen.
 *
 * Rendered bytes, no pixels: every style is rendered through the installed gentle-pi, with
 * the same jiti loader pi uses.
 */
const GENTLE = join(homedir(), '.pi', 'agent', 'npm', 'node_modules', 'gentle-pi');
const PI_ROOT = join(homedir(), '.local', 'share', 'loon-pi', 'npm-prefix', 'lib', 'node_modules', '@earendil-works', 'pi-coding-agent');

const available = existsSync(join(GENTLE, 'lib', 'shell-card.ts')) && existsSync(join(PI_ROOT, 'package.json'));

/** The visible columns that carry the surface, decoded from the row's own escapes. */
function paintedColumns(row: string): number[] {
	const columns: number[] = [];
	let column = 0;
	let surface = false;
	for (let index = 0; index < row.length;) {
		const escape = /^\u001b\[([0-9;]*)m/.exec(row.slice(index));
		if (escape) {
			const parameters = escape[1] ?? '';
			if (parameters === '' || parameters === '0' || parameters === '49') surface = false;
			else if (parameters.startsWith('48;')) surface = true;
			index += escape[0].length;
			continue;
		}
		if (surface) columns.push(column);
		column += 1;
		index += 1;
	}
	return columns;
}

function bareBackground(rows: readonly string[]): string[] {
	const offenders: string[] = [];
	for (const row of rows) {
		for (const match of row.matchAll(/\[48;2;[0-9;]*m/g)) {
			if (match.index === undefined || row[match.index - 1] !== '\u001b') offenders.push(row.slice(0, 40));
		}
	}
	return offenders;
}

/**
 * A theme whose styling callbacks record every SGR parameter they write into an allowed set.
 * Cards must only paint colors and weights produced by the active theme, never hand-written
 * escapes injected directly by the renderer.
 */
function createRecordingTheme() {
	const allowed = new Set<string>();
	const record = (open: string, text: string, close: string) => {
		allowed.add(open);
		allowed.add(close);
		return `\u001b[${open}m${text}\u001b[${close}m`;
	};
	const theme = {
		fg: (_role: string, text: string) => record('38;2;172;168;154', text, '39'),
		bg: (_role: string, text: string) => record('48;2;61;56;35', text, '49'),
		bold: (text: string) => record('1', text, '22'),
	};
	return { theme, allowed };
}

/**
 * Closed-set guardian: every `\u001b[...m` escape sequence in a row must belong to the closed set
 * of parameters the theme emitted (plus plain resets `''` and `'0'`). If any unexpected escape
 * appears (such as a hardcoded `\u001b[31m` or an unrecorded background/weight), it is reported
 * with the offending sequence and a prefix of the containing row.
 */
function strayEscapes(rows: readonly string[], allowed: ReadonlySet<string>): string[] {
	const offenders: string[] = [];
	for (const row of rows) {
		for (const match of row.matchAll(/\u001b\[([0-9;]*)m/g)) {
			const param = match[1] ?? '';
			if (param === '' || param === '0' || allowed.has(param)) continue;
			offenders.push(`${match[0]} in ${row.slice(0, 40)}`);
		}
	}
	return offenders;
}

test('no painted row starts with an escape, in any card style', { skip: !available && 'gentle-pi is not installed here' }, async () => {
	const { createJiti } = (await import(join(PI_ROOT, 'node_modules', 'jiti', 'lib', 'jiti-static.mjs'))) as {
		createJiti: (url: string, options: Record<string, unknown>) => { import: (path: string) => Promise<unknown> };
	};
	const jiti = createJiti(import.meta.url, {
		moduleCache: false,
		interopDefault: true,
		fsCache: false,
		alias: {
			'@earendil-works/pi-tui': join(PI_ROOT, 'node_modules', '@earendil-works', 'pi-tui', 'dist', 'index.js'),
			'@earendil-works/pi-agent-core': join(PI_ROOT, 'node_modules', '@earendil-works', 'pi-agent-core', 'dist', 'index.js'),
			'@earendil-works/pi-ai': join(PI_ROOT, 'node_modules', '@earendil-works', 'pi-ai', 'dist', 'compat.js'),
		},
	});
	const card = (await jiti.import(join(GENTLE, 'lib', 'shell-card.ts'))) as {
		CARD_STYLE: Record<string, string>;
		setCardStyle: (style: string) => void;
		renderCard: (card: unknown, theme: unknown, width: number, options: unknown) => string[];
		CARD_TONE: Record<string, string>;
	};
	const { theme, allowed } = createRecordingTheme();
	// The geometry is the invariant behind the byte rule: a style with no left margin puts
	// the surface in the first cell, and that is the bug this file exists to catch.
	const geometry = (card as unknown as { CARD_GEOMETRY?: Record<string, { padLeft: number; padRight: number }> }).CARD_GEOMETRY;
	if (geometry) {
		for (const [style, spec] of Object.entries(geometry)) {
			assert.ok(spec.padLeft >= 1, `${style} has padLeft ${spec.padLeft}: a painted row would start with an escape`);
		}
		// The numbers the human chose, not just the inequality: cards take a one-column
		// transparent gutter on both sides, like float.
		assert.equal(geometry.loon!.padLeft, 1, 'loon left gutter');
		assert.equal(geometry.loon!.padRight, 1, 'loon right gutter');
	}

	// The prompt band is the one surface where loon differs from float, so its columns are
	// asserted by number: rule in column 0, text in column 2.
	const prompt = (await jiti.import(join(GENTLE, 'lib', 'shell-prompt.ts'))) as {
		resolvePromptLayout: (width: number, style: string, bg: unknown) => unknown;
		framePromptLines: (lines: string[], width: number, options: unknown, layout: unknown) => string[];
	};
	const theme2 = { fg: (_r: string, t: string) => t, bg: (_r: string, t: string) => `\u001b[48;2;61;56;35m${t}\u001b[49m` };
	const bandOptions = { style: 'loon', bg: theme2.bg, fg: theme2.fg, borderColor: (t: string) => t, state: 'idle' };
	const layout = prompt.resolvePromptLayout(120, 'loon', theme2.bg);
	const bandRows = prompt.framePromptLines(['', 'hello', ''], 120, bandOptions, layout);
	const band = bandRows[1]!.replace(/\u001b\[[0-9;]*m/g, '');
	assert.equal(band.indexOf('▎'), 1, `loon band rule sits in column ${band.indexOf('▎')}, expected 1: column 0 is the margin`);
	assert.equal(band.indexOf('hello'), 2, `loon band text sits in column ${band.indexOf('hello')}, expected 2`);
	assert.ok(!bandRows[1]!.startsWith('\u001b'), 'the band row begins with an escape');

	const subject = {
		title: 'read',
		subtitle: 'a.ts',
		body: ['one line', 'two lines'],
		tone: 'info',
		glyph: '✿',
	};

	for (const style of Object.values(card.CARD_STYLE)) {
		card.setCardStyle(style);
		for (const width of [100, 120, 160]) {
			const rows = card.renderCard(subject, theme, width, { expanded: true, previewRows: 3, panel: true });
			assert.deepEqual(bareBackground(rows), [], `${style} at ${width} columns rendered a bare background escape`);
			assert.deepEqual(strayEscapes(rows, allowed), [], `${style} at ${width} columns rendered an unexpected escape sequence`);
			const painted = rows.join('\n');
			// The same rule stated as the agent asked: every background parameter counted is a
			// background parameter preceded by ESC.
			assert.equal(
				(painted.match(/\[48;2;/g) ?? []).length,
				(painted.match(/\u001b\[48;2;/g) ?? []).length,
				`${style} at ${width} columns has a background parameter without its ESC`,
			);
			// The rule is about painted rows: an outlined row (neon) starts with its frame in a
			// colour escape and always has, so only rows carrying a surface are constrained.
			for (const row of rows) {
				if (!row.includes('[48;2;')) continue;
				assert.ok(!row.startsWith('\u001b'), `${style} at ${width} columns begins a painted row with an escape`);
			}
		}
	}
});

// The band and the bar are one visual panel: their painted surfaces have to close on the
// same column, or the band shows a two-column notch of unpainted background beside a bar
// that painted those same cells. Read from rendered columns, never from string widths.
test('the loon band surface ends where the bar surface ends', { skip: !available && 'gentle-pi is not installed here' }, async () => {
	const { createJiti } = (await import(join(PI_ROOT, 'node_modules', 'jiti', 'lib', 'jiti-static.mjs'))) as {
		createJiti: (url: string, options: Record<string, unknown>) => { import: (path: string) => Promise<unknown> };
	};
	const jiti = createJiti(import.meta.url, {
		moduleCache: false,
		interopDefault: true,
		fsCache: false,
		alias: {
			'@earendil-works/pi-tui': join(PI_ROOT, 'node_modules', '@earendil-works', 'pi-tui', 'dist', 'index.js'),
			'@earendil-works/pi-agent-core': join(PI_ROOT, 'node_modules', '@earendil-works', 'pi-agent-core', 'dist', 'index.js'),
			'@earendil-works/pi-ai': join(PI_ROOT, 'node_modules', '@earendil-works', 'pi-ai', 'dist', 'compat.js'),
			'@earendil-works/pi-coding-agent': join(PI_ROOT, 'dist', 'index.js'),
		},
	});
	const card = (await jiti.import(join(GENTLE, 'lib', 'shell-card.ts'))) as { setCardStyle: (style: string) => void };
	const prompt = (await jiti.import(join(GENTLE, 'lib', 'shell-prompt.ts'))) as {
		resolvePromptLayout: (width: number, style: string, bg: unknown) => unknown;
		framePromptLines: (lines: string[], width: number, options: unknown, layout: unknown) => string[];
	};
	const shellBar = (await jiti.import(join(GENTLE, 'lib', 'shell-bar.ts'))) as {
		renderShellBelowInputFloat: (model: unknown, theme: unknown, width: number, usageHint: unknown, presentation: unknown) => { rows: string[]; headerRow: number } | undefined;
	};
	const OPEN = '\u001b[48;2;61;56;35m';
	const CLOSE = '\u001b[49m';
	const theme = {
		fg: (_role: string, text: string) => text,
		bg: (_role: string, text: string) => OPEN + text + CLOSE,
		bold: (text: string) => text,
	};
	const model = {
		cwd: '/tmp', branch: 'main', dirty: 0, modelId: 'test-model', effort: 'high',
		contextPercent: 10, contextWindow: 100000, costTotal: 0, subscription: false,
		usage: undefined, statuses: [],
	};
	const presentation = {
		density: 'comfortable', headerPlacement: 'below-input', statusPlacement: 'auto',
		visibility: { changes: true, rdd: true, agents: true, todo: true, usageCost: true, modelDetails: true, contextWarning: true },
	};
	card.setCardStyle('loon');
	for (const width of [120, 160]) {
		const layout = prompt.resolvePromptLayout(width, 'loon', theme.bg);
		const bandRowsAtWidth = prompt.framePromptLines(['', 'a line the band paints', ''], width, {
			state: 'idle', tick: 0, bg: theme.bg, fg: theme.fg, borderColor: (text: string) => text, style: 'loon',
		}, layout);
		const bandRow = bandRowsAtWidth[1]!;
		const chrome = shellBar.renderShellBelowInputFloat(model, theme, width, undefined, presentation);
		assert.ok(chrome, 'the bar did not render at ' + width + ' columns');
		const bandRight = Math.max(...paintedColumns(bandRow));
		const barRow = chrome.rows[chrome.headerRow]!;
		const barRight = Math.max(...paintedColumns(barRow));
		assert.equal(bandRight, barRight, 'at ' + width + ' columns the band surface ends at ' + bandRight + ' and the bar at ' + barRight);
		assert.equal(Math.min(...paintedColumns(barRow)), 1, 'the bar surface starts in column 1, where the band starts: one margin for the whole chrome');
		assert.ok(!paintedColumns(barRow).includes(0), 'column 0 is a margin for the bar too: it carries no surface');
		assert.equal(bandRight, width - 1, 'the surface reaches the last column at ' + width);
		const bandCells = bandRow.replace(/\u001b\[[0-9;]*m/g, '');
		assert.equal(Math.min(...paintedColumns(bandRow)), 1, 'the band surface starts in column 1');
		assert.ok(!paintedColumns(bandRow).includes(0), 'column 0 is a margin: it carries no surface');
		assert.ok(paintedColumns(bandRow).includes(1), 'the rule cell carries the surface: the glyph is a quarter block, and a transparent cell around it reads as a hole');
		assert.equal(bandCells[0], ' ', 'the row starts with its margin, never with an escape or the glyph');
		assert.equal(bandCells[1], '▎', 'the rule glyph sits in column 1, inside the surface');
	}
});

// Row 0 of the band is its top slot. pi's editor maps that row to padding and ignores it
// for clicks, so the label lives there with no surface and no rule: the band starts on the
// first content row and the caption reads above it. The row spans the band's width, so the
// two blocks end on the same column and the row count stays native.
test("the band's first row is the label, painted without surface", { skip: !available && 'gentle-pi is not installed here' }, async () => {
	const { createJiti } = (await import(join(PI_ROOT, 'node_modules', 'jiti', 'lib', 'jiti-static.mjs'))) as {
		createJiti: (url: string, options: Record<string, unknown>) => { import: (path: string) => Promise<unknown> };
	};
	const jiti = createJiti(import.meta.url, {
		moduleCache: false,
		interopDefault: true,
		fsCache: false,
		alias: {
			'@earendil-works/pi-tui': join(PI_ROOT, 'node_modules', '@earendil-works', 'pi-tui', 'dist', 'index.js'),
			'@earendil-works/pi-agent-core': join(PI_ROOT, 'node_modules', '@earendil-works', 'pi-agent-core', 'dist', 'index.js'),
			'@earendil-works/pi-ai': join(PI_ROOT, 'node_modules', '@earendil-works', 'pi-ai', 'dist', 'compat.js'),
		},
	});
	const prompt = (await jiti.import(join(GENTLE, 'lib', 'shell-prompt.ts'))) as {
		resolvePromptLayout: (width: number, style: string, bg: unknown) => unknown;
		framePromptLines: (lines: string[], width: number, options: unknown, layout: unknown) => string[];
	};
	const theme = {
		fg: (_role: string, text: string) => text,
		bg: (_role: string, text: string) => '\u001b[48;2;61;56;35m' + text + '\u001b[49m',
	};
	for (const width of [100, 120, 160]) {
		const layout = prompt.resolvePromptLayout(width, 'loon', theme.bg);
		const rows = prompt.framePromptLines(['', 'hello', ''], width, {
			state: 'idle', tick: 0, bg: theme.bg, fg: theme.fg, borderColor: (text: string) => text, style: 'loon',
		}, layout);
		const cells = rows.map((row) => row.replace(/\u001b\[[0-9;]*m/g, ''));
		// The label slot, one content row, the closing row: the native count, unchanged.
		assert.equal(rows.length, 3, 'the band has ' + rows.length + ' rows at ' + width + ', expected 3');
		assert.ok(cells[0]!.includes('waiting for input'), 'row 0 is not the label at ' + width + ': ' + JSON.stringify(cells[0]!.trim()));
		assert.ok(!cells[0]!.includes('\u258e'), 'row 0 still carries the rule at ' + width + ': ' + JSON.stringify(cells[0]!.trim()));
		assert.deepEqual(paintedColumns(rows[0]!), [], 'row 0 paints a surface at ' + width + ': ' + JSON.stringify(cells[0]!.trim()));
		assert.ok(paintedColumns(rows[1]!).length > 0, 'the first content row carries no surface at ' + width);
		assert.equal(paintedColumns(rows[1]!)[0], 1, 'the band starts in column 1 at ' + width);
		for (const [index, row] of rows.entries()) {
			if (index === 0) continue;
			const right = Math.max(...paintedColumns(row));
			assert.equal(right, width - 1, 'band row ' + index + ' at ' + width + ' closes its surface at column ' + right);
		}
		// The label row is as wide as the band, so the two blocks end on the same column.
		assert.equal(cells[0]!.length, cells[1]!.length, 'the label row is ' + cells[0]!.length + ' cells and the band ' + cells[1]!.length + ' at ' + width);
	}
});

// The defect pinned as a test: bareBackground only checks for stripped ESC before [48;2;
// so a raw escape like \u001b[31m passes through silently. The closed set catches it.
test('the guardian catches raw escapes that bareBackground misses', { skip: !available && 'gentle-pi is not installed here' }, async () => {
	const { createJiti } = (await import(join(PI_ROOT, 'node_modules', 'jiti', 'lib', 'jiti-static.mjs'))) as {
		createJiti: (url: string, options: Record<string, unknown>) => { import: (path: string) => Promise<unknown> };
	};
	const jiti = createJiti(import.meta.url, {
		moduleCache: false,
		interopDefault: true,
		fsCache: false,
		alias: {
			'@earendil-works/pi-tui': join(PI_ROOT, 'node_modules', '@earendil-works', 'pi-tui', 'dist', 'index.js'),
			'@earendil-works/pi-agent-core': join(PI_ROOT, 'node_modules', '@earendil-works', 'pi-agent-core', 'dist', 'index.js'),
			'@earendil-works/pi-ai': join(PI_ROOT, 'node_modules', '@earendil-works', 'pi-ai', 'dist', 'compat.js'),
		},
	});
	const card = (await jiti.import(join(GENTLE, 'lib', 'shell-card.ts'))) as {
		setCardStyle: (style: string) => void;
		renderCard: (card: unknown, theme: unknown, width: number, options: unknown) => string[];
	};
	const { theme, allowed } = createRecordingTheme();
	const subject = {
		title: 'read',
		subtitle: 'a.ts',
		body: ['one line', 'two lines'],
		tone: 'info',
		glyph: '✿',
	};

	card.setCardStyle('loon');
	const rows = card.renderCard(subject, theme, 120, { expanded: true, previewRows: 3, panel: true });
	const original = rows.find((row) => row.includes('[48;2;')) ?? rows[0]!;
	const tampered = `${original}\u001b[31m`;

	// bareBackground only looks for [48;2;... escapes whose ESC was stripped, missing \u001b[31m entirely:
	assert.deepEqual(bareBackground([tampered]), [], 'bareBackground misses the raw escape');

	// The closed set checks all escapes against what the theme emitted, reporting the stray escape:
	const offenders = strayEscapes([tampered], allowed);
	assert.equal(offenders.length, 1, 'strayEscapes must report the injected escape');
	assert.ok(offenders[0]!.includes('\u001b[31m'), 'offender must identify the offending escape');
});
