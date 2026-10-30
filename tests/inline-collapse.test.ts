/**
 * The collapsed renderer: what a person actually sees in the main transcript
 * while the parent itself programs inline.
 *
 * These assert rows, not wiring. A collapsed unit must leave no rows behind
 * while it runs, its closing summary must still arrive, a real subagent task and
 * a question waiting for the owner must render exactly as before, a failure must
 * never be swallowed, and the kill switch must bring the old rendering back in
 * full.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
	ExtensionAPI,
	ExtensionContext,
	ToolRendererResolver,
	ToolRenderers,
} from '@earendil-works/pi-coding-agent';
import { createInlineWork } from '../extensions/inline-work.ts';
import { COLLAPSED_TOOL_NAMES } from '../extensions/lib/inline-collapse.ts';
import { carrierPath, type InlineCarrierRecord } from '../extensions/lib/inline-carrier.ts';
import { liveThreadPath } from '../extensions/lib/inline-overlay.ts';
import { THINKING_SUFFIX } from '../extensions/lib/inline-transcript.ts';

const SESSION_ID = 'sess-abc123';
/** The subagent tools: the collapse must never touch them. */
const SUBAGENT_TOOLS = ['subagent_run', 'subagent_status', 'subagent_result'];
/** Tools whose answer only the owner can give. */
const QUESTION_TOOLS = ['ask_user_choice', 'ask_user_question'];
/** Tools that also draw in the main transcript and are none of this slice's business. */
const OTHER_TOOLS = ['todo', 'gentle_review', 'gentle_design'];

const theme = {
	bold: (value: string): string => value,
	fg: (_color: string, value: string): string => value,
};

/** A row as a person would see it, from whatever would have drawn it without us. */
function rowsOf(label: string): string[] {
	return [label + ' drew its usual rows'];
}

/** A stand-in for whatever would have drawn the row without our resolver. */
function nativeRenderers(label: string): ToolRenderers {
	const component = { render: (): string[] => rowsOf(label), invalidate: (): void => {} };
	return {
		renderShell: 'default',
		renderCall: () => component,
		renderResult: () => component,
	};
}

/** A tool render context, as pi builds it for one call. */
function renderContext(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		args: {},
		toolCallId: 'call-1',
		invalidate: () => {},
		lastComponent: undefined,
		state: {},
		cwd: '/repo',
		executionStarted: true,
		argsComplete: true,
		isPartial: false,
		expanded: false,
		showImages: true,
		isError: false,
		durationMs: 5,
		outputPad: 1,
		...overrides,
	};
}

interface FakePi {
	api: ExtensionAPI;
	handlers: Map<string, ((event: unknown, ctx: unknown) => void)[]>;
	resolvers: ToolRendererResolver[];
	messageRenderers: string[];
	transformers: ((markdown: string, context: unknown) => string)[];
	/** What pi renders for an assistant message: every transformer in load order. */
	transform: (markdown: string, context?: Record<string, unknown>) => string;
	fire: (event: string, payload?: Record<string, unknown>, ctx?: unknown) => void;
	/** What pi draws for a call: every resolver in load order, then the tool itself. */
	resolve: (toolName: string) => ToolRenderers | undefined;
}

