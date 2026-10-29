/**
 * LOON-Pi: the pi-claude-code-tui startup header (MIT, see NOTICE), drawn from
 * the active theme and from gentle-pi's own configuration.
 *
 * It declares no theme of its own and touches no footer, spinner or editor. It
 * reads gentle-pi's files instead of importing a module of it, so the settings a
 * person changes in /gentle:customization also reach this header.
 */
import { VERSION, type ExtensionAPI, type ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { Component, TUI } from '@earendil-works/pi-tui';
import { renderBanner } from './lib/banner.ts';
import { watchConfigDirs } from './lib/config-watch.ts';
import {
	gentleConfigHome,
	readGentleSettings,
	sameGentleSettings,
	type GentleSettings,
} from './lib/gentle-config.ts';
import { collectPiCommandNames, formatCwd, formatModelLabel, pickSlashCommandTips } from './lib/layout.ts';
import {
	type AccentSource,
	type LoonSettings,
	piConfigHome,
	readLoonSettings,
	sameLoonSettings,
	writeLoonSettings,
} from './lib/loon-config.ts';
import { resolvePalette, type LoonTheme } from './lib/palette.ts';

/** Reapply the header, and turn the banner on. */
export const LOOK_COMMAND = 'use-loon-tui';
/** Turn the banner off and restore pi's own header, footer and spinner. */
export const RESTORE_COMMAND = 'use-default-tui';
/** The two settings gentle-pi's menu does not have. */
export const MENU_COMMAND = 'loon:tui';
/** Key of the widget drawn under the editor when gentle-pi asks for it. */
export const WIDGET_KEY = 'loon-header';

/**
 * Install on the next macrotask so pi has started its renderer, then watch the
 * header instead of guessing the boot time.
 *
 * Fixed re-assert delays do not survive a real start: the TUI only begins to
 * paint about two seconds in, so every timed re-assert burns during boot and an
 * extension that registers later (gentle-pi registers its banner ~50 ms after an
 * await readBannerConfig()) keeps the header. The watchdog re-asserts while our
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
 * The signal is measured: pi calls render on the installed header component, so
 * a render gap means the header on screen is not ours. Stopping after the first
 * paint is not safe — a competing extension registers its own header only after
 * its own awaits, and in a real start gentle-pi landed around 2.7 s, long after
 * our first paint at 1.9 s. The loop therefore watches the whole boot window.
 * Re-asserting stops as soon as a render follows a reclaim (our header is back),
 * and in any case at the ceiling; setHeader requests a render, so an assert never
 * needs an arbitrary wait to prove itself.
 *
 * The watchdog only runs while LOON owns the top slot: a banner drawn under the
 * editor has no competitor, and a disabled banner must never reclaim anything.
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
		// One re-assert per stale period: setHeader requests a render, so a fresh
		// render after an assert is the answer we wait for.
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
			exclude: [LOOK_COMMAND, MENU_COMMAND],
		}),
	};
}

interface HeaderDeps {
	/** Read per render: a re-install refreshes it without rebuilding the header. */
	snapshot(): HeaderSnapshot;
	/** Read per render so a file change lands on the next paint. */
	gentle(): GentleSettings;
	accent(): AccentSource;
	/** LOON's own mark switch, read per render. */
	mark(): boolean;
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
		const snapshot = this.deps.snapshot();
		const gentle = this.deps.gentle();
		const accentColor = this.deps.accent() === 'banner' ? gentle.accentColor : undefined;
		return renderBanner({
			width,
			version: snapshot.version,
			model: snapshot.model,
			effort: snapshot.effort,
			cwd: snapshot.cwd,
			tips: snapshot.tips,
			density: gentle.density,
			showLogo: this.deps.mark(),
			palette: resolvePalette(this.deps.theme(), { accentColor }),
		});
	}

	invalidate(): void {}
}

/** The two settings sources LOON follows, already read. */
export interface LoonState {
	loon: LoonSettings;
	gentle: GentleSettings;
}

/**
 * Everything LOON touches outside itself. The tests replace it so no test ever
 * reads or writes the real config homes.
 */
export interface LoonDeps {
	read(): LoonState;
	write(settings: LoonSettings): void;
	/** Report every change to either config home; returns the disposer. */
	watch(onChange: () => void): () => void;
	/** Seam for the tests: the watchdog's clock. */
	clock?: WatchdogClock;
}

export const defaultLoonDeps: LoonDeps = {
	read: () => ({ loon: readLoonSettings(piConfigHome()), gentle: readGentleSettings(gentleConfigHome()) }),
	write: (settings) => {
		writeLoonSettings(settings, piConfigHome());
	},
	watch: (onChange) => watchConfigDirs([gentleConfigHome(), piConfigHome()], onChange),
};

