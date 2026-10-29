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
import { join } from 'node:path';
import { parseHexColor, type Rgb } from './accent.ts';

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
export function readWallpaperAccent(path: string = wallpaperAccentPath()): Rgb | undefined {
	try {
		return parseHexColor(readFileSync(path, 'utf8'));
	} catch {
		return undefined;
	}
}
