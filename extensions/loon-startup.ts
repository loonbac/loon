/**
 * LOON-Pi: a theme-aware startup header for pi, and nothing else.
 *
 * The header is the pi-claude-code-tui box (MIT, see NOTICE) with the layout,
 * the static Pi mark and every colour taken from the active theme. It declares
 * no theme of its own and touches no footer, spinner or editor.
 */
import { VERSION, type ExtensionAPI, type ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { Component, TUI } from '@earendil-works/pi-tui';
import { renderBanner } from './lib/banner.ts';
import { collectPiCommandNames, formatCwd, formatModelLabel, pickSlashCommandTips } from './lib/layout.ts';
import { resolvePalette, type LoonTheme } from './lib/palette.ts';

/** Reapply the header. */
export const LOOK_COMMAND = 'use-loon-tui';
/** Restore pi's own header, footer and spinner. */
export const RESTORE_COMMAND = 'use-default-tui';

/**
 * Install on the next macrotask so pi has started its renderer, then watch the
 * header instead of guessing the boot time.
 *
 * Fixed re-assert delays do not survive a real start: the TUI only begins to
 * paint about two seconds in, so every timed re-assert burns during boot and an
 * extension that registers later (gentle-pi registers its banner ~50 ms after an
 * `await readBannerConfig()`) keeps the header. The watchdog re-asserts while our
 * component is not being rendered and stops once it is, so no boot duration is
 * assumed.
 */
export interface HeaderHealth {
	/** When pi last called our component's render; 0 means never. */
	lastRenderAt: number;
}

/** Watchdog timing: a short tick, a boot-sized ceiling, one second of slack. */
export const WATCHDOG_CONFIG = {
	/** How often the watchdog looks. */
	tickMs: 250,
	/** Ceiling: stop watching even if the header never paints or keeps losing. */
	windowMs: 10_000,
	/** A render older than this means the header on screen is not ours. */
	staleMs: 1_000,
} as const;

export interface WatchdogClock {
	now(): number;
	setInterval(callback: () => void, ms: number): unknown;
	clearInterval(handle: unknown): void;
}

const systemClock: WatchdogClock = {
	now: () => Date.now(),
	setInterval: (callback, ms) => {
		const handle = setInterval(callback, ms);
		handle.unref?.();
		return handle;
	},
	clearInterval: (handle) => clearInterval(handle as NodeJS.Timeout),
};

/**
 * Re-asserts the header whenever our component stops being rendered.
 *
 * The signal is measured: pi calls `render` on the installed header component,
 * so a render gap means the header on screen is not ours. Stopping after the
 * first paint is not safe — a competing extension registers its own header only
 * after its own awaits, and in a real start gentle-pi landed around 2.7 s, long
 * after our first paint at 1.9 s. The loop therefore watches the whole boot
 * window. Re-asserting stops as soon as a render follows a reclaim (our header
 * is back), and in any case at the ceiling; `setHeader` requests a render, so an
 * assert never needs an arbitrary wait to prove itself.
 */
export class HeaderWatchdog {
	private readonly assert: () => void;
	private readonly health: HeaderHealth;
	private readonly clock: WatchdogClock;
	private readonly config: typeof WATCHDOG_CONFIG;
	private handle: unknown;
	private startedAt = 0;
	private lastAssertAt = 0;
	/** Set once a re-assert follows a paint: the next render proves the reclaim. */
	private awaitingReclaim = false;

	constructor(
		assert: () => void,
		health: HeaderHealth,
		clock: WatchdogClock = systemClock,
		config: typeof WATCHDOG_CONFIG = WATCHDOG_CONFIG,
	) {
		this.assert = assert;
		this.health = health;
		this.clock = clock;
		this.config = config;
	}

	start(): void {
		this.stop();
		this.startedAt = this.clock.now();
		this.lastAssertAt = this.startedAt;
		this.handle = this.clock.setInterval(() => this.tick(), this.config.tickMs);
	}

	stop(): void {
		if (this.handle === undefined) return;
		this.clock.clearInterval(this.handle);
		this.handle = undefined;
	}

	/** One check; public so the test drives the loop without real timers. */
	tick(): void {
		const now = this.clock.now();
		if (now - this.startedAt >= this.config.windowMs) {
			this.stop();
			return;
		}

		// A render after a reclaim proves our header is back on screen.
		if (this.awaitingReclaim && this.health.lastRenderAt >= this.lastAssertAt) {
			this.stop();
			return;
		}

		if (now - this.health.lastRenderAt < this.config.staleMs) return;
		// One re-assert per stale period: `setHeader` requests a render, so a
		// fresh render after an assert is the answer we wait for.
		if (now - this.lastAssertAt < this.config.staleMs) return;

		this.lastAssertAt = now;
		this.awaitingReclaim = this.health.lastRenderAt > 0;
		this.assert();
	}
}

interface HeaderSnapshot {
	version: string;
	model: string;
	effort: string;
	cwd: string;
	tips: string[];
}

/**
 * Everything the header shows, taken once per install so the tips do not
 * shuffle: the restore command first, then three real commands of this pi.
 */
function takeSnapshot(pi: ExtensionAPI, ctx: ExtensionContext): HeaderSnapshot {
	return {
		version: VERSION,
		model: formatModelLabel(ctx.model),
		effort: pi.getThinkingLevel(),
		cwd: formatCwd(ctx.cwd),
		tips: pickSlashCommandTips(collectPiCommandNames(pi.getCommands()), {
			fixed: [RESTORE_COMMAND],
			count: 3,
			exclude: [LOOK_COMMAND],
		}),
	};
}

interface HeaderDeps {
	snapshot: HeaderSnapshot;
	/** Read per render so a theme change is picked up without reinstalling. */
	theme(): LoonTheme;
	/** Shared with the watchdog: a render is the proof that we own the header. */
	health: HeaderHealth;
}

class LoonHeader implements Component {
	private readonly deps: HeaderDeps;

	constructor(deps: HeaderDeps) {
		this.deps = deps;
	}

	render(width: number): string[] {
		this.deps.health.lastRenderAt = Date.now();
		const { snapshot } = this.deps;
		return renderBanner({
			width,
			version: snapshot.version,
			model: snapshot.model,
			effort: snapshot.effort,
			cwd: snapshot.cwd,
			tips: snapshot.tips,
			palette: resolvePalette(this.deps.theme()),
		});
	}

	invalidate(): void {}
}

let snapshot: HeaderSnapshot | undefined;
let timer: NodeJS.Timeout | undefined;
let watchdog: HeaderWatchdog | undefined;
const health: HeaderHealth = { lastRenderAt: 0 };

function cancelInstall(): void {
	watchdog?.stop();
	watchdog = undefined;
	if (timer !== undefined) clearTimeout(timer);
	timer = undefined;
}

function install(pi: ExtensionAPI, ctx: ExtensionContext, refreshSnapshot = false): boolean {
	if (ctx.mode !== 'tui' || !ctx.hasUI) return false;
	if (refreshSnapshot || !snapshot) snapshot = takeSnapshot(pi, ctx);
	const current = snapshot;

	ctx.ui.setHeader((tui: TUI, fallbackTheme: LoonTheme) =>
		new LoonHeader({
			snapshot: current,
			theme: () => ctx.ui.theme ?? fallbackTheme,
			health,
		}),
	);
	return true;
}

function restoreNative(ctx: ExtensionContext): void {
	cancelInstall();
	snapshot = undefined;
	if (ctx.mode !== 'tui') return;
	ctx.ui.setHeader(undefined);
	ctx.ui.setFooter(undefined);
	ctx.ui.setWorkingIndicator(undefined);
}

function scheduleInstall(pi: ExtensionAPI, ctx: ExtensionContext): void {
	cancelInstall();
	health.lastRenderAt = 0;
	timer = setTimeout(() => {
		timer = undefined;
		if (!install(pi, ctx)) return;
		watchdog = new HeaderWatchdog(() => install(pi, ctx), health);
		watchdog.start();
	}, 0);
	timer.unref?.();
}

export default function loonPi(pi: ExtensionAPI): void {
	pi.on('session_start', (_event, ctx) => {
		scheduleInstall(pi, ctx);
	});

	pi.on('session_shutdown', () => {
		cancelInstall();
		snapshot = undefined;
	});

	pi.registerCommand(LOOK_COMMAND, {
		description: 'Apply the LOON startup header',
		handler: async (_args, ctx) => {
			cancelInstall();
			health.lastRenderAt = 0;
			if (install(pi, ctx, true)) ctx.ui.notify('LOON header applied', 'info');
		},
	});

	pi.registerCommand(RESTORE_COMMAND, {
		description: "Restore pi's own header, footer and spinner",
		handler: async (_args, ctx) => {
			restoreNative(ctx);
			ctx.ui.notify('Using the default pi TUI', 'info');
		},
	});
}
