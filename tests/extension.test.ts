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
	wallpaperRgb: [number, number, number] | undefined;
	themeCalls: unknown[];
	themeResult: 'written' | 'up-to-date' | 'skipped-foreign' | 'skipped-no-accent';
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
		wallpaperRgb: undefined,
		themeCalls: [],
		themeResult: 'written',
		deps: {
			read: () => ({ loon: { ...state.loon }, gentle: { ...state.gentle } }),
			write: (settings) => {
				writes.push(settings);
				state = { ...state, loon: settings };
				config.state = state;
			},
			wallpaper: () => config.wallpaperRgb,
			ensureTheme: (accent) => {
				config.themeCalls.push(accent);
				return { result: config.themeResult, path: '/tmp/themes/Wallpaper (LOON).json' };
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
	const name = (ctx.ui.theme as { name?: string } | undefined)?.name;
	return renderHeaderWith(ctx, name, width);
}

/** Render with a specific active theme name, as pi would after a theme change. */
function renderHeaderWith(ctx: FakeContext, themeName: string | undefined, width = 80): string[] {
	const factory = headerFactories(ctx).at(-1) as Factory;
	ctx.ui.theme = { ...plainTheme(), name: themeName };
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
	const { pi, ctx, config } = boot({ loon: { ...DEFAULT_LOON_SETTINGS, enabled: false, accent: 'banner' } });
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

test('gentle-pi’s below-input placement moves its bar, never the banner', async () => {
	// The user saw the banner slide under the editor together with gentle-pi’s bar.
	// The banner lives in pi’s header slot and does not follow that setting.
	const { pi, ctx } = boot({ gentle: { ...DEFAULT_GENTLE_SETTINGS, headerPlacement: 'below-input' } });
	startSession(pi, ctx);
	await wait(50);

	assert.equal(typeof headerFactories(ctx).at(-1), 'function', 'the banner left the header slot');
	assert.deepEqual(widgets(ctx), [], 'the banner was drawn as a widget under the editor');
	assert.match(renderHeader(ctx).join('\n'), /Getting started/);
});

test('a live placement change leaves the banner where it is', async () => {
	const { pi, ctx, config } = boot({ gentle: { ...DEFAULT_GENTLE_SETTINGS, headerPlacement: 'below-input' } });
	startSession(pi, ctx);
	await wait(50);

	config.set({ gentle: { ...config.state.gentle, headerPlacement: 'top' } });
	config.emit();
	assert.equal(typeof headerFactories(ctx).at(-1), 'function', 'the banner is not in the header slot');

	config.set({ gentle: { ...config.state.gentle, headerPlacement: 'below-input' } });
	config.emit();
	assert.equal(typeof headerFactories(ctx).at(-1), 'function', 'the banner left the header slot when the bar moved down');
	assert.deepEqual(widgets(ctx), [], 'a banner widget appeared under the editor');
});

/* S4/S5: `source` decides who paints, and LOON never reclaims what it does not own. */

test('source rose leaves the header to gentle-pi', async () => {
	const { pi, ctx } = boot({ loon: { ...DEFAULT_LOON_SETTINGS, source: 'rose' } });
	startSession(pi, ctx);
	await wait(500);

	assert.equal(headerFactories(ctx).at(-1), undefined, 'LOON took the slot gentle-pi was asked to paint');
	assert.deepEqual(widgets(ctx), []);
});

test('source off leaves pi its own header', async () => {
	const { pi, ctx } = boot({ loon: { ...DEFAULT_LOON_SETTINGS, source: 'off' } });
	startSession(pi, ctx);
	await wait(500);

	assert.equal(headerFactories(ctx).at(-1), undefined);
	assert.deepEqual(widgets(ctx), []);
});

test('a live change of source hands the slot over and takes it back', async () => {
	const { pi, ctx, config } = boot();
	startSession(pi, ctx);
	await wait(50);
	assert.equal(typeof headerFactories(ctx).at(-1), 'function');

	config.set({ loon: { ...DEFAULT_LOON_SETTINGS, source: 'rose' } });
	config.emit();
	assert.equal(headerFactories(ctx).at(-1), undefined, 'LOON kept the slot after source became rose');

	config.set({ loon: { ...DEFAULT_LOON_SETTINGS, source: 'loon' } });
	config.emit();
	assert.equal(typeof headerFactories(ctx).at(-1), 'function', 'LOON did not come back');
});

test('the status line reports the source', async () => {
	const { pi, ctx } = boot({ loon: { ...DEFAULT_LOON_SETTINGS, source: 'off' } });
	const menu = pi.commands.get(MENU_COMMAND)!;
	await (menu.handler as (args: string, ctx: FakeContext) => Promise<void>)('status', ctx);
	assert.match(ctx.ui.notifyQueue.at(-1) ?? '', /source off/);
});

/* S6: off means off — nothing painted, nothing reclaimed. */

test('a disabled banner installs nothing at all', async () => {
	const { pi, ctx } = boot({ loon: { ...DEFAULT_LOON_SETTINGS, enabled: false, accent: 'banner' } });
	startSession(pi, ctx);
	await wait(500);

	assert.deepEqual(headerFactories(ctx), []);
	assert.deepEqual(widgets(ctx), []);
});

test('the settings command turns a disabled banner on without a restart', async () => {
	const { pi, ctx, config } = boot({ loon: { ...DEFAULT_LOON_SETTINGS, enabled: false, accent: 'banner' } });
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
		loon: { ...DEFAULT_LOON_SETTINGS, enabled: true, accent: 'banner' },
		gentle: { ...DEFAULT_GENTLE_SETTINGS, accentColor: 'cyan' },
	});
	startSession(pi, ctx);
	await wait(50);
	assert.ok(renderHeader(ctx).join('\n').includes('\x1b[38;2;95;210;255m'), 'the gentle colour was not painted');

	config.set({ loon: { ...DEFAULT_LOON_SETTINGS, enabled: true, accent: 'theme' } });
	config.emit();
	assert.ok(!renderHeader(ctx).join('\n').includes('\x1b[38;2;'), 'the theme accent was not restored');
});

