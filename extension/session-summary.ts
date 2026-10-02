/**
 * Exit summary: a compact CC-style recap printed when pi quits, immediately
 * before pi's own "To resume this session: <cmd>" line.
 *
 * Why stdout and not pi.appendEntry: interactive-mode.js:3442-3448 stops the
 * TUI (`this.stop()`, which dumps the transcript when fullscreenExitOutput is
 * "transcript") *before* it calls `runtimeHost.dispose()` and emits
 * session_shutdown. An entry appended from this hook would therefore land after
 * the dump and never be printed. The resume line is written after dispose, so
 * what we write here reads directly above it — summary first, resume second.
 *
 * Only `reason: "quit"` ends the session. reload / new / resume / fork replace
 * it and pi prints no resume hint for them, so neither do we.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { formatTokens, formatTurnDuration, tildeHome } from "./session-format.ts";

/** Session facts the summary renders. Pure data, no pi types, so it is testable. */
export interface SessionSummaryData {
	/** Session display name, when one was set. */
	name?: string;
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

function dim(text: string): string {
	// chalk is pi's dependency, not ours; a raw SGR keeps this module free of
	// new runtime deps. NO_COLOR still wins, as it does for pi itself.
	if (process.env.NO_COLOR) return text;
	return `\x1b[2m${text}\x1b[0m`;
}

/**
 * Two lines: a CC-style completion line, then the location/spend detail.
 * Returns "" when the session did no work — an empty quit should stay silent
 * rather than print a zeroed recap.
 */
export function formatSessionSummary(data: SessionSummaryData): string {
	if (data.turns === 0) return "";
	const detail: string[] = [tildeHome(data.cwd)];
	if (data.branch) detail.push(`⎇ ${data.branch}`);
	detail.push(`${data.turns} ${data.turns === 1 ? "turn" : "turns"}`);
	if (data.contextTokens > 0) detail.push(`ctx ${formatTokens(data.contextTokens)}`);
	if (data.cost > 0) detail.push(`$${data.cost.toFixed(2)}`);

	const heading = `✻ LOON — ${formatTurnDuration(data.durationMs)}`;
	return [heading, dim("  " + detail.join(" · "))].join("\n") + "\n";
}

// Loose type for the assistant usage we read (avoids a direct pi-ai dependency).
interface AssistantUsage {
	usage?: {
		totalTokens?: number;
		cost?: { total?: number };
	};
}

export function registerSessionSummary(pi: ExtensionAPI): void {
	pi.on("session_start", async (_event, ctx) => {
		if (ctx.mode !== "tui") return;

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
			const text = formatSessionSummary({
				name: shutdownCtx.sessionManager.getSessionName() ?? undefined,
				cwd: shutdownCtx.sessionManager.getCwd(),
				durationMs: Date.now() - sessionStartMs,
				turns,
				cost,
				contextTokens,
			});
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