import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
	PATCH_MARKERS,
	PATCH_NOTICE_KEY,
	missingPatches,
	patchNoticeText,
	repoRootOf,
} from '../extensions/lib/patch-notice.ts';
import { TARGETS } from '../scripts/gentle-pi-patch.ts';
import { createLoonExtension } from '../extensions/loon-startup.ts';
import { DEFAULT_GENTLE_SETTINGS } from '../extensions/lib/gentle-config.ts';
import { DEFAULT_LOON_SETTINGS } from '../extensions/lib/loon-config.ts';

/** A fake installed package: every file present with the marker the patch writes. */
function installed(): string {
	const root = mkdtempSync(join(tmpdir(), 'loon-notice-'));
	for (const { file, marker } of PATCH_MARKERS) {
		mkdirSync(dirname(join(root, file)), { recursive: true });
		writeFileSync(join(root, file), '// pristine\nconst x = 1;\n' + marker + '\n');
	}
	writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'gentle-pi', version: '4.6.0' }));
	return root;
}

test('the marker table covers every file the patch targets', () => {
	// A target added to the patch without a marker here would be a file whose loss the
	// owner is never told about, which is the failure this notice exists to prevent.
	assert.deepEqual(
		PATCH_MARKERS.map((entry) => entry.file).sort(),
		TARGETS.map((target) => target.file).sort(),
	);
});

test('nothing missing when every marker is there, and each lost file is named', () => {
	const root = installed();
	try {
		assert.deepEqual(missingPatches(root), []);
		writeFileSync(join(root, 'lib', 'shell-card.ts'), '// a stock gentle-pi 4.6.0 file\n');
		assert.deepEqual(missingPatches(root), ['lib/shell-card.ts'], 'the lost target is not named');
		rmSync(join(root, 'lib', 'shell-prompt.ts'));
		assert.deepEqual(missingPatches(root), ['lib/shell-card.ts', 'lib/shell-prompt.ts'], 'a missing file is not a loss');
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('the notice names what was lost and the exact command, not a vague warning', () => {
	const text = patchNoticeText(['lib/shell-card.ts', 'lib/shell-prompt.ts', 'lib/shell-bar.ts'], '/home/loon/loon');
	assert.match(text, /parche LOON perdido/, text);
	assert.match(text, /geometría de tarjetas/, 'the notice does not say what was lost: ' + text);
	assert.match(text, /barra y filas de banner/, text);
	assert.match(text, /3 de 7 archivos/, 'the notice does not count what is missing: ' + text);
	assert.ok(
		text.includes('cd /home/loon/loon && node --experimental-strip-types scripts/gentle-pi-patch.ts apply'),
		'the notice does not carry the exact command with its absolute path: ' + text,
	);
	assert.equal(text.includes('\n'), false, 'a status line is one line');
});

test('the repository root is derived from the module, whatever the cwd is', () => {
	// Whatever depth the module sits at, the answer is the directory that holds the
	// patch: the command in the notice has to run from there.
	const real = repoRootOf(new URL('../extensions/lib/patch-notice.ts', import.meta.url).href);
	assert.equal(real, join(dirname(new URL(import.meta.url).pathname), '..').replace(/\/tests\/\.\.$/, ''), real);
	assert.equal(repoRootOf(new URL('../extensions/loon-startup.ts', import.meta.url).href), real, 'a module one level up resolved elsewhere');
	assert.ok(existsSync(join(real, 'scripts', 'gentle-pi-patch.ts')), 'the resolved root does not hold the patch: ' + real);
});

/** The session-start wiring, with the settings sources replaced like the rest of the suite. */
function boot(missing: () => string[]) {
	const calls: [string, unknown][] = [];
	const pi = {
		handlers: new Map<string, Array<(event: unknown, ctx: unknown) => void>>(),
		on(event: string, handler: (event: unknown, ctx: unknown) => void) {
			const list = this.handlers.get(event) ?? [];
			list.push(handler);
			this.handlers.set(event, list);
		},
		// Only what the header snapshot reads on a session start.
		getThinkingLevel: () => 'medium',
		getCommands: () => [],
	};
	const ctx = {
		mode: 'tui',
		hasUI: true,
		cwd: '/tmp',
		model: { provider: 'openai-codex', id: 'gpt-5.5' },
		ui: {
			theme: { name: 'Wallpaper (LOON)', fg: (_role: string, text: string) => text, bold: (text: string) => text },
			setHeader: () => undefined,
			setWidget: () => undefined,
			setStatus: (key: string, text: unknown) => calls.push([key, text]),
			setFooter: () => undefined,
			setWorkingIndicator: () => undefined,
			notify: () => undefined,
			select: async () => undefined,
		},
	};
	createLoonExtension(pi as never, {
		read: () => ({ loon: { ...DEFAULT_LOON_SETTINGS }, gentle: { ...DEFAULT_GENTLE_SETTINGS } }),
		write: () => undefined,
		wallpaper: () => undefined,
		ensureTheme: () => ({ result: 'up-to-date', path: '/tmp/themes/Wallpaper (LOON).json' }),
		watch: () => () => undefined,
		patchMissing: missing,
	});
	return { pi, ctx, calls };
}

async function started(missing: () => string[]): Promise<[string, unknown][]> {
	const { pi, ctx, calls } = boot(missing);
	for (const handler of pi.handlers.get('session_start') ?? []) handler({}, ctx);
	await new Promise((resolve) => setTimeout(resolve, 5));
	return calls.filter(([key]) => key === PATCH_NOTICE_KEY);
}

test('a lost patch is announced in a status key that survives the scrollback', async () => {
	const announced = await started(() => ['lib/shell-card.ts', 'lib/shell-bar.ts']);
	assert.equal(announced.length, 1, 'the notice was not set once: ' + JSON.stringify(announced));
	const [, text] = announced[0]!;
	assert.equal(typeof text, 'string');
	assert.match(String(text), /parche LOON perdido/);
	assert.match(String(text), /gentle-pi-patch\.ts apply/, 'the notice does not say what to run');
});

test('a repaired patch clears the notice, so a stale one cannot keep lying', async () => {
	const announced = await started(() => []);
	assert.deepEqual(announced, [[PATCH_NOTICE_KEY, undefined]], 'a healthy install must clear the key, not leave it set');
});

test('a notice that cannot be computed clears itself instead of throwing into pi', async () => {
	const announced = await started(() => {
		throw new Error('unreadable package');
	});
	assert.deepEqual(announced, [[PATCH_NOTICE_KEY, undefined]]);
});
