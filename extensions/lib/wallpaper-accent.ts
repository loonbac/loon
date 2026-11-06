/**
 * The wallpaper accent: the colour the desktop already publishes for its own theme.
 *
 * `~/.config/mpvpaper/accent.txt` holds one `#RRGGBB` line. The script that writes it
 * replaces the file atomically (`write · fsync · os.replace`), so the inode changes on
 * every wallpaper: a watch on the file dies after the first update, while a watch on
 * the directory survives. That is why the caller watches the directory.
 *
 * LOON reads this one file and nothing else the desktop writes.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseHexColor, type Rgb } from './accent.ts';
import type { LoonSettings } from './loon-config.ts';

export const WALLPAPER_ACCENT_FILE = 'accent.txt';

/** The directory the wallpaper script writes into, and that LOON watches. */
export function wallpaperAccentDir(home: string = homedir()): string {
	return join(home, '.config', 'mpvpaper');
}

/** The single file the accent comes from. */
export function wallpaperAccentPath(home: string = homedir()): string {
	return join(wallpaperAccentDir(home), WALLPAPER_ACCENT_FILE);
}

/**
 * The wallpaper accent, or undefined when the file is missing, unreadable or does
 * not hold a colour. Undefined is the signal to fall back to the theme accent: never
 * a crash, and never black.
 */
export function readAccentFrom(path: string | undefined): Rgb | undefined {
	if (path === undefined || path === '') return undefined;
	try {
		return parseHexColor(readFileSync(path, 'utf8'));
	} catch {
		return undefined;
	}
}

/**
 * `readAccentFrom` on the wallpaper script's own file.
 *
 * Kept as its own name because the wallpaper source is a real thing a person selects,
 * not merely the default path: it survives `accentFile` being configured for another
 * source, so switching back does not silently read the wrong file.
 */
export function readWallpaperAccent(path: string = wallpaperAccentPath()): Rgb | undefined {
	return readAccentFrom(path);
}

/**
 * The file the *selected source* reads, which is what the caller must watch and stamp.
 *
 * `file` is the configurable path; `wallpaper` keeps the historical mpvpaper location so
 * an existing install behaves exactly as before. The other sources read no file at all.
 */
export function accentPath(settings: Pick<LoonSettings, 'accent' | 'accentFile'>): string | undefined {
	if (settings.accent === 'file') return settings.accentFile;
	if (settings.accent === 'wallpaper') return wallpaperAccentPath();
	return undefined;
}

/**
 * The directories to watch for a change to the accent file.
 *
 * The file is replaced atomically by whichever tool writes it, so its inode changes and
 * a watch on the file itself dies after the first update. The directory survives that,
 * which is why the watcher takes directories and a source that reads no file contributes
 * none — watching the default path for someone using the theme accent would be noise.
 */
export function accentWatchDirs(settings: Pick<LoonSettings, 'accent' | 'accentFile'> | undefined): string[] {
	if (settings === undefined) return [wallpaperAccentDir()];
	const dir = accentPath(settings);
	return dir === undefined ? [] : [dirname(dir)];
}
