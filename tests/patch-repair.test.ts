/**
 * The patch repairs itself, and a repair that cannot happen never costs the session.
 *
 * Installing LOON is the consent to patch gentle-pi, so a gentle-pi update that replaces
 * the patched files must be repaired on the next start without asking again. What it must
 * never do is make things worse on the way: a patch that half-applies, throws, or runs on
 * every render would turn a cosmetic extension into the reason pi does not start.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

// The repair is pure by design: it is given what a target file says and what it may do,
// and returns a verdict. That is what lets these tests describe every failure without a
// real gentle-pi install.
const { repairVerdict, REPAIR_OUTCOME } = await import('../extensions/lib/patch-repair.ts');

const TARGET = {
	file: 'extensions/gentle-shell.ts',
	edits: [{ anchor: 'ANCHOR', replacement: 'ANCHOR // patched' }],
};

test('a file that is already patched is left alone', () => {
	const verdict = repairVerdict('LOON banner patch\nANCHOR // patched', TARGET);
	assert.equal(verdict.outcome, REPAIR_OUTCOME.already);
});

test('a file whose anchors still fit is repairable', () => {
	const verdict = repairVerdict('original text with ANCHOR inside', TARGET);
	assert.equal(verdict.outcome, REPAIR_OUTCOME.repairable);
	assert.match(String(verdict.text), /ANCHOR \/\/ patched/);
});

test('a file whose anchors moved is refused with the file and the reason, never patched anyway', () => {
	const verdict = repairVerdict('gentle-pi changed and the anchor is gone', TARGET);
	assert.equal(verdict.outcome, REPAIR_OUTCOME.refused);
	assert.equal(verdict.file, TARGET.file);
	assert.match(String(verdict.reason), /anchor/i);
	assert.equal(verdict.text, undefined, 'a refusal must not carry replacement text');
});

test('a missing target is refused, not invented', () => {
	const verdict = repairVerdict(undefined, TARGET);
	assert.equal(verdict.outcome, REPAIR_OUTCOME.missing);
	assert.equal(verdict.file, TARGET.file);
});

test('an ambiguous anchor — present twice — is refused rather than patched in both places', () => {
	const double = { file: 'x.ts', edits: [{ anchor: 'A', replacement: 'B' }] };
	assert.equal(repairVerdict('A and A', double).outcome, REPAIR_OUTCOME.refused);
});

test('every outcome is a closed set: no verdict can be "maybe"', () => {
	assert.deepEqual(Object.keys(REPAIR_OUTCOME).sort(), ['already', 'missing', 'refused', 'repairable']);
	assert.deepEqual(
		[...new Set(Object.values(REPAIR_OUTCOME))].sort(),
		['already', 'missing', 'refused', 'repairable'],
	);
});

/**
 * The install a repair looks at has to be the install pi is actually using.
 *
 * Somebody running pi with `PI_CODING_AGENT_DIR` set has gentle-pi under that directory.
 * A roots list built only from `$HOME` answers "no gentle-pi here", which reads as "nothing
 * to repair" and silently skips the repair that was the whole point.
 */
test('the install roots include pi’s own agent home, not only $HOME', async () => {
	const { gentlePiRoots } = await import('../extensions/lib/patch-notice.ts');
	const roots = gentlePiRoots('/home/someone', { PI_CODING_AGENT_DIR: '/tmp/custom-agent' });
	assert.equal(roots[0], '/tmp/custom-agent/npm/node_modules/gentle-pi');
	assert.ok(
		roots.includes('/home/someone/.pi/agent/npm/node_modules/gentle-pi'),
		'the default location stays in the list',
	);
});

test('with no override the list is the historical one, in the same order', async () => {
	const { gentlePiRoots } = await import('../extensions/lib/patch-notice.ts');
	assert.deepEqual(gentlePiRoots('/home/someone', {}), [
		'/home/someone/.pi/agent/npm/node_modules/gentle-pi',
		'/home/someone/.local/share/loon-pi/npm-prefix/lib/node_modules/gentle-pi',
	]);
});
