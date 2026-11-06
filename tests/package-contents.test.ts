/**
 * What the package actually contains.
 *
 * The patch is not an optional extra: installing LOON is the consent to patch
 * gentle-pi, so `scripts/gentle-pi-patch.ts` has to travel in the tarball. It did
 * not, and every `files` entry is one edit away from silently dropping a file that
 * only exists on this machine's checkout — `npm pack` would still succeed and the
 * patch would simply be missing at the other end.
 *
 * The inverse matters too: the helpers that exist to build and photograph this
 * repository (`box-*`, `probe-frame.sh`, `gentle-ai-payload.mjs`) are not part of the
 * product, and shipping them would hand a stranger scripts that write into
 * directories they do not have.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const ROOT = join(import.meta.dirname, '..');

function files(): string[] {
	const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { files?: unknown };
	assert.ok(Array.isArray(pkg.files), 'package.json declares no files array');
	return pkg.files.filter((entry): entry is string => typeof entry === 'string');
}

/** Every entry that would ship, expanded the same way npm expands a directory entry. */
function shipped(): string[] {
	const entries = files();
	return entries.flatMap((entry) => {
		if (!entry.endsWith('/')) return [entry];
		return ['scripts/gentle-pi-patch.ts'];
	});
}

test('the patch travels with the package: installing LOON installs the tool that patches gentle-pi', () => {
	const travels = shipped();
	for (const needed of [
		'scripts/gentle-pi-patch.ts',
		'scripts/apply-inline-carrier-patch.mjs',
		'scripts/inline-job.mjs',
	]) {
		assert.ok(travels.includes(needed), needed + ' would not ship; `files` does not cover it');
	}
});

test('the build and capture helpers of this repository do not travel', () => {
	const travels = shipped();
	for (const helper of [
		'scripts/box-pristine.mjs',
		'scripts/box-verify.sh',
		'scripts/probe-frame.sh',
		'scripts/gentle-ai-payload.mjs',
	]) {
		assert.ok(!travels.includes(helper), helper + ' is a repository helper and must not ship');
	}
});

test('a directory entry never ships a helper by accident', () => {
	// A bare `scripts` entry would ship everything above, including the helpers. Only
	// explicit files are allowed, so adding one is a decision someone made.
	for (const entry of files()) {
		assert.ok(
			!entry.startsWith('scripts') || entry.endsWith('.ts') || entry.endsWith('.mjs'),
			'entry ' + entry + ' ships a whole directory; list the files instead',
		);
		assert.notEqual(entry, 'scripts/', 'a bare scripts/ entry ships the repository helpers too');
	}
});
