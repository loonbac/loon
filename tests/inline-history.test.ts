/**
 * The unit's history: what a person finds after closing a unit and reloading pi.
 *
 * The card and its transcript come from gentle-pi's own history directory, so
 * that its `loadHistory` re-adds the record to the store on resume and the
 * overlay panel can render both the card and the thread. These tests assert the
 * file that lands there: that gentle-pi's own reader accepts it, that the id is a
 * file name it accepts, that the thread carries the tool calls and the closing
 * summary without a full tool output, that a second unit never overwrites the
 * first, and that a session which never worked writes nothing at all.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { createInlineWork } from '../extensions/inline-work.ts';
import { carrierDirectory, carrierPath } from '../extensions/lib/inline-carrier.ts';

const SESSION_ID = 'sess-hist-1';
/** The carrier id prefix plus the session: every unit id starts here. */
const UNIT_ID = 'loon-inline-' + SESSION_ID;
/** gentle-pi's own history location: `<agentHome>/gentle-agents/tasks`. */
const historyDirectory = (agentHome: string): string => join(agentHome, 'gentle-agents', 'tasks');

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
const gentleAvailable = existsSync(join(GENTLE, 'lib', 'agents-history.ts')) && existsSync(join(PI_ROOT, 'package.json'));

type Stored = { task: Record<string, unknown>; thread: { items: Record<string, unknown>[] } };
type Reader = (dir: string, id: string) => Promise<Stored | undefined>;

/** gentle-pi's own `loadStoredTask`, loaded the way pi loads its TypeScript. */
async function loadStoredTask(): Promise<Reader> {
	const { createJiti } = (await import(join(PI_ROOT, 'node_modules', 'jiti', 'lib', 'jiti-static.mjs'))) as {
		createJiti: (url: string, options: Record<string, unknown>) => { import: (path: string) => Promise<unknown> };
	};
	const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
	const history = (await jiti.import(join(GENTLE, 'lib', 'agents-history.ts'))) as { loadStoredTask: Reader };
	return history.loadStoredTask;
}

interface Harness {
	api: ExtensionAPI;
	fire: (event: string, payload?: Record<string, unknown>) => void;
}

function sessionContext(): ExtensionContext {
	return {
		sessionManager: { getSessionId: () => SESSION_ID },
		cwd: '/repo',
		model: { provider: 'anthropic', id: 'claude-opus-4' },
		thinkingLevel: 'high',
	} as unknown as ExtensionContext;
}

function fakePi(): Harness {
	const handlers = new Map<string, ((event: unknown, ctx: unknown) => void)[]>();
	const api = {
		on(event: string, handler: (event: unknown, ctx: unknown) => void): () => void {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
			return () => {};
		},
		registerToolRenderer: (): void => {},
	} as unknown as ExtensionAPI;
	return {
		api,
		fire(event, payload = { type: event }) {
			for (const handler of handlers.get(event) ?? []) handler(payload, sessionContext());
		},
	};
}

function scratch(): string {
	return mkdtempSync(join(tmpdir(), 'loon-history-'));
}

let callSequence = 0;

/** One top-level tool call, before and after it ran. */
function step(h: Harness, toolName: string, input: Record<string, unknown>, output: string, isError = false): void {
	callSequence += 1;
	const toolCallId = 'call-' + callSequence;
	h.fire('tool_call', { type: 'tool_call', toolCallId, toolName, input });
	h.fire('tool_execution_end', {
		type: 'tool_execution_end',
		toolCallId,
		toolName,
		isError,
		result: { content: [{ type: 'text', text: output }], details: undefined, isError },
	});
}

/** A session that starts, does its steps, and closes the unit with a summary. */
function runUnit(agentHome: string, steps: (h: Harness) => void, summary = 'Cerrei el slice con los tests.'): Harness {
	const h = fakePi();
	createInlineWork(h.api, { env: {}, agentHome, heartbeatMs: 0, now: () => 1_700_000_000_000 });
	h.fire('session_start', { type: 'session_start' });
	steps(h);
	h.fire('agent_end', {
		type: 'agent_end',
		messages: [{ role: 'assistant', content: [{ type: 'text', text: summary }] }],
	});
	return h;
}

