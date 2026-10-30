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
 * Sequences that are not SGR and are still allowed to appear in a painted row.
 *
 * Empty on purpose: a guardian that cannot see a whole family of escapes is not a closed set,
 * and an allow-list that grows quietly is how such a guardian starts lying. Adding one here is
 * a decision with its own line, reviewed on its own merits - never a way to make a failing test
 * pass.
 */
const ALLOWED_NON_SGR: ReadonlySet<string> = new Set<string>();

/** Parameter bytes (0x30-0x3F) and intermediate bytes (0x20-0x2F) of a control sequence. */
function isParameterOrIntermediate(character: string): boolean {
	return (character >= '\u0030' && character <= '\u003f') || (character >= '\u0020' && character <= '\u002f');
}

/** Bytes that end an escape sequence other than a control sequence final byte. */
function isFinalByte(character: string): boolean {
	return character >= '\u0040' && character <= '\u007e';
}

/**
 * Closed-set guardian over every escape family, not only SGR.
 *
 * An SGR sequence (`\u001b[...m`) is allowed only when its parameters were emitted by the theme
 * (plus plain resets `''` and `'0'`). Every other sequence - OSC (`\u001b]...BEL` or
 * `\u001b]...\u001b\\`), charset designation (`\u001b(B`, `\u001b(0`), a CSI whose final byte is
 * not `m` (`\u001b[2J`), or any two-byte escape - is reported unless it appears literally in
 * `ALLOWED_NON_SGR`. A sequence left unterminated at the end of a row is reported too: the
 * guardian cannot be satisfied by leaving one open.
 */
