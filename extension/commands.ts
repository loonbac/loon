/**
 * Commands and session lifecycle helpers.
 *
 * Ensures the single LOON theme is active across sessions and preserves
 * readSettings / writeSettingsKey helpers for ~/.pi/settings.json persistence.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Settings cache: merged cwd + home settings, 5s TTL.
let settingsCache: { value: Record<string, unknown>; timestamp: number } | null = null;
const SETTINGS_CACHE_TTL_MS = 5_000;

export function readSettings(): Record<string, unknown> {
	const now = Date.now();
	if (settingsCache && now - settingsCache.timestamp < SETTINGS_CACHE_TTL_MS) {
		return settingsCache.value;
	}
	const merged: Record<string, unknown> = {};
	for (const path of [join(process.cwd(), ".pi", "settings.json"), join(homedir(), ".pi", "settings.json")]) {
		try {
			if (!path || !existsSync(path)) continue;
			const raw = JSON.parse(readFileSync(path, "utf8"));
			if (raw && typeof raw === "object") Object.assign(merged, raw);
		} catch {
			// ignore invalid settings files
		}
	}
	settingsCache = { value: merged, timestamp: now };
	return merged;
}

/** Write one key to ~/.pi/settings.json. Uses homedir() — the same source
 *  readSettings uses, so the setting survives even when HOME is unset. */
export function writeSettingsKey(key: string, value: unknown): void {
	settingsCache = null; // invalidate cache on write
	const dir = join(homedir(), ".pi");
	const path = join(dir, "settings.json");
	let settings: Record<string, unknown> = {};
	try {
		if (existsSync(path)) settings = JSON.parse(readFileSync(path, "utf8")) ?? {};
	} catch {
		/* start fresh */
	}
	if (value === undefined) {
		delete settings[key];
	} else {
		settings[key] = value;
	}
	try {
		mkdirSync(dir, { recursive: true });
		writeFileSync(path, JSON.stringify(settings, null, 2) + "\n");
	} catch {
		/* best effort */
	}
}

export function registerCommands(pi: ExtensionAPI): void {
	// Ensure the single LOON theme is active if pi fell back to built-in default at startup.
	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		const current = ctx.ui.theme?.name;
		if (current === "dark" || current === "light") {
			ctx.ui.setTheme("loon");
		}
	});
}
