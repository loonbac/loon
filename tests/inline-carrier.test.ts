import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { createInlineWork, summaryLine } from '../extensions/inline-work.ts';
import {
	INLINE_AGENT,
	INLINE_MODE,
	INLINE_STATUS,
	agentHomeDirectory,
	buildCarrierRecord,
	carrierPath,
	inlineText,
	inlineWorkEnabled,
	isCarrierSessionId,
	pruneDeadCarriers,
	processAlive,
	removeCarrier,
	stepLabel,
	writeCarrier,
	type InlineCarrierRecord,
} from '../extensions/lib/inline-carrier.ts';

/** The field set of gentle-pi's `TaskRecord`, which the card renders. */
const TASK_RECORD_FIELDS = [
	'id',
	'agent',
	'mode',
	'prompt',
	'label',
	'cwd',
	'parentSessionId',
	'status',
	'createdAt',
	'startedAt',
	'endedAt',
	'model',
	'thinking',
	'sessionPath',
	'error',
	'result',
	'lastStep',
	'lastActivityAt',
	'turns',
	'toolCalls',
	'tokens',
	'cost',
] as const;

const SESSION_ID = 'sess-abc123';

function scratch(): string {
	return mkdtempSync(join(tmpdir(), 'loon-inline-'));
}

interface FakePi {
	api: ExtensionAPI;
	handlers: Map<string, ((event: unknown, ctx: unknown) => void)[]>;
	fire(event: string, payload?: unknown, ctx?: unknown): void;
}

function fakePi(): FakePi {
	const handlers = new Map<string, ((event: unknown, ctx: unknown) => void)[]>();
	const on = (event: string, handler: (event: unknown, ctx: unknown) => void) => {
		const list = handlers.get(event) ?? [];
		list.push(handler);
		handlers.set(event, list);
		return () => {};
	};
	return {
		api: { on } as unknown as ExtensionAPI,
		handlers,
		fire(event, payload = { type: event }, ctx) {
			for (const handler of handlers.get(event) ?? []) handler(payload, ctx);
		},
	};
}

function context(overrides: Record<string, unknown> = {}): ExtensionContext {
	return {
		cwd: '/home/person/projects/loon',
		model: { provider: 'antigravity', id: 'claude-opus-5-5' },
		thinkingLevel: 'high',
		sessionManager: { getSessionId: () => SESSION_ID },
		...overrides,
	} as unknown as ExtensionContext;
}

function readCarrier(agentHome: string, sessionId = SESSION_ID): InlineCarrierRecord {
	return JSON.parse(readFileSync(carrierPath(agentHome, sessionId), 'utf8')) as InlineCarrierRecord;
}

test('the carrier record has the exact shape gentle-pi renders', () => {
	const record = buildCarrierRecord({
		sessionId: SESSION_ID,
		cwd: '/home/person/projects/loon',
		status: INLINE_STATUS.RUNNING,
		createdAt: 1_000,
		startedAt: 1_000,
		endedAt: null,
		label: 'edit extensions/inline-work.ts',
		lastStep: 'edit extensions/inline-work.ts',
		lastActivityAt: 1_000,
		model: 'antigravity/claude-opus-5-5',
		thinking: 'high',
		turns: 0,
		toolCalls: 1,
		tokens: 0,
		cost: 0,
		pid: 4321,
	});

	for (const field of TASK_RECORD_FIELDS) {
		assert.ok(Object.hasOwn(record, field), 'TaskRecord field ' + field + ' is missing');
	}
	assert.deepEqual(
		Object.keys(record).filter((key) => !(TASK_RECORD_FIELDS as readonly string[]).includes(key)),
		['pid'],
		'only the carrier pid is added on top of TaskRecord',
	);
	assert.equal(record.id, 'loon-inline-' + SESSION_ID);
	assert.equal(record.agent, INLINE_AGENT);
	assert.equal(record.agent, 'gentle-ai-worker');
	assert.equal(record.mode, INLINE_MODE);
	assert.equal(record.mode, 'inline');
	assert.equal(record.parentSessionId, SESSION_ID);
	assert.equal(record.status, 'running');
	assert.equal(record.startedAt, 1_000);
	assert.equal(record.model, 'antigravity/claude-opus-5-5');
	assert.equal(record.thinking, 'high');
	// There is no launch behind inline work, and the record must not imply one.
	assert.equal(record.prompt, '');
	assert.equal(record.sessionPath, null);
	assert.equal(record.error, null);
	assert.equal(record.result, null);
	assert.equal(record.pid, 4321);
	assert.equal(JSON.parse(JSON.stringify(record)).id, record.id, 'the record survives a round trip through JSON');
});

test('the kill switch turns the whole extension off', () => {
	assert.equal(inlineWorkEnabled({}), true);
	assert.equal(inlineWorkEnabled({ LOON_INLINE_WORK: '1' }), true);
	assert.equal(inlineWorkEnabled({ LOON_INLINE_WORK: '0' }), false);
	assert.equal(inlineWorkEnabled({ LOON_INLINE_WORK: ' 0 ' }), false);

	const pi = fakePi();
	createInlineWork(pi.api, { env: { LOON_INLINE_WORK: '0' }, agentHome: scratch() });
	assert.equal(pi.handlers.size, 0, 'no handler may be registered while disabled');
});

test('the agent home follows pi, and a session id has to be path-safe', () => {
	assert.equal(agentHomeDirectory({}, '/home/person'), join('/home/person', '.pi', 'agent'));
	assert.equal(agentHomeDirectory({ PI_CODING_AGENT_DIR: '/tmp/agent' }, '/home/person'), '/tmp/agent');
	assert.equal(agentHomeDirectory({ PI_CODING_AGENT_DIR: '/tmp/agent', GENTLE_PI_AGENT_HOME: '/tmp/gentle' }, '/home/person'), '/tmp/gentle');
	assert.equal(isCarrierSessionId(SESSION_ID), true);
	assert.equal(isCarrierSessionId('../escape'), false);
	assert.equal(isCarrierSessionId(''), false);
	assert.equal(isCarrierSessionId(undefined), false);
});

test('one line of text, whatever the tool hands over', () => {
	assert.equal(inlineText('  edit\n\ttwo   spaces '), 'edit two spaces');
	assert.equal(inlineText('bell\u0007null\u0000end'), 'bell null end');
	assert.equal(inlineText('x'.repeat(200)).length, 72);
	assert.equal(inlineText(undefined), '');
	assert.equal(stepLabel('edit', { path: 'extensions/inline-work.ts' }), 'edit extensions/inline-work.ts');
	assert.equal(stepLabel('bash', { command: 'npm test\nrm -rf /' }), 'bash npm test rm -rf /');
	assert.equal(stepLabel('read', {}), 'read');
	assert.equal(stepLabel(undefined, undefined), 'tool');
});

