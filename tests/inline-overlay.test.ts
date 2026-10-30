import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installOverlayPanel, overlayTasks, overlayThread, unitKey } from '../extensions/lib/inline-overlay.ts';

const SESSION = 'sess-overlay-1';

interface Unit {
	id?: string;
	status: 'running' | 'completed';
	createdAt?: number;
	endedAt?: number | null;
	label?: string;
	toolCalls?: number;
	result?: string | null;
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
		lastActivityAt: Date.now(),
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
		JSON.stringify({ id: 'loon-inline-' + session + '-1', thread: { version: 1, dropped: 0, items, limits: { maxItems: 200, maxOutputChars: 1000 } } }),
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
		lastActivityAt: Date.now(),
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
		assert.equal(tasks[0]?.id, 'loon-inline-' + SESSION + '-1');
		assert.equal(overlayThread(root, tasks[0]?.id ?? '')?.items.length, 1);
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
		liveThread(root, SESSION, [toolItem('c1', 'read')]);
		history(root, SESSION, { status: 'completed', label: 'cerrado', result: 'listo' }, [toolItem('c1', 'read'), { kind: 'text', text: 'listo' }]);
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
		const id = 'loon-inline-' + SESSION + '-1';
		assert.equal(overlayTasks(root, SESSION, [id]).length, 0, 'the store serves that id; the provider must not double it');
		assert.equal(overlayTasks(root, SESSION, []).length, 1);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('a second unit is a second card and the first stays where it was', () => {
	const root = home();
	try {
		history(root, SESSION, { status: 'completed', label: 'primera' }, [toolItem('c1', 'read')]);
		carrier(root, SESSION, { id: 'loon-inline-' + SESSION + '-2', status: 'running', label: 'segunda', createdAt: 3000 });
		const tasks = overlayTasks(root, SESSION, []);
		assert.equal(tasks.length, 2);
		assert.deepEqual(tasks.map((task) => task.id).sort(), ['loon-inline-' + SESSION + '-1', 'loon-inline-' + SESSION + '-2']);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('a carrier from before units existed is dropped once history exists', () => {
	const root = home();
	try {
		carrier(root, SESSION, { id: 'loon-inline-' + SESSION, status: 'running' });
		history(root, SESSION, { status: 'completed' }, [toolItem('c1', 'read')]);
		const tasks = overlayTasks(root, SESSION, []);
		assert.equal(tasks.length, 1, 'the numberless record is the same unit as the first one');
		assert.equal(tasks[0]?.id, 'loon-inline-' + SESSION + '-1');
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

test('the unit key is the unit, not the source it came from', () => {
	assert.equal(unitKey('loon-inline-abc-1', 'abc'), unitKey('loon-inline-abc-1', 'abc'));
	assert.notEqual(unitKey('loon-inline-abc-1', 'abc'), unitKey('loon-inline-abc-2', 'abc'));
	assert.equal(unitKey('loon-inline-abc', 'abc'), 'loon-inline-abc#legacy');
	// A session id that itself ends in digits is a session, not a unit: this is
	// the shape that made a legacy carrier look like unit 1 of another session.
	assert.equal(unitKey('loon-inline-sess-1', 'sess-1'), 'loon-inline-sess-1#legacy');
	assert.equal(unitKey('loon-inline-sess-1-1', 'sess-1'), 'loon-inline-sess-1#1');
});