/** One sentence for notifications: what LOON is doing and why. */
function describe(state: LoonState): string {
	const banner = state.loon.enabled ? 'on' : 'off';
	const accent = state.loon.accent === 'theme' ? 'theme accent' : 'gentle-pi banner.json accent';
	return [
		`LOON banner ${banner}`,
		accent,
		`density ${state.gentle.density}`,
		`placement ${state.gentle.headerPlacement}`,
		state.loon.mark ? 'mark on' : 'mark off',
		`source ${state.loon.source}`,
	].join(' · ');
}

export function createLoonExtension(pi: ExtensionAPI, deps: LoonDeps): void {
	let state: LoonState | undefined;
	let snapshot: HeaderSnapshot | undefined;
	let timer: NodeJS.Timeout | undefined;
	let watchdog: HeaderWatchdog | undefined;
	let disposeWatch: (() => void) | undefined;
	/** What LOON currently owns, so it only ever clears its own slot. */
	let attached: 'none' | 'header' | 'widget' = 'none';
	const health: HeaderHealth = { lastRenderAt: 0 };

	const cancelPending = () => {
		if (timer !== undefined) clearTimeout(timer);
		timer = undefined;
	};
	const cancelWatchdog = () => {
		watchdog?.stop();
		watchdog = undefined;
	};

	/** Give back exactly the slot LOON took, and nothing else. */
	function release(ctx: ExtensionContext): void {
		if (ctx.mode !== 'tui') return;
		if (attached === 'header') ctx.ui.setHeader(undefined);
		if (attached === 'widget') ctx.ui.setWidget(WIDGET_KEY, undefined);
		attached = 'none';
	}

	/** True when LOON paints at all: on, and asked for by gentle-pi's banner source. */
	const loonPaints = () => state?.loon.enabled === true && state.loon.source === 'loon';

	/** True when LOON should own the top slot right now. */
	const ownsTopSlot = () => loonPaints() && state?.gentle.headerPlacement === 'top';

	/**
	 * Paint with the settings already in hand. Never reads the files: the caller
	 * decides when a re-read is due, so the watchdog cannot chase its own tail.
	 */
	function apply(ctx: ExtensionContext): boolean {
		if (ctx.mode !== 'tui' || !ctx.hasUI) return false;
		if (!state) return false;
		const { loon, gentle } = state;
		if (!snapshot) snapshot = takeSnapshot(pi, ctx);
		const current = snapshot;

		const header = (tui: TUI, fallbackTheme: LoonTheme) =>
			new LoonHeader({
				snapshot: () => current,
				gentle: () => state?.gentle ?? gentle,
				accent: () => state?.loon.accent ?? loon.accent,
				mark: () => state?.loon.mark ?? loon.mark,
				theme: () => ctx.ui.theme ?? fallbackTheme,
				health,
			});

		if (!loon.enabled || loon.source !== 'loon') {
			// Off, or gentle-pi's menu asked for its own banner (`rose`) or for none
			// (`off`): LOON gives the slot back and never reclaims it.
			cancelWatchdog();
			release(ctx);
			return false;
		}

		if (gentle.headerPlacement === 'below-input') {
			// gentle-pi's rule: the top slot stays free and the banner moves under
			// the editor, so its own banner keeps the top when it paints.
			cancelWatchdog();
			if (attached === 'header') ctx.ui.setHeader(undefined);
			ctx.ui.setWidget(WIDGET_KEY, header, { placement: 'belowEditor' });
			attached = 'widget';
			return true;
		}

		if (attached === 'widget') ctx.ui.setWidget(WIDGET_KEY, undefined);
		ctx.ui.setHeader(header);
		attached = 'header';
		return true;
	}

	/** Re-read both config homes and repaint, restarting the watchdog if needed. */
	function refresh(ctx: ExtensionContext, options: { refreshSnapshot?: boolean } = {}): boolean {
		cancelPending();
		health.lastRenderAt = 0;
		state = deps.read();
		if (options.refreshSnapshot) snapshot = undefined;
		const applied = apply(ctx);
		cancelWatchdog();
		if (applied && ownsTopSlot()) {
			watchdog = new HeaderWatchdog(() => apply(ctx), health, deps.clock ?? systemClock);
			watchdog.start();
		}
		return applied;
	}

	function detach(ctx: ExtensionContext, restorePi: boolean): void {
		cancelPending();
		cancelWatchdog();
		attached = 'none';
		if (ctx.mode !== 'tui') return;
		ctx.ui.setHeader(undefined);
		ctx.ui.setWidget(WIDGET_KEY, undefined);
		if (restorePi) {
			ctx.ui.setFooter(undefined);
			ctx.ui.setWorkingIndicator(undefined);
		}
	}

	function persist(next: LoonSettings): void {
		deps.write(next);
		state = state ? { loon: next, gentle: state.gentle } : { loon: next, gentle: deps.read().gentle };
	}

	async function openMenu(ctx: ExtensionContext): Promise<void> {
		for (;;) {
			const current = deps.read();
			const bannerOption = `Banner: ${current.loon.enabled ? 'on' : 'off'}`;
			const accentOption = `Accent: ${current.loon.accent === 'theme' ? 'theme' : 'gentle-pi banner.json'}`;
			const markOption = `Mark: ${current.loon.mark ? 'on' : 'off'}`;
			const closeOption = 'Close';
			const choice = await ctx.ui.select('LOON banner', [bannerOption, accentOption, markOption, closeOption]);
			if (!choice || choice === closeOption) return;

			const next: LoonSettings =
				choice === bannerOption
					? { ...current.loon, enabled: !current.loon.enabled }
					: choice === accentOption
						? { ...current.loon, accent: current.loon.accent === 'theme' ? 'banner' : 'theme' }
						: { ...current.loon, mark: !current.loon.mark };
			persist(next);
			refresh(ctx);
			ctx.ui.notify(describe({ loon: next, gentle: current.gentle }), 'info');
		}
	}

	pi.on('session_start', (_event, ctx) => {
		// One macrotask after the event: pi has started its renderer by then.
		cancelPending();
		health.lastRenderAt = 0;
		timer = setTimeout(() => {
			timer = undefined;
			refresh(ctx);
			// Follow the files for the rest of the session, so a change made in
			// gentle-pi's own menu lands without restarting pi.
			disposeWatch?.();
			disposeWatch = deps.watch(() => {
				const next = deps.read();
				if (state && sameLoonSettings(state.loon, next.loon) && sameGentleSettings(state.gentle, next.gentle)) return;
				refresh(ctx);
			});
		}, 0);
		timer.unref?.();
	});

	pi.on('session_shutdown', () => {
		cancelPending();
		cancelWatchdog();
		disposeWatch?.();
		disposeWatch = undefined;
		state = undefined;
		snapshot = undefined;
	});

	pi.registerCommand(LOOK_COMMAND, {
		description: 'Apply the LOON startup header and turn the banner on',
		handler: async (_args, ctx) => {
			persist({ ...(state?.loon ?? deps.read().loon), enabled: true });
			const applied = refresh(ctx, { refreshSnapshot: true });
			ctx.ui.notify(applied ? 'LOON header applied' : 'LOON header could not be applied', applied ? 'info' : 'warning');
		},
	});

	pi.registerCommand(RESTORE_COMMAND, {
		description: "Turn the banner off and restore pi's own header, footer and spinner",
		handler: async (_args, ctx) => {
			persist({ ...(state?.loon ?? deps.read().loon), enabled: false });
			detach(ctx, true);
			ctx.ui.notify('Using the default pi TUI', 'info');
		},
	});

	pi.registerCommand(MENU_COMMAND, {
		description: 'LOON banner settings: on or off, and where the accent comes from',
		handler: async (args, ctx) => {
			const [verb = '', value = ''] = String(args ?? '').trim().split(/\s+/).filter(Boolean);
			const current = deps.read();

			if (verb === 'status') {
				ctx.ui.notify(describe(current), 'info');
				return;
			}
			if (verb === 'on' || verb === 'off') {
				persist({ ...current.loon, enabled: verb === 'on' });
				refresh(ctx);
				ctx.ui.notify(describe(deps.read()), 'info');
				return;
			}
			if (verb === 'accent' && (value === 'theme' || value === 'banner')) {
				persist({ ...current.loon, accent: value });
				refresh(ctx);
				ctx.ui.notify(describe(deps.read()), 'info');
				return;
			}
			if (verb === 'mark' && (value === 'on' || value === 'off')) {
				persist({ ...current.loon, mark: value === 'on' });
				refresh(ctx);
				ctx.ui.notify(describe(deps.read()), 'info');
				return;
			}
			if (verb) {
				ctx.ui.notify('Usage: /loon:tui [on|off|accent theme|accent banner|mark on|mark off|status]', 'warning');
				return;
			}
			await openMenu(ctx);
		},
	});
}

export default function loonPi(pi: ExtensionAPI): void {
	createLoonExtension(pi, defaultLoonDeps);
}
