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
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
	fire: (event: string, payload?: Record<string, unknown>, ctx?: unknown) => void;
	/** What pi draws for a call: every resolver in load order, then the tool itself. */
	resolve: (toolName: string) => ToolRenderers | undefined;
}

function fakePi(): FakePi {
	const handlers = new Map<string, ((event: unknown, ctx: unknown) => void)[]>();
	const resolvers: ToolRendererResolver[] = [];
	const messageRenderers: string[] = [];
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
		registerMarkdownTransformer: (): void => {
			messageRenderers.push('markdown');
		},
	} as unknown as ExtensionAPI;
	return {
		api,
		handlers,
		resolvers,
		messageRenderers,
		fire(event, payload = { type: event }, ctx) {
			for (const handler of handlers.get(event) ?? []) handler(payload, ctx);
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

test('a codemode call in a session without a carrier is untouched', () => {
	const agentHome = scratch();
	try {
		const pi = fakePi();
		createInlineWork(pi.api, { env: {}, agentHome, heartbeatMs: 0 });
		pi.fire('session_start', { type: 'session_start' }, sessionContext());
		const renderers = pi.resolve('codemode');
		assert.equal(renderers?.renderShell, 'default', 'an idle session keeps the rendering it had');
		const call = renderers?.renderCall?.({ code: 'await' }, theme as never, renderContext() as never);
		assert.deepEqual(call?.render(80), rowsOf('codemode'));
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

test('nothing is collapsed before the unit has a carrier', () => {
	const agentHome = scratch();
	try {
		const pi = fakePi();
		createInlineWork(pi.api, { env: {}, agentHome, heartbeatMs: 0 });
		pi.fire('session_start', { type: 'session_start' }, sessionContext());
		const renderers = pi.resolve('read');
		assert.equal(renderers?.renderShell, 'default', 'an idle session keeps the rendering it had');
		const call = renderers?.renderCall?.({}, theme as never, renderContext() as never);
		assert.deepEqual(call?.render(80), rowsOf('read'));
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
