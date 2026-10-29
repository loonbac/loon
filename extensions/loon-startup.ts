/**
 * LOON-Pi: a theme-aware startup banner for pi.
 *
 * The banner is pi-claude-code-tui's header (MIT, see NOTICE) with every
 * colour resolved from the active theme, so it reads correctly with the
 * gentle-pi themes and with any other theme. It declares no theme of its own.
 */
import { VERSION, type ExtensionAPI, type ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { Component, TUI } from '@earendil-works/pi-tui';
import { createLogoClock, type LogoClock } from './lib/animation.ts';
import { renderBanner } from './lib/banner.ts';
import { collectPiCommandNames, formatCwd, formatModelLabel, pickSlashCommandTips } from './lib/layout.ts';
import { resolvePalette, type LoonTheme } from './lib/palette.ts';

/** Reapply the LOON look. */
export const LOOK_COMMAND = 'loon:look';
/** Restore pi's own header, footer and spinner. */
export const RESTORE_COMMAND = 'loon:default';

/**
 * Install on the next macrotask so pi has started its renderer, then
 * re-assert: gentle-pi registers its own banner after an `await`, so its
 * `setHeader` can land after ours and win. Re-asserting is invisible because
 * the animation clock keeps its frame instead of restarting.
 */
const INSTALL_DELAYS_MS = [0, 120, 400] as const;

interface BannerSnapshot {
	version: string;
	model: string;
	effort: string;
	cwd: string;
	tips: string[];
}

function takeSnapshot(pi: ExtensionAPI, ctx: ExtensionContext): BannerSnapshot {
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
	tui: TUI;
	snapshot: BannerSnapshot;
	clock: LogoClock;
	/** Read per render so a theme change is picked up without reinstalling. */
	theme(): LoonTheme;
}

class LoonStartupHeader implements Component {
	private readonly deps: HeaderDeps;

	constructor(deps: HeaderDeps) {
		this.deps = deps;
	}

	render(width: number): string[] {
		return renderBanner({
			width,
			frame: this.deps.clock.getFrame(),
			version: this.deps.snapshot.version,
			model: this.deps.snapshot.model,
			effort: this.deps.snapshot.effort,
			cwd: this.deps.snapshot.cwd,
			tips: this.deps.snapshot.tips,
			palette: resolvePalette(this.deps.theme()),
		});
	}

	invalidate(): void {}

	dispose(): void {
		this.deps.clock.attach(undefined);
	}
}

let clock: LogoClock | undefined;
let snapshot: BannerSnapshot | undefined;
let timers: NodeJS.Timeout[] = [];

function cancelTimers(): void {
	for (const timer of timers) clearTimeout(timer);
	timers = [];
}

function install(pi: ExtensionAPI, ctx: ExtensionContext, refreshSnapshot = false): boolean {
	if (ctx.mode !== 'tui' || !ctx.hasUI) return false;
	if (refreshSnapshot || !snapshot) snapshot = takeSnapshot(pi, ctx);
	const current = snapshot;
	const bannerClock = (clock ??= createLogoClock());

	ctx.ui.setHeader((tui, fallbackTheme) => {
		bannerClock.attach(tui);
		return new LoonStartupHeader({
			tui,
			snapshot: current,
			clock: bannerClock,
			theme: () => ctx.ui.theme ?? fallbackTheme,
		});
	});
	return true;
}

function restoreNative(ctx: ExtensionContext): void {
	cancelTimers();
	clock?.dispose();
	clock = undefined;
	snapshot = undefined;
	if (ctx.mode !== 'tui') return;
	ctx.ui.setHeader(undefined);
	ctx.ui.setFooter(undefined);
	ctx.ui.setWorkingIndicator(undefined);
}

function scheduleInstall(pi: ExtensionAPI, ctx: ExtensionContext): void {
	cancelTimers();
	for (const delay of INSTALL_DELAYS_MS) {
		const timer = setTimeout(() => install(pi, ctx), delay);
		timer.unref?.();
		timers.push(timer);
	}
}

export default function loonPi(pi: ExtensionAPI): void {
	pi.on('session_start', (_event, ctx) => {
		scheduleInstall(pi, ctx);
	});

	pi.on('session_shutdown', () => {
		cancelTimers();
		clock?.dispose();
		clock = undefined;
		snapshot = undefined;
	});

	pi.registerCommand(LOOK_COMMAND, {
		description: 'Apply the LOON startup banner',
		handler: async (_args, ctx) => {
			cancelTimers();
			if (install(pi, ctx, true)) ctx.ui.notify('LOON banner applied', 'info');
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
