/**
 * The inline work view is gone, and nothing may bring it back halfway.
 *
 * The feature drew the parent's own work as a card and collapsed its prose into one
 * `· inline · /gentle:agents` line. The owner asked for the deletion, so the failure
 * this file guards against is a dormant piece: a file that no longer has a reader but
 * still ships, a transcript transformer that still rewrites the message, or an
 * environment variable that suggests a behaviour nobody implements.
 *
 * Everything here reads files and the declared package surface. Nothing imports the
 * extension, because the point is that there is no module left to import.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const ROOT = join(import.meta.dirname, '..');

function pkg(): Record<string, any> {
	return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as Record<string, any>;
}

/** Every tracked source file of the repository, minus the installed tree. */
function sources(dir = ROOT): string[] {
	const found: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.name === 'node_modules' || entry.name === '.git') continue;
		const full = join(dir, entry.name);
		if (entry.isDirectory()) found.push(...sources(full));
		else if (/\.(ts|mts|js|mjs|json)$/.test(entry.name)) found.push(full);
	}
	return found;
}

test('no inline module survives in the repository', () => {
	for (const gone of [
		'extensions/inline-work.ts',
		'extensions/lib/inline-carrier.ts',
		'extensions/lib/inline-collapse.ts',
		'extensions/lib/inline-history.ts',
		'extensions/lib/inline-overlay.ts',
		'extensions/lib/inline-transcript.ts',
		'scripts/inline-job.mjs',
		'scripts/apply-inline-carrier-patch.mjs',
	]) {
		assert.equal(existsSync(join(ROOT, gone)), false, gone + ' should have been deleted');
	}
});

test('the package declares the startup extension and nothing else', () => {
	const declared = pkg().pi?.extensions;
	assert.deepEqual(declared, ['./extensions/loon-startup.ts']);
	for (const entry of declared as string[]) {
		assert.equal(existsSync(join(ROOT, entry.replace(/^\.\//, ''))), true, entry + ' does not exist');
	}
});

test('nothing in the sources reads an inline switch or writes a carrier', () => {
	const forbidden = ['LOON_INLINE_WORK', 'LOON_INLINE_TRANSCRIPT', '__loonInlinePanel', 'loon-inline'];
	const self = join(ROOT, 'tests', 'inline-retired.test.ts');
	for (const file of sources()) {
		// The ODD record quotes the decision, and this file has to name what it forbids.
		if (file.includes(join(ROOT, 'odd')) || file === self) continue;
		const text = readFileSync(file, 'utf8');
		for (const needle of forbidden) {
			assert.equal(
				text.includes(needle),
				false,
				file.slice(ROOT.length + 1) + ' still mentions ' + needle,
			);
		}
	}
});

test('the shipped scripts are the patch and nothing else', () => {
	const scripts = Object.keys(pkg().scripts ?? {});
	assert.equal(scripts.includes('inline-job'), false, 'the inline job script is gone');

	assert.equal(
		(pkg().files as string[]).includes('scripts/inline-job.mjs'),
		false,
		'inline-job.mjs would ship',
	);
	assert.equal(
		(pkg().files as string[]).includes('scripts/apply-inline-carrier-patch.mjs'),
		false,
		'the carrier patch would ship',
	);
});
