#!/usr/bin/env node
/**
 * The pristine half of the box procedure, so it is guaranteed instead of documented.
 *
 * A backup copy that silently did not arrive would turn the digest tests into visible skips,
 * and a skip looks like a pass in a summary line. So the transfer is checked before anything
 * runs: one hash per file against `tests/fixtures/pristine-digests.json`.
 *
 *   node scripts/box-pristine.mjs prepare            print the pristine source to copy
 *   node scripts/box-pristine.mjs verify <dir>       exit 1 unless every file hashes right
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PRISTINE_FILES, pristineSource, verifyDirectory } from '../tests/support/pristine.ts';

const [command, ...rest] = process.argv.slice(2);

if (command === 'prepare') {
	const resolved = pristineSource();
	if (!resolved.ok) {
		console.error(resolved.reason);
		process.exit(1);
	}
	console.log(resolved.source.root);
	process.exit(0);
}

if (command === 'verify') {
	const dir = rest[0];
	if (dir === undefined) {
		console.error('usage: box-pristine.mjs verify <dir>');
		process.exit(2);
	}
	const root = resolve(dir);
	if (!existsSync(root)) {
		console.error('the pristine copy did not arrive: ' + root);
		process.exit(1);
	}
	const { missing, wrong } = verifyDirectory(root);
	if (missing.length > 0) {
		console.error('the pristine copy is incomplete: ' + missing.length + ' of ' + PRISTINE_FILES.length + ' files missing, first ' + missing[0]);
		process.exit(1);
	}
	if (wrong.length > 0) {
		const first = wrong[0];
		console.error('the pristine copy is not the pinned build: ' + first.file + ' hashes to ' + first.found + ', the record says ' + first.expected);
		process.exit(1);
	}
	console.log('pristine copy verified: ' + root);
	process.exit(0);
}

console.error('usage: box-pristine.mjs prepare | verify <dir>');
process.exit(2);
