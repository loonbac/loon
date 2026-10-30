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
import { IDLE_CLOSE_MS, createInlineWork } from '../extensions/inline-work.ts';
import { carrierDirectory, carrierPath, closeRequestPath } from '../extensions/lib/inline-carrier.ts';

const SESSION_ID = 'sess-hist-1';
/** The first job of the session: a job is the work, so it carries its own number. */
const JOB_ONE = 'loon-inline-' + SESSION_ID + '-1';
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

/** A record on disk, wherever it is stored. */
function readStored(agentHome: string, path: string): Record<string, unknown> {
	const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
	return parsed as Record<string, unknown>;
}

/** What the agent runs to say the work is done: the marker the extension consumes. */
function signalDone(agentHome: string): void {
	mkdirSync(join(agentHome, 'state', 'loon-inline'), { recursive: true });
	writeFileSync(closeRequestPath(agentHome, SESSION_ID), JSON.stringify({ at: Date.now(), by: 'agent' }));
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
	// A turn ending does not finish the work: the agent says so, and the extension
	// consumes that signal on its next event.
	signalDone(agentHome);
	h.fire('message_end', { type: 'message_end', message: { role: 'assistant', content: [] } });
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
		assert.deepEqual(historyFiles(agentHome), [JOB_ONE + '.json'], 'one history file for the job, named after the job id');
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
			assert.equal(cards[0]?.id, JOB_ONE);
			assert.equal(cards[0]?.mode, 'inline');
			const restored = store.thread(JOB_ONE);
			assert.ok(restored.items.length >= 3, 'opening the card shows its transcript, not an empty pane');
		} finally {
			rmSync(agentHome, { recursive: true, force: true });
		}
	},
);

test('three turns inside one job are one record, and the card stays running', () => {
	const agentHome = scratch();
	try {
		const h = session(agentHome);
		step(h, 'read', { path: 'a' }, 'one');
		closeTurn(h, 'Primera parte.');
		step(h, 'read', { path: 'b' }, 'two');
		closeTurn(h, 'Segunda parte.');
		step(h, 'read', { path: 'c' }, 'three');
		closeTurn(h, 'Tercera parte.');

		// The job is the work, not the turn: nothing is written until the work is over.
		assert.deepEqual(historyFiles(agentHome), [], 'an open job writes no history yet');
		const carrier = readStored(agentHome, carrierPath(agentHome, SESSION_ID));
		assert.equal(carrier.status, 'running', 'a turn ending must not finish the job');
		assert.equal(carrier.id, JOB_ONE, 'one id for the whole job');
		const thread = JSON.parse(readFileSync(join(carrierDirectory(agentHome), SESSION_ID + '.thread.json'), 'utf8')) as { id: string; thread: { items: { kind: string; name?: string; text?: string }[] } };
		const layout = thread.thread.items.map((item) => (item.kind === 'tool' ? item.name : item.kind === 'note' ? 'note' : item.text));
		assert.deepEqual(layout, ['read', 'Primera parte.', 'note', 'read', 'Segunda parte.', 'note', 'read', 'Tercera parte.'], 'three turns, in order, with a divider where each new request began');
	} finally {
		rmSync(agentHome, { recursive: true, force: true });
	}
});

test('a job never shows completed between its turns, not for a moment', () => {
	const agentHome = scratch();
	try {
		const h = session(agentHome);
		const status = (): unknown => (readStored(agentHome, carrierPath(agentHome, SESSION_ID)) as { status?: unknown }).status;

		step(h, 'read', { path: 'a' }, 'one');
		closeTurn(h, 'Primera.');
		assert.equal(status(), 'running', 'a turn ending must not tell the person the work finished');
		assert.deepEqual(historyFiles(agentHome), [], 'and must not write the record either');

		step(h, 'read', { path: 'b' }, 'two');
		closeTurn(h, 'Segunda.');
		assert.equal(status(), 'running');
		assert.deepEqual(historyFiles(agentHome), []);

		step(h, 'read', { path: 'c' }, 'three');
		closeTurn(h, 'Tercera.');
		assert.equal(status(), 'running', 'three turns, still the same open job');
		assert.deepEqual(historyFiles(agentHome), []);

		// Only the agent's own signal completes it.
		signalDone(agentHome);
		h.fire('message_end', { type: 'message_end', message: { role: 'assistant', content: [] } });
		assert.equal(status(), 'completed');
		assert.deepEqual(historyFiles(agentHome), [JOB_ONE + '.json']);
	} finally {
		rmSync(agentHome, { recursive: true, force: true });
	}
});

test('the agent signal closes the job with the accumulated thread', () => {
	const agentHome = scratch();
	try {
		const h = session(agentHome);
		step(h, 'read', { path: 'a' }, 'one');
		closeTurn(h, 'Primera parte.');
		step(h, 'edit', { path: 'b' }, 'two');
		closeTurn(h, 'Segunda parte.');
		assert.deepEqual(historyFiles(agentHome), []);

		// The agent says the work is done; the extension consumes it on its next event.
		signalDone(agentHome);
		h.fire('message_end', {
			type: 'message_end',
			message: { role: 'assistant', content: [], usage: { totalTokens: 10, cost: { total: 0.001 } } },
		});

		assert.deepEqual(historyFiles(agentHome), [JOB_ONE + '.json'], 'the job becomes one record');
		const stored = readStored(agentHome, join(historyDirectory(agentHome), JOB_ONE + '.json')) as {
			task: { status: string; closedBy?: string; toolCalls: number };
			thread: { items: { kind: string; name?: string }[] };
		};
		assert.equal(stored.task.status, 'completed');
		assert.equal(stored.task.closedBy, 'agent', 'the record says who closed it');
		assert.deepEqual(stored.thread.items.filter((item) => item.kind === 'tool').map((item) => item.name), ['read', 'edit'], 'both turns are in the transcript');
		assert.equal(readStored(agentHome, carrierPath(agentHome, SESSION_ID)).status, 'completed', 'and the card is finished');
	} finally {
		rmSync(agentHome, { recursive: true, force: true });
	}
});

