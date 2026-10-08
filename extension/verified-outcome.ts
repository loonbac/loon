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
 * Attribution is deliberately narrow, and it distinguishes two failures that used to be
 * treated as one.
 *
 * Whether the work landed is decided by the last gate that ended, because that is the one
 * that describes the final tree: a run that passes its tests and then breaks something on
 * the next edit ends unverified even though a gate did pass earlier. So a pass only counts
 * if nothing failed after it.
 *
 * Whether the failure belongs to the model is a separate question, and the honest answer
 * is narrower than "the gate failed". A failing gate can be a pre-existing failure, a
 * flaky suite or the model's fault, and the host has no baseline to tell them apart. Two
 * conditions make it attributable anyway: the run has to have finished normally — no
 * errored turn, no abort — so the model had a fair chance; and the failures are reported
 * as product failures, never as model-capability failures. A single failing suite is
 * equally consistent with a broken tree the model never touched, and asserting that a
 * model *cannot* do this class of work is a much stronger claim than the evidence
 * supports. Capability is left to accumulate across fingerprints, not decided by one run.
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
export type GateOutcome = "PASSED" | "FAILED" | "NONE";

export class VerificationGateTracker {
	#pending = new Map<string, string>();
	#last: { command: string; passed: boolean } | undefined;

	reset(): void {
		this.#pending.clear();
		this.#last = undefined;
	}

	/** Record a started tool call when it looks like a verification command. */
	noteStart(toolCallId: string, args: unknown): void {
		const command = toolCommand(args);
		if (command === undefined || !isVerificationCommand(command)) return;
		this.#pending.set(toolCallId, command);
	}

	/**
	 * Record the completion of a tracked tool call.
	 *
	 * A failure is stored, not discarded: it has to be able to supersede an earlier pass,
	 * or a unit that broke the tree after a green run would still read as verified.
	 */
	noteEnd(toolCallId: string, isError: boolean): void {
		const command = this.#pending.get(toolCallId);
		if (command === undefined) return;
		this.#pending.delete(toolCallId);
		this.#last = { command, passed: !isError };
	}

	/**
	 * What the final tree's verification says: the last gate to end decides, and a run
	 * where no gate ended has no verdict rather than a passing one.
	 */
	outcome(): GateOutcome {
		if (this.#last === undefined) return "NONE";
		return this.#last.passed ? "PASSED" : "FAILED";
	}

	/** The verification command the final tree passed, when it did. */
	passedGate(): string | undefined {
		return this.#last?.passed === true ? this.#last.command : undefined;
	}
}