function fakePi(): FakePi {
	const handlers = new Map<string, ((event: unknown, ctx: unknown) => void)[]>();
	const resolvers: ToolRendererResolver[] = [];
	const messageRenderers: string[] = [];
	/** The prose transformers the extension registered, in load order. */
	const transformers: ((markdown: string, context: unknown) => string)[] = [];
	const on = (event: string, handler: (event: unknown, ctx: unknown) => void): (() => void) => {
		const list = handlers.get(event) ?? [];
		list.push(handler);
		handlers.set(event, list);
		return () => {};
	};
	const api = {
		on,
		registerToolRenderer: (resolver: ToolRendererResolver): void => {
			resolvers.push(resolver);
		},
		registerMessageRenderer: (customType: string): void => {
			messageRenderers.push(customType);
		},
		registerMarkdownTransformer: (transformer: unknown): void => {
			transformers.push(transformer as (markdown: string, context: unknown) => string);
		},
	} as unknown as ExtensionAPI;
	return {
		api,
		handlers,
		resolvers,
		messageRenderers,
		transformers,
		fire(event, payload = { type: event }, ctx) {
			for (const handler of handlers.get(event) ?? []) handler(payload, ctx);
		},
		transform(markdown, context = {}) {
			let text = markdown;
			for (const transformer of transformers) {
				text = transformer(text, { messageType: 'assistant', isStreaming: false, availableWidth: 100, ...context });
			}
			return text;
		},
		resolve(toolName) {
			const base = (): ToolRenderers => nativeRenderers(toolName);
			const step = (index: number): ToolRenderers | undefined => {
				if (index >= resolvers.length) return base();
				const resolver = resolvers[index] as (
					name: string,
					next: () => ToolRenderers | undefined,
				) => ToolRenderers | undefined;
				return resolver(toolName, () => step(index + 1));
			};
			return step(0);
		},
	};
}

function scratch(): string {
	return mkdtempSync(join(tmpdir(), 'loon-collapse-'));
}

function sessionContext(): ExtensionContext {
	return {
		sessionManager: { getSessionId: () => SESSION_ID },
		cwd: '/repo',
		model: { provider: 'anthropic', id: 'claude-opus-4' },
		thinkingLevel: 'high',
	} as unknown as ExtensionContext;
}

/** An extension with a carrier already open, which is the state a unit runs in. */
/** A session that started and has not yet done anything: no card exists. */
function idleSession(agentHome: string, env: Record<string, string> = {}): FakePi {
	const pi = fakePi();
	createInlineWork(pi.api, { env, agentHome, heartbeatMs: 0 });
	pi.fire('session_start', { type: 'session_start' }, sessionContext());
	return pi;
}

function runningUnit(agentHome: string, env: Record<string, string> = {}): FakePi {
	const pi = fakePi();
	createInlineWork(pi.api, { env, agentHome, heartbeatMs: 0 });
	pi.fire('session_start', { type: 'session_start' }, sessionContext());
	pi.fire('tool_call', { type: 'tool_call', toolName: 'read', input: { path: 'README.md' } }, sessionContext());
	return pi;
}

function readCarrier(agentHome: string): InlineCarrierRecord {
	return JSON.parse(readFileSync(carrierPath(agentHome, SESSION_ID), 'utf8')) as InlineCarrierRecord;
}

test('while a unit runs, its tool calls leave no rows behind', () => {
	const agentHome = scratch();
	try {
		const pi = runningUnit(agentHome);
		for (const toolName of COLLAPSED_TOOL_NAMES) {
			const renderers = pi.resolve(toolName);
			assert.ok(renderers, toolName + ' must still resolve to renderers');
			assert.equal(renderers.renderShell, 'self', toolName + ' must draw its own framing, or pi keeps the frame');
			const call = renderers.renderCall?.({}, theme as never, renderContext() as never);
			assert.ok(call, toolName + ' must return a component');
			assert.deepEqual(call.render(80), [], toolName + ' must not occupy a row in the transcript');
			const result = renderers.renderResult?.(
				{ content: [{ type: 'text', text: 'some output' }], details: undefined, isError: false },
				{ expanded: false, isPartial: false },
				theme as never,
				renderContext() as never,
			);
			assert.ok(result);
			assert.deepEqual(result.render(80), [], toolName + ' output must not occupy a row either');
		}
	} finally {
		rmSync(agentHome, { recursive: true, force: true });
	}
});