test('a request after a closed job opens a new card', () => {
	const agentHome = scratch();
	try {
		const h = session(agentHome);
		step(h, 'read', { path: 'a' }, 'one');
		closeTurn(h, 'Primera.');
		signalDone(agentHome);
		h.fire('message_end', { type: 'message_end', message: { role: 'assistant', content: [] } });
		assert.deepEqual(historyFiles(agentHome), [JOB_ONE + '.json']);

		// The next request is a new piece of work, and gets its own card.
		step(h, 'bash', { command: 'ls' }, 'ok');
		const carrier = readStored(agentHome, carrierPath(agentHome, SESSION_ID));
		assert.equal(carrier.id, 'loon-inline-' + SESSION_ID + '-2', 'the next job has its own id');
		assert.equal(carrier.status, 'running');
		closeTurn(h, 'Segunda.');
		signalDone(agentHome);
		h.fire('message_end', { type: 'message_end', message: { role: 'assistant', content: [] } });
		assert.deepEqual(historyFiles(agentHome), [JOB_ONE + '.json', 'loon-inline-' + SESSION_ID + '-2.json'].sort(), 'two jobs, two records');
	} finally {
		rmSync(agentHome, { recursive: true, force: true });
	}
});

test('the totals belong to the job, and a new job starts from zero', () => {
	const agentHome = scratch();
	try {
		const h = session(agentHome);
		step(h, 'read', { path: 'a' }, 'one');
		spend(h, 1000, 0.001);
		closeTurn(h, 'Primera.');
		step(h, 'read', { path: 'b' }, 'two');
		spend(h, 500, 0.002);
		closeTurn(h, 'Segunda.');
		signalDone(agentHome);
		h.fire('message_end', { type: 'message_end', message: { role: 'assistant', content: [] } });
		const first = readStored(agentHome, join(historyDirectory(agentHome), JOB_ONE + '.json')) as {
			task: { tokens: number; cost: number; toolCalls: number; createdAt: number };
		};
		assert.equal(first.task.tokens, 1500, 'tokens add up across the turns of one job');
		assert.equal(first.task.cost, 0.003, 'and so does the cost');
		assert.equal(first.task.toolCalls, 2);

		step(h, 'bash', { command: 'ls' }, 'ok');
		spend(h, 7, 0.0005);
		const second = readStored(agentHome, carrierPath(agentHome, SESSION_ID)) as { tokens: number; cost: number; createdAt: number; toolCalls: number };
		assert.equal(second.tokens, 7, 'a new job does not inherit the previous totals');
		assert.equal(second.cost, 0.0005);
		assert.equal(second.toolCalls, 1);
		assert.ok(second.createdAt >= first.task.createdAt, 'and it starts its own clock');
	} finally {
		rmSync(agentHome, { recursive: true, force: true });
	}
});

test('the idle fallback closes the job and records why', async () => {
	const agentHome = scratch();
	try {
		const clock = { value: 1_800_000_000_000 };
		const h = fakePi();
		createInlineWork(h.api, { env: {}, agentHome, heartbeatMs: 10, now: () => clock.value });
		h.fire('session_start', { type: 'session_start' });
		step(h, 'read', { path: 'a' }, 'one');
		closeTurn(h, 'Primera.');
		assert.deepEqual(historyFiles(agentHome), []);

		// Nothing else happens: no signal, no activity. The heartbeat notices.
		clock.value += IDLE_CLOSE_MS + 1;
		await new Promise((resolve) => setTimeout(resolve, 80));

		assert.deepEqual(historyFiles(agentHome), [JOB_ONE + '.json'], 'a job nobody finished is still closed');
		const stored = readStored(agentHome, join(historyDirectory(agentHome), JOB_ONE + '.json')) as {
			task: { status: string; closedBy?: string };
			thread: { items: { kind: string; text?: string }[] };
		};
		assert.equal(stored.task.status, 'completed');
		assert.equal(stored.task.closedBy, 'idle');
		assert.match(JSON.stringify(stored.thread.items), /without activity/, 'the transcript says it was not the agent who closed it');
	} finally {
		rmSync(agentHome, { recursive: true, force: true });
	}
});

test('a job still open when the session ends is closed, not left running', () => {
	const agentHome = scratch();
	try {
		const h = session(agentHome);
		step(h, 'read', { path: 'a' }, 'one');
		closeTurn(h, 'Primera.');
		h.fire('session_shutdown', { type: 'session_shutdown' });
		const stored = readStored(agentHome, join(historyDirectory(agentHome), JOB_ONE + '.json')) as { task: { status: string; closedBy?: string } };
		assert.equal(stored.task.status, 'completed');
		assert.equal(stored.task.closedBy, 'session');
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
		assert.deepEqual(historyFiles(agentHome), [JOB_ONE + '.json'], 'the closed job survives the shutdown: that is the whole point');
	} finally {
		rmSync(agentHome, { recursive: true, force: true });
	}
});
