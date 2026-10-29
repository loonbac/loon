import test from 'node:test';
import assert from 'node:assert/strict';
import loonPi, { LOOK_COMMAND, RESTORE_COMMAND } from '../extensions/loon-startup.ts';
import { plainTheme, strictTheme } from './support/themes.ts';

type Handler = (event: unknown, ctx: FakeContext) => unknown;

interface FakeContext {
	mode: string;
	hasUI: boolean;
	cwd: string;
	model: { provider: string; id: string };
	ui: {
		theme: unknown;
		setHeader: (factory: unknown) => void;
		setFooter: (value: unknown) => void;
		setWorkingIndicator: (value: unknown) => void;
		notify: (message: string, kind: string) => void;
		calls: [string, unknown][];
	};
}

function fakeContext(): FakeContext {
	const calls: [string, unknown][] = [];
	const ui = {
		theme: strictTheme(),
		setHeader: (factory: unknown) => {
			calls.push(['setHeader', factory]);
		},
		setFooter: (value: unknown) => {
			calls.push(['setFooter', value]);
		},
		setWorkingIndicator: (value: unknown) => {
			calls.push(['setWorkingIndicator', value]);
		},
		notify: () => {},
		calls,
	};
	return {
		mode: 'tui',
		hasUI: true,
		cwd: '/home/loon/proj',
		model: { provider: 'gentle', id: 'gentleman' },
		ui,
	};
}

function fakePi() {
	const commands = new Map<string, { description: string; handler: unknown }>();
	const handlers = new Map<string, Handler[]>();
	return {
		commands,
		handlers,
		on(event: string, handler: Handler) {
			handlers.set(event, [...(handlers.get(event) ?? []), handler]);
		},
		registerCommand(name: string, options: { description: string; handler: unknown }) {
			commands.set(name, options);
		},
		getCommands: () => [{ name: LOOK_COMMAND }, { name: RESTORE_COMMAND }, { name: 'deploy' }],
		getThinkingLevel: () => 'high',
	};
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function headerFactories(ctx: FakeContext): (unknown)[] {
	return ctx.ui.calls.filter(([name]) => name === 'setHeader').map(([, value]) => value);
}

test('registers one command to reapply the look and one to restore pi’s TUI', () => {
	const pi = fakePi();
	loonPi(pi as never);
	assert.deepEqual([...pi.commands.keys()], [LOOK_COMMAND, RESTORE_COMMAND]);
});

test('installs the banner on session start, after the first macrotask', async () => {
	const pi = fakePi();
	const ctx = fakeContext();
	loonPi(pi as never);

	for (const handler of pi.handlers.get('session_start') ?? []) handler({}, ctx);
	assert.deepEqual(headerFactories(ctx), [], 'installed synchronously instead of after the event');

	await wait(50);
	const factories = headerFactories(ctx);
	assert.ok(factories.length >= 1);
	assert.equal(typeof factories.at(-1), 'function');
});

test('the installed header renders the banner and keeps the restore tip', async () => {
	const pi = fakePi();
	const ctx = fakeContext();
	loonPi(pi as never);
	for (const handler of pi.handlers.get('session_start') ?? []) handler({}, ctx);
	await wait(50);

	// The header reads the live theme per render, so the context decides.
	ctx.ui.theme = plainTheme();
	const factory = headerFactories(ctx).at(-1) as (tui: unknown, theme: unknown) => { render(w: number): string[] };
	const tui = { requestRender: () => {} };
	const header = factory(tui, ctx.ui.theme);
	const lines = header.render(80);
	assert.ok(lines.length > 3);
	assert.match(lines.join('\n'), /loon:default/);
	assert.ok(!lines.join('\n').includes(LOOK_COMMAND), 'tips must not advertise the reapply command');
});

test('the restore command clears header, footer and spinner and stops re-asserting', async () => {
	const pi = fakePi();
	const ctx = fakeContext();
	loonPi(pi as never);
	for (const handler of pi.handlers.get('session_start') ?? []) handler({}, ctx);
	await wait(50);

	const restore = pi.commands.get(RESTORE_COMMAND)!;
	await (restore.handler as (args: string, ctx: FakeContext) => Promise<void>)('', ctx);

	assert.deepEqual(ctx.ui.calls.slice(-3), [
		['setHeader', undefined],
		['setFooter', undefined],
		['setWorkingIndicator', undefined],
	]);

	const afterRestore = ctx.ui.calls.length;
	await wait(500);
	assert.equal(ctx.ui.calls.length, afterRestore, 'a pending re-assert reinstalled the banner after restore');
});

test('the look command re-applies the banner', async () => {
	const pi = fakePi();
	const ctx = fakeContext();
	loonPi(pi as never);
	const look = pi.commands.get(LOOK_COMMAND)!;
	await (look.handler as (args: string, ctx: FakeContext) => Promise<void>)('', ctx);
	assert.equal(typeof headerFactories(ctx).at(-1), 'function');
});

test('nothing is installed when the context has no TUI', async () => {
	const pi = fakePi();
	const ctx = { ...fakeContext(), mode: 'print' };
	loonPi(pi as never);
	for (const handler of pi.handlers.get('session_start') ?? []) handler({}, ctx);
	await wait(50);
	assert.deepEqual(headerFactories(ctx), []);
});
