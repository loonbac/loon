/**
 * Watch the directories that hold the settings LOON follows, so a change made in
 * another window lands without restarting pi.
 *
 * Editing a file in gentle-pi's menu writes a fresh file and renames it into
 * place, which surfaces as several watch events; the debounce collapses them into
 * one re-read. A directory that does not exist yet, or a platform that refuses
 * the watch, is not an error: the watcher simply reports nothing and the banner
 * still follows the files the next time it is applied.
 */
import { watch } from 'node:fs';

/** A live watch; closing it stops the events. */
export interface WatchHandle {
	close(): void;
}

export interface WatchDirOptions {
	/** How long to wait after the last event before reporting one change. */
	debounceMs?: number;
	/** Seam for the tests: the default watches with node:fs. */
	watchDir?: (dir: string, onChange: () => void) => WatchHandle;
}

const silentHandle: WatchHandle = { close: () => {} };

function defaultWatchDir(dir: string, onChange: () => void): WatchHandle {
	try {
		const watcher = watch(dir, { persistent: false }, () => onChange());
		watcher.on('error', () => watcher.close());
		return watcher;
	} catch {
		// No such directory yet, or watching is unavailable: no events, no crash.
		return silentHandle;
	}
}

/**
 * Watch several directories and report one debounced change. Returns the
 * disposer; calling it twice is safe.
 */
export function watchConfigDirs(dirs: readonly string[], onChange: () => void, options: WatchDirOptions = {}): () => void {
	const debounceMs = options.debounceMs ?? 150;
	const watchDir = options.watchDir ?? defaultWatchDir;
	let timer: NodeJS.Timeout | undefined;
	let disposed = false;

	const schedule = () => {
		if (disposed) return;
		if (timer !== undefined) clearTimeout(timer);
		timer = setTimeout(() => {
			timer = undefined;
			if (!disposed) onChange();
		}, debounceMs);
		timer.unref?.();
	};

	const handles = dirs.map((dir) => watchDir(dir, schedule));
	return () => {
		disposed = true;
		if (timer !== undefined) clearTimeout(timer);
		timer = undefined;
		for (const handle of handles) handle.close();
	};
}
