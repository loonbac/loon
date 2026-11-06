/**
 * The startup path's file list and the script's real targets must not drift.
 *
 * The repair cannot import `scripts/gentle-pi-patch.ts` — that would pull a command-line
 * tool into pi's boot — so it carries the file list. This is the test that keeps the copy
 * honest: a target added to the script without the list, or a file renamed on one side, is
 * red here instead of silently unpatched on a person's machine.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PATCHED_FILES } from '../extensions/lib/patch-targets.ts';
import { TARGETS } from '../scripts/gentle-pi-patch.ts';

test('the startup list is exactly the script’s target list, in order', () => {
	assert.deepEqual([...PATCHED_FILES], TARGETS.map((target) => target.file));
});

test('every listed file has at least one edit, so a target cannot be a no-op', () => {
	for (const target of TARGETS) {
		assert.ok(target.edits.length > 0, target.file + ' declares no edits');
	}
});