test('the closing summary still arrives, and nothing else about messages changes', () => {
	const agentHome = scratch();
	try {
		const pi = runningUnit(agentHome);
		pi.fire(
			'agent_end',
			{
				type: 'agent_end',
				messages: [{ role: 'assistant', content: [{ type: 'text', text: 'Cerrei el slice con los tests.' }] }],
			},
			sessionContext(),
		);
		assert.equal(readCarrier(agentHome).label, 'Cerrei el slice con los tests.');
		// The summary is pi's own assistant text. Collapsing tool rows must not
		// reach for the message renderer to draw it a second time.
		assert.deepEqual(pi.messageRenderers, [], 'the collapse must not register a message renderer');
	} finally {
		rmSync(agentHome, { recursive: true, force: true });
	}
});

test('a real subagent task renders exactly as it does today', () => {
	const agentHome = scratch();
	try {
		const pi = runningUnit(agentHome);
		for (const toolName of SUBAGENT_TOOLS) {
			const renderers = pi.resolve(toolName);
			assert.ok(renderers);
			assert.equal(renderers.renderShell, 'default', toolName + ' keeps the frame it has today');
			const call = renderers.renderCall?.({}, theme as never, renderContext() as never);
			assert.deepEqual(call?.render(80), rowsOf(toolName));
		}
	} finally {
		rmSync(agentHome, { recursive: true, force: true });
	}
});

test('a failure is never collapsed away', () => {
	const agentHome = scratch();
	try {
		const pi = runningUnit(agentHome);
		const renderers = pi.resolve('bash');
		assert.ok(renderers);
		const failure = {
			content: [{ type: 'text' as const, text: 'exit code 1: tmux: command not found' }],
			details: undefined,
			isError: true,
		};
		const call = renderers.renderCall?.(
			{ command: 'tmux ls' },
			theme as never,
			renderContext({ isError: true }) as never,
		);
		assert.deepEqual(call?.render(80), rowsOf('bash'), 'the failed call keeps its own row');
		const result = renderers.renderResult?.(
			failure,
			{ expanded: false, isPartial: false },
			theme as never,
			renderContext({ isError: true }) as never,
		);
		const rows = result?.render(80) ?? [];
		assert.ok(rows.length > 0, 'a failed result must still draw rows');
		assert.deepEqual(
			rows,
			rowsOf('bash'),
			'a failure keeps the rendering it has today, not a summary of it',
		);
	} finally {
		rmSync(agentHome, { recursive: true, force: true });
	}
});

test('a codemode call collapses like the file and shell tools', () => {
	const agentHome = scratch();
	try {
		const pi = runningUnit(agentHome);
		const renderers = pi.resolve('codemode');
		assert.ok(renderers, 'codemode must still resolve to renderers');
		assert.equal(renderers.renderShell, 'self', 'codemode must draw its own framing, or pi keeps the frame');
		const call = renderers.renderCall?.({ code: 'await tools.read({ path: "a" })' }, theme as never, renderContext() as never);
		assert.deepEqual(call?.render(80), [], 'a codemode call must not occupy a row');
		const result = renderers.renderResult?.(
			{ content: [{ type: 'text', text: 'file contents' }], details: undefined, isError: false },
			{ expanded: false, isPartial: false },
			theme as never,
			renderContext() as never,
		);
		assert.deepEqual(result?.render(80), [], 'a codemode result must not occupy a row either');
	} finally {
		rmSync(agentHome, { recursive: true, force: true });
	}
});

test('a failed codemode call still draws its row', () => {
	const agentHome = scratch();
	try {
		const pi = runningUnit(agentHome);
		const renderers = pi.resolve('codemode');
		assert.ok(renderers);
		// pi builds the render context with the result's own error flag
		// (tool-execution.js: isError: this.result?.isError ?? false), so this is
		// the shape a failed codemode call really produces.
		const failure = {
			content: [{ type: 'text' as const, text: 'SyntaxError: unexpected token' }],
			details: undefined,
			isError: true,
		};
		const call = renderers.renderCall?.({ code: 'await' }, theme as never, renderContext({ isError: true }) as never);
		assert.deepEqual(call?.render(80), rowsOf('codemode'), 'the failed call keeps its own row');
		const result = renderers.renderResult?.(
			failure,
			{ expanded: false, isPartial: false },
			theme as never,
			renderContext({ isError: true }) as never,
		);
		assert.deepEqual(result?.render(80), rowsOf('codemode'), 'the failure keeps the rendering it has today');
	} finally {
		rmSync(agentHome, { recursive: true, force: true });
	}
});

test('a codemode row the reader expands comes back in full', () => {
	const agentHome = scratch();
	try {
		const pi = runningUnit(agentHome);
		const renderers = pi.resolve('codemode');
		assert.ok(renderers);
		const call = renderers.renderCall?.({ code: 'await' }, theme as never, renderContext({ expanded: true }) as never);
		assert.deepEqual(call?.render(80), rowsOf('codemode'), 'an expanded codemode row must never stay blank');
		const result = renderers.renderResult?.(
			{ content: [{ type: 'text', text: 'ok' }], details: undefined, isError: false },
			{ expanded: true, isPartial: false },
			theme as never,
			renderContext({ expanded: true }) as never,
		);
		assert.deepEqual(result?.render(80), rowsOf('codemode'));
	} finally {
		rmSync(agentHome, { recursive: true, force: true });
	}
});

test('the very first call of a unit collapses, before any carrier exists', () => {
	const agentHome = scratch();
	try {
		const pi = fakePi();
		createInlineWork(pi.api, { env: {}, agentHome, heartbeatMs: 0 });
		pi.fire('session_start', { type: 'session_start' }, sessionContext());
		// pi builds a call's component while the assistant message streams, which is
		// strictly before the tool runs and therefore before the carrier exists. A
		// gate that waits for the carrier lets that first row through, and with
		// codemode a whole unit can be a single call.
		assert.equal(existsSync(carrierPath(agentHome, SESSION_ID)), false, 'the carrier does not exist yet');
		for (const toolName of ['read', 'codemode']) {
			const renderers = pi.resolve(toolName);
			assert.equal(renderers?.renderShell, 'self', toolName + ' must collapse from the session, not from its own first call');
			assert.deepEqual(renderers?.renderCall?.({}, theme as never, renderContext() as never)?.render(80), [], toolName + ' must not occupy a row');
		}
	} finally {
		rmSync(agentHome, { recursive: true, force: true });
	}
});

test('a question waiting for the owner is never collapsed', () => {
	const agentHome = scratch();
	try {
		const pi = runningUnit(agentHome);
		for (const toolName of QUESTION_TOOLS) {
			const renderers = pi.resolve(toolName);
			assert.equal(renderers?.renderShell, 'default', toolName + ' must keep its own rendering');
			const call = renderers?.renderCall?.({}, theme as never, renderContext() as never);
			assert.deepEqual(call?.render(80), rowsOf(toolName));
		}
	} finally {
		rmSync(agentHome, { recursive: true, force: true });
	}
});

test('every other tool keeps its rows', () => {
	const agentHome = scratch();
	try {
		const pi = runningUnit(agentHome);
		for (const toolName of OTHER_TOOLS) {
			const renderers = pi.resolve(toolName);
			const call = renderers?.renderCall?.({}, theme as never, renderContext() as never);
			assert.deepEqual(call?.render(80), rowsOf(toolName), toolName + ' is not part of the collapse');
		}
		assert.equal(
			COLLAPSED_TOOL_NAMES.size,
			8,
			'the file and shell tools plus codemode, which is every call of an agent that works through it',
		);
	} finally {
		rmSync(agentHome, { recursive: true, force: true });
	}
});

test('a call mid-unit collapses too', () => {
	const agentHome = scratch();
	try {
		const pi = runningUnit(agentHome);
		for (const toolName of ['read', 'codemode']) {
			assert.equal(pi.resolve(toolName)?.renderShell, 'self', toolName + ' keeps collapsing');
			const call = pi.resolve(toolName)?.renderCall?.({ code: 'await 1' }, theme as never, renderContext() as never);
			assert.deepEqual(call?.render(80), []);
		}
	} finally {
		rmSync(agentHome, { recursive: true, force: true });
	}
});

