import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installOverlayPanel, jobKey, overlayTasks, overlayThread } from '../extensions/lib/inline-overlay.ts';

const SESSION = 'sess-overlay-1';
/** The card id of that session's job. */
const JOB_ID = 'loon-inline-' + SESSION;

interface Unit {
	id?: string;
	status: 'running' | 'completed';
	createdAt?: number;
	endedAt?: number | null;
	label?: string;
	toolCalls?: number;
	result?: string | null;
	lastActivityAt?: number;
}

function home(): string {
	const root = mkdtempSync(join(tmpdir(), 'loon-overlay-'));
	mkdirSync(join(root, 'state', 'loon-inline'), { recursive: true });
	mkdirSync(join(root, 'gentle-agents', 'tasks'), { recursive: true });
	mkdirSync(join(root, 'gentle-agents', 'presence'), { recursive: true });
	return root;
}

function carrier(root: string, session: string, unit: Unit): void {
	const id = unit.id ?? 'loon-inline-' + session + '-1';
	const record = {
		id,
		agent: 'gentle-ai-worker',
		mode: 'inline',
		prompt: '',
		label: unit.label ?? 'working',
		cwd: '/repo',
		parentSessionId: session,
		status: unit.status,
		createdAt: unit.createdAt ?? 1000,
		startedAt: unit.createdAt ?? 1000,
		endedAt: unit.endedAt ?? null,
		model: 'test-model',
		thinking: 'high',
		sessionPath: null,
		error: null,
		result: unit.result ?? null,
		lastStep: 'read',
		lastActivityAt: unit.lastActivityAt ?? Date.now(),
		turns: 1,
		toolCalls: unit.toolCalls ?? 1,
		tokens: 10,
		cost: 0,
		pid: process.pid,
	};
	writeFileSync(join(root, 'state', 'loon-inline', session + '.json'), JSON.stringify(record));
}

function liveThread(root: string, session: string, items: unknown[]): void {
	writeFileSync(
		join(root, 'state', 'loon-inline', session + '.thread.json'),
		// The writer names the live thread after the job, so a card that is the job
		// finds its transcript.
		JSON.stringify({ id: 'loon-inline-' + session, thread: { version: 1, dropped: 0, items, limits: { maxItems: 200, maxOutputChars: 1000 } } }),
	);
}

function history(root: string, session: string, unit: Unit, items: unknown[]): void {
	const id = unit.id ?? 'loon-inline-' + session + '-1';
	const task = {
		id,
		agent: 'gentle-ai-worker',
		mode: 'inline',
		prompt: '',
		label: unit.label ?? 'done',
		cwd: '/repo',
		parentSessionId: session,
		status: unit.status,
		createdAt: unit.createdAt ?? 1000,
		startedAt: unit.createdAt ?? 1000,
		endedAt: unit.endedAt ?? 2000,
		model: 'test-model',
		thinking: 'high',
		sessionPath: null,
		error: null,
		result: unit.result ?? 'done',
		lastStep: 'bash',
		lastActivityAt: unit.lastActivityAt ?? Date.now(),
		turns: 1,
		toolCalls: unit.toolCalls ?? 1,
		tokens: 10,
		cost: 0,
	};
	writeFileSync(join(root, 'gentle-agents', 'tasks', id + '.json'), JSON.stringify({ task, thread: { version: 1, dropped: 0, items, limits: { maxItems: 200, maxOutputChars: 1000 } } }));
}

function toolItem(callId: string, name: string): Record<string, unknown> {
	return { kind: 'tool', callId, name, args: { path: 'README.md' }, output: 'ok 1 lines', running: false, isError: false };
}