function historyFiles(agentHome: string): string[] {
	try {
		return readdirSync(historyDirectory(agentHome)).filter((name) => name.endsWith('.json')).sort();
	} catch {
		return [];
	}
}

test('the closed unit lands where gentle-pi reads history from', () => {
	const agentHome = scratch();
	try {
		runUnit(agentHome, (h) => {
			step(h, 'read', { path: 'README.md' }, '# LOON\n\nsome prose');
			step(h, 'bash', { command: 'npm test' }, 'ok 12 tests');
		});
		assert.deepEqual(historyFiles(agentHome), [UNIT_ID + '-1.json'], 'one history file per unit, named after the task id');
	} finally {
		rmSync(agentHome, { recursive: true, force: true });
	}
});

test(
	"gentle-pi's own reader accepts the file, and its id is a file name it accepts",
	{ skip: !gentleAvailable && 'gentle-pi is not installed here' },
	async () => {
		const agentHome = scratch();
		try {
			runUnit(agentHome, (h) => step(h, 'read', { path: 'README.md' }, 'prose'));
			const [name] = historyFiles(agentHome);
			assert.ok(name, 'the unit wrote a history file');
			const id = name.replace(/\.json$/, '');
			assert.match(id, /^[a-z0-9-]+$/i, "the id must fit gentle-pi's SAFE_ID");

			const read = await loadStoredTask();
			const stored = await read(historyDirectory(agentHome), id);
			assert.ok(stored, 'loadStoredTask must return the record, not undefined');
			assert.equal(stored.task.id, id);
			assert.equal(stored.task.agent, 'gentle-ai-worker');
			assert.equal(stored.task.mode, 'inline');
			assert.equal(stored.task.status, 'completed');
			assert.equal(stored.task.parentSessionId, SESSION_ID);
			assert.ok(stored.thread.items.length > 0, 'the restored record carries a thread');

			// The negative control: the same reader refuses an id SAFE_ID rejects,
			// which is what makes the positive result above mean something.
			assert.equal(await read(historyDirectory(agentHome), id + '#'), undefined);
		} finally {
			rmSync(agentHome, { recursive: true, force: true });
		}
	},
);

test(
	'the thread carries the tool calls with a bounded summary, and the closing result',
	{ skip: !gentleAvailable && 'gentle-pi is not installed here' },
	async () => {
		const agentHome = scratch();
		try {
			const long = Array.from({ length: 400 }, (_, index) => 'line ' + index + ' of output').join('\n');
			runUnit(agentHome, (h) => {
				step(h, 'read', { path: 'README.md', offset: 1, limit: 50 }, '# LOON\n\nsome prose');
				step(h, 'bash', { command: 'npm test' }, long);
			});
			const [name] = historyFiles(agentHome);
			const read = await loadStoredTask();
			const stored = await read(historyDirectory(agentHome), (name as string).replace(/\.json$/, ''));
			assert.ok(stored);
			const items = stored.thread.items;

			const tools = items.filter((item) => item.kind === 'tool');
			assert.deepEqual(tools.map((item) => item.name), ['read', 'bash'], 'one item per top-level call, in order, with its name');
			for (const tool of tools) {
				assert.equal(tool.running, false, 'a closed unit has no running call');
				assert.ok((tool.output as string).length > 0, 'the call keeps a summary of what it produced');
				assert.ok((tool.output as string).length <= 1000, 'a full tool output never reaches the panel: got ' + (tool.output as string).length);
			}
			const last = items[items.length - 1];
			assert.equal(last?.kind, 'text', 'the closing result is the last thing in the thread');
			assert.match(String(last?.text), /Cerrei el slice con los tests/);
		} finally {
			rmSync(agentHome, { recursive: true, force: true });
		}
	},
);

test(
	"gentle-pi's own restore is what puts the card and its thread back after a reload",
	{ skip: !gentleAvailable && 'gentle-pi is not installed here' },
	async () => {
		const agentHome = scratch();
		try {
			runUnit(agentHome, (h) => {
				step(h, 'read', { path: 'README.md' }, '# LOON');
				step(h, 'bash', { command: 'npm test' }, 'ok 12 tests');
			});
			const { createJiti } = (await import(join(PI_ROOT, 'node_modules', 'jiti', 'lib', 'jiti-static.mjs'))) as {
				createJiti: (url: string, options: Record<string, unknown>) => { import: (path: string) => Promise<unknown> };
			};
			const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
			const history = (await jiti.import(join(GENTLE, 'lib', 'agents-history.ts'))) as {
				loadHistory: (dir: string) => Promise<{ task: Record<string, unknown>; thread: { items: unknown[] } }[]>;
			};
			const protocol = (await jiti.import(join(GENTLE, 'lib', 'agents-protocol.ts'))) as {
				TaskStore: new () => {
					restore: (task: unknown, thread: unknown) => boolean;
					list: (sessionId?: string) => { id: string; mode: string }[];
					thread: (id: string) => { items: unknown[] };
				};
			};

			// The restore gentle-pi runs on a startup into an existing session:
			// loadHistory, then every record of this session back into the store.
			const store = new protocol.TaskStore();
			for (const { task, thread } of await history.loadHistory(historyDirectory(agentHome))) {
				if (task.parentSessionId !== SESSION_ID) continue;
				store.restore(task, thread);
			}

			const cards = store.list(SESSION_ID);
			assert.equal(cards.length, 1, 'the panel lists exactly one card for the unit');
			assert.equal(cards[0]?.id, UNIT_ID + '-1');
			assert.equal(cards[0]?.mode, 'inline');
			const restored = store.thread(UNIT_ID + '-1');
			assert.ok(restored.items.length >= 3, 'opening the card shows its transcript, not an empty pane');
		} finally {
			rmSync(agentHome, { recursive: true, force: true });
		}
	},
);

test('a second unit in the same session does not overwrite the first', () => {
	const agentHome = scratch();
	try {
		runUnit(agentHome, (h) => step(h, 'grep', { pattern: 'carrier' }, 'three matches'));
		runUnit(agentHome, (h) => step(h, 'edit', { path: 'README.md' }, 'applied'));
		assert.deepEqual(historyFiles(agentHome), [UNIT_ID + '-1.json', UNIT_ID + '-2.json'], 'each unit keeps its own record');
	} finally {
		rmSync(agentHome, { recursive: true, force: true });
	}
});

test('the first unit is still readable after the second one closes', () => {
	const agentHome = scratch();
	try {
		runUnit(agentHome, (h) => step(h, 'grep', { pattern: 'carrier' }, 'three matches'));
		const before = historyFiles(agentHome)[0] as string;
		runUnit(agentHome, (h) => step(h, 'edit', { path: 'README.md' }, 'applied'));
		const text = readFileSync(join(historyDirectory(agentHome), before), 'utf8');
		assert.match(text, /"name":"grep"/, "the first unit's call is still there");
		assert.doesNotMatch(text, /"name":"edit"/, 'the second unit never writes into the first record');
	} finally {
		rmSync(agentHome, { recursive: true, force: true });
	}
});

test('nothing is written when the unit never started', () => {
	const agentHome = scratch();
	try {
		const h = fakePi();
		createInlineWork(h.api, { env: {}, agentHome, heartbeatMs: 0 });
		h.fire('session_start', { type: 'session_start' });
		h.fire('agent_end', {
			type: 'agent_end',
			messages: [{ role: 'assistant', content: [{ type: 'text', text: 'No hice nada.' }] }],
		});
		h.fire('session_shutdown', { type: 'session_shutdown' });
		assert.deepEqual(historyFiles(agentHome), [], 'a session without a unit leaves no history');
	} finally {
		rmSync(agentHome, { recursive: true, force: true });
	}
});

test('shutdown keeps the history and only removes the live carrier', () => {
	const agentHome = scratch();
	try {
		const h = runUnit(agentHome, (unit) => step(unit, 'read', { path: 'README.md' }, 'prose'));
		assert.ok(existsSync(carrierPath(agentHome, SESSION_ID)), 'the live carrier exists while the session lives');
		h.fire('session_shutdown', { type: 'session_shutdown' });
		assert.equal(existsSync(carrierPath(agentHome, SESSION_ID)), false, 'the live carrier is still removed');
		assert.equal(existsSync(carrierDirectory(agentHome)), true);
		assert.deepEqual(historyFiles(agentHome), [UNIT_ID + '-1.json'], 'the closed unit survives the shutdown: that is the whole point');
	} finally {
		rmSync(agentHome, { recursive: true, force: true });
	}
});
