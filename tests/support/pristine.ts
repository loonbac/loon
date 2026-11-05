import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * The pristine gentle-pi bytes the patch and its digests are measured against, found at
 * run time and never committed.
 *
 * Committing a whole foreign package cost 6,900 of 7,779 reviewed lines once, which put the
 * candidate out of the reviewer's budget. What is committed instead is one SHA-256 per file:
 * a few hundred bytes that make the *provenance* verifiable. The bytes come from a source
 * that already exists on the machine, in the documented order below, and every file is
 * hashed before use.
 *
 * The rule: a missing source is a visible skip with a reason; bytes that are present but do
 * not hash to the record are a failure. Never recompute a digest against bytes that are not
 * the ones we measured.
 */
const HERE = dirname(new URL(import.meta.url).pathname);
const RECORD = JSON.parse(readFileSync(join(HERE, '..', 'fixtures', 'pristine-digests.json'), 'utf8')) as {
	version: string;
	files: Record<string, string>;
};

export const PRISTINE_VERSION = RECORD.version;
export const PRISTINE_FILES = Object.keys(RECORD.files).sort();
export const PRISTINE_SHA = RECORD.files;

export interface PristineSource {
	root: string;
	/** Where these bytes came from, so a failing test can say what it verified against. */
	label: string;
}

export type PristineResolution =
	| { ok: true; source: PristineSource }
	| { ok: false; reason: string };

export function sha256(path: string): string {
	return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/**
 * The files of `root` that are missing or whose bytes are not the pinned build.
 *
 * Exported because the box procedure needs the same judgement as the tests: the transfer of
 * a pristine copy is checked by hashing, not by trusting that the copy worked.
 */
export function verifyDirectory(root: string): { missing: string[]; wrong: Array<{ file: string; expected: string; found: string }> } {
	const missing: string[] = [];
	const wrong: Array<{ file: string; expected: string; found: string }> = [];
	for (const file of PRISTINE_FILES) {
		const path = join(root, file);
		if (!existsSync(path)) {
			missing.push(file);
			continue;
		}
		const found = sha256(path);
		if (found !== PRISTINE_SHA[file]) wrong.push({ file, expected: PRISTINE_SHA[file]!, found });
	}
	return { missing, wrong };
}

/** The newest patch backup, newest first; each one holds the bytes that were there before. */
function backups(): string[] {
	const dir = join(homedir(), '.pi', 'agent', 'backups');
	try {
		return readdirSync(dir)
			.filter((entry) => entry.startsWith('gentle-pi-banner-patch-'))
			.sort()
			.reverse()
			.map((entry) => join(dir, entry));
	} catch {
		return [];
	}
}

/** The installed package roots, in the same order the rest of the repo looks for them. */
function installedRoots(): string[] {
	return [
		join(homedir(), '.pi', 'agent', 'npm', 'node_modules', 'gentle-pi'),
		join(homedir(), '.local', 'share', 'loon-pi', 'npm-prefix', 'lib', 'node_modules', 'gentle-pi'),
	];
}

/**
 * Resolve the pristine sources, in this order and no other:
 *
 * 1. `GENTLE_PI_ROOT` — an explicit declaration. Its bytes must be the pinned build; a
 *    mismatch fails, because the caller said where to look.
 * 2. The newest patch backup that holds all seven files. A backup that does not hash right
 *    is another version, so it is passed over rather than trusted.
 * 3. The installed package, **only while unpatched**: once the patch is applied its bytes
 *    are ours, not pristine.
 *
 * Any other outcome is `{ ok: false, reason }`, which the tests turn into a visible skip.
 */
export function pristineSource(env: NodeJS.ProcessEnv = process.env): PristineResolution {
	const checked: string[] = [];
	const explicit = env.GENTLE_PI_ROOT;
	if (explicit !== undefined && explicit.length > 0) {
		const { missing, wrong } = verifyDirectory(explicit);
		if (missing.length > 0) {
			return { ok: false, reason: `GENTLE_PI_ROOT=${explicit} holds ${missing.length} of ${PRISTINE_FILES.length} prístinos (falta ${missing[0]})` };
		}
		if (wrong.length > 0) {
			const first = wrong[0]!;
			throw new Error(
				'GENTLE_PI_ROOT is not the pinned gentle-pi ' +
					PRISTINE_VERSION +
					': ' +
					first.file +
					' hashes to ' +
					first.found +
					', the record says ' +
					first.expected,
			);
		}
		return { ok: true, source: { root: explicit, label: 'GENTLE_PI_ROOT' } };
	}
	for (const root of backups()) {
		const { missing, wrong } = verifyDirectory(root);
		if (missing.length === 0 && wrong.length === 0) return { ok: true, source: { root, label: 'backup ' + root.split('/').pop() } };
		checked.push(root + (missing.length > 0 ? ' (incompleto)' : ' (otros bytes)'));
	}
	for (const root of installedRoots()) {
		if (!existsSync(join(root, 'package.json'))) continue;
		const { missing, wrong } = verifyDirectory(root);
		if (missing.length === 0 && wrong.length === 0) return { ok: true, source: { root, label: 'installed ' + root } };
		checked.push(root + (missing.length > 0 ? ' (incompleto)' : ' (parcheado u otra versión)'));
	}
	return {
		ok: false,
		reason:
			'no hay prístinos de gentle-pi ' +
			PRISTINE_VERSION +
			' disponibles: ' +
			(checked.length === 0 ? 'ningún backup ni paquete instalado' : checked.join(', ')),
	};
}

/** Read one pristine file, verifying it against the record first. */
export function readPristine(source: PristineSource, file: string): string {
	const expected = PRISTINE_SHA[file];
	if (expected === undefined) throw new Error('no recorded digest for ' + file);
	const path = join(source.root, file);
	const found = sha256(path);
	if (found !== expected) {
		throw new Error(
			source.label + ' is not the pinned ' + PRISTINE_VERSION + ': ' + file + ' hashes to ' + found + ', the record says ' + expected,
		);
	}
	return readFileSync(path, 'utf8');
}
