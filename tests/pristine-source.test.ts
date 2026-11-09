import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { PRISTINE_FILES, PRISTINE_SHA, PRISTINE_VERSION, pristineSource, readPristine, verifyDirectory } from './support/pristine.ts';
import { TARGETS } from '../scripts/gentle-pi-patch.ts';

/**
 * The rule: the pristine bytes are never committed, so the record has to prove their
 * provenance. A source that is absent is a visible skip; bytes that are present but differ
 * from the record are a failure, because they are not the build the digests were measured on.
 */
const REAL = pristineSource();

/** A copy of the real pristine sources, so a test can damage one thing at a time. */
function copyOfReal(): string {
	if (!REAL.ok) throw new Error('no pristine sources to copy: ' + REAL.reason);
	const root = mkdtempSync(join(tmpdir(), 'loon-pristine-'));
	for (const file of PRISTINE_FILES) {
		mkdirSync(dirname(join(root, file)), { recursive: true });
		writeFileSync(join(root, file), readPristine(REAL.source, file));
	}
	return root;
}

test('the record names one SHA-256 per patch target, and nothing else', () => {
	assert.equal(PRISTINE_VERSION, '4.7.0');
	assert.deepEqual(PRISTINE_FILES, TARGETS.map((target) => target.file).sort(), 'the record and the patch targets drifted apart');
	for (const [file, digest] of Object.entries(PRISTINE_SHA)) {
		assert.match(digest, /^[0-9a-f]{64}$/, file + ' has no SHA-256');
	}
});

test('an explicit source with the pinned bytes is accepted, and says it is the one', () => {
	const root = copyOfReal();
	try {
		const resolved = pristineSource({ GENTLE_PI_ROOT: root });
		assert.equal(resolved.ok, true);
		if (resolved.ok) assert.equal(resolved.source.label, 'GENTLE_PI_ROOT');
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('an explicit source missing a file is a visible skip, not a pass', () => {
	const root = copyOfReal();
	try {
		rmSync(join(root, 'lib', 'shell-card.ts'));
		const resolved = pristineSource({ GENTLE_PI_ROOT: root });
		assert.equal(resolved.ok, false, 'a source with a missing file was accepted');
		if (!resolved.ok) assert.match(resolved.reason, /1 of 7 prístinos/, resolved.reason);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('one corrupted byte fails loudly instead of silently re-measuring', () => {
	const root = copyOfReal();
	try {
		const path = join(root, 'lib', 'shell-bar.ts');
		writeFileSync(path, readFileSync(path, 'utf8').replace('export', 'exporT'));
		assert.throws(
			() => pristineSource({ GENTLE_PI_ROOT: root }),
			/lib\/shell-bar\.ts hashes to [0-9a-f]{64}, the record says [0-9a-f]{64}/,
			'a corrupted pristine file was accepted',
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('a transferred copy is judged by its hashes, which is what the box procedure trusts', () => {
	// The box script runs this before anything else, so an incomplete or wrong copy stops the
	// run instead of turning the digest tests into skips that read as a pass.
	const root = copyOfReal();
	try {
		assert.deepEqual(verifyDirectory(root), { missing: [], wrong: [] });
		rmSync(join(root, 'lib', 'shell-prompt.ts'));
		assert.deepEqual(verifyDirectory(root).missing, ['lib/shell-prompt.ts']);
		writeFileSync(join(root, 'lib', 'shell-prompt.ts'), readPristine(REAL.ok ? REAL.source : { root, label: 'x' }, 'lib/shell-bar.ts').replace('export', 'exporT'));
		const after = verifyDirectory(root);
		assert.equal(after.wrong.length, 1, JSON.stringify(after));
		assert.equal(after.wrong[0]?.file, 'lib/shell-prompt.ts');
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test('reading a pristine file verifies it every time', () => {
	if (!REAL.ok) return;
	const text = readPristine(REAL.source, 'lib/shell-prompt.ts');
	assert.ok(text.includes('PromptLayout'), 'the pristine file does not look like its target');
	assert.throws(() => readPristine(REAL.source, 'lib/not-a-target.ts'), /no recorded digest/);
});

test('with no source at all the reason names what was looked for', () => {
	// An empty GENTLE_PI_ROOT is not a source, so the resolver reports what it checked.
	const resolved = pristineSource({ GENTLE_PI_ROOT: '' });
	if (resolved.ok) {
		// The machine has a backup or an unpatched install; the label must say which.
		assert.match(resolved.source.label, /^(backup|installed|GENTLE_PI_ROOT)/, resolved.source.label);
		return;
	}
	assert.match(resolved.reason, /no hay prístinos de gentle-pi 4\.6\.0 disponibles/, resolved.reason);
});
