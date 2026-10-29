import test from 'node:test';
import assert from 'node:assert/strict';
import {
	createLoonExtension,
	HeaderWatchdog,
	LOOK_COMMAND,
	MENU_COMMAND,
	RESTORE_COMMAND,
	WATCHDOG_CONFIG,
	WIDGET_KEY,
	type LoonDeps,
	type LoonState,
} from '../extensions/loon-startup.ts';
import { DEFAULT_GENTLE_SETTINGS } from '../extensions/lib/gentle-config.ts';
import { DEFAULT_LOON_SETTINGS, type LoonSettings } from '../extensions/lib/loon-config.ts';
import { plainTheme, strictTheme } from './support/themes.ts';

type Handler = (event: unknown, ctx: FakeContext) => unknown;

interface FakeUi {
	theme: unknown;
	setHeader: (factory: unknown) => void;
	setWidget: (key: string, content: unknown, options?: unknown) => void;
	setFooter: (value: unknown) => void;
	setWorkingIndicator: (value: unknown) => void;
	notify: (message: string, kind: string) => void;
	select: (title: string, options: string[]) => Promise<string | undefined>;
	notifyQueue: string[];
	selectQueue: string[];
	calls: [string, unknown, unknown?][];
}

interface FakeContext {
	mode: string;
	hasUI: boolean;
	cwd: string;
	model: { provider: string; id: string };
	ui: FakeUi;
}

function fakeContext(): FakeContext {
	const calls: [string, unknown, unknown?][] = [];
	const ui: FakeUi = {
		theme: strictTheme(),
		setHeader: (factory) => {
			calls.push(['setHeader', factory]);
		},
		setWidget: (key, content, options) => {
			calls.push(['setWidget', key, { content, options }]);
		},
		setFooter: (value) => {
			calls.push(['setFooter', value]);
		},
		setWorkingIndicator: (value) => {
			calls.push(['setWorkingIndicator', value]);
		},
		notify: (message) => {
			ui.notifyQueue.push(message);
		},
		select: async (_title, options) => {
			const queued = ui.selectQueue.shift();
			if (queued === undefined) return undefined;
			return options.find((option) => option.startsWith(queued)) ?? queued;
		},
		notifyQueue: [],
		selectQueue: [],
		calls,
	};
	return { mode: 'tui', hasUI: true, cwd: '/home/loon/Workspace/mypi', model: { provider: 'openai-codex', id: 'gpt-5.5' }, ui };
}

interface FakePi {
	commands: Map<string, { description: string; handler: unknown }>;
	handlers: Map<string, Handler[]>;
	on(event: string, handler: Handler): void;
	registerCommand(name: string, options: { description: string; handler: unknown }): void;
	getCommands(): { name: string }[];
	getThinkingLevel(): string;
}

function fakePi(): FakePi {
	const commands = new Map<string, { description: string; handler: unknown }>();
	const handlers = new Map<string, Handler[]>();
	return {
		commands,
		handlers,
		on: (event, handler) => {
			handlers.set(event, [...(handlers.get(event) ?? []), handler]);
		},
		registerCommand: (name, options) => {
			commands.set(name, options);
		},
		getCommands: () => [
			{ name: LOOK_COMMAND },
			{ name: RESTORE_COMMAND },
			{ name: MENU_COMMAND },
			{ name: 'deploy' },
		],
		getThinkingLevel: () => 'high',
	};
}

interface FakeConfig {
	deps: LoonDeps;
	writes: LoonSettings[];
	state: LoonState;
	set(next: Partial<LoonState>): void;
	emit(): void;
	disposed(): number;
}

