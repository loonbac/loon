/**
 * Exit banner: the pi brand mark with the finished session's totals beside it,
 * printed on quit directly above pi's own "To resume this session" line.
 *
 * Why stdout and not pi.appendEntry: interactive-mode.js:3442-3448 stops the
 * TUI (`this.stop()`, which dumps the transcript when fullscreenExitOutput is
 * "transcript") *before* it calls `runtimeHost.dispose()` and emits
 * session_shutdown. An entry appended from this hook would therefore land after
 * the dump and never be printed. The resume line is written after dispose, so
 * what we write here reads directly below the banner.
 *
 * Painting is injected rather than resolved here: at shutdown the TUI is gone
 * and the theme object it would need is no longer live, so the registrar
 * captures the painters on session_start and hands them to the pure formatter.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { spawnSync } from "node:child_process";
import { formatTokens, formatTurnDuration, tildeHome } from "./session-format.ts";
import { PI_LOGO, PI_LOGO_WIDTH } from "./pi-logo.ts";

/** Session facts the banner renders. Pure data, no pi types, so it is testable. */
export interface SessionSummaryData {
	/** Absolute working directory. */
	cwd: string;
	/** Git branch, when the session is inside a repository. */
	branch?: string;
	/** Submitted prompts in this session. */
	turns: number;
	/** Wall-clock since the first entry of the session. */
	durationMs: number;
	/** Summed cost across assistant messages, in USD. */
	cost: number;
	/**
	 * Context window size of the most recent assistant call. NOT a sum: each
	 * message reports the window it was billed against, so only the latest is
	 * the session's current occupancy.
	 */
	contextTokens: number;
}

/** Injected painters, so the formatter stays free of ANSI and theme lookups. */
export interface ExitBannerPaint {
	/** Brand accent — the same CC palette colour the startup banner paints. */
	accent: (text: string) => string;
	dim: (text: string) => string;
}

/** Blank columns between the mark and the text column. */
const LOGO_GAP = 3;
/** Logo row the heading sits on, so the text starts one row below the top. */
const HEADING_ROW = 1;

/**
 * The six-row mark with the totals in a column to its right.
 *
 * Returns "" when the session did no work — an empty quit should stay silent
 * rather than print a zeroed recap.
 */
export function formatExitBanner(data: SessionSummaryData, paint: ExitBannerPaint): string {
	if (data.turns === 0) return "";

	const stats: string[] = [`${data.turns} ${data.turns === 1 ? "turn" : "turns"}`];
	if (data.contextTokens > 0) stats.push(`ctx ${formatTokens(data.contextTokens)}`);
	if (data.cost > 0) stats.push(`$${data.cost.toFixed(2)}`);

	const location = [tildeHome(data.cwd), data.branch ? `⎇ ${data.branch}` : undefined]
		.filter(Boolean)
		.join(" ");

	// Text column: past the widest logo row plus the gap. The mark is only
	// full blocks and spaces, so `.length` is its display width.
	const infoColumn = PI_LOGO_WIDTH + LOGO_GAP;
	const info: Record<number, string> = {
		[HEADING_ROW]: `✻ LOON — ${formatTurnDuration(data.durationMs)}`,
		[HEADING_ROW + 2]: location,
		[HEADING_ROW + 3]: stats.join(" · "),
	};

	const lines = PI_LOGO.map((row, i) => {
		const art = paint.accent(row.trimEnd());
		const text = info[i];
		if (!text) return art;
		return art + " ".repeat(infoColumn - row.trimEnd().length) + paint.dim(text);
	});

	return lines.join("\n") + "\n\n";
}

/** Painters for a terminal with no colour support. */
export const PLAIN_PAINT: ExitBannerPaint = {
	accent: (text) => text,
	dim: (text) => text,
};

function ansiDim(text: string): string {
	// chalk is pi's dependency, not ours; a raw SGR keeps this module free of
	// new runtime deps. NO_COLOR still wins, as it does for pi itself.
	return process.env.NO_COLOR ? text : `\x1b[2m${text}\x1b[0m`;
}

/** Painters built from a live theme, for when the TUI is gone at shutdown. */
export function paintFromTheme(accent: (text: string) => string): ExitBannerPaint {
	return { accent, dim: ansiDim };
}

