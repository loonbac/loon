/**
 * The write side, where the only interesting question is what happens when it fails.
 *
 * A patcher that leaves gentle-pi half edited is worse than one that does nothing: the
 * session still starts, the banner still paints, and the person has no way to know that
 * the file in front of them is neither gentle-pi nor LOON.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { repairPatch } from '../extensions/lib/patch-repair-write.ts';

const TARGET = { file: 'lib/a.ts', edits: [{ anchor: 'ANCHOR', replacement: 'ANCHOR // patched' }] };

function install(text: string): { install: string; backups: string } {
	const root = mkdtempSync(join(tmpdir(), 'loon-repair-'));
	const base = { install: join(root, 'gentle-pi'), backups: join(root, 'backups') };
	mkdirSync(join(base.install, 'lib'), { recursive: true });
	writeFileSync(join(base.install, 'lib/a.ts'), text);
	return base;
}

test('a target whose anchors fit is patched, and the original is saved first', () => {
	const paths = install('before ANCHOR after');
	const report = repairPatch([TARGET], { ...paths, stamp: 's1' });
	assert.equal(report.problems.length, 0);
	assert.equal(report.applied.length, 1);
	assert.match(readFileSync(join(paths.install, 'lib/a.ts'), 'utf8'), /ANCHOR \/\/ patched/);
	assert.match(readFileSync(join(report.backup as string, 'lib/a.ts'), 'utf8'), /before ANCHOR after/);
});

test('an already patched install rewrites nothing and claims no backup', () => {
	const paths = install('LOON banner patch\nANCHOR // patched');
	const report = repairPatch([TARGET], { ...paths, stamp: 's1' });
	assert.deepEqual(report.applied, []);
	assert.deepEqual(report.problems, []);
	assert.equal(report.backup, undefined);
});

test('a refusal writes nothing at all, and leaves the file byte-identical', () => {
	const paths = install('gentle-pi changed shape');
	const before = readFileSync(join(paths.install, 'lib/a.ts'), 'utf8');
	const report = repairPatch([TARGET], { ...paths, stamp: 's1' });
	assert.deepEqual(report.applied, []);
	assert.equal(report.problems.length, 1);
	assert.match(report.problems[0] as string, /anchor/i);
	assert.equal(readFileSync(join(paths.install, 'lib/a.ts'), 'utf8'), before);
});

test('a write that throws mid-staging leaves every target untouched', () => {
	const paths = install('before ANCHOR after');
	const before = readFileSync(join(paths.install, 'lib/a.ts'), 'utf8');
	const report = repairPatch([TARGET], { ...paths, stamp: 's1' }, {
		write: () => {
			throw new Error('disk full');
		},
	});
	assert.deepEqual(report.applied, []);
	assert.match(report.problems.join(' '), /disk full/);
	assert.equal(
		readFileSync(join(paths.install, 'lib/a.ts'), 'utf8'),
		before,
		'a staging failure must not have renamed anything',
	);
});

test('one refusal among several targets means nothing is written, so no half patched install exists', () => {
	const paths = install('before ANCHOR after');
	const second = { file: 'lib/b.ts', edits: [{ anchor: 'B', replacement: 'B // patched' }] };
	writeFileSync(join(paths.install, 'lib/b.ts'), 'gentle-pi changed shape again');
	const before = readFileSync(join(paths.install, 'lib/a.ts'), 'utf8');
	const report = repairPatch([TARGET, second], { ...paths, stamp: 's1' });
	assert.deepEqual(report.applied, []);
	assert.equal(readFileSync(join(paths.install, 'lib/a.ts'), 'utf8'), before);
	assert.equal(readdirSync(join(paths.install, 'lib')).filter((n) => n.endsWith('.tmp')).length, 0);
});

/**
 * The path that runs at session start: the script is the only implementation of the
 * patch, so the startup repair runs it and trusts its exit code and its words.
 */
test('a successful script run reports nothing, and a refusal carries the script’s own words', async () => {
	const { repairPatchViaScript } = await import('../extensions/lib/patch-repair-write.ts');
	const ok = repairPatchViaScript(
		{ install: '/i', backups: '/b', script: '/s.ts' },
		() => ({ status: 0 }),
	);
	assert.deepEqual(ok.problems, []);

	const refused = repairPatchViaScript(
		{ install: '/i', backups: '/b', script: '/s.ts' },
		() => ({ status: 1, stderr: 'lib/shell-bar.ts: anchor moved\n  address: lib/shell-bar.ts:232' }),
	);
	assert.deepEqual(refused.applied, []);
	assert.equal(refused.problems.length, 2);
	assert.match(refused.problems[0] as string, /anchor moved/);
});

test('a script that cannot run is a reported problem, never a throw at startup', async () => {
	const { repairPatchViaScript } = await import('../extensions/lib/patch-repair-write.ts');
	const report = repairPatchViaScript({ install: '/i', backups: '/b', script: '/s.ts' }, () => {
		throw new Error('spawn ENOENT');
	});
	assert.match(report.problems.join(' '), /ENOENT/);
});

test('a silent failure still says something a person can act on', async () => {
	const { repairPatchViaScript } = await import('../extensions/lib/patch-repair-write.ts');
	const report = repairPatchViaScript({ install: '/i', backups: '/b', script: '/s.ts' }, () => ({ status: 64 }));
	assert.match(report.problems[0] as string, /exited with status 64/);
});