test('a running unit is one card, taken from the live record and its live thread', () => {
	const root = home();
	try {
		carrier(root, SESSION, { status: 'running', label: 'leyendo el repo' });
		liveThread(root, SESSION, [toolItem('c1', 'read')]);
		const tasks = overlayTasks(root, SESSION, []);
		assert.equal(tasks.length, 1);
		assert.equal(tasks[0]?.status, 'running');
		assert.equal(tasks[0]?.id, JOB_ID, 'the card is the job, not the unit');
		assert.equal(overlayThread(root, JOB_ID)?.items.length, 1);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('when the unit closes, the history record is the one card, not a second one', () => {
	const root = home();
	try {
		// Both sources exist at once, which is exactly the window between the
		// history write and the shutdown that removes the carrier.
		carrier(root, SESSION, { status: 'completed', label: 'working', result: null });
		// The writer keeps both in step: the sidecar is rewritten at the close too.
		const closed = [toolItem('c1', 'read'), { kind: 'text', text: 'listo' }];
		liveThread(root, SESSION, closed);
		history(root, SESSION, { status: 'completed', label: 'cerrado', result: 'listo' }, closed);
		const tasks = overlayTasks(root, SESSION, []);
		assert.equal(tasks.length, 1, 'one unit is one card');
		assert.equal(tasks[0]?.status, 'completed');
		assert.equal(tasks[0]?.label, 'cerrado', 'the history record wins: it is the finished unit');
		const thread = overlayThread(root, tasks[0]?.id ?? '');
		assert.equal(thread?.items.length, 2);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('a unit the store already restored is not drawn again', () => {
	const root = home();
	try {
		history(root, SESSION, { status: 'completed' }, [toolItem('c1', 'read')]);
		carrier(root, SESSION, { status: 'completed' });
		assert.equal(overlayTasks(root, SESSION, [JOB_ID]).length, 0, 'the store serves this job; the provider must not double it');
		assert.equal(overlayTasks(root, SESSION, [JOB_ID + '-1']).length, 0, 'an id the previous design wrote is the same job');
		assert.equal(overlayTasks(root, SESSION, []).length, 1);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('a finished unit beside a running one is one card, and it says running', () => {
	const root = home();
	try {
		// The first stretch of work closed and was written; the second is running.
		history(root, SESSION, { status: 'completed', label: 'primera', endedAt: 2000, lastActivityAt: Date.now() - 5000 }, [toolItem('c1', 'read')]);
		carrier(root, SESSION, { status: 'running', label: 'segunda', createdAt: 3000 });
		const tasks = overlayTasks(root, SESSION, []);
		assert.equal(tasks.length, 1, 'one job, one card');
		assert.equal(tasks[0]?.status, 'running', 'a closing unit must not leave the job looking finished');
		assert.equal(tasks[0]?.label, 'segunda', 'and the card shows what is happening now');
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('records the previous design wrote one per unit collapse into the one card', () => {
	const root = home();
	try {
		history(root, SESSION, { id: 'loon-inline-' + SESSION + '-1', status: 'completed', createdAt: 1000, endedAt: 2000 }, [toolItem('c1', 'read')]);
		history(root, SESSION, { id: 'loon-inline-' + SESSION + '-2', status: 'completed', createdAt: 3000, endedAt: 4000 }, [toolItem('c2', 'edit')]);
		const tasks = overlayTasks(root, SESSION, []);
		assert.equal(tasks.length, 1, 'an old session must not come back as one card per request');
		assert.equal(tasks[0]?.id, JOB_ID);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('a malformed record is absent, never an error card', () => {
	const root = home();
	try {
		writeFileSync(join(root, 'state', 'loon-inline', SESSION + '.json'), '{ this is not json');
		writeFileSync(join(root, 'state', 'loon-inline', SESSION + '.thread.json'), 'nope');
		writeFileSync(join(root, 'gentle-agents', 'tasks', 'loon-inline-' + SESSION + '-1.json'), '[]');
		assert.deepEqual(overlayTasks(root, SESSION, []), []);
		assert.equal(overlayThread(root, 'loon-inline-' + SESSION + '-1'), undefined);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('another session, or no records at all, draws nothing', () => {
	const root = home();
	try {
		carrier(root, 'other-session', { status: 'running' });
		assert.deepEqual(overlayTasks(root, SESSION, []), []);
		assert.deepEqual(overlayTasks(root, 'empty-session', []), []);
		assert.equal(overlayThread(root, 'loon-inline-' + SESSION + '-1'), undefined);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('the provider is one global the panel finds, and it comes off again', () => {
	const root = home();
	try {
		history(root, SESSION, { status: 'completed' }, [toolItem('c1', 'read')]);
		installOverlayPanel({ agentHome: root });
		const panel = (globalThis as unknown as { __loonInlinePanel?: { tasks(s: string, known: string[]): unknown[] } }).__loonInlinePanel;
		assert.equal(panel?.tasks(SESSION, []).length, 1);
		installOverlayPanel(undefined);
		assert.equal((globalThis as unknown as { __loonInlinePanel?: unknown }).__loonInlinePanel, undefined);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('the job key is the session, whatever id a source happens to use', () => {
	assert.equal(jobKey('loon-inline-abc', 'abc'), 'loon-inline-abc');
	assert.equal(jobKey('loon-inline-abc-1', 'abc'), 'loon-inline-abc', 'a numbered id is still the same job');
	assert.equal(jobKey('loon-inline-abc-7', 'abc'), 'loon-inline-abc');
	// A session id that itself ends in digits is a session, not a unit.
	assert.equal(jobKey('loon-inline-sess-1', 'sess-1'), 'loon-inline-sess-1');
	assert.equal(jobKey('loon-inline-sess-1-1', 'sess-1'), 'loon-inline-sess-1');
	// Somebody else's id is left alone.
	assert.equal(jobKey('child-task-1', 'abc'), 'child-task-1');
});
