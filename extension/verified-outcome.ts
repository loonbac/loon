/**
 * Which tool runs count as evidence that a work unit succeeded.
 *
 * The router keeps local evidence per (model, task class, language), and it needs
 * a verified outcome to admit any: an observation alone records that a route was
 * applied, not that the work was good. Without that signal every candidate stays
 * EXPLORATION_ONLY and the router can never leave its cold-start bootstrap.
 *
 * The signal has to be attributable to the work and cheap to obtain, which rules
 * out judging the model's own prose. A verification command that exits zero is
 * both: the host watched a gate pass on the tree the model produced.
 *
 * Attribution is deliberately narrow. Only a *passing* gate is reported. A failing
 * gate is ambiguous — it can be a pre-existing failure, a flaky test, or the
 * model's fault — and the router has no baseline to tell them apart, so admitting
 * it would poison the evidence it is meant to build. The consequence is that
 * admitted outcomes are success-only, which is a known bias in the reliability
 * ratio and the reason this module reports no failures at all rather than
 * guessing which ones belong to the model.
 */

/**
 * Commands that verify the tree rather than build or exercise it incidentally.
 *
 * Matched on the command text because that is all the host sees. Kept to runners
 * whose exit code means "the checks passed", and deliberately narrow: a broad
 * pattern would admit commands that exit zero for reasons unrelated to the work.
 */
const VERIFICATION_PATTERNS: readonly RegExp[] = [
	// Test runners.
	/\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b/u,
	/\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:tests|test:[\w:-]+)\b/u,
	/\b(?:jest|vitest|mocha|ava|tap)\b/u,
	/\bpytest\b/u,
	/\bpython\s+-m\s+(?:pytest|unittest)\b/u,
	/\bcargo\s+test\b/u,
	/\bgo\s+test\b/u,
	/\bmix\s+test\b/u,
	/\bdotnet\s+test\b/u,
	/\bnix\s+(?:flake\s+)?check\b/u,
	// Static gates: types, lint and build all fail loudly on a broken tree.
	/\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:check|typecheck|type-check|lint|build)\b/u,
	/\btsc\b[^\n]*(?:--noEmit|--build)\b/u,
	/\bcargo\s+(?:check|clippy|build)\b/u,
	/\bgo\s+(?:build|vet)\b/u,
	/\bruff\s+check\b/u,
	/\bshellcheck\b/u,
	/\bnix\s+(?:build|flake\s+check)\b/u,
];

/**
 * Whether a shell command verifies the tree.
 *
 * Only the first line of a compound command is considered: `npm test && rm -rf x`
 * is still a test run, and treating the whole string as one command would make
 * every pattern depend on whatever was appended after it.
 */
export function isVerificationCommand(command: string): boolean {
	const first = command.split(/[\n;]/u)[0]?.trim() ?? "";
	if (first.length === 0) return false;
	return VERIFICATION_PATTERNS.some((pattern) => pattern.test(first));
}

/**
 * The shell command a tool call carries, when it carries one.
 *
 * Read defensively: extensions do not own the tool schemas, so this looks for the
 * conventional field names rather than assuming one host's shape.
 */
export function toolCommand(args: unknown): string | undefined {
	if (typeof args !== "object" || args === null || Array.isArray(args)) return undefined;
	const record = args as Record<string, unknown>;
	for (const key of ["command", "cmd", "script"]) {
		const value = record[key];
		if (typeof value === "string" && value.trim().length > 0) return value;
	}
	return undefined;
}

/**
 * Tracks verification gates across one agent run.
 *
 * A gate only counts once it has *ended* successfully, so the tracker keys on the
 * tool call id: many runs execute a gate that fails first and passes after the
 * model fixes it, and the last outcome is the one that describes the final tree.
 */
export class VerificationGateTracker {
	#pending = new Map<string, string>();
	#passed: string | undefined;

	reset(): void {
		this.#pending.clear();
		this.#passed = undefined;
	}

	/** Record a started tool call when it looks like a verification command. */
	noteStart(toolCallId: string, args: unknown): void {
		const command = toolCommand(args);
		if (command === undefined || !isVerificationCommand(command)) return;
		this.#pending.set(toolCallId, command);
	}

	/** Record the completion of a tracked tool call. Failing gates record nothing. */
	noteEnd(toolCallId: string, isError: boolean): void {
		const command = this.#pending.get(toolCallId);
		if (command === undefined) return;
		this.#pending.delete(toolCallId);
		if (!isError) this.#passed = command;
	}

	/** The verification command that last passed during this run, if any. */
	passedGate(): string | undefined {
		return this.#passed;
	}
}
