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
			const offenders = bareBackground(rows);
			assert.deepEqual(offenders, [], `${style} at ${width} columns rendered a row whose first bytes are a bare background escape`);
		}
	}
});
