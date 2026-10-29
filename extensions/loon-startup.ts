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
 * Install on the next macrotask so pi has started its renderer, then
 * re-assert: gentle-pi registers its own banner after an `await`, so its
 * `setHeader` can land after ours and win. The header is static, so
 * re-asserting repaints the same rows.
 */
const INSTALL_DELAYS_MS = [0, 120, 400] as const;

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
}

class LoonHeader implements Component {
	private readonly deps: HeaderDeps;

	constructor(deps: HeaderDeps) {
		this.deps = deps;
	}

	render(width: number): string[] {
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
let timers: NodeJS.Timeout[] = [];

function cancelTimers(): void {
	for (const timer of timers) clearTimeout(timer);
	timers = [];
}

function install(pi: ExtensionAPI, ctx: ExtensionContext, refreshSnapshot = false): boolean {
	if (ctx.mode !== 'tui' || !ctx.hasUI) return false;
	if (refreshSnapshot || !snapshot) snapshot = takeSnapshot(pi, ctx);
	const current = snapshot;

	ctx.ui.setHeader((tui: TUI, fallbackTheme: LoonTheme) =>
		new LoonHeader({
			snapshot: current,
			theme: () => ctx.ui.theme ?? fallbackTheme,
		}),
	);
	return true;
}

function restoreNative(ctx: ExtensionContext): void {
	cancelTimers();
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
		snapshot = undefined;
	});

	pi.registerCommand(LOOK_COMMAND, {
		description: 'Apply the LOON startup header',
		handler: async (_args, ctx) => {
			cancelTimers();
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