function strayEscapes(
	rows: readonly string[],
	allowed: ReadonlySet<string>,
	allowedNonSgr: ReadonlySet<string> = ALLOWED_NON_SGR,
): string[] {
	const offenders: string[] = [];
	for (const row of rows) {
		const report = (sequence: string, why: string) => {
			offenders.push(`${JSON.stringify(sequence)} (${why}) in ${row.slice(0, 40)}`);
		};
		let index = 0;
		while (index < row.length) {
			const start = row.indexOf('\u001b', index);
			if (start === -1) break;
			const kind = row[start + 1];
			if (kind === undefined) {
				report(row.slice(start), 'unterminated escape at the end of the row');
				break;
			}
			if (kind === '[') {
				let cursor = start + 2;
				while (cursor < row.length && isParameterOrIntermediate(row[cursor]!)) cursor += 1;
				const final = row[cursor];
				if (final === undefined || !isFinalByte(final)) {
					report(row.slice(start), 'unterminated control sequence');
					break;
				}
				const sequence = row.slice(start, cursor + 1);
				if (final === 'm') {
					const parameters = row.slice(start + 2, cursor);
					if (parameters !== '' && parameters !== '0' && !allowed.has(parameters)) {
						report(sequence, 'SGR the theme did not emit');
					}
				} else if (!allowedNonSgr.has(sequence)) {
					report(sequence, 'control sequence outside the closed set');
				}
				index = cursor + 1;
				continue;
			}
			if (kind === ']') {
				let cursor = start + 2;
				let end = -1;
				while (cursor < row.length) {
					if (row[cursor] === '\u0007') {
						end = cursor + 1;
						break;
					}
					if (row[cursor] === '\u001b' && row[cursor + 1] === '\\') {
						end = cursor + 2;
						break;
					}
					cursor += 1;
				}
				if (end === -1) {
					report(row.slice(start), 'unterminated operating system command');
					break;
				}
				const sequence = row.slice(start, end);
				if (!allowedNonSgr.has(sequence)) report(sequence, 'operating system command outside the closed set');
				index = end;
				continue;
			}
			// Any other escape: a two-byte escape, or a three-byte charset designation such as ESC ( B.
			const length = kind === '(' || kind === ')' || kind === '*' || kind === '+' || kind === '-' || kind === '.' || kind === '/' ? 3 : 2;
			const sequence = row.slice(start, start + length);
			if (!allowedNonSgr.has(sequence)) report(sequence, 'escape outside the closed set');
			index = start + length;
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
	const band = bandRows[2]!.replace(/\u001b\[[0-9;]*m/g, '');
	assert.equal(band.indexOf('▎'), 1, `loon band rule sits in column ${band.indexOf('▎')}, expected 1: column 0 is the margin`);
	assert.equal(band.indexOf('hello'), 2, `loon band text sits in column ${band.indexOf('hello')}, expected 2`);
	assert.ok(!bandRows[2]!.startsWith('\u001b'), 'the band row begins with an escape');

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
		const bandRow = bandRowsAtWidth[2]!;
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

// The band's first row is its top edge. The hint used to BE that row, so the surface
// started on the label and the band had padding below but none above. It now opens with an
// empty surface row, symmetric to the one it closes with - and the row count is what pi's
// mouse model reads, which is why the editor translates y by one row.
test('the band opens with an empty surface row and the hint is not the first row', { skip: !available && 'gentle-pi is not installed here' }, async () => {
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
	// Loaded here, under the same guard as everything else that needs gentle-pi: a top-level
	// import would fail the whole file on a machine without the package.
	const { visibleWidth } = (await import(join(PI_ROOT, 'node_modules', '@earendil-works', 'pi-tui', 'dist', 'index.js'))) as {
		visibleWidth: (text: string) => number;
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
		// One editor line, plus the row the band opens with and the row it closes with.
		assert.equal(rows.length, 4, 'the band has ' + rows.length + ' rows at ' + width + ', expected 4');
		assert.equal(cells[0]!.slice(2).trim(), '', 'the band opens with text on its top edge at ' + width + ': ' + JSON.stringify(cells[0]!.trim()));
		assert.ok(!rows[0]!.includes('waiting for input'), 'the hint is still the first row of the band at ' + width);
		assert.ok(cells[1]!.includes('waiting for input'), 'the hint is not the second row of the band at ' + width + ': ' + JSON.stringify(cells[1]!.trim()));
		for (const [index, row] of rows.entries()) {
			const columns = paintedColumns(row);
			assert.ok(columns.length > 0, 'band row ' + index + ' at ' + width + ' painted no column at all');
			const right = Math.max(...columns);
			assert.equal(right, width - 1, 'band row ' + index + ' at ' + width + ' closes its surface at column ' + right);
		}
		// Every band row is as wide as the next, measured in columns and not in string
		// length: a wide glyph is one character and two cells.
		assert.equal(
			visibleWidth(cells[0]!),
			visibleWidth(cells[1]!),
			'the first two band rows differ in width at ' + width,
		);
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
	assert.ok(offenders[0]!.includes(JSON.stringify('\u001b[31m')), 'offender must identify the offending escape');
});

/* The rule this one carries: the guardian is closed over every escape family, not only SGR.
 * A family it cannot see is a family that can paint anything, and an unterminated sequence is
 * the same hole at the end of a row. Each case below injects one escape into an otherwise clean
 * painted row and expects exactly one offender naming that escape. */
test('the escape guardian reports every family, not only SGR', () => {
	const clean = '\u001b[48;2;61;56;35m  card  \u001b[49m';
	// The parameters the recording theme emits, so only the injected family can trip the guardian.
	// The set records on use, exactly as rendering does, so the callbacks are exercised once here.
	const { theme, allowed } = createRecordingTheme();
	theme.fg('text', '');
	theme.bg('panel', '');
	theme.bold('');
	// `tail` is empty where the point is that the escape is left open at the end of the row.
	const injections: Array<{ name: string; sequence: string; tail: string }> = [
		{ name: 'operating system command, BEL-terminated', sequence: '\u001b]8;;https://example.com\u0007', tail: clean },
		{ name: 'operating system command, ST-terminated', sequence: '\u001b]0;title\u001b\\', tail: clean },
		{ name: 'charset designation (B)', sequence: '\u001b(B', tail: clean },
		{ name: 'charset designation (0)', sequence: '\u001b(0', tail: clean },
		{ name: 'control sequence that is not SGR: erase display', sequence: '\u001b[2J', tail: clean },
		{ name: 'control sequence that is not SGR: cursor position', sequence: '\u001b[1;2H', tail: clean },
		{ name: 'escape left unterminated at the end of the row', sequence: '\u001b', tail: '' },
		{ name: 'operating system command left unterminated', sequence: '\u001b]0;title', tail: '' },
	];
	for (const { name, sequence: injection, tail } of injections) {
		const offenders = strayEscapes([clean + injection + tail], allowed);
		assert.equal(offenders.length, 1, `${name}: exactly one offender, got ${JSON.stringify(offenders)}`);
		assert.ok(
			offenders[0]!.includes(JSON.stringify(injection)),
			`${name}: the offender must name the escape as ${JSON.stringify(injection)}, got ${offenders[0]}`,
		);
	}
	// The allow-list for non-SGR families is empty on purpose: widening it is a decision.
	assert.equal(ALLOWED_NON_SGR.size, 0, 'a non-SGR sequence was allowed without a reviewed decision');
	// SGR the theme emitted, and plain resets, still pass.
	assert.deepEqual(strayEscapes([`\u001b[1mbold\u001b[22m\u001b[0m\u001b[m`], allowed), [], 'theme SGR must stay allowed');
});