test('a work unit starts with its first tool call and closes with a summary', () => {
	const agentHome = scratch();
	let clock = 5_000;
	const pi = fakePi();
	createInlineWork(pi.api, { agentHome, env: {}, now: () => clock, pid: 999_999, heartbeatMs: 0 });

	const ctx = context();
	pi.fire('session_start', { type: 'session_start', reason: 'startup' }, ctx);
	assert.equal(existsSync(carrierPath(agentHome, SESSION_ID)), false, 'an idle session has no card');

	pi.fire('tool_call', { type: 'tool_call', toolCallId: 'c1', toolName: 'edit', input: { path: 'extensions/inline-work.ts' } }, ctx);
	const running = readCarrier(agentHome);
	assert.equal(running.status, 'running');
	assert.equal(running.toolCalls, 1);
	assert.equal(running.label, 'edit extensions/inline-work.ts');
	assert.equal(running.startedAt, 5_000);
	assert.equal(running.endedAt, null);
	assert.equal(running.model, 'antigravity/claude-opus-5-5');
	assert.equal(running.cwd, '/home/person/projects/loon');
	assert.equal(running.pid, 999_999);

	// A nested call belongs to the step that made it.
	pi.fire('tool_call', { type: 'tool_call', toolCallId: 'c1/1', parentToolCallId: 'c1', toolName: 'read', input: { path: 'x' } }, ctx);
	assert.equal(readCarrier(agentHome).toolCalls, 1);

	pi.fire('message_end', { type: 'message_end', message: { role: 'assistant', usage: { totalTokens: 1200, cost: { total: 0.25 } } } }, ctx);
	assert.equal(readCarrier(agentHome).tokens, 1200);
	assert.equal(readCarrier(agentHome).cost, 0.25);

	clock = 9_000;
	pi.fire('turn_end', { type: 'turn_end', turnIndex: 0 }, ctx);
	pi.fire('agent_end', { type: 'agent_end', messages: [{ role: 'assistant', content: [{ type: 'text', text: '## Summary\nCarrier record written.' }] }] }, ctx);
	// A turn ending is not the work ending: the card stays running.
	const afterTurn = readCarrier(agentHome);
	assert.equal(afterTurn.status, 'running', 'a turn ending must not finish the job');
	assert.equal(afterTurn.endedAt, null);
	assert.equal(afterTurn.turns, 1);
	assert.equal(afterTurn.label, 'Summary', 'the closing line is the first line of the final answer');

	pi.fire('session_shutdown', { type: 'session_shutdown', reason: 'quit' }, ctx);
	assert.equal(existsSync(carrierPath(agentHome, SESSION_ID)), false, 'the carrier never outlives its session');
	const stored = JSON.parse(readFileSync(join(agentHome, 'gentle-agents', 'tasks', 'loon-inline-' + SESSION_ID + '-1.json'), 'utf8')) as {
		task: { status: string; closedBy?: string };
	};
	assert.equal(stored.task.status, 'completed', 'a job still open at shutdown is closed, not left running');
	assert.equal(stored.task.closedBy, 'session');
	rmSync(agentHome, { recursive: true, force: true });
});

test('the next turn continues the same job, and the card keeps its start', () => {
	const agentHome = scratch();
	let clock = 1_000;
	const pi = fakePi();
	createInlineWork(pi.api, { agentHome, env: {}, now: () => clock, pid: 424_242, heartbeatMs: 0 });
	const ctx = context();
	pi.fire('session_start', { type: 'session_start', reason: 'startup' }, ctx);
	pi.fire('tool_call', { type: 'tool_call', toolCallId: 'c1', toolName: 'read', input: { path: 'a.ts' } }, ctx);
	pi.fire('agent_end', { type: 'agent_end', messages: [] }, ctx);
	assert.equal(readCarrier(agentHome).status, 'running', 'the work is not over because the turn is');

	clock = 20_000;
	pi.fire('tool_call', { type: 'tool_call', toolCallId: 'c2', toolName: 'write', input: { path: 'b.ts' } }, ctx);
	const continued = readCarrier(agentHome);
	assert.equal(continued.status, 'running');
	assert.equal(continued.endedAt, null);
	assert.equal(continued.toolCalls, 2);
	assert.equal(continued.startedAt, 1_000, 'the job keeps its start across turns');
	rmSync(agentHome, { recursive: true, force: true });
});