test('a call right after a unit closed still collapses', () => {
	const agentHome = scratch();
	try {
		const pi = runningUnit(agentHome);
		pi.fire(
			'agent_end',
			{ type: 'agent_end', messages: [{ role: 'assistant', content: [{ type: 'text', text: 'Cerrado.' }] }] },
			sessionContext(),
		);
		// The next request in the session is the same job: its rows belong in the
		// panel, not in the transcript.
		for (const toolName of ['read', 'codemode']) {
			assert.equal(pi.resolve(toolName)?.renderShell, 'self');
			assert.deepEqual(pi.resolve(toolName)?.renderCall?.({}, theme as never, renderContext() as never)?.render(80), []);
		}
	} finally {
		rmSync(agentHome, { recursive: true, force: true });
	}
});

test('the prose of a live turn collapses to one line, and the answer does not', () => {
	const agentHome = scratch();
	try {
		const pi = runningUnit(agentHome);
		const prose = 'Voy a leer el repositorio y después escribir el slice.\n\nCon dos párrafos.';
		const collapsed = pi.transform(prose);
		assert.notEqual(collapsed, prose, 'the prose must not reach the transcript whole');
		assert.equal(collapsed.split('\n').length, 1);
		assert.match(collapsed, /gentle:agents/);

		// The closing message is the answer: the extension exempts it at agent_end.
		const answer = 'Hecho: el slice quedó con sus pruebas.';
		pi.fire('agent_end', { type: 'agent_end', messages: [{ role: 'assistant', content: [{ type: 'text', text: answer }] }] }, sessionContext());
		assert.equal(pi.transform(answer), answer, 'the final answer stays legible in full');
		// And a repaint after the turn keeps the earlier prose collapsed.
		assert.equal(pi.transform(prose), collapsed, 'a collapsed message must not expand afterwards');
	} finally {
		rmSync(agentHome, { recursive: true, force: true });
	}
});

test('a user message is never transformed', () => {
	const agentHome = scratch();
	try {
		const pi = runningUnit(agentHome);
		const prose = 'Una pregunta del dueño, en dos líneas.\n\nCon contexto.';
		assert.equal(pi.transform(prose, { messageType: 'user' }), prose);
	} finally {
		rmSync(agentHome, { recursive: true, force: true });
	}
});

test('a thinking block collapses to one line and its text reaches the panel', () => {
	const agentHome = scratch();
	try {
		const pi = runningUnit(agentHome);
		const reasoning = 'El dueño quiere el razonamiento fuera del transcript.\n\nPero sin perderlo: el panel lo muestra.';
		const collapsed = pi.transform(reasoning, { messageType: 'assistant-thinking' });
		assert.equal(collapsed.split('\n').length, 1, 'the reasoning leaves the transcript: ' + collapsed);
		assert.ok(collapsed.includes(THINKING_SUFFIX), collapsed);

		// Collapsing is not losing: the panel gets the whole text, as its own kind.
		const live = JSON.parse(readFileSync(liveThreadPath(agentHome, SESSION_ID), 'utf8')) as {
			thread: { items: Array<{ kind: string; text?: string }> };
		};
		const thinkingItems = live.thread.items.filter((item) => item.kind === 'thinking');
		assert.equal(thinkingItems.length, 1, 'the reasoning is in the thread: ' + JSON.stringify(live.thread.items));
		assert.equal(thinkingItems[0]?.text, reasoning);

		// A repaint of the same block must not append it again.
		pi.transform(reasoning, { messageType: 'assistant-thinking' });
		const again = JSON.parse(readFileSync(liveThreadPath(agentHome, SESSION_ID), 'utf8')) as {
			thread: { items: Array<{ kind: string; text?: string }> };
		};
		assert.equal(again.thread.items.filter((item) => item.kind === 'thinking').length, 1, 'one block, one item');
	} finally {
		rmSync(agentHome, { recursive: true, force: true });
	}
});

test('the first prose and the first reasoning of a turn collapse before any tool call opened the card', () => {
	const agentHome = scratch();
	try {
		const pi = idleSession(agentHome);
		const prose = 'Primera prosa del turno, antes de cualquier herramienta.\n\nCon dos líneas.';
		assert.equal(pi.transform(prose).split('\n').length, 1, 'the carrier does not exist yet, and the session does');
		const reasoning = 'Primer bloque de razonamiento del turno, antes de la herramienta.';
		const collapsed = pi.transform(reasoning, { messageType: 'assistant-thinking' });
		assert.equal(collapsed.split('\n').length, 1);
		assert.ok(collapsed.includes(THINKING_SUFFIX), collapsed);
	} finally {
		rmSync(agentHome, { recursive: true, force: true });
	}
});

test('the reasoning captured before the card exists is in the thread once the work starts', () => {
	const agentHome = scratch();
	try {
		const pi = idleSession(agentHome);
		const first = 'Razonamiento previo a la primera herramienta.';
		pi.transform(first, { messageType: 'assistant-thinking', isStreaming: true });
		pi.transform(first, { messageType: 'assistant-thinking', isStreaming: false });
		// The work starts now: the card is created, and its thread already has the block.
		pi.fire('tool_call', { type: 'tool_call', toolName: 'read', input: { path: 'README.md' } }, sessionContext());
		pi.transform('Un segundo bloque, ya con la tarjeta abierta.', { messageType: 'assistant-thinking' });
		const live = JSON.parse(readFileSync(liveThreadPath(agentHome, SESSION_ID), 'utf8')) as {
			thread: { items: Array<{ kind: string; text?: string }> };
		};
		const thinking = live.thread.items.filter((item) => item.kind === 'thinking');
		assert.deepEqual(
			thinking.map((item) => item.text),
			[first, 'Un segundo bloque, ya con la tarjeta abierta.'],
			'the block that happened before the card was not lost: ' + JSON.stringify(live.thread.items),
		);
	} finally {
		rmSync(agentHome, { recursive: true, force: true });
	}
});

test('every turn end keeps its own answer legible, and a work message still collapses', () => {
	const agentHome = scratch();
	try {
		const pi = runningUnit(agentHome);
		const answer = 'Primera respuesta del turno, con dos líneas.\n\nY la segunda.';
		// The real order: the answer is drawn while it streams, and only then does the
		// message end. The frame drawn during the turn is collapsed, which is why the
		// exemption has to be in place before pi rebuilds the finished message.
		assert.equal(pi.transform(answer, { isStreaming: true }).split('\n').length, 1, 'collapsed while streaming');
		pi.fire(
			'message_end',
			{ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: answer }] } },
			sessionContext(),
		);
		assert.equal(pi.transform(answer), answer, 'the answer of the turn reads in full as soon as its message ends');
		// The job stays open across turns: another turn must not recolour the first answer.
		pi.fire('tool_call', { type: 'tool_call', toolName: 'read', input: { path: 'README.md' } }, sessionContext());
		assert.equal(pi.transform(answer), answer, 'and the next turn does not take it back');
		// A message that ends with a tool call is work, not an answer.
		const work = 'Voy a leer el registro y después el README.';
		pi.fire(
			'message_end',
			{
				type: 'message_end',
				message: {
					role: 'assistant',
					content: [{ type: 'text', text: work }, { type: 'toolCall', name: 'read', input: { path: 'README.md' } }],
				},
			},
			sessionContext(),
		);
		assert.equal(pi.transform(work).split('\n').length, 1, 'work prose still leaves the transcript');
	} finally {
		rmSync(agentHome, { recursive: true, force: true });
	}
});

