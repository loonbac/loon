import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * The rule this pins: the header bar drops the brand only for a theme LOON generated, and
 * it drops it whole - no empty segment, no stray separator, no blank narrowest stage.
 *
 * Rendered bytes from the installed, patched gentle-pi through the same jiti loader pi uses:
 * this is the measurement the port's brand change is judged by, not the patch's own diff.
 */
const GENTLE = join(homedir(), '.pi', 'agent', 'npm', 'node_modules', 'gentle-pi');
const PI_ROOT = join(
	homedir(),
	'.local',
	'share',
	'loon-pi',
	'npm-prefix',
	'lib',
	'node_modules',
	'@earendil-works',
	'pi-coding-agent',
);
const available = existsSync(join(GENTLE, 'lib', 'shell-bar.ts')) && existsSync(join(PI_ROOT, 'package.json'));

const plain = (row: string): string => row.replace(/\u001b\[[0-9;]*m/g, '');

async function header(width: number, themeName?: string): Promise<string[]> {
	const { createJiti } = (await import(join(PI_ROOT, 'node_modules', 'jiti', 'lib', 'jiti-static.mjs'))) as {
		createJiti: (url: string, options: Record<string, unknown>) => { import: (path: string) => Promise<unknown> };
	};
	const jiti = createJiti(import.meta.url, {
		interopDefault: true,
		moduleCache: false,
		fsCache: false,
		alias: {
			'@earendil-works/pi-tui': join(PI_ROOT, 'node_modules', '@earendil-works', 'pi-tui', 'dist', 'index.js'),
			'@earendil-works/pi-agent-core': join(PI_ROOT, 'node_modules', '@earendil-works', 'pi-agent-core', 'dist', 'index.js'),
			'@earendil-works/pi-ai': join(PI_ROOT, 'node_modules', '@earendil-works', 'pi-ai', 'dist', 'compat.js'),
			// shell-bar pulls the package root in for VERSION; the dist entry is enough.
			'@earendil-works/pi-coding-agent': join(PI_ROOT, 'dist', 'index.js'),
		},
	});
	const bar = (await jiti.import(join(GENTLE, 'lib', 'shell-bar.ts'))) as {
		renderShellBar: (model: unknown, theme: unknown, width: number, presentation?: unknown) => string[] | string;
	};
	const theme = {
		...(themeName === undefined ? {} : { name: themeName }),
		fg: (_role: string, text: string) => text,
		bold: (text: string) => text,
		bg: (_role: string, text: string) => text,
	};
	// The model shape the bar reads, values included: the brand decision must not depend on
	// an incomplete fixture, or the measurement would be about my fixture, not the bar.
	const model = {
		cwd: '/home/loon/proj',
		branch: 'master',
		dirty: 0,
		sessionName: undefined,
		modelId: 'gpt-5',
		effort: 'high',
		profile: 'reviewer',
		contextPercent: 12,
		contextWindow: 200000,
		costTotal: 0.42,
		subscription: false,
		usage: undefined,
		statuses: [],
	};
	const rows = bar.renderShellBar(model, theme, width, undefined);
	return (Array.isArray(rows) ? rows : [String(rows)]).map((row) => plain(String(row)));
}

test('a stock theme keeps the brand in the header row', { skip: !available && 'gentle-pi is not installed here' }, async () => {
	// Measured from the rendered row: the bar paints the brand through the theme, which
	// lowercases it, and it separates segments with ⟡.
	const rows = await header(120, 'Gentle');
	assert.ok(
		rows.some((row) => /✿ gentle shell/i.test(row)),
		'the brand is missing from a stock theme: ' + JSON.stringify(rows),
	);
	assert.ok(rows.join(' ').includes('⟡'), 'the row does not use the separator this test knows: ' + JSON.stringify(rows));
});

test('a theme LOON generated hides the brand, and leaves no empty segment behind', { skip: !available && 'gentle-pi is not installed here' }, async () => {
	for (const width of [120, 90, 60]) {
		const rows = await header(width, 'Wallpaper (LOON)');
		const joined = rows.join('\n');
		assert.equal(joined.includes('✿'), false, 'the brand survived at width ' + width + ': ' + JSON.stringify(rows));
		assert.equal(/gentle shell/i.test(joined), false, 'the brand text survived at width ' + width + ': ' + JSON.stringify(rows));
		// A hidden brand must not leave a separator with nothing in front of it, nor a row
		// that is empty because the only segment it had was the brand.
		for (const row of rows) assert.equal(row.trimStart().startsWith('⟡'), false, 'a stray leading separator at width ' + width + ': ' + JSON.stringify(rows));
		assert.ok(rows.every((row) => row.trim().length > 0), 'an empty header row at width ' + width + ': ' + JSON.stringify(rows));
	}
});

test('a theme with no name fails open and keeps the brand', { skip: !available && 'gentle-pi is not installed here' }, async () => {
	const rows = await header(120, undefined);
	assert.ok(rows.some((row) => /✿ gentle shell/i.test(row)), 'an unreadable theme must not hide the brand: ' + JSON.stringify(rows));
});
