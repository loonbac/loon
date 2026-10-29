import test from 'node:test';
import assert from 'node:assert/strict';
import loonPi, { HeaderWatchdog, LOOK_COMMAND, RESTORE_COMMAND, WATCHDOG_CONFIG } from '../extensions/loon-startup.ts';
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
		cwd: '/home/loon/Workspace/mypi',
		model: { provider: 'openai-codex', id: 'gpt-5.5' },
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

function headerFactories(ctx: FakeContext): unknown[] {
	return ctx.ui.calls.filter(([name]) => name === 'setHeader').map(([, value]) => value);
}

test('registers exactly two commands: reapply the header, restore pi’s TUI', () => {
	const pi = fakePi();
	loonPi(pi as never);
	assert.deepEqual([...pi.commands.keys()], [LOOK_COMMAND, RESTORE_COMMAND]);
	assert.equal(LOOK_COMMAND, 'use-loon-tui');
	assert.equal(RESTORE_COMMAND, 'use-default-tui');
});

test('installs the header on session start, after the first macrotask', async () => {
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

test('applying the header touches no footer, spinner, title or editor', async () => {
	const pi = fakePi();
	const ctx = fakeContext();
	loonPi(pi as never);
	for (const handler of pi.handlers.get('session_start') ?? []) handler({}, ctx);
	await wait(500);
	assert.deepEqual([...new Set(ctx.ui.calls.map(([name]) => name))], ['setHeader']);
});

test('the installed header renders the capture and keeps the restore tip', async () => {
	const pi = fakePi();
	const ctx = fakeContext();
	loonPi(pi as never);
	for (const handler of pi.handlers.get('session_start') ?? []) handler({}, ctx);
	await wait(50);

	ctx.ui.theme = plainTheme();
	const factory = headerFactories(ctx).at(-1) as (tui: unknown, theme: unknown) => { render(w: number): string[] };
	const header = factory({ requestRender: () => {} }, ctx.ui.theme);
	const rendered = header.render(80).join('\n');
	assert.match(rendered, /Pi v/);
	assert.match(rendered, /Getting started/);
	assert.match(rendered, /\/use-default-tui/);
	assert.ok(!rendered.includes('/use-loon-tui'), 'tips must not advertise the reapply command');
});

test('the tips are fixed once per session, not reshuffled per install', async () => {
	const pi = fakePi();
	const ctx = fakeContext();
	loonPi(pi as never);
	for (const handler of pi.handlers.get('session_start') ?? []) handler({}, ctx);
	await wait(500);
	const factories = headerFactories(ctx) as ((tui: unknown, theme: unknown) => { render(w: number): string[] })[];
	const renders = factories.map((factory) => factory({ requestRender: () => {} }, plainTheme()).render(80).join('\n'));
	for (const rendered of renders) assert.equal(rendered, renders[0]);
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
	assert.equal(ctx.ui.calls.length, afterRestore, 'a pending re-assert reinstalled the header after restore');
});

test('the reapply command applies the header again', async () => {
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

interface FakeClock {
	now(): number;
	setInterval(callback: () => void, ms: number): unknown;
	clearInterval(handle: unknown): void;
	advance(ms: number): void;
	running(): boolean;
}

/** A clock the test steps by hand, so the watchdog loop needs no real timers. */
function fakeClock(): FakeClock {
	let now = 0;
	const timers = new Set<() => void>();
	return {
		now: () => now,
		setInterval: (callback) => {
			timers.add(callback);
			return callback;
		},
		clearInterval: (handle) => {
			timers.delete(handle as () => void);
		},
		advance(ms) {
			now += ms;
			for (const callback of [...timers]) callback();
		},
		running: () => timers.size > 0,
	};
}

test('the watchdog re-asserts while the header never paints', () => {
	const clock = fakeClock();
	const health = { lastRenderAt: 0 };
	let asserts = 0;
	const watchdog = new HeaderWatchdog(() => {
		asserts += 1;
	}, health, clock);
	watchdog.start();

	for (let tick = 0; tick < 12; tick += 1) clock.advance(WATCHDOG_CONFIG.tickMs);
	assert.ok(asserts >= 2, `expected re-asserts, got ${asserts}`);
	assert.ok(clock.running(), 'the watchdog stopped while the header was still unpainted');
});

test('the watchdog re-asserts when a later registration takes the header over', () => {
	const clock = fakeClock();
	const health = { lastRenderAt: 0 };
	let asserts = 0;
	const watchdog = new HeaderWatchdog(() => {
		asserts += 1;
	}, health, clock);
	watchdog.start();

	// Our header paints, then another extension registers its own and ours stops
	// being rendered: the render gap is the only signal.
	for (let tick = 0; tick < 10; tick += 1) {
		clock.advance(WATCHDOG_CONFIG.tickMs);
		health.lastRenderAt = clock.now();
	}
	assert.equal(asserts, 0, 'the watchdog re-asserted a header it owned');

	for (let tick = 0; tick < 6; tick += 1) clock.advance(WATCHDOG_CONFIG.tickMs);
	assert.equal(asserts, 1, `expected one reclaim, got ${asserts}`);

	// The re-assert requests a render: ours is on screen again, so it stops.
	health.lastRenderAt = clock.now();
	for (let tick = 0; tick < 8; tick += 1) clock.advance(WATCHDOG_CONFIG.tickMs);
	assert.equal(asserts, 1, 'the watchdog kept re-asserting after it had reclaimed the header');
	assert.equal(clock.running(), false, 'the watchdog did not stop after the reclaim painted');
});

test('the watchdog leaves a header that keeps painting alone', () => {
	const clock = fakeClock();
	const health = { lastRenderAt: 0 };
	let asserts = 0;
	const watchdog = new HeaderWatchdog(() => {
		asserts += 1;
	}, health, clock);
	watchdog.start();

	for (let tick = 0; tick < 30; tick += 1) {
		clock.advance(WATCHDOG_CONFIG.tickMs);
		health.lastRenderAt = clock.now();
	}

	assert.equal(asserts, 0, `the watchdog re-asserted a painted header ${asserts} time(s)`);
});

test('the watchdog gives up at the ceiling', () => {
	const clock = fakeClock();
	const health = { lastRenderAt: 0 };
	const watchdog = new HeaderWatchdog(() => {}, health, clock);
	watchdog.start();
	assert.ok(clock.running());

	for (let tick = 0; tick < Math.ceil(WATCHDOG_CONFIG.windowMs / WATCHDOG_CONFIG.tickMs) + 2; tick += 1) {
		clock.advance(WATCHDOG_CONFIG.tickMs);
	}
	assert.equal(clock.running(), false, 'the watchdog never stopped at its ceiling');
});
