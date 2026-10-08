/**
 * LOON: LOON Offers Only Nuanced-gentle — Claude Code visual identity for pi.
 *
 * Layers:
 *   1. theme/             curated dark ANSI theme (JSON, loaded by pi)
 *   2. chrome             banner (welcome box), spinner, status line, turn footer
 *   3. tools/             CC-style tool rendering (builtins, diff, grouping)
 *   4. thinking           CC-style thinking title + hidden label + spinner row
 *
 * Layers 1-4 use only pi public extension APIs. host-patches.ts additionally
 * wraps two prototype methods of PUBLIC pi exports (AssistantMessageComponent,
 * InteractiveMode) as the extension-side landing of the upstream PR draft —
 * see its header for scope and removal criteria.
 * See ALIGNMENT.md for the per-module CC source mapping.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installHostPatches } from "./host-patches.ts";
import { registerSpinner } from "./spinner.ts";
import { registerTurnFooter } from "./turn-footer.ts";
import { registerSessionSummary } from "./session-summary.ts";
import { registerBanner, ccAccent } from "./banner.ts";
import { registerStatusLine } from "./status-line.ts";
import { registerGrouping } from "./tools/grouping.js";
import { registerBuiltins } from "./tools/builtins.js";
import { registerCommands } from "./commands.ts";
import { registerThinking } from "./thinking.ts";
import { registerPromptPointer } from "./prompt-editor.ts";
import { FastModeIndicator, type FastModeIndicatorUi } from "./fast-mode-indicator.ts";
import { WallpaperAccentSync, type WallpaperThemeUi } from "./wallpaper-sync.ts";
import { registerAntigravityUsage } from "./antigravity-usage.ts";
import { registerCommandCodeUsage } from "./commandcode-usage.ts";
import { registerOpenCodeGoUsage } from "./opencode-go-usage.ts";
import { registerCodexUsageCache } from "./codex-usage-cache.ts";
import { ensureFallbackConfig } from "./fallback-config.ts";
import antigravityQuotaFallback from "./antigravity-quota-fallback.ts";
import { registerBoundedSearch } from "./bounded-search.ts";

/**
 * gentle-pi's quiet-tools extension owns the same seven built-in tool names.
 * Let it keep those registrations when it is active, while the rest of this
 * extension (including wallpaper colors) continues to load. Set
 * GENTLE_PI_QUIET_TOOLS=0 to give these CC renderers ownership instead.
 */
function gentlePiQuietToolsAreActive(): boolean {
	if (process.env.GENTLE_PI_QUIET_TOOLS === "0") return false;
	try {
		const settingsPaths = [
			join(homedir(), ".pi", "agent", "settings.json"),
			join(homedir(), ".pi", "settings.json"),
			join(process.cwd(), ".pi", "settings.json"),
		];
		for (const p of settingsPaths) {
			if (!existsSync(p)) continue;
			const settings = JSON.parse(readFileSync(p, "utf8")) as { packages?: unknown; extensions?: unknown };
			if (Array.isArray(settings.packages) && settings.packages.some(
				(source) => typeof source === "string" && (source.includes("gentle-pi") || /^(?:npm:)?gentle-pi(?:@|$)/u.test(source)),
			)) return true;
			if (Array.isArray(settings.extensions) && settings.extensions.some(
				(source) => typeof source === "string" && source.includes("gentle-pi"),
			)) return true;
		}
	} catch {
		// ignore
	}
	return existsSync(join(homedir(), "Proyectos", "gentle-pi", "extensions", "quiet-tools.ts")) ||
		existsSync(join(homedir(), ".pi", "agent", "npm", "node_modules", "gentle-pi", "extensions", "quiet-tools.ts"));
}

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
	registerSpinner(pi);
	registerTurnFooter(pi);
	registerSessionSummary(pi, { accentFromTheme: ccAccent });
	registerBanner(pi);
	if (shouldRegisterStandaloneStatusLine()) registerStatusLine(pi);
	registerPromptPointer(pi);

	// Layer 3: tool rendering
	registerGrouping(pi);
	if (!gentlePiQuietToolsAreActive()) registerBuiltins(pi);

	// Layer 4: thinking (transformer + hidden label + spinner-row coordination)
	registerThinking(pi);

	// Commands + shortcuts
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
