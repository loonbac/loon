import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { installOverlayPanel } from '../extensions/lib/inline-overlay.ts';
import { TARGETS, patchTargetText } from '../scripts/apply-inline-carrier-patch.mjs';

// The merge only exists once the panel is patched, so this file runs against a
// copy of the installed library with the real patch applied to it, and then
// asks that copy's own AgentsView what it draws. Anything less would test our
// idea of the merge instead of the merge.

const GENTLE = join(homedir(), '.pi', 'agent', 'npm', 'node_modules', 'gentle-pi');
const PI_ROOT = join(homedir(), '.local/share/loon-pi/npm-prefix/lib/node_modules/@earendil-works/pi-coding-agent');
const available = existsSync(join(GENTLE, 'lib', 'agents-view.ts')) && existsSync(join(PI_ROOT, 'node_modules', 'jiti', 'lib', 'jiti-static.mjs'));
const SESSION = 'sess-panel-1';

interface Scenario {
	running?: boolean;
	closed?: boolean;
	restored?: boolean;
	malformed?: boolean;
	child?: boolean;
	provider?: boolean;
}

interface Rendered {
	lines: string[];
	dispose(): void;
	restore(id: string): void;
}

interface Harness {
	render(setup: Scenario): Promise<Rendered>;
}

let harness: Promise<Harness> | undefined;

function patchedLibraryCopy(): string {
	// The whole package, not just lib/: its modules reach into ../scripts, and a
	// copy that cannot import is not a copy of what runs.
	const root = mkdtempSync(join(tmpdir(), 'loon-view-copy-'));
	const skipped = new Set(['node_modules', '.git', 'dist', 'coverage', '.loon-test']);
	cpSync(GENTLE, root, {
		recursive: true,
		filter: (source) => !skipped.has(source.slice(GENTLE.length + 1).split('/')[0] ?? ''),
	});
	const lib = join(root, 'lib');
	const path = join(lib, 'agents-view.ts');
	const patched = patchTargetText(TARGETS[1], readFileSync(path, 'utf8'));
	assert.ok(patched.ok, patched.ok ? '' : patched.reason);
	writeFileSync(path, patched.text);
	return lib;
}

async function loadJiti() {
	const { createJiti } = (await import(join(PI_ROOT, 'node_modules', 'jiti', 'lib', 'jiti-static.mjs'))) as {
		createJiti: (url: string, options: Record<string, unknown>) => { import: (path: string) => Promise<unknown> };
	};
	return createJiti(import.meta.url, {
		moduleCache: false,
		interopDefault: true,
		fsCache: false,
		alias: {
			'@earendil-works/pi-tui': join(PI_ROOT, 'node_modules', '@earendil-works', 'pi-tui', 'dist', 'index.js'),
			'@earendil-works/pi-coding-agent': join(PI_ROOT, 'dist', 'index.js'),
			'@earendil-works/pi-agent-core': join(PI_ROOT, 'node_modules', '@earendil-works', 'pi-agent-core', 'dist', 'index.js'),
			'@earendil-works/pi-ai': join(PI_ROOT, 'node_modules', '@earendil-works', 'pi-ai', 'dist', 'compat.js'),
		},
	});
}