test('LOON_INLINE_TRANSCRIPT=full leaves the prose alone, and the kill switch registers nothing', () => {
	const agentHome = scratch();
	try {
		const full = fakePi();
		createInlineWork(full.api, { env: { LOON_INLINE_TRANSCRIPT: 'full' }, agentHome, heartbeatMs: 0 });
		full.fire('session_start', { type: 'session_start' }, sessionContext());
		full.fire('tool_call', { type: 'tool_call', toolName: 'read', input: { path: 'README.md' } }, sessionContext());
		const prose = 'Prosa completa, dos líneas.\n\nY otra.';
		assert.equal(full.transform(prose), prose);

		const off = fakePi();
		createInlineWork(off.api, { env: { LOON_INLINE_WORK: '0' }, agentHome, heartbeatMs: 0 });
		off.fire('session_start', { type: 'session_start' }, sessionContext());
		assert.deepEqual(off.transformers, [], 'the disabled extension registers no transformer at all');
	} finally {
		rmSync(agentHome, { recursive: true, force: true });
	}
});

test('a session that never started keeps its rows', () => {
	const agentHome = scratch();
	try {
		const pi = fakePi();
		createInlineWork(pi.api, { env: {}, agentHome, heartbeatMs: 0 });
		// No session, so nothing says this is an inline session at all.
		const renderers = pi.resolve('read');
		assert.equal(renderers?.renderShell, 'default');
		assert.deepEqual(renderers?.renderCall?.({}, theme as never, renderContext() as never)?.render(80), rowsOf('read'));
	} finally {
		rmSync(agentHome, { recursive: true, force: true });
	}
});

test('LOON_INLINE_WORK=0 returns the previous behaviour in full', () => {
	const agentHome = scratch();
	try {
		const pi = fakePi();
		createInlineWork(pi.api, { env: { LOON_INLINE_WORK: '0' }, agentHome, heartbeatMs: 0 });
		pi.fire('session_start', { type: 'session_start' }, sessionContext());
		pi.fire('tool_call', { type: 'tool_call', toolName: 'read', input: { path: 'README.md' } }, sessionContext());
		assert.deepEqual(pi.resolvers, [], 'the disabled extension registers no renderer at all');
		const call = pi.resolve('read')?.renderCall?.({}, theme as never, renderContext() as never);
		assert.deepEqual(call?.render(80), rowsOf('read'));
		const codemode = pi.resolve('codemode')?.renderCall?.({}, theme as never, renderContext() as never);
		assert.deepEqual(codemode?.render(80), rowsOf('codemode'), 'codemode is untouched too');
	} finally {
		rmSync(agentHome, { recursive: true, force: true });
	}
});

test('a row the reader expands comes back in full', () => {
	const agentHome = scratch();
	try {
		const pi = runningUnit(agentHome);
		const renderers = pi.resolve('edit');
		assert.ok(renderers);
		const call = renderers.renderCall?.({}, theme as never, renderContext({ expanded: true }) as never);
		assert.deepEqual(call?.render(80), rowsOf('edit'), 'an expanded row must never stay blank');
		const result = renderers.renderResult?.(
			{ content: [{ type: 'text', text: 'ok' }], details: undefined, isError: false },
			{ expanded: true, isPartial: false },
			theme as never,
			renderContext({ expanded: true }) as never,
		);
		assert.deepEqual(result?.render(80), rowsOf('edit'));
	} finally {
		rmSync(agentHome, { recursive: true, force: true });
	}
});

test('the collapse ends with the session, not before it', () => {
	const agentHome = scratch();
	try {
		const pi = runningUnit(agentHome);
		pi.fire(
			'agent_end',
			{ type: 'agent_end', messages: [{ role: 'assistant', content: [{ type: 'text', text: 'Listo.' }] }] },
			sessionContext(),
		);
		// A finished turn keeps its carrier on disk, so a redraw must not resurrect
		// the rows the unit just stopped drawing.
		assert.equal(pi.resolve('read')?.renderShell, 'self');
		pi.fire('session_shutdown', { type: 'session_shutdown' }, sessionContext());
		assert.equal(pi.resolve('read')?.renderShell, 'default', 'a closed session draws the way it always did');
	} finally {
		rmSync(agentHome, { recursive: true, force: true });
	}
});
