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

function bareBackground(rows: readonly string[]): string[] {
	const offenders: string[] = [];
	for (const row of rows) {
		for (const match of row.matchAll(/\[48;2;[0-9;]*m/g)) {
			if (match.index === undefined || row[match.index - 1] !== '\u001b') offenders.push(row.slice(0, 40));
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
	const theme = {
		fg: (_role: string, text: string) => `\u001b[38;2;172;168;154m${text}\u001b[39m`,
		bg: (_role: string, text: string) => `\u001b[48;2;61;56;35m${text}\u001b[49m`,
		bold: (text: string) => `\u001b[1m${text}\u001b[22m`,
	};
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
	assert.equal(band.indexOf('▎'), 0, `loon band rule sits in column ${band.indexOf('▎')}, expected 0`);
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
