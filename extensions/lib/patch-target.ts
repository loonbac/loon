/**
 * The shape of a patch target, without the applier.
 *
 * `scripts/gentle-pi-patch.ts` owns the real anchors and the real edits, and it is a
 * script: it can use node APIs and it is run by hand. This module exists so the startup
 * path can reason about a target *without importing that script*, which would pull a
 * command-line tool into pi's boot for the sake of one predicate.
 *
 * It is the same rule, written once: an edit applies only when its anchor occurs exactly
 * once, and a file that already carries the marker is not patched twice.
 */
export const PATCH_MARKER = 'LOON banner patch';

export interface PatchableEdit {
	anchor: string;
	replacement: string;
}

export interface PatchableTarget {
	file: string;
	edits: readonly PatchableEdit[];
}

/** True when the file already carries this patch. */
export function isPatched(text: string): boolean {
	return text.includes(PATCH_MARKER);
}

export type PatchAttempt = { ok: true; text: string } | { ok: false; reason: string };

/**
 * Apply every edit, or none.
 *
 * The occurrence count is checked before replacing anything, so an anchor that appears
 * twice is a refusal rather than two silent replacements in the wrong places.
 */
export function patchTextFor(text: string, target: PatchableTarget): PatchAttempt {
	if (isPatched(text)) return { ok: true, text };
	let next = text;
	for (const edit of target.edits) {
		const occurrences = next.split(edit.anchor).length - 1;
		if (occurrences !== 1) {
			return {
				ok: false,
				reason:
					'anchor for ' + target.file + ' appears ' + occurrences + ' time(s), expected exactly 1',
			};
		}
		next = next.replace(edit.anchor, () => edit.replacement);
	}
	return { ok: true, text: next };
}