test('density reaches the drawn header', async () => {
	const { pi, ctx } = boot({ gentle: { ...DEFAULT_GENTLE_SETTINGS, density: 'minimal' } });
	startSession(pi, ctx);
	await wait(50);

	const rendered = renderHeader(ctx);
	assert.equal(rendered.length, 3, 'minimal is a three-row box');
	assert.ok(!rendered.join('\n').includes('████'));
});

/* The mark is LOON's own switch: gentle-pi's showTextLogo never reaches it. */

const markRows = (lines: string[]) => lines.filter((line) => line.includes('███')).length;

test('the mark is drawn by default, whatever gentle-pi’s files say', async () => {
	const { pi, ctx } = boot();
	startSession(pi, ctx);
	await wait(50);
	assert.equal(markRows(renderHeader(ctx)), 4);
});

test('/loon:tui mark off hides the mark and mark on brings it back', async () => {
	const { pi, ctx, config } = boot();
	startSession(pi, ctx);
	await wait(50);
	const menu = pi.commands.get(MENU_COMMAND)!;
	const run = menu.handler as (args: string, ctx: FakeContext) => Promise<void>;

	await run('mark off', ctx);
	assert.equal(config.writes.at(-1)?.mark, false);
	assert.equal(markRows(renderHeader(ctx)), 0, 'the mark survived mark off');

	await run('mark on', ctx);
	assert.equal(config.writes.at(-1)?.mark, true);
	assert.equal(markRows(renderHeader(ctx)), 4, 'the mark did not come back');
});

