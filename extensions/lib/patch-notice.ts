import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The status key the notice lives under, so it survives the scrollback and can be cleared. */
export const PATCH_NOTICE_KEY = 'loon:patch';

/**
 * One marker per file the patch targets, and only ever written by the patch.
 *
 * A marker is not a digest: a gentle-pi update replaces the files, and the question
 * at session start is "is LOON's chrome still installed?", not "is this the exact
 * build". `tests/patch-notice.test.ts` compares this table with the patch targets,
 * so a new target cannot be forgotten here.
 */
export const PATCH_MARKERS: ReadonlyArray<{ file: string; marker: string }> = [
	{ file: 'extensions/gentle-shell.ts', marker: 'LOON_BANNER_SOURCES' },
	{ file: 'lib/visual-customize-view.ts', marker: 'row.label(rightWidth)' },
	{ file: 'extensions/startup-banner.ts', marker: 'readLoonBannerSource' },
	{ file: 'lib/shell-bar.ts', marker: 'loonThemeActive' },
	{ file: 'lib/shell-card.ts', marker: 'CARD_GEOMETRY' },
	{ file: 'lib/card-style-policy.ts', marker: 'CARD_STYLE.LOON' },
	{ file: 'lib/shell-prompt.ts', marker: 'chrome === "loon"' },
];

/**
 * This repository, from the URL of any module inside it.
 *
 * The command in the notice has to work from any cwd, so it carries the absolute path
 * of the repository instead of asking the reader to find it.
 * @param {string} moduleUrl usually `import.meta.url`
 * @returns {string}
 */
export function repoRootOf(moduleUrl: string): string {
	// Walk up until the directory that holds the patch itself: exact for a module in
	// extensions/ and for one in extensions/lib/, which sit at different depths.
	let dir = dirname(fileURLToPath(moduleUrl));
	for (let step = 0; step < 6; step += 1) {
		if (existsSync(join(dir, 'scripts', 'gentle-pi-patch.ts'))) return dir;
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return dirname(dir);
}

/** Where the patch lives in this repository. */
export const PATCH_COMMAND = 'node --experimental-strip-types scripts/gentle-pi-patch.ts apply';

/** Where an installed gentle-pi may be, newest layout first. */
export function gentlePiRoots(home: string = homedir()): string[] {
	return [
		join(home, '.pi', 'agent', 'npm', 'node_modules', 'gentle-pi'),
		join(home, '.local', 'share', 'loon-pi', 'npm-prefix', 'lib', 'node_modules', 'gentle-pi'),
	];
}

/**
 * The files whose LOON marker is gone.
 *
 * Read-only by construction: it opens the files and never writes, so it can run at
 * session start without turning an update in flight into a silent write.
 * @param {string} install the installed gentle-pi root
 * @param {(path: string) => string} read
 * @returns {string[]} the targets that lost their marker, empty when nothing is missing
 */
export function missingPatches(install: string, read: (path: string) => string = (path) => readFileSync(path, 'utf8')): string[] {
	const missing: string[] = [];
	for (const { file, marker } of PATCH_MARKERS) {
		try {
			if (!read(join(install, file)).includes(marker)) missing.push(file);
		} catch {
			missing.push(file);
		}
	}
	return missing;
}

/**
 * What to say, and what to run.
 *
 * It names what was lost and the exact command with its absolute path: the owner lost
 * this in silence once, and "there is an update pending" would lose it again.
 * @param {string[]} missing
 * @param {string} repo this repository
 * @returns {string}
 */
export function patchNoticeText(missing: readonly string[], repo: string): string {
	const lost = missing.length === 0 ? '' : missing.some((file) => file === 'lib/shell-card.ts' || file === 'lib/shell-prompt.ts')
		? 'geometría de tarjetas'
		: 'parte del chrome';
	return 'parche LOON perdido (' + lost + ', barra y filas de banner): ' + missing.length + ' de ' + PATCH_MARKERS.length + ' archivos. Arreglalo con: cd ' + repo + ' && ' + PATCH_COMMAND;
}

/** The first installed gentle-pi, or undefined when there is none to inspect. */
export function installedGentlePi(home: string = homedir()): string | undefined {
	return gentlePiRoots(home).find((root) => existsSync(join(root, 'package.json')));
}
