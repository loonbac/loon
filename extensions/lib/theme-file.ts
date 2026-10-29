/**
 * The generated theme file on disk, and the rules for touching it.
 *
 * pi lists `<agentDir>/themes/*.json` on every call and reloads the active one
 * when its file changes, so writing here is enough to make the theme appear and to
 * recolour a running session. Two rules keep that safe: writes are atomic, and a
 * file that is not ours is never overwritten.
 */
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { piConfigHome } from './loon-config.ts';
import type { Rgb } from './oklch.ts';
import {
	WALLPAPER_THEME_NAME,
	deriveWallpaperTheme,
	isLoonThemeName,
	themeFileName,
	type LoonThemeFile,
} from './wallpaper-theme.ts';

export const THEME_DIR_NAME = 'themes';

/** pi keeps user themes in `<agentDir>/themes`. */
export function themesDir(env: NodeJS.ProcessEnv = process.env, home?: string): string {
	return join(piConfigHome(env, home), THEME_DIR_NAME);
}

/** The generated theme's path: the name plus `.json`, by the same rule. */
export function wallpaperThemePath(dir: string): string {
	return join(dir, themeFileName(WALLPAPER_THEME_NAME));
}

/** Read one theme file, if it parses. */
export function readThemeFile(path: string): LoonThemeFile | undefined {
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
		return typeof parsed === 'object' && parsed !== null ? (parsed as LoonThemeFile) : undefined;
	} catch {
		return undefined;
	}
}

function modifiedAt(path: string): number | undefined {
	try {
		return statSync(path).mtimeMs;
	} catch {
		return undefined;
	}
}

export type EnsureResult = 'written' | 'up-to-date' | 'skipped-foreign' | 'skipped-no-accent';

export interface EnsureOptions {
	/** The wallpaper accent; undefined means there is nothing to derive from. */
	accent: Rgb | undefined;
	/** Defaults to pi's own themes directory. */
	dir?: string;
	/** mtime of `accent.txt` in milliseconds, so a stale theme is regenerated. */
	accentModifiedAt?: number | undefined;
}

export interface EnsureOutcome {
	result: EnsureResult;
	path: string;
}

/**
 * Make sure the theme file exists and is newer than the accent it came from.
 *
 * - absent or unparsable: written;
 * - present, ours, older than the accent: written again;
 * - present, ours, fresh: left alone;
 * - present with a name that is not ours: skipped, untouched;
 * - no accent at all: nothing is written.
 */
export function ensureWallpaperTheme(options: EnsureOptions): EnsureOutcome {
	const dir = options.dir ?? themesDir();
	const path = wallpaperThemePath(dir);
	if (options.accent === undefined) return { result: 'skipped-no-accent', path };

	const existing = readThemeFile(path);
	if (existing !== undefined && !isLoonThemeName(existing.name)) return { result: 'skipped-foreign', path };

	if (existing !== undefined && isLoonThemeName(existing.name)) {
		const themeTime = modifiedAt(path);
		const accentTime = options.accentModifiedAt;
		const fresh = themeTime !== undefined && (accentTime === undefined || themeTime >= accentTime);
		if (fresh && sameAccent(existing, options.accent)) return { result: 'up-to-date', path };
	}

	const theme = deriveWallpaperTheme(options.accent);
	mkdirSync(dir, { recursive: true });
	const temporary = path + '.' + process.pid + '.tmp';
	try {
		writeFileSync(temporary, JSON.stringify(theme, null, '\t') + '\n', { flag: 'w', mode: 0o600 });
		renameSync(temporary, path);
	} finally {
		rmSync(temporary, { force: true });
	}
	return { result: 'written', path };
}

/** A fresh file still has to match today's accent: the wallpaper may have changed. */
function sameAccent(theme: LoonThemeFile, accent: Rgb): boolean {
	const expected = deriveWallpaperTheme(accent);
	return theme.vars?.bg === expected.vars.bg && theme.vars?.accent === expected.vars.accent;
}

/** The names currently installed, for the status line. */
export function installedThemeNames(dir: string = themesDir()): string[] {
	try {
		return readdirSync(dir)
			.filter((name) => name.endsWith('.json'))
			.map((name) => name.slice(0, -'.json'.length))
			.sort();
	} catch {
		return [];
	}
}
