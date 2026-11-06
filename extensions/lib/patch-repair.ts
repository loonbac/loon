/**
 * The patch as state that repairs itself.
 *
 * Installing LOON is the consent to patch gentle-pi, and an update to gentle-pi or to pi
 * replaces the files this patch edits. Those are the same event from LOON's point of view:
 * the markers are gone. So the question asked at every start is not "was this installed",
 * it is "are my markers there", and if they are not, the patch is applied again.
 *
 * This module is the part of that decision that can be described without touching a real
 * install: given what a target file says, what would happen to it. It is deliberately
 * pure, so every branch — including the ones a person will only ever hit once, on a bad
 * day, in the middle of a release — is testable here.
 *
 * The three failures are distinct on purpose. `refused` means gentle-pi changed shape and
 * a new LOON is needed; that is a message to publish, not to retry. `missing` means the
 * file is not where an install would put it. `already` means there is nothing to do.
 */
import { isPatched, patchTextFor, type PatchableTarget } from './patch-target.ts';

/** Every answer the repair can give. A closed set, so no caller has to guess. */
export const REPAIR_OUTCOME = {
	/** The marker is already there: this file needs nothing. */
	already: 'already',
	/** The anchors still fit: `text` holds the patched content, ready to write. */
	repairable: 'repairable',
	/** gentle-pi changed shape: the anchors moved or became ambiguous. */
	refused: 'refused',
	/** The file is not there at all. */
	missing: 'missing',
} as const;

export type RepairOutcome = (typeof REPAIR_OUTCOME)[keyof typeof REPAIR_OUTCOME];

export interface RepairVerdict {
	outcome: RepairOutcome;
	file: string;
	/** Only for `repairable`: the exact bytes to write. */
	text?: string;
	/** Only for `refused` and `missing`: why, in words a person can act on. */
	reason?: string;
}

/**
 * What should happen to one target file.
 *
 * `current` is what the file says on disk, or undefined when it does not exist. Nothing
 * here writes: the caller owns the backup, the write and its atomicity, which is what keeps
 * this decision free of side effects.
 */
export function repairVerdict(current: string | undefined, target: PatchableTarget): RepairVerdict {
	const file = target.file;
	if (current === undefined) {
		return { outcome: REPAIR_OUTCOME.missing, file, reason: file + ': file not found' };
	}
	if (isPatched(current)) {
		return { outcome: REPAIR_OUTCOME.already, file };
	}
	const patched = patchTextFor(current, target);
	if (!patched.ok) {
		// The reason already names the anchor, its address and how many times it appeared,
		// so it is passed through rather than summarised into something less useful.
		return { outcome: REPAIR_OUTCOME.refused, file, reason: patched.reason };
	}
	return { outcome: REPAIR_OUTCOME.repairable, file, text: patched.text };
}

/**
 * Fold the per-file verdicts into one summary a caller can act on.
 *
 * One refusal anywhere means nothing is applied at all: a partially patched gentle-pi is a
 * state nobody can reason about, and it is exactly the half-finished update that goes
 * silent. `ready` is true only when at least one file needs writing and none refused.
 */
export function repairSummary(verdicts: readonly RepairVerdict[]): {
	ready: boolean;
	writes: RepairVerdict[];
	problems: RepairVerdict[];
} {
	const writes = verdicts.filter((verdict) => verdict.outcome === REPAIR_OUTCOME.repairable);
	const problems = verdicts.filter(
		(verdict) => verdict.outcome === REPAIR_OUTCOME.refused || verdict.outcome === REPAIR_OUTCOME.missing,
	);
	return { ready: writes.length > 0 && problems.length === 0, writes, problems };
}
