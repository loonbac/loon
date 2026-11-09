/**
 * LOON-Pi: the pi-claude-code-tui startup header (MIT, see NOTICE), drawn from
 * the active theme and from gentle-pi's own configuration.
 *
 * It declares no theme of its own and touches no footer, spinner or editor. It
 * reads gentle-pi's files instead of importing a module of it, so the settings a
 * person changes in /gentle:customization also reach this header.
 */
import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { VERSION, type ExtensionAPI, type ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { Component, TUI } from '@earendil-works/pi-tui';
import { renderBanner } from './lib/banner.ts';
import { watchConfigDirs } from './lib/config-watch.ts';
import { repairPatchViaScript, type RepairReport } from './lib/patch-repair-write.ts';
import {
	accentPath,
	accentWatchDirs,
	readAccentFrom,
	wallpaperAccentPath,
} from './lib/wallpaper-accent.ts';
import { ensureWallpaperTheme, themesDir, type EnsureOutcome } from './lib/theme-file.ts';
import {
	gentleConfigHome,
	readGentleSettings,
	sameGentleSettings,
	type GentleSettings,
} from './lib/gentle-config.ts';
import { collectPiCommandNames, formatCwd, formatModelLabel, pickSlashCommandTips } from './lib/layout.ts';
import { PATCH_NOTICE_KEY, installedGentlePi, missingPatches, patchNoticeText, repoRootOf } from './lib/patch-notice.ts';
import {
	ACCENT_SOURCES,
	type AccentSource,
	type LoonSettings,
	piConfigHome,
	readLoonSettings,
	sameLoonSettings,
	writeLoonSettings,
} from './lib/loon-config.ts';
import { resolvePalette, type LoonTheme } from './lib/palette.ts';
import { ACCENT_RGB, type Rgb } from './lib/accent.ts';

/** Key of the widget drawn under the editor when gentle-pi asks for it. */
export const WIDGET_KEY = 'loon-header';

/** True when two parsed accents would paint the same colour. */
export function sameRgb(a: Rgb | undefined, b: Rgb | undefined): boolean {
	if (a === undefined || b === undefined) return a === b;
	return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}
/**
 * Which RGB the accent roles get, for one setting:
 *
 * - `theme` keeps the theme's own accent (undefined here);
 * - `banner` follows gentle-pi's `banner.json` colour, falling back to the theme;
 * - `wallpaper` follows the wallpaper accent, falling back to the theme when the
 *   file is missing, unreadable or malformed - never black, never a crash.
 */
export function resolveAccentRgb(
	source: AccentSource,
	bannerRgb: Rgb | undefined,
	wallpaperRgb: Rgb | undefined,
): Rgb | undefined {
	if (source === 'theme') return undefined;
	if (source === 'wallpaper') return wallpaperRgb;
	return bannerRgb;
}


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
		tips: pickSlashCommandTips(collectPiCommandNames(pi.getCommands()), { count: 3 }),
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
	/** The configured accent file, read per render so a change lands on the next paint. */
	accentFile(): string;
	/**
	 * The accent of the *selected* source, already parsed: the configured `accentFile`
	 * for `file`, the wallpaper script's own file for `wallpaper`. Undefined falls back
	 * to the theme, which is what a machine with neither gets.
	 */
	wallpaper(settings: Pick<LoonSettings, 'accent' | 'accentFile'>): Rgb | undefined;
	/** Read per render so a theme change is picked up without reinstalling. */
	theme(): LoonTheme & { name?: string };
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
		const bannerRgb = gentle.accentColor === undefined ? undefined : ACCENT_RGB[gentle.accentColor];
		const theme = this.deps.theme();
		const accent = this.deps.accent();
		const accentFile = this.deps.accentFile();
		const wallpaperRgb = this.deps.wallpaper({ accent, accentFile });
		// The setting alone decides, whatever theme is active: a shortcut that made the
		// generated theme follow the wallpaper left `accent: theme` with no effect at all,
		// and it went stale the moment the generated theme lifted its accent for contrast.
		// Derived at paint time; the setting file is never rewritten for it.
		const accentRgb = resolveAccentRgb(accent, bannerRgb, wallpaperRgb);
		return renderBanner({
			width,
			version: snapshot.version,
			model: snapshot.model,
			effort: snapshot.effort,
			cwd: snapshot.cwd,
			tips: snapshot.tips,
			density: gentle.density,
			showLogo: this.deps.mark(),
			palette: resolvePalette(theme, { accentRgb }),
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
	/**
	 * Which patch targets lost their LOON marker, read-only. Undefined means "do not
	 * ask": a session without the package has nothing to report.
	 */
	patchMissing?(): string[];
	/**
	 * Re-apply the patch when a gentle-pi or pi update replaced the files it edits.
	 * Called at most once per process, from session start, never from a render: installing
	 * LOON is the consent, and this is what makes that consent survive an update.
	 */
	patchRepair?(): RepairReport;
	write(settings: LoonSettings): void;
	/** Report every change to either config home or the accent file's; returns the disposer. */
	watch(onChange: () => void, settings: Pick<LoonSettings, 'accent' | 'accentFile'>): () => void;
	/**
	 * The accent of the source the settings select, parsed. Undefined falls back to the
	 * theme. The settings are the argument because the path depends on `accent` and
	 * `accentFile`, and a reader bound at construction would freeze the old path.
	 */
	wallpaper(settings: Pick<LoonSettings, 'accent' | 'accentFile'>): Rgb | undefined;
	/**
	 * Make sure the generated theme exists, matches this accent, and is named for the
	 * active theme pi is showing. The active name is a parameter because the file has to
	 * carry it: pi activates the theme its settings name, not the one LOON writes.
	 */
	ensureTheme(accent: Rgb | undefined, settings: Pick<LoonSettings, 'accent' | 'accentFile'>, activeTheme?: unknown): EnsureOutcome;
	/** Seam for the tests: the watchdog's clock. */
	clock?: WatchdogClock;
}

/**
 * The mtime the theme freshness check compares against. A source that reads no file has
 * no mtime, and `undefined` is exactly what "always regenerate" means there.
 */
function modifiedAtOf(path: string | undefined): number | undefined {
	return path === undefined ? undefined : accentModifiedAt(path);
}

export const defaultLoonDeps: LoonDeps = {
	read: () => ({ loon: readLoonSettings(piConfigHome()), gentle: readGentleSettings(gentleConfigHome()) }),
	write: (settings) => {
		writeLoonSettings(settings, piConfigHome());
	},
	wallpaper: (settings) => readAccentFrom(accentPath(settings)),
	// Read-only by construction: the notice never writes into the package, because a
	// write during session start is exactly how a half-finished update goes silent.
	patchMissing: () => {
		const install = installedGentlePi();
		return install === undefined ? [] : missingPatches(install);
	},
	patchRepair: () => {
		const install = installedGentlePi();
		if (install === undefined) return { applied: [], problems: [] };
		// Nothing to repair is the common case, and it must cost one comparison, not a
		// process. Only a marker that is actually gone pays for running the script.
		if (missingPatches(install).length === 0) return { applied: [], problems: [] };
		const script = join(repoRootOf(import.meta.url), 'scripts', 'gentle-pi-patch.ts');
		return repairPatchViaScript(
			{ install, backups: join(homedir(), '.pi', 'agent', 'backups'), script },
			(command, args, options) => execFileSync(command, args, options) as unknown as {
				status: number | null;
				stdout?: string;
				stderr?: string;
			},
		);
	},
	ensureTheme: (accent, settings, activeTheme) =>
		ensureWallpaperTheme({
			accent,
			dir: themesDir(),
			accentModifiedAt: modifiedAtOf(accentPath(settings)),
			activeTheme,
		}),
	// The wallpaper script replaces accent.txt atomically, so its inode changes on
	// every wallpaper: the directory is watched, never the file.
	watch: (onChange, settings) =>
		watchConfigDirs([gentleConfigHome(), piConfigHome(), ...accentWatchDirs(settings)], onChange),
};

export function createLoonExtension(pi: ExtensionAPI, deps: LoonDeps): void {
	let state: LoonState | undefined;
	let snapshot: HeaderSnapshot | undefined;
	let timer: NodeJS.Timeout | undefined;
	let watchdog: HeaderWatchdog | undefined;
	let disposeWatch: (() => void) | undefined;
	/** What LOON currently owns, so it only ever clears its own slot. */
	let attached: 'none' | 'header' | 'widget' = 'none';
	/** The wallpaper accent, parsed once per read and reused for every render. */
	let wallpaperRgb: Rgb | undefined;
	const health: HeaderHealth = { lastRenderAt: 0 };
	let repairAttempted = false;
	let repairReport: RepairReport | undefined;

	const cancelPending = () => {
		if (timer !== undefined) clearTimeout(timer);
		timer = undefined;
	};
	const cancelWatchdog = () => {
		watchdog?.stop();
		watchdog = undefined;
	};

	/**
	 * Say, in a status key that survives the scrollback, that the patch is gone — and
	 * say what to run. It clears itself the moment the markers are back, so a stale
	 * notice can never keep claiming a loss that was repaired.
	 */
	/**
	 * Repair once per process, and remember what happened.
	 *
	 * The guard is a module-level flag rather than a closure one because a second
	 * `session_start` in the same process — a reload does exactly that — must not stage the
	 * same files twice. A repair that threw would be a startup failure, so it cannot throw:
	 * the report carries the problem and the session carries on.
	 */
	function repairOnce(): RepairReport | undefined {
		if (repairAttempted) return repairReport;
		repairAttempted = true;
		try {
			repairReport = deps.patchRepair?.() ?? { applied: [], problems: [] };
		} catch (error) {
			repairReport = {
				applied: [],
				problems: ['patch repair failed: ' + (error instanceof Error ? error.message : String(error))],
			};
		}
		return repairReport;
	}

	function announcePatch(ctx: ExtensionContext): void {
		if (ctx.mode !== 'tui' || !ctx.hasUI) return;
		// A host without status keys has nowhere to put the notice; say nothing rather than
		// fail the session over a message.
		if (typeof ctx.ui.setStatus !== 'function') return;
		const clear = (): void => {
			try {
				ctx.ui.setStatus(PATCH_NOTICE_KEY, undefined);
			} catch {
				// Giving up on a notice must never take the session with it.
			}
		};
		try {
			const missing = deps.patchMissing?.() ?? [];
			if (missing.length === 0) {
				clear();
				return;
			}
			ctx.ui.setStatus(PATCH_NOTICE_KEY, patchNoticeText(missing, repoRootOf(import.meta.url)));
		} catch {
			clear();
		}
	}

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
	/** True when LOON should own the header slot: painting is the whole condition. */
	const ownsTopSlot = () => loonPaints();

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
				accentFile: () => state?.loon.accentFile ?? loon.accentFile,
				wallpaper: () => wallpaperRgb,
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

		// The banner lives in pi's header slot, always. gentle-pi's `headerPlacement`
		// moves *its own* bar under the editor; it never moved pi's header, and the
		// banner used to follow it into a `belowEditor` widget, which is what made the
		// two look like one piece that slid down. The bar moves, the banner does not.
		if (attached === 'widget') ctx.ui.setWidget(WIDGET_KEY, undefined);
		ctx.ui.setHeader(header);
		attached = 'header';
		return true;
	}

	/** Re-read both config homes and repaint, restarting the watchdog if needed. */
	function refresh(ctx: ExtensionContext): boolean {
		cancelPending();
		health.lastRenderAt = 0;
		state = deps.read();
		// S9: sin parche no se pinta. Si la reparación se negó (anchors que ya no
		// encajan), la sesión sigue pero LOON no instala su header ni regenera el
		// tema: pintar sobre una barra stock es lo que se veía roto. El aviso de
		// patch-notice ya dijo el archivo y el motivo; en cuanto los marcadores
		// vuelven, este mismo refresh los detecta y LOON vuelve sin reiniciar.
		// Una lectura que falla también cierra: un arranque nunca se impide (S7).
		let missing: string[];
		try {
			missing = deps.patchMissing?.() ?? [];
		} catch {
			missing = ['unreadable'];
		}
		if (missing.length > 0) {
			cancelWatchdog();
			release(ctx);
			return false;
		}
		const currentSettings = state.loon;
		wallpaperRgb = deps.wallpaper(currentSettings);
		// Regenerate the theme when it is missing or older than the accent it came
		// from; on a wallpaper change this runs again, which is what makes the open
		// session recolour through pi's own theme watcher. The active theme's name is
		// passed through because pi activates the theme its settings name: a generated
		// file for `Wallpaper` on a `Gruvbox` install is written and never seen.
		deps.ensureTheme(wallpaperRgb, currentSettings, ctx.ui.theme?.name);
		const applied = apply(ctx);
		cancelWatchdog();
		if (applied && ownsTopSlot()) {
			watchdog = new HeaderWatchdog(() => apply(ctx), health, deps.clock ?? systemClock);
			watchdog.start();
		}
		return applied;
	}

	pi.on('session_start', (_event, ctx) => {
		// One macrotask after the event: pi has started its renderer by then.
		cancelPending();
		health.lastRenderAt = 0;
		timer = setTimeout(() => {
			timer = undefined;
			// The repair is not a notice: it runs before anything is drawn, on every start and
			// whatever the host is. An update to gentle-pi or to pi removes the markers, and
			// the next start puts them back; a headless start must do it too, so it cannot
			// live inside `announcePatch`, which returns early without a status key.
			repairOnce();
			announcePatch(ctx);
			refresh(ctx);
			// Follow the files for the rest of the session, so a change made in
			// gentle-pi's own menu lands without restarting pi.
			disposeWatch?.();
			disposeWatch = deps.watch(() => {
				const next = deps.read();
				const nextWallpaper = deps.wallpaper(next.loon);
				const sameSettings = state !== undefined && sameLoonSettings(state.loon, next.loon) && sameGentleSettings(state.gentle, next.gentle);
				if (sameSettings && sameRgb(wallpaperRgb, nextWallpaper)) return;
				refresh(ctx);
			}, state?.loon ?? deps.read().loon);
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
}

/** mtime in milliseconds, or undefined when the file is not there. */
export function accentModifiedAt(path: string): number | undefined {
	try {
		return statSync(path).mtimeMs;
	} catch {
		return undefined;
	}
}

export default function loonPi(pi: ExtensionAPI): void {
	createLoonExtension(pi, defaultLoonDeps);
}
