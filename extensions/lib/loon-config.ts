/**
 * LOON's own settings: the banner switch and where the accent comes from.
 *
 * These are the two things gentle-pi's menu does not offer, so they live in a
 * small file of our own under pi's config home. A missing or unreadable file is
 * not an error: it means the defaults.
 */
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Where pi keeps its own agent configuration. */
export function piConfigHome(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
	return env.PI_CODING_AGENT_DIR || join(home, '.pi', 'agent');
}

export const LOON_CONFIG_FILE_NAME = 'loon-tui.json';

/**
 * Where the accent comes from: the theme itself, gentle-pi's `banner.json` colour,
 * or the wallpaper accent published by the desktop. `banner` stays the default, so
 * a colour already chosen in gentle-pi's menu is honoured.
 */
export const ACCENT_SOURCES = ['theme', 'banner', 'wallpaper'] as const;

export type AccentSource = (typeof ACCENT_SOURCES)[number];

/**
 * Who paints the startup banner, as written by gentle-pi's own menu once the
 * patch in `scripts/gentle-pi-patch.ts` is applied.
 *
 * `loon` is the default and today's behaviour; `rose` hands the header to
 * gentle-pi's banner; `off` leaves pi's own header. The setting lives here rather
 * than in `banner.json` because gentle-pi rewrites that file with its own three
 * keys and would drop it.
 */
export const BANNER_SOURCES = ['loon', 'rose', 'off'] as const;

export type BannerSource = (typeof BANNER_SOURCES)[number];

export interface LoonSettings {
	/** When false, LOON paints nothing and never reclaims the header. */
	enabled: boolean;
	accent: AccentSource;
	/** The Pi mark. LOON's own switch: gentle-pi's `showTextLogo` is not this. */
	mark: boolean;
	/** Who paints the banner. LOON paints only when this is `loon`. */
	source: BannerSource;
}

/**
 * gentle-pi's `banner.json` already carries a colour the person picked in its own
 * menu, so that colour wins until someone asks for the theme's accent instead.
 */
export const DEFAULT_LOON_SETTINGS: LoonSettings = { enabled: true, accent: 'banner', mark: true, source: 'loon' };

export function loonConfigPath(home: string): string {
	return join(home, LOON_CONFIG_FILE_NAME);
}

function record(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Parse the file tolerantly: any field that does not validate falls back. */
export function parseLoonSettings(raw: string | undefined): LoonSettings {
	if (raw === undefined) return { ...DEFAULT_LOON_SETTINGS };
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return { ...DEFAULT_LOON_SETTINGS };
	}
	if (!record(parsed)) return { ...DEFAULT_LOON_SETTINGS };

	const enabled = typeof parsed.enabled === 'boolean' ? parsed.enabled : DEFAULT_LOON_SETTINGS.enabled;
	const accent =
		typeof parsed.accent === 'string' && (ACCENT_SOURCES as readonly string[]).includes(parsed.accent)
			? (parsed.accent as AccentSource)
			: DEFAULT_LOON_SETTINGS.accent;
	const mark = typeof parsed.mark === 'boolean' ? parsed.mark : DEFAULT_LOON_SETTINGS.mark;
	const source =
		typeof parsed.source === 'string' && (BANNER_SOURCES as readonly string[]).includes(parsed.source)
			? (parsed.source as BannerSource)
			: DEFAULT_LOON_SETTINGS.source;
	return { enabled, accent, mark, source };
}

export function readLoonSettings(home: string): LoonSettings {
	try {
		return parseLoonSettings(readFileSync(loonConfigPath(home), 'utf8'));
	} catch {
		return { ...DEFAULT_LOON_SETTINGS };
	}
}

/**
 * Write atomically: a temporary file in the same directory, then a rename, so a
 * reader never sees half a file. Returns the path written.
 */
export function writeLoonSettings(settings: LoonSettings, home: string): string {
	const path = loonConfigPath(home);
	const temporary = `${path}.${process.pid}.tmp`;
	mkdirSync(home, { recursive: true });
	try {
		writeFileSync(temporary, `${JSON.stringify(settings, null, '\t')}\n`, { flag: 'w', mode: 0o600 });
		renameSync(temporary, path);
	} finally {
		try {
			rmSync(temporary, { force: true });
		} catch {
			/* The rename consumed it. */
		}
	}
	return path;
}

/** True when two settings would draw and place the same banner. */
export function sameLoonSettings(a: LoonSettings, b: LoonSettings): boolean {
	return a.enabled === b.enabled && a.accent === b.accent && a.mark === b.mark && a.source === b.source;
}