/**
 * How the caller resolves the brand accent from a live theme. Injected so this
 * module never imports banner.ts, which pulls in pi-tui at load time and would
 * make the formatter untestable under type stripping.
 */
export interface SessionSummaryOptions {
	accentFromTheme: (theme: unknown) => (text: string) => string;
}

/**
 * Current branch for `cwd`, or undefined outside a repository.
 *
 * Read at shutdown with a synchronous, short-lived call rather than a watcher:
 * the banner needs it exactly once, and spawning nothing at exit keeps the
 * shutdown path free of anything that could outlive the process.
 */
function readGitBranch(cwd: string): string | undefined {
	try {
		const result = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
			cwd,
			encoding: "utf8",
			timeout: 1_000,
			stdio: ["ignore", "pipe", "ignore"],
		});
		if (result.status !== 0) return undefined;
		const branch = result.stdout.trim();
		// "HEAD" means detached; there is no branch worth reporting.
		return branch && branch !== "HEAD" ? branch : undefined;
	} catch {
		return undefined;
	}
}

// Loose type for the assistant usage we read (avoids a direct pi-ai dependency).
interface AssistantUsage {
	usage?: {
		totalTokens?: number;
		cost?: { total?: number };
	};
}

export function registerSessionSummary(pi: ExtensionAPI, options: SessionSummaryOptions): void {
	pi.on("session_start", async (_event, ctx) => {
		if (ctx.mode !== "tui") return;

		// The accent is resolved from the live theme while it still exists; the
		// banner repaints it from a closure at shutdown. session_start can fire
		// before ctx.ui is constructed, so agent_start retries it — and because
		// the banner only prints for a session with at least one turn, agent_start
		// is guaranteed to have run before shutdown.
		let accent: (text: string) => string | undefined;
		const resolveAccent = (ui: { theme?: unknown } | undefined) => {
			if (accent || !ui?.theme) return;
			try {
				accent = options.accentFromTheme(ui.theme);
			} catch {
				// Leave the mark unpainted rather than failing the shutdown path.
			}
		};
		resolveAccent(ctx.ui);
		const paint = () => paintFromTheme(accent ?? ((text: string) => text));

		// Seed from the branch so a resumed session reports its own totals
		// instead of only what happened after the resume, matching status-line.ts.
		let cost = 0;
		let turns = 0;
		let contextTokens = 0;
		let earliestMs = Date.now();
		for (const e of ctx.sessionManager.getBranch()) {
			if (e.type === "message" && e.message.role === "assistant") {
				const usage = (e.message as unknown as AssistantUsage).usage;
				cost += usage?.cost?.total ?? 0;
				contextTokens = usage?.totalTokens ?? contextTokens;
			}
			if (e.type === "message" && e.message.role === "user") turns += 1;
			// SessionEntryBase.timestamp is an ISO string.
			if (typeof e.timestamp === "string") {
				const t = Date.parse(e.timestamp);
				if (Number.isFinite(t) && t < earliestMs) earliestMs = t;
			}
		}
		const sessionStartMs = earliestMs;

		pi.on("agent_start", async (_event, agentCtx) => {
			resolveAccent(agentCtx.ui);
		});

		pi.on("message_end", async (event) => {
			if (event.message?.role === "assistant") {
				const usage = (event.message as unknown as AssistantUsage).usage;
				cost += usage?.cost?.total ?? 0;
				contextTokens = usage?.totalTokens ?? contextTokens;
			} else if (event.message?.role === "user") {
				turns += 1;
			}
		});

		pi.on("session_shutdown", async (event, shutdownCtx) => {
			if (event.reason !== "quit") return;
			const text = formatExitBanner(
				{
					cwd: shutdownCtx.sessionManager.getCwd(),
					branch: readGitBranch(shutdownCtx.sessionManager.getCwd()),
					durationMs: Date.now() - sessionStartMs,
					turns,
					cost,
					contextTokens,
				},
				paint(),
			);
			if (!text) return;
			// Best effort: a closed stdout must not turn the shutdown path into
			// an unhandled error.
			try {
				process.stdout.write(text);
			} catch {
				// ignore
			}
		});
	});
}