/** Every settings source replaced: no test ever touches a real config home. */
function fakeConfig(initial: Partial<LoonState> = {}): FakeConfig {
	let state: LoonState = {
		loon: { ...DEFAULT_LOON_SETTINGS, ...(initial.loon ?? {}) },
		gentle: { ...DEFAULT_GENTLE_SETTINGS, ...(initial.gentle ?? {}) },
	};
	const writes: LoonSettings[] = [];
	let emitHandler: (() => void) | undefined;
	let disposeCount = 0;
	const config: FakeConfig = {
		writes,
		state,
		deps: {
			read: () => ({ loon: { ...state.loon }, gentle: { ...state.gentle } }),
			write: (settings) => {
				writes.push(settings);
				state = { ...state, loon: settings };
				config.state = state;
			},
			watch: (onChange) => {
				emitHandler = onChange;
				return () => {
					disposeCount += 1;
					emitHandler = undefined;
				};
			},
		},
		set: (next) => {
			state = { ...state, ...next };
			config.state = state;
		},
		emit: () => emitHandler?.(),
		disposed: () => disposeCount,
	};
	return config;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function boot(initial: Partial<LoonState> = {}, clock?: FakeClock) {
	const pi = fakePi();
	const ctx = fakeContext();
	const config = fakeConfig(initial);
	createLoonExtension(pi as never, { ...config.deps, ...(clock ? { clock } : {}) });
	return { pi, ctx, config };
}

function startSession(pi: FakePi, ctx: FakeContext): void {
	for (const handler of pi.handlers.get('session_start') ?? []) handler({}, ctx);
}

function headerFactories(ctx: FakeContext): unknown[] {
	return ctx.ui.calls.filter(([name]) => name === 'setHeader').map(([, value]) => value);
}

function widgets(ctx: FakeContext): [string, { content: unknown; options: unknown }][] {
	return ctx.ui.calls
		.filter(([name]) => name === 'setWidget')
		.map(([, key, value]) => [key as string, value as { content: unknown; options: unknown }]);
}

type Factory = (tui: unknown, theme: unknown) => { render(width: number): string[] };

function renderHeader(ctx: FakeContext, width = 80): string[] {
	const factory = headerFactories(ctx).at(-1) as Factory;
	ctx.ui.theme = plainTheme();
	return factory({ requestRender: () => {} }, ctx.ui.theme).render(width);
}

function renderWidget(ctx: FakeContext, width = 80): string[] {
	const content = widgets(ctx).at(-1)?.[1].content as Factory;
	return content({ requestRender: () => {} }, plainTheme()).render(width);
}

test('registers exactly three commands', () => {
	const { pi } = boot();
	assert.deepEqual([...pi.commands.keys()], [LOOK_COMMAND, RESTORE_COMMAND, MENU_COMMAND]);
	assert.equal(LOOK_COMMAND, 'use-loon-tui');
	assert.equal(RESTORE_COMMAND, 'use-default-tui');
	assert.equal(MENU_COMMAND, 'loon:tui');
});

test('installs the header on session start, after the first macrotask', async () => {
	const { pi, ctx } = boot();
	startSession(pi, ctx);
	assert.deepEqual(headerFactories(ctx), [], 'installed synchronously instead of after the event');

	await wait(50);
	assert.ok(headerFactories(ctx).length >= 1);
	assert.equal(typeof headerFactories(ctx).at(-1), 'function');
});

test('applying the header touches no footer, spinner, title or editor', async () => {
	const { pi, ctx } = boot();
	startSession(pi, ctx);
	await wait(500);
	assert.deepEqual([...new Set(ctx.ui.calls.map(([name]) => name))], ['setHeader']);
});

test('the installed header renders the capture and keeps the restore tip', async () => {
	const { pi, ctx } = boot();
	startSession(pi, ctx);
	await wait(50);

	const rendered = renderHeader(ctx).join('\n');
	assert.match(rendered, /Pi v/);
	assert.match(rendered, /Getting started/);
	assert.match(rendered, /\/use-default-tui/);
	assert.ok(!rendered.includes('/use-loon-tui'), 'tips must not advertise the reapply command');
	assert.ok(!rendered.includes('/loon:tui'), 'tips must not advertise the settings command');
});

test('the tips are fixed once per session, not reshuffled per install', async () => {
	const { pi, ctx } = boot();
	startSession(pi, ctx);
	await wait(500);
	const renders = headerFactories(ctx).map(() => renderHeader(ctx).join('\n'));
	for (const rendered of renders) assert.equal(rendered, renders[0]);
});

test('the restore command clears the header, the widget, the footer and the spinner', async () => {
	const { pi, ctx, config } = boot();
	startSession(pi, ctx);
	await wait(50);

	const restore = pi.commands.get(RESTORE_COMMAND)!;
	await (restore.handler as (args: string, ctx: FakeContext) => Promise<void>)('', ctx);

	assert.deepEqual(ctx.ui.calls.slice(-4), [
		['setHeader', undefined],
		['setWidget', WIDGET_KEY, { content: undefined, options: undefined }],
		['setFooter', undefined],
		['setWorkingIndicator', undefined],
	]);
	assert.equal(config.writes.at(-1)?.enabled, false, 'turning it off is persisted');

	const afterRestore = ctx.ui.calls.length;
	await wait(500);
	assert.equal(ctx.ui.calls.length, afterRestore, 'a pending re-assert reinstalled the header after restore');
});

test('the reapply command turns the banner on and applies it again', async () => {
	const { pi, ctx, config } = boot({ loon: { enabled: false, accent: 'banner' } });
	const look = pi.commands.get(LOOK_COMMAND)!;
	await (look.handler as (args: string, ctx: FakeContext) => Promise<void>)('', ctx);
	assert.equal(config.writes.at(-1)?.enabled, true);
	assert.equal(typeof headerFactories(ctx).at(-1), 'function');
});

test('nothing is installed when the context has no TUI', async () => {
	const { pi, ctx } = boot();
	const headless = { ...ctx, mode: 'print' };
	startSession(pi, headless);
	await wait(50);
	assert.deepEqual(headerFactories(headless), []);
});

/* S3: headerPlacement, in both directions and without a restart. */

test('below-input leaves the top slot and draws under the editor', async () => {
	const { pi, ctx } = boot({ gentle: { ...DEFAULT_GENTLE_SETTINGS, headerPlacement: 'below-input' } });
	startSession(pi, ctx);
	await wait(50);

	assert.equal(headerFactories(ctx).at(-1), undefined, 'the top slot is handed back');
	const [key, value] = widgets(ctx).at(-1) ?? ['', { content: undefined, options: undefined }];
	assert.equal(key, WIDGET_KEY);
	assert.deepEqual(value.options, { placement: 'belowEditor' });
	assert.match(renderWidget(ctx).join('\n'), /Getting started/);
});

test('a live change from below-input to top restores the header, and back again', async () => {
	const { pi, ctx, config } = boot({ gentle: { ...DEFAULT_GENTLE_SETTINGS, headerPlacement: 'below-input' } });
	startSession(pi, ctx);
	await wait(50);

	config.set({ gentle: { ...config.state.gentle, headerPlacement: 'top' } });
	config.emit();
	assert.equal(typeof headerFactories(ctx).at(-1), 'function', 'the header did not come back');
	assert.equal(widgets(ctx).at(-1)?.[1].content, undefined, 'the widget was not cleared');

	config.set({ gentle: { ...config.state.gentle, headerPlacement: 'below-input' } });
	config.emit();
	assert.equal(headerFactories(ctx).at(-1), undefined, 'the top slot was not released');
	assert.deepEqual(widgets(ctx).at(-1)?.[1].options, { placement: 'belowEditor' });
});

/* S6: off means off — nothing painted, nothing reclaimed. */

test('a disabled banner installs nothing at all', async () => {
	const { pi, ctx } = boot({ loon: { enabled: false, accent: 'banner' } });
	startSession(pi, ctx);
	await wait(500);

	assert.deepEqual(headerFactories(ctx), []);
	assert.deepEqual(widgets(ctx), []);
});

test('the settings command turns a disabled banner on without a restart', async () => {
	const { pi, ctx, config } = boot({ loon: { enabled: false, accent: 'banner' } });
	startSession(pi, ctx);
	await wait(50);

	const menu = pi.commands.get(MENU_COMMAND)!;
	await (menu.handler as (args: string, ctx: FakeContext) => Promise<void>)('on', ctx);
	assert.equal(config.writes.at(-1)?.enabled, true);
	assert.equal(typeof headerFactories(ctx).at(-1), 'function');
});

/* S4: the accent override reaches the drawn header. */

test('the accent source decides between the theme and gentle-pi’s colour', async () => {
	const { pi, ctx, config } = boot({
		loon: { enabled: true, accent: 'banner' },
		gentle: { ...DEFAULT_GENTLE_SETTINGS, accentColor: 'cyan' },
	});
	startSession(pi, ctx);
	await wait(50);
	assert.ok(renderHeader(ctx).join('\n').includes('\x1b[38;2;95;210;255m'), 'the gentle colour was not painted');

	config.set({ loon: { enabled: true, accent: 'theme' } });
	config.emit();
	assert.ok(!renderHeader(ctx).join('\n').includes('\x1b[38;2;'), 'the theme accent was not restored');
});

test('density and the mark flag reach the drawn header', async () => {
	const { pi, ctx } = boot({ gentle: { ...DEFAULT_GENTLE_SETTINGS, density: 'minimal', showTextLogo: false } });
	startSession(pi, ctx);
	await wait(50);

	const rendered = renderHeader(ctx);
	assert.equal(rendered.length, 3, 'minimal is a three-row box');
	assert.ok(!rendered.join('\n').includes('████'));
});

test('the settings command reports what it is following', async () => {
	const { pi, ctx } = boot({ gentle: { ...DEFAULT_GENTLE_SETTINGS, density: 'compact', headerPlacement: 'below-input' } });
	const menu = pi.commands.get(MENU_COMMAND)!;
	await (menu.handler as (args: string, ctx: FakeContext) => Promise<void>)('status', ctx);
	const message = ctx.ui.notifyQueue.at(-1) ?? '';
	assert.match(message, /banner on/);
	assert.match(message, /density compact/);
	assert.match(message, /placement below-input/);
});

test('the settings command switches the accent source and repaints', async () => {
	const { pi, ctx, config } = boot();
	startSession(pi, ctx);
	await wait(50);

	const menu = pi.commands.get(MENU_COMMAND)!;
	const run = menu.handler as (args: string, ctx: FakeContext) => Promise<void>;
	await run('accent theme', ctx);
	assert.equal(config.writes.at(-1)?.accent, 'theme');
	assert.equal(typeof headerFactories(ctx).at(-1), 'function');

	await run('accent banner', ctx);
	assert.equal(config.writes.at(-1)?.accent, 'banner');
});

test('the menu toggles the banner and closes', async () => {
	const { pi, ctx, config } = boot();
	startSession(pi, ctx);
	await wait(50);

	ctx.ui.selectQueue.push('Banner:', 'Close');
	const menu = pi.commands.get(MENU_COMMAND)!;
	await (menu.handler as (args: string, ctx: FakeContext) => Promise<void>)('', ctx);
	assert.equal(config.writes.at(-1)?.enabled, false, 'the banner option did not toggle');
	assert.equal(ctx.ui.selectQueue.length, 0, 'the menu did not consume its answers');
});

test('the watcher ignores a change that resolves to the same settings', async () => {
	const { pi, ctx, config } = boot();
	startSession(pi, ctx);
	await wait(50);
	const before = ctx.ui.calls.length;

	config.emit();
	assert.equal(ctx.ui.calls.length, before, 'an unchanged config repainted the banner');
});

test('shutdown stops the watcher', async () => {
	const { pi, ctx, config } = boot();
	startSession(pi, ctx);
	await wait(50);
	for (const handler of pi.handlers.get('session_shutdown') ?? []) handler({}, ctx);
	assert.equal(config.disposed(), 1);
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
	assert.ok(asserts >= 2, 'expected re-asserts, got ' + asserts);
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

	for (let tick = 0; tick < 10; tick += 1) {
		clock.advance(WATCHDOG_CONFIG.tickMs);
		health.lastRenderAt = clock.now();
	}
	assert.equal(asserts, 0, 'the watchdog re-asserted a header it owned');

	for (let tick = 0; tick < 6; tick += 1) clock.advance(WATCHDOG_CONFIG.tickMs);
	assert.equal(asserts, 1, 'expected one reclaim, got ' + asserts);

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

	assert.equal(asserts, 0, 'the watchdog re-asserted a painted header');
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

test('the extension stops re-asserting while the banner is disabled or below the editor', async () => {
	const scenarios = [
		{ loon: { enabled: false, accent: 'banner' as const }, gentle: DEFAULT_GENTLE_SETTINGS },
		{ loon: DEFAULT_LOON_SETTINGS, gentle: { ...DEFAULT_GENTLE_SETTINGS, headerPlacement: 'below-input' as const } },
	];
	for (const scenario of scenarios) {
		const clock = fakeClock();
		const { pi, ctx } = boot(scenario, clock);
		startSession(pi, ctx);
		await wait(50);

		const before = ctx.ui.calls.length;
		for (let tick = 0; tick < 20; tick += 1) clock.advance(WATCHDOG_CONFIG.tickMs);
		assert.equal(ctx.ui.calls.length, before, 'the watchdog re-asserted where it must not');
	}
});