test('compact keeps the mark while the mark switch is on', async () => {
	const { pi, ctx } = boot({ gentle: { ...DEFAULT_GENTLE_SETTINGS, density: 'compact' } });
	startSession(pi, ctx);
	await wait(50);
	assert.equal(markRows(renderHeader(ctx)), 4);
	assert.equal(renderHeader(ctx).length, 9, 'two borders plus seven body rows');
});

test('the wallpaper accent paints the box and keeps the text roles themed', async () => {
	const { pi, ctx, config } = boot({ loon: { ...DEFAULT_LOON_SETTINGS, accent: 'wallpaper' } });
	config.wallpaperRgb = [155, 72, 74];
	startSession(pi, ctx);
	await wait(50);

	const rendered = renderHeader(ctx).join('\n');
	assert.ok(rendered.includes('\x1b[38;2;155;72;74m'), 'the wallpaper colour was not painted');
	assert.ok(!rendered.includes('\x1b[38;2;255;118;195m'), 'gentle-pi\'s pink leaked into the wallpaper accent');
});

test('an unreadable wallpaper accent falls back to the theme and says so', async () => {
	const { pi, ctx, config } = boot({ loon: { ...DEFAULT_LOON_SETTINGS, accent: 'wallpaper' } });
	config.wallpaperRgb = undefined;
	startSession(pi, ctx);
	await wait(50);

	assert.ok(!renderHeader(ctx).join('\n').includes('\x1b[38;2;'), 'the theme accent was overridden by nothing');
	const menu = pi.commands.get(MENU_COMMAND)!;
	await (menu.handler as (args: string, ctx: FakeContext) => Promise<void>)('status', ctx);
	assert.match(ctx.ui.notifyQueue.at(-1) ?? '', /accent wallpaper \(unavailable, theme fallback\)/);
});

