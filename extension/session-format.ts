/**
 * Pure session formatting shared by the chrome modules.
 *
 * These three helpers are the presentation rules for session-scoped text:
 * home-relative paths, elapsed time and token counts. They live here, with no
 * pi runtime imports, because every consumer needs them — and because a module
 * that can be imported without pulling in `@earendil-works/pi-tui` stays
 * testable under `node --experimental-strip-types`.
 */
import { homedir } from "node:os";

/**
 * Collapse the home-dir prefix of an absolute path to `~`, CC-style
 * (getDisplayPath, file.ts:163-166): only rewrite when the path actually sits
 * under home, guarded by a `home + "/"` boundary. A bare
 * `cwd.replace(HOME ?? "", "~")` injects a stray leading `~` when HOME is unset
 * (`replace("", "~")` matches at index 0) (AUDIT §5 status-line.ts:66).
 */
export function tildeHome(cwd: string): string {
	const home = homedir();
	if (!home) return cwd;
	if (cwd === home) return "~";
	if (cwd.startsWith(home + "/")) return "~" + cwd.slice(home.length);
	return cwd;
}

// dsh-tui transcript.ts: formatTurnDuration — `45s`, `1m 23s`, `2h 5m 1s`.
export function formatTurnDuration(ms: number): string {
	const elapsed = Math.max(0, ms);
	if (elapsed < 60_000) return `${Math.floor(elapsed / 1000)}s`;
	let seconds = Math.round((elapsed % 60_000) / 1000);
	let minutes = Math.floor((elapsed % 3_600_000) / 60_000);
	let hours = Math.floor(elapsed / 3_600_000);
	if (seconds === 60) {
		seconds = 0;
		minutes += 1;
	}
	if (minutes === 60) {
		minutes = 0;
		hours += 1;
	}
	return hours > 0 ? `${hours}h ${minutes}m ${seconds}s` : `${minutes}m ${seconds}s`;
}

/** Token counts stay exact below 1000 and switch to one decimal above it. */
export function formatTokens(n: number): string {
	if (n < 1000) return `${n}`;
	return `${(n / 1000).toFixed(1)}k`;
}
