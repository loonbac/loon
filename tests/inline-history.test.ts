/**
 * The unit's history: what a person finds after closing a unit and reloading pi.
 *
 * The card and its transcript come from gentle-pi's own history directory, so
 * that its `loadHistory` re-adds the record to the store on resume and the
 * overlay panel can render both the card and the thread. These tests assert the
 * file that lands there: that gentle-pi's own reader accepts it, that the id is a
 * file name it accepts, that the thread carries the tool calls and the closing
 * summary without a full tool output, that two requests in one session stay one
 * record with both transcripts, that the previous design's one-record-per-unit
 * files are merged into one, and that a session which never worked writes
 * nothing at all.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { createInlineWork } from '../extensions/inline-work.ts';
import { carrierDirectory, carrierPath } from '../extensions/lib/inline-carrier.ts';

const SESSION_ID = 'sess-hist-1';
/** The carrier id prefix plus the session: every unit id starts here. */
/** The job id: one session is one card, so the record carries the session. */
const JOB_ID = 'loon-inline-' + SESSION_ID;
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
/** A session that stays open, so a second unit is really the same job. */
function session(agentHome: string): Harness {
	const h = fakePi();
	createInlineWork(h.api, { env: {}, agentHome, heartbeatMs: 0, now: () => 1_700_000_000_000 });
	h.fire('session_start', { type: 'session_start' });
	return h;
}

/** The turn ended: the unit closes and its record is written. */
function closeTurn(h: Harness, summary: string): void {
	h.fire('agent_end', { type: 'agent_end', messages: [{ role: 'assistant', content: [{ type: 'text', text: summary }] }] });
}

/** What the model reported spending on that message. */
function spend(h: Harness, tokens: number, cost: number): void {
	h.fire('message_end', {
		type: 'message_end',
		message: { role: 'assistant', content: [], usage: { totalTokens: tokens, cost: { total: cost } } },
	});
}

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
		assert.deepEqual(historyFiles(agentHome), [JOB_ID + '.json'], 'one history file for the session, named after the job id');
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
			assert.equal(cards[0]?.id, JOB_ID);
			assert.equal(cards[0]?.mode, 'inline');
			const restored = store.thread(JOB_ID);
			assert.ok(restored.items.length >= 3, 'opening the card shows its transcript, not an empty pane');
		} finally {
			rmSync(agentHome, { recursive: true, force: true });
		}
	},
);

test('two units in one session are one record, with both transcripts in order', () => {
	const agentHome = scratch();
	try {
		const h = session(agentHome);
		step(h, 'grep', { pattern: 'carrier' }, 'three matches');
		closeTurn(h, 'Primera parte lista.');
		step(h, 'edit', { path: 'README.md' }, 'applied');
		closeTurn(h, 'Segunda parte lista.');

		assert.deepEqual(historyFiles(agentHome), [JOB_ID + '.json'], 'one card per job, not one per request');
		const stored = JSON.parse(readFileSync(join(historyDirectory(agentHome), JOB_ID + '.json'), 'utf8')) as {
			thread: { items: { kind: string; name?: string; text?: string }[] };
		};
		const layout = stored.thread.items.map((item) => (item.kind === 'tool' ? item.name : item.kind === 'note' ? 'note' : item.text));
		assert.deepEqual(layout, ['grep', 'Primera parte lista.', 'note', 'edit', 'Segunda parte lista.'], 'both stretches of work, in order, with a divider where the next request began');
	} finally {
		rmSync(agentHome, { recursive: true, force: true });
	}
});

test('the totals on the record are the job totals, not the last unit numbers', () => {
	const agentHome = scratch();
	try {
		const h = session(agentHome);
		step(h, 'read', { path: 'a' }, 'one');
		spend(h, 1000, 0.001);
		closeTurn(h, 'Primera.');
		const first = JSON.parse(readFileSync(join(historyDirectory(agentHome), JOB_ID + '.json'), 'utf8')) as { task: { tokens: number; cost: number; createdAt: number; startedAt: number | null } };
		step(h, 'read', { path: 'b' }, 'two');
		spend(h, 500, 0.002);
		closeTurn(h, 'Segunda.');
		const second = JSON.parse(readFileSync(join(historyDirectory(agentHome), JOB_ID + '.json'), 'utf8')) as { task: { tokens: number; cost: number; createdAt: number; startedAt: number | null; toolCalls: number } };
		assert.equal(second.task.tokens, 1500, 'tokens add up across units');
		assert.equal(second.task.cost, 0.003, 'cost adds up across units');
		assert.equal(second.task.toolCalls, 2, 'and so do the calls');
		assert.equal(second.task.createdAt, first.task.createdAt, 'the job keeps its start: wall time is the job span');
		assert.equal(second.task.startedAt, first.task.startedAt);
	} finally {
		rmSync(agentHome, { recursive: true, force: true });
	}
});

test('a session from the previous design is merged into one record, once', () => {
	const agentHome = scratch();
	try {
		// Two records the old writer left behind, one per unit.
		const legacy = (unit: number, name: string, at: number): void => {
			const task = {
				id: JOB_ID + '-' + unit,
				agent: 'gentle-ai-worker',
				mode: 'inline',
				prompt: '',
				label: 'unit ' + unit,
				cwd: '/repo',
				parentSessionId: SESSION_ID,
				status: 'completed',
				createdAt: at,
				startedAt: at,
				endedAt: at + 10,
				model: 'test-model',
				thinking: 'high',
				sessionPath: null,
				error: null,
				result: 'done',
				lastStep: name,
				lastActivityAt: at + 10,
				turns: 1,
				toolCalls: 1,
				tokens: 100,
				cost: 0.001,
			};
			const thread = { version: 1, dropped: 0, items: [{ kind: 'tool', callId: 'c' + unit, name, args: {}, output: 'ok', running: false, isError: false }], limits: { maxItems: 200, maxOutputChars: 1000 } };
			writeFileSync(join(historyDirectory(agentHome), task.id + '.json'), JSON.stringify({ task, thread }));
		};
		mkdirSync(historyDirectory(agentHome), { recursive: true });
		legacy(1, 'grep', 1000);
		legacy(2, 'edit', 2000);

		// Starting the session is what merges them, before anything is restored.
		const h = fakePi();
		createInlineWork(h.api, { env: {}, agentHome, heartbeatMs: 0 });
		h.fire('session_start', { type: 'session_start' });

		assert.deepEqual(historyFiles(agentHome), [JOB_ID + '.json'], 'one record, so a restore brings one card');
		const merged = JSON.parse(readFileSync(join(historyDirectory(agentHome), JOB_ID + '.json'), 'utf8')) as {
			thread: { items: { kind: string; name?: string }[] };
		};
		const names = merged.thread.items.filter((item) => item.kind === 'tool').map((item) => item.name);
		assert.deepEqual(names, ['grep', 'edit'], 'both stretches of work survive, in order');
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
		assert.deepEqual(historyFiles(agentHome), [JOB_ID + '.json'], 'the closed unit survives the shutdown: that is the whole point');
	} finally {
		rmSync(agentHome, { recursive: true, force: true });
	}
});
