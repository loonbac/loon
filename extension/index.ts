/**
 * LOON: LOON Offers Only Nuanced-gentle — Claude Code visual identity for pi.
 *
 * Layers:
 *   1. theme/             curated dark ANSI theme (JSON, loaded by pi)
 *   2. chrome             banner (welcome box), session summary, status line
 *
 * Chat rendering, tool rendering, thinking, and prompt editor use Pi's native
 * default implementations. host-patches.ts wraps prototype methods of public
 * pi exports (AssistantMessageComponent, InteractiveMode, SessionSelectorComponent)
 * for upstream bug fixes, resume hold-delete, and Gentle rail/layout stabilization.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installHostPatches } from "./host-patches.ts";
import { registerSessionSummary } from "./session-summary.ts";
import { registerBanner, ccAccent } from "./banner.ts";
import { registerStatusLine } from "./status-line.ts";
import { registerCommands } from "./commands.ts";
import { FastModeIndicator, type FastModeIndicatorUi } from "./fast-mode-indicator.ts";
import { WallpaperAccentSync, type WallpaperThemeUi } from "./wallpaper-sync.ts";
import { registerAntigravityUsage } from "./antigravity-usage.ts";
import { registerCommandCodeUsage } from "./commandcode-usage.ts";
import { registerOpenCodeGoUsage } from "./opencode-go-usage.ts";
import { registerCodexUsageCache } from "./codex-usage-cache.ts";
import { ensureFallbackConfig } from "./fallback-config.ts";
import antigravityQuotaFallback from "./antigravity-quota-fallback.ts";
import { registerBoundedSearch } from "./bounded-search.ts";

function shouldRegisterStandaloneStatusLine(): boolean {
	if (process.env.BETTER_CC_STATUS_LINE === "0") return false;
	try {
		const settingsPath = join(homedir(), ".pi", "agent", "settings.json");
		const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as { packages?: unknown };
		if (!Array.isArray(settings.packages)) return true;
		// Both packages own ctx.ui.setFooter(). Registering ours after Gentle's
		// session_start handler disposes its footer, whose dispose callback also
		// uninstalls the complete fullscreen sidebar. Keep decorating Gentle's
		// footer through host-patches.ts, but never replace it here.
		return !settings.packages.some((source) => typeof source === "string" && (
			/pi-statusline/u.test(source)
			|| source.includes("gentle-pi")
			|| /^(?:npm:)?gentle-pi(?:@|$)/u.test(source)
		));
	} catch {
		return true;
	}
}

export default async function (pi: ExtensionAPI) {
	// NixOS whole-filesystem searches fan out through /nix/store. Teach every
	// parent/child session the bounded alternative and enforce it at tool time.
	registerBoundedSearch(pi);
	// Keep the custom fallback editor/runtime and gentle-pi 2.7's named profile
	// store reconciled even when the user has not opened /gentle:models yet.
	ensureFallbackConfig();
	// Seam de routing a nivel de lanzamiento: este módulo es el dueño del hook
	// `before_agent_start` que aplica la ruta primaria adaptativa y la
	// recuperación por cuota, y registra `/adaptive`. Sin esta llamada el router
	// natural calculaba decisiones que nadie consumía.
	await antigravityQuotaFallback(pi);
	// Host patches (ghost blank rows, ctrl+o status residue) — before any render.
	installHostPatches();
	registerAntigravityUsage(pi);
	registerCommandCodeUsage(pi);
	registerOpenCodeGoUsage(pi);
	registerCodexUsageCache(pi);

	// Layer 2: chrome
	registerSessionSummary(pi, { accentFromTheme: ccAccent });
	registerBanner(pi);
	if (shouldRegisterStandaloneStatusLine()) registerStatusLine(pi);

	// Commands
	registerCommands(pi);

	// Keep the CC brand roles aligned with the wallpaper producer's live accent.
	const wallpaperSync = new WallpaperAccentSync();
	const fastModeIndicator = new FastModeIndicator();
	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		try {
			ctx.ui.setWidget("gentle-shell-below-input-header", undefined);
		} catch {
			// ignore
		}
		fastModeIndicator.start(ctx.ui as unknown as FastModeIndicatorUi);
		await wallpaperSync.start(ctx.ui as unknown as WallpaperThemeUi);
	});
	pi.on("session_shutdown", async () => {
		fastModeIndicator.stop();
		wallpaperSync.stop();
	});
}