test('nothing this extension does can throw into pi', () => {
	const brokenHome = join(scratch(), 'not-a-directory');
	writeFileSync(brokenHome, 'this is a file, so the carrier directory cannot exist');
	const pi = fakePi();
	assert.doesNotThrow(() => createInlineWork(pi.api, { agentHome: brokenHome, env: {}, heartbeatMs: 0 }));
	const ctx = context();
	assert.doesNotThrow(() => pi.fire('session_start', { type: 'session_start', reason: 'startup' }, ctx));
	assert.doesNotThrow(() => pi.fire('tool_call', { type: 'tool_call', toolCallId: 'c1', toolName: 'edit', input: { path: 'x' } }, ctx));
	assert.doesNotThrow(() => pi.fire('agent_end', { type: 'agent_end', messages: [] }, ctx));
	assert.doesNotThrow(() => pi.fire('session_shutdown', { type: 'session_shutdown', reason: 'quit' }, ctx));
	// A junk context must be survivable too: a newer pi is not a reason to die.
	const junk = fakePi();
	createInlineWork(junk.api, { agentHome: brokenHome, env: {}, heartbeatMs: 0 });
	assert.doesNotThrow(() => junk.fire('session_start', { type: 'session_start', reason: 'startup' }, undefined));
	assert.doesNotThrow(() => junk.fire('tool_call', { type: 'tool_call', toolCallId: 'c1' }, { sessionManager: {} }));
});

test('a record whose writer died is deleted, a live one is kept', () => {
	const agentHome = scratch();
	const base = {
		status: INLINE_STATUS.COMPLETED,
		createdAt: 1,
		startedAt: 1,
		endedAt: 2,
		label: 'done',
		lastStep: 'done',
		lastActivityAt: 2,
		model: '',
		turns: 1,
		toolCalls: 1,
		tokens: 0,
		cost: 0,
		cwd: '/tmp',
	};
	writeCarrier(agentHome, buildCarrierRecord({ ...base, sessionId: 'dead-session', pid: 999_999 }));
	writeCarrier(agentHome, buildCarrierRecord({ ...base, sessionId: 'live-session', pid: process.pid }));
	assert.equal(existsSync(carrierPath(agentHome, 'dead-session')), true);
	assert.equal(processAlive(999_999), false);
	pruneDeadCarriers(agentHome);
	assert.equal(existsSync(carrierPath(agentHome, 'dead-session')), false, 'a dead writer leaves nothing behind');
	assert.equal(existsSync(carrierPath(agentHome, 'live-session')), true, 'another live pi keeps its card');
	removeCarrier(agentHome, 'live-session');
	assert.equal(existsSync(carrierPath(agentHome, 'live-session')), false);
	rmSync(agentHome, { recursive: true, force: true });
});

test('the summary is the first real line of the last answer', () => {
	assert.equal(summaryLine([{ role: 'assistant', content: '\n\nDone: carrier written.\n' }]), 'Done: carrier written.');
	assert.equal(summaryLine([{ role: 'assistant', content: [{ type: 'text', text: '**Shipped** the card.' }] }]), 'Shipped the card.');
	assert.equal(summaryLine([{ role: 'user', content: 'hi' }]), undefined);
	assert.equal(summaryLine([]), undefined);
	assert.equal(summaryLine(undefined), undefined);
	assert.equal(summaryLine([{ role: 'assistant', content: [{ type: 'thinking', text: 'hmm' }] }]), undefined);
});

test('a carrier directory that does not exist yet is created on demand', () => {
	const agentHome = join(scratch(), 'nested', 'agent');
	writeCarrier(agentHome, buildCarrierRecord({
		sessionId: 'fresh',
		cwd: '/tmp',
		status: INLINE_STATUS.RUNNING,
		createdAt: 1,
		startedAt: 1,
		endedAt: null,
		label: 'edit',
		lastStep: 'edit',
		lastActivityAt: 1,
		model: '',
		turns: 0,
		toolCalls: 1,
		tokens: 0,
		cost: 0,
	}));
	assert.equal(existsSync(carrierPath(agentHome, 'fresh')), true);
	assert.equal(JSON.parse(readFileSync(carrierPath(agentHome, 'fresh'), 'utf8')).status, 'running');
	rmSync(join(agentHome, '..', '..'), { recursive: true, force: true });
});