test('status names the wallpaper colour that is in effect', async () => {
	const { pi, ctx, config } = boot({ loon: { ...DEFAULT_LOON_SETTINGS, accent: 'wallpaper' } });
	config.wallpaperRgb = [155, 72, 74];
	startSession(pi, ctx);
	await wait(50);
	const menu = pi.commands.get(MENU_COMMAND)!;
	await (menu.handler as (args: string, ctx: FakeContext) => Promise<void>)('status', ctx);
	assert.match(ctx.ui.notifyQueue.at(-1) ?? '', /accent wallpaper #9B484A/);
});

test('a wallpaper change repaints a running session', async () => {
	const { pi, ctx, config } = boot({ loon: { ...DEFAULT_LOON_SETTINGS, accent: 'wallpaper' } });
	config.wallpaperRgb = [155, 72, 74];
	startSession(pi, ctx);
	await wait(50);
	assert.ok(renderHeader(ctx).join('\n').includes('\x1b[38;2;155;72;74m'));

	// The accent file was replaced: the watcher reports it, the header recolours.
	config.wallpaperRgb = [30, 144, 255];
	config.emit();
	const rendered = renderHeader(ctx).join('\n');
	assert.ok(rendered.includes('\x1b[38;2;30;144;255m'), 'the new wallpaper colour was not painted');
	assert.ok(!rendered.includes('\x1b[38;2;155;72;74m'), 'the old wallpaper colour is still on screen');
});

/* S6/S8: the generated theme, and the banner following it. */

test('the theme is generated on session start and again when the wallpaper changes', async () => {
	const { pi, ctx, config } = boot();
	config.wallpaperRgb = [213, 169, 240];
	startSession(pi, ctx);
	await wait(50);
	assert.deepEqual(config.themeCalls, [[213, 169, 240]], 'the theme was not generated from the accent');

	config.wallpaperRgb = [30, 144, 255];
	config.emit();
	assert.deepEqual(config.themeCalls, [[213, 169, 240], [30, 144, 255]], 'a wallpaper change did not regenerate the theme');
});

test('with the generated theme active the banner follows the wallpaper, whatever the accent setting', async () => {
	const { pi, ctx, config } = boot({
		loon: { ...DEFAULT_LOON_SETTINGS, accent: 'banner' },
		gentle: { ...DEFAULT_GENTLE_SETTINGS, accentColor: 'pink' },
	});
	config.wallpaperRgb = [213, 169, 240];
	ctx.ui.theme = { ...plainTheme(), name: 'Wallpaper (LOON)' };
	startSession(pi, ctx);
	await wait(50);

	const rendered = renderHeaderWith(ctx, 'Wallpaper (LOON)').join('\n');
	assert.ok(rendered.includes('\x1b[38;2;213;169;240m'), 'the banner did not follow the wallpaper');
	assert.ok(!rendered.includes('\x1b[38;2;255;118;195m'), 'gentle-pi\'s pink won over the active theme');

	// Any other theme leaves the setting in charge.
	const other = renderHeaderWith(ctx, 'Gentle').join('\n');
	assert.ok(other.includes('\x1b[38;2;255;118;195m'), 'the accent setting was ignored for a foreign theme');
});

test('status reports the theme file and whether it is active', async () => {
	const { pi, ctx, config } = boot();
	config.wallpaperRgb = [213, 169, 240];
	config.themeResult = 'skipped-foreign';
	startSession(pi, ctx);
	await wait(50);
	const menu = pi.commands.get(MENU_COMMAND)!;
	const status = menu.handler as (args: string, ctx: FakeContext) => Promise<void>;
	await status('status', ctx);
	assert.match(ctx.ui.notifyQueue.at(-1) ?? '', /theme Wallpaper \(LOON\) skipped-foreign/, 'a foreign file must be reported');

	// A wallpaper change regenerates it, and the status follows the active theme.
	config.themeResult = 'written';
	ctx.ui.theme = { ...plainTheme(), name: 'Wallpaper (LOON)' } as never;
	config.wallpaperRgb = [30, 144, 255];
	config.emit();
	await status('status', ctx);
	assert.match(ctx.ui.notifyQueue.at(-1) ?? '', /theme Wallpaper \(LOON\) written, active/);
});

test('the settings command reports what it is following', async () => {
	const { pi, ctx } = boot({ gentle: { ...DEFAULT_GENTLE_SETTINGS, density: 'compact', headerPlacement: 'below-input' } });
	const menu = pi.commands.get(MENU_COMMAND)!;
	await (menu.handler as (args: string, ctx: FakeContext) => Promise<void>)('status', ctx);
	const message = ctx.ui.notifyQueue.at(-1) ?? '';
	assert.match(message, /banner on/);
	assert.match(message, /density compact/);
	assert.match(message, /placement below-input/);
	assert.match(message, /mark on/, 'the status line reports the mark switch');
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

test('the extension stops re-asserting while the banner is disabled', async () => {
	const clock = fakeClock();
	const { pi, ctx } = boot({ loon: { ...DEFAULT_LOON_SETTINGS, enabled: false }, gentle: DEFAULT_GENTLE_SETTINGS }, clock);
	startSession(pi, ctx);
	await wait(50);

	const before = ctx.ui.calls.length;
	for (let tick = 0; tick < 20; tick += 1) clock.advance(WATCHDOG_CONFIG.tickMs);
	assert.equal(ctx.ui.calls.length, before, 'the watchdog re-asserted while the banner was off');
});

test('the watchdog still defends the banner when the bar moves down', async () => {
	// The banner is on top and a later registration can take the slot, whatever
	// gentle-pi's own placement says.
	const clock = fakeClock();
	const { pi, ctx } = boot({ gentle: { ...DEFAULT_GENTLE_SETTINGS, headerPlacement: 'below-input' } }, clock);
	startSession(pi, ctx);
	await wait(50);

	const before = ctx.ui.calls.length;
	for (let tick = 0; tick < 12; tick += 1) clock.advance(WATCHDOG_CONFIG.tickMs);
	assert.ok(ctx.ui.calls.length > before, 'the banner was left undefended under below-input');
});