function buildHarness(): Promise<Harness> {
	harness ??= (async () => {
		const lib = patchedLibraryCopy();
		const jiti = await loadJiti();
		const viewModule = (await jiti.import(join(lib, 'agents-view.ts'))) as any;
		const protocol = (await jiti.import(join(lib, 'agents-protocol.ts'))) as any;
		return {
			async render(setup: Scenario) {
				const agentHome = mkdtempSync(join(tmpdir(), 'loon-view-home-'));
				mkdirSync(join(agentHome, 'state', 'loon-inline'), { recursive: true });
				mkdirSync(join(agentHome, 'gentle-agents', 'tasks'), { recursive: true });
				mkdirSync(join(agentHome, 'gentle-agents', 'presence'), { recursive: true });
				const id = 'loon-inline-' + SESSION + '-' + (setup.running || setup.closed ? '1' : setup.restored ? '1' : '1');
				const record = (status: string, label: string, result: string | null) => ({
					id,
					agent: 'gentle-ai-worker',
					mode: 'inline',
					prompt: '',
					label,
					cwd: '/repo',
					parentSessionId: SESSION,
					status,
					createdAt: 1000,
					startedAt: 1000,
					endedAt: status === 'completed' ? 2000 : null,
					model: 'test-model',
					thinking: 'high',
					sessionPath: null,
					error: null,
					result,
					lastStep: 'bash',
					lastActivityAt: Date.now(),
					turns: 1,
					toolCalls: 1,
					tokens: 10,
					cost: 0,
					pid: process.pid,
				});
				const thread = {
					version: 1,
					dropped: 0,
					items: [
						{ kind: 'tool', callId: 'c1', name: 'grep', args: {}, output: 'tres coincidencias', running: false, isError: false },
						{ kind: 'text', text: 'resumen del cierre' },
					],
					limits: { maxItems: 200, maxOutputChars: 1000 },
				};
				if (setup.malformed) {
					writeFileSync(join(agentHome, 'state', 'loon-inline', SESSION + '.json'), '{ not json');
					writeFileSync(join(agentHome, 'gentle-agents', 'tasks', id + '.json'), '{ not json');
				} else {
					if (setup.running) {
						writeFileSync(join(agentHome, 'state', 'loon-inline', SESSION + '.json'), JSON.stringify(record('running', 'trabajando', null)));
						writeFileSync(join(agentHome, 'state', 'loon-inline', SESSION + '.thread.json'), JSON.stringify({ id, thread }));
					}
					if (setup.closed) {
						// The window between the history write and the shutdown that
						// removes the live carrier: both sources exist.
						writeFileSync(join(agentHome, 'state', 'loon-inline', SESSION + '.json'), JSON.stringify(record('completed', 'trabajando', null)));
						writeFileSync(join(agentHome, 'state', 'loon-inline', SESSION + '.thread.json'), JSON.stringify({ id, thread }));
						writeFileSync(join(agentHome, 'gentle-agents', 'tasks', id + '.json'), JSON.stringify({ task: record('completed', 'cerrado', 'resumen del cierre'), thread }));
					}
				}

				const store = new protocol.TaskStore();
				if (setup.child) {
					const child = { ...record('completed', 'subagente real', 'hecho'), id: 'child-task-1', agent: 'gentle-ai-worker' };
					store.restore(child, thread);
				}
				installOverlayPanel({ agentHome });
				// The differential case: the same store and the same files, once with
				// the provider and once without, must draw the same rows.
				if (setup.provider === false) installOverlayPanel(undefined);
				const view = new viewModule.AgentsView({
					theme: { fg: (_color: string, text: string) => text },
					rows: 30,
					store,
					sessionId: SESSION,
					now: () => 3000,
					onCancel: () => {},
					onOpen: () => {},
					onClose: () => {},
					requestRender: () => {},
					presence: { profile: agentHome },
				});
				const lines = view.render(120) as string[];
				return {
					lines,
					dispose() {
						view.dispose();
						installOverlayPanel(undefined);
						rmSync(agentHome, { recursive: true, force: true });
					},
					restore(restoreId: string) {
						store.restore({ ...record('completed', 'cerrado', 'resumen del cierre'), id: restoreId }, thread);
					},
				};
			},
		};
	})();
	return harness;
}

function cards(lines: string[]): number {
	return lines.filter((line) => line.includes('Subagent gentle-ai-worker')).length;
}

test('a running unit is in the panel, once, with its live thread', { skip: !available && 'gentle-pi is not installed here' }, async () => {
	const rendered = await (await buildHarness()).render({ running: true });
	try {
		assert.equal(cards(rendered.lines), 1, 'the panel draws the running unit exactly once');
		const text = rendered.lines.join('\n');
		assert.match(text, /◐/, 'it is drawn as a running task');
		assert.match(text, /grep/, 'opening it shows the live transcript');
	} finally {
		rendered.dispose();
	}
});

test('when the unit closes the same card flips, and does not double', { skip: !available && 'gentle-pi is not installed here' }, async () => {
	const rendered = await (await buildHarness()).render({ closed: true });
	try {
		assert.equal(cards(rendered.lines), 1, 'history file and live carrier are one unit, not two cards');
		const text = rendered.lines.join('\n');
		assert.match(text, /✓/, 'the same card is now a finished task');
		assert.doesNotMatch(text, /◐/, 'and no longer claims to be running');
		assert.match(text, /grep/, 'the transcript is still there after the flip');
		assert.match(text, /resumen del cierre/, 'and it ends with the closing text');
	} finally {
		rendered.dispose();
	}
});

test('a unit the store already restored is still one card', { skip: !available && 'gentle-pi is not installed here' }, async () => {
	const rendered = await (await buildHarness()).render({ closed: true });
	try {
		rendered.restore('loon-inline-' + SESSION + '-1');
		const lines = rendered.lines;
		assert.equal(cards(lines), 1, 'the restore must not add a second card for the same unit');
	} finally {
		rendered.dispose();
	}
});

test('a subagent that is not inline is drawn exactly as before', { skip: !available && 'gentle-pi is not installed here' }, async () => {
	const harness = await buildHarness();
	const withProvider = await harness.render({ child: true });
	const withLines = [...withProvider.lines];
	withProvider.dispose();
	const withoutProvider = await harness.render({ child: true, provider: false });
	try {
		assert.equal(cards(withLines), 1);
		assert.deepEqual(withLines, withoutProvider.lines, 'the provider must not change a row that is not ours');
	} finally {
		withoutProvider.dispose();
	}
});

test('a malformed record is absent from the panel, not an error card', { skip: !available && 'gentle-pi is not installed here' }, async () => {
	const rendered = await (await buildHarness()).render({ malformed: true });
	try {
		assert.equal(cards(rendered.lines), 0);
	} finally {
		rendered.dispose();
	}
});
