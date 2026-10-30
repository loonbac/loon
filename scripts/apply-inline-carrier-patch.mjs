#!/usr/bin/env node
/**
 * LOON inline carrier patch: teach gentle-pi's Agents card to draw the parent's
 * inline work.
 *
 * The carrier itself comes from LOON's own extension (`extensions/inline-work.ts`
 * writes one TaskRecord-shaped file per session under
 * `<agent home>/state/loon-inline/`). gentle-pi renders that card from
 * `visibleTasks()` in `extensions/gentle-agents.ts`, and nothing else in the
 * package needs to know the records exist.
 *
 * This edits another installed package, so it is deliberately paranoid:
 *
 *   - the anchor must appear exactly once, so a partial match cannot leave half a
 *     patch behind, and a moved anchor fails loudly instead of silently doing
 *     nothing;
 *   - the patched text is checked for balance and, when the repository's own
 *     TypeScript is available, transpiled to prove it still parses;
 *   - the original goes to a timestamped backup first, and `revert` puts it back
 *     and verifies its md5;
 *   - reapplying is a no-op that verifies instead of rewriting, so a package
 *     update that drops the patch is the only thing that ever needs this rerun.
 *
 *   node scripts/apply-inline-carrier-patch.mjs check   [--install DIR] [--backups DIR]
 *   node scripts/apply-inline-carrier-patch.mjs apply   [--install DIR] [--backups DIR]
 *   node scripts/apply-inline-carrier-patch.mjs revert  [--install DIR] [--backups DIR]
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Every patched file carries this marker, which also makes the patch idempotent. */
export const PATCH_MARKER = 'LOON inline carrier patch';

/** The one file this patch touches, relative to the gentle-pi package root. */
export const TARGET_FILE = 'extensions/gentle-agents.ts';

/** The exact line the patch replaces, in gentle-pi 4.5.x. */
export const ANCHOR = '\tconst visibleTasks = (): TaskRecord[] => store.list(activeSessionId());';

/** Backup directories are named after this, mirroring the banner patch. */
export const BACKUP_PREFIX = 'loon-inline-carrier-patch-';

/** The carrier directory, relative to the agent home. */
export const CARRIER_DIR = 'state/loon-inline';

/**
 * The replacement: a reader for the carrier file plus the same `visibleTasks`
 * the package had, now with the carrier appended. Only imports the file already
 * has (`existsSync`, `readFileSync`, `join`, `TASK_STATUS`, `TaskRecord`) are
 * used, so no import line changes.
 */
export const REPLACEMENT = [
	'\t// LOON inline carrier patch: while the parent itself programs inline, LOON',
	'\t// writes a TaskRecord-shaped record (agent "gentle-ai-worker", mode "inline")',
	'\t// into state/loon-inline/<sessionId>.json. Drawing it here is the whole point:',
	'\t// the inline work reads as one agent instead of flooding the transcript. It is',
	'\t// display only - the record never enters the store, so it is never an owned',
	'\t// child, never cancellable, and never launch authority.',
	'\tconst INLINE_CARRIER_LIVE_MS = 10 * 60 * 1000;',
	'\tconst inlineCarrierTask = (sessionId: string | undefined): TaskRecord | undefined => {',
	'\t\tif (sessionId === undefined || sessionId.length === 0) return undefined;',
	'\t\ttry {',
	'\t\t\tconst path = join(agentHome, "state", "loon-inline", sessionId + ".json");',
	'\t\t\tif (!existsSync(path)) return undefined;',
	'\t\t\tconst parsed: unknown = JSON.parse(readFileSync(path, "utf8"));',
	'\t\t\tif (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;',
	'\t\t\tconst carrier = parsed as TaskRecord;',
	'\t\t\tif (carrier.parentSessionId !== sessionId || typeof carrier.id !== "string" || typeof carrier.agent !== "string" || typeof carrier.label !== "string") return undefined;',
	'\t\t\tconst running = carrier.status === TASK_STATUS.RUNNING;',
	'\t\t\tif (!running && carrier.status !== TASK_STATUS.COMPLETED) return undefined;',
	'\t\t\t// A record left behind by a dead pi must not pose as live work: a running one',
	'\t\t\t// heartbeats every 20s, a finished one is this session history.',
	'\t\t\tconst seen = typeof carrier.lastActivityAt === "number" ? carrier.lastActivityAt : 0;',
	'\t\t\tconst age = Date.now() - seen;',
	'\t\t\tif (!Number.isFinite(age) || age < 0 || age > (running ? INLINE_CARRIER_LIVE_MS : 24 * 60 * 60 * 1000)) return undefined;',
	'\t\t\treturn carrier;',
	'\t\t} catch {',
	'\t\t\treturn undefined;',
	'\t\t}',
	'\t};',
	'\tconst visibleTasks = (): TaskRecord[] => {',
	'\t\tconst tasks = store.list(activeSessionId());',
	'\t\tconst carrier = inlineCarrierTask(activeSessionId());',
	'\t\tif (carrier === undefined || tasks.some((task) => task.id === carrier.id)) return tasks;',
	'\t\treturn [...tasks, carrier].sort((a, b) => b.lastActivityAt - a.lastActivityAt || b.createdAt - a.createdAt);',
	'\t};',
].join('\n');

/** Where the package and the backups live unless the caller says otherwise. */
/**
 * @returns {{ install: string, backups: string }}
 */
export function defaultPaths() {
	return {
		install: join(homedir(), '.pi', 'agent', 'npm', 'node_modules', 'gentle-pi'),
		backups: join(homedir(), '.pi', 'agent', 'backups'),
	};
}

/**
 * @param {string} text
 * @returns {string}
 */
export function md5(text) {
	return createHash('md5').update(text).digest('hex');
}

function occurrences(text, needle) {
	return text.split(needle).length - 1;
}

/**
 * The replacement has to be balanced on its own: the anchor was one balanced
 * statement, so a balanced replacement cannot unbalance the file it lands in.
 */
/**
 * @returns {boolean}
 */
export function replacementBalanced() {
	const pairs = [['{', '}'], ['(', ')'], ['[', ']']];
	return pairs.every(([open, close]) => occurrences(REPLACEMENT, open) === occurrences(REPLACEMENT, close));
}

/**
 * Everything this script promises about a patched file, checked in one place.
 * @param {string} text
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function verifyPatched(text) {
	if (!text.includes(PATCH_MARKER)) return { ok: false, reason: 'the marker is missing' };
	if (occurrences(text, ANCHOR) !== 0) return { ok: false, reason: 'the unpatched anchor is still there' };
	// The patched file must still list the store: the patch adds a record, it does
	// not replace what the card already showed.
	if (occurrences(text, 'const tasks = store.list(activeSessionId());') !== 1) return { ok: false, reason: 'the original store lookup is gone' };
	if (occurrences(text, 'const visibleTasks = (): TaskRecord[] => {') !== 1) return { ok: false, reason: 'the patched visibleTasks is missing or duplicated' };
	if (occurrences(text, 'const inlineCarrierTask = (sessionId: string | undefined)') !== 1) return { ok: false, reason: 'the carrier reader is missing or duplicated' };
	return { ok: true };
}

/**
 * @param {string | undefined} text
 * @returns {'missing' | 'clean' | 'patched' | 'patched-modified' | 'different-version'}
 */
export function classify(text) {
	if (text === undefined) return 'missing';
	if (text.includes(PATCH_MARKER)) return verifyPatched(text).ok ? 'patched' : 'patched-modified';
	return occurrences(text, ANCHOR) === 1 ? 'clean' : 'different-version';
}

/**
 * The pure transformation: text in, patched text out.
 * @param {string} text
 * @returns {{ ok: true, text: string, changed: boolean } | { ok: false, reason: string }}
 */
export function patchText(text) {
	if (text.includes(PATCH_MARKER)) return { ok: true, text, changed: false };
	const found = occurrences(text, ANCHOR);
	if (found === 0) {
		return {
			ok: false,
			reason:
				'the anchor moved: this exact line is not in the file\n' +
				'    ' + ANCHOR.trim() + '\n' +
				'gentle-pi changed. Update scripts/apply-inline-carrier-patch.mjs against the new build instead of forcing it.',
		};
	}
	if (found > 1) return { ok: false, reason: 'the anchor appears ' + found + ' times, expected exactly 1' };
	if (!replacementBalanced()) return { ok: false, reason: 'the replacement text is not balanced; refusing to write it' };
	return { ok: true, text: text.replace(ANCHOR, () => REPLACEMENT), changed: true };
}

/**
 * A syntax gate, so a typo in the replacement cannot reach a person's terminal.
 * Only the repository's own TypeScript is used, and only when it is installed:
 * a missing compiler is reported, never invented.
 */
/**
 * @param {string} text
 * @returns {Promise<{ ok: true, detail: string } | { ok: false, reason: string }>}
 */
export async function checkSyntax(text) {
	let typescript;
	try {
		typescript = await import('typescript');
	} catch {
		return { ok: true, detail: 'typescript not installed; syntax gate skipped' };
	}
	const ts = typescript.default ?? typescript;
	const result = ts.transpileModule(text, {
		compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, isolatedModules: true },
		reportDiagnostics: true,
		fileName: TARGET_FILE,
	});
	const errors = (result.diagnostics ?? []).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
	if (errors.length === 0) return { ok: true, detail: 'typescript' };
	const rendered = errors.slice(0, 3).map((diagnostic) => {
		const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ');
		if (diagnostic.start === undefined || diagnostic.file === undefined) return message;
		const at = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
		return 'line ' + (at.line + 1) + ', column ' + (at.character + 1) + ': ' + message;
	});
	return { ok: false, reason: 'the patched file does not parse:\n    ' + rendered.join('\n    ') };
}

function timestamp() {
	const now = new Date();
	const pad = (value) => String(value).padStart(2, '0');
	return [now.getFullYear(), pad(now.getMonth() + 1), pad(now.getDate()), pad(now.getHours()), pad(now.getMinutes()), pad(now.getSeconds())].join('');
}

function targetPath(paths) {
	return join(paths.install, TARGET_FILE);
}

function readTarget(paths) {
	const path = targetPath(paths);
	return existsSync(path) ? readFileSync(path, 'utf8') : undefined;
}

/**
 * Keep the file that was there, with the digest that proves it.
 * @param {{ install: string, backups: string }} paths
 * @param {string} text
 * @returns {string}
 */
export function backupOriginal(paths, text) {
	const base = BACKUP_PREFIX + timestamp();
	let dir = join(paths.backups, base);
	for (let copy = 2; existsSync(dir); copy += 1) dir = join(paths.backups, base + '-' + copy);
	const copy = join(dir, TARGET_FILE);
	mkdirSync(dirname(copy), { recursive: true });
	writeFileSync(copy, text);
	writeFileSync(
		join(dir, 'manifest.json'),
		JSON.stringify({ at: new Date().toISOString(), files: [{ file: TARGET_FILE, md5: md5(text) }] }, null, '\t') + '\n',
	);
	return dir;
}

/**
 * The newest trustworthy backup: its bytes must be the ones its manifest names.
 * @param {{ install: string, backups: string }} paths
 * @returns {{ dir: string, text: string } | undefined}
 */
export function latestBackup(paths) {
	if (!existsSync(paths.backups)) return undefined;
	const names = readdirSync(paths.backups)
		.filter((name) => name.startsWith(BACKUP_PREFIX))
		.sort()
		.reverse();
	for (const name of names) {
		const dir = join(paths.backups, name);
		const path = join(dir, TARGET_FILE);
		if (!existsSync(path)) continue;
		let recorded;
		try {
			const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
			recorded = Array.isArray(manifest.files) ? manifest.files.find((entry) => entry && entry.file === TARGET_FILE) : undefined;
		} catch {
			continue;
		}
		if (typeof recorded?.md5 !== 'string') continue;
		const text = readFileSync(path, 'utf8');
		if (md5(text) !== recorded.md5) continue;
		return { dir, text };
	}
	return undefined;
}

/**
 * One command, one outcome. Every failure is a message a person can act on, and
 * the exit code is 1 so a wrapper never mistakes it for success.
 * @param {string} command
 * @param {{ install: string, backups: string }} paths
 * @returns {Promise<{ ok: true, message: string } | { ok: false, reason: string }>}
 */
export async function run(command, paths) {
	if (!existsSync(paths.install)) {
		return { ok: false, reason: 'no gentle-pi installation at ' + paths.install };
	}
	const text = readTarget(paths);
	if (text === undefined) return { ok: false, reason: TARGET_FILE + ' is missing from ' + paths.install };
	const state = classify(text);

	if (command === 'check') {
		if (state === 'patched') return { ok: true, message: 'patched and verified' };
		if (state === 'clean') return { ok: false, reason: 'not patched: the carrier record would not be drawn' };
		if (state === 'patched-modified') return { ok: false, reason: 'carries the marker but does not verify: ' + verifyPatched(text).reason };
		return { ok: false, reason: 'the anchor moved: gentle-pi changed' };
	}

	if (command === 'apply') {
		if (state === 'patched') return { ok: true, message: 'already patched and verified; nothing to do' };
		if (state === 'patched-modified') return { ok: false, reason: 'carries the marker but does not verify: ' + verifyPatched(text).reason };
		if (state === 'different-version') {
			const found = occurrences(text, ANCHOR);
			return {
				ok: false,
				reason: found === 0
					? 'the anchor moved: this exact line is not in ' + targetPath(paths) + '\n    ' + ANCHOR.trim() + '\ngentle-pi changed. Update scripts/apply-inline-carrier-patch.mjs against the new build instead of forcing it.'
					: 'the anchor appears ' + found + ' times, expected exactly 1',
			};
		}
		const patched = patchText(text);
		if (!patched.ok) return { ok: false, reason: patched.reason };
		const syntax = await checkSyntax(patched.text);
		if (!syntax.ok) return { ok: false, reason: syntax.reason };
		const dir = backupOriginal(paths, text);
		writeFileSync(targetPath(paths), patched.text);
		const written = readTarget(paths);
		const verified = written === undefined ? { ok: false, reason: 'the file disappeared after the write' } : verifyPatched(written);
		if (!verified.ok) return { ok: false, reason: 'the write did not verify: ' + verified.reason + '. The original is in ' + dir };
		return { ok: true, message: 'patched ' + targetPath(paths) + ' (syntax: ' + syntax.detail + '); original in ' + dir };
	}

	if (command === 'revert') {
		if (state === 'clean') return { ok: true, message: 'already unpatched; nothing to do' };
		const backup = latestBackup(paths);
		if (backup === undefined) return { ok: false, reason: 'no trustworthy backup under ' + paths.backups + ' to restore from' };
		writeFileSync(targetPath(paths), backup.text);
		const restored = readTarget(paths);
		if (restored === undefined || md5(restored) !== md5(backup.text)) {
			return { ok: false, reason: 'the restore did not verify; the copy is still in ' + backup.dir };
		}
		return { ok: true, message: 'restored ' + targetPath(paths) + ' from ' + backup.dir };
	}

	return { ok: false, reason: 'unknown command: ' + String(command) };
}

function parseArgs(argv) {
	const paths = defaultPaths();
	let command;
	for (let index = 0; index < argv.length; index += 1) {
		const value = argv[index];
		if (value === '--install' && argv[index + 1] !== undefined) {
			paths.install = argv[index + 1];
			index += 1;
		} else if (value === '--backups' && argv[index + 1] !== undefined) {
			paths.backups = argv[index + 1];
			index += 1;
		} else if (value === '--help' || value === '-h') {
			command = 'help';
		} else if (!value.startsWith('--') && command === undefined) {
			command = value;
		}
	}
	return { command, paths };
}

export const USAGE = [
	'node scripts/apply-inline-carrier-patch.mjs <check|apply|revert> [--install <gentle-pi dir>] [--backups <dir>]',
	'',
	'  check    report whether the installed gentle-pi draws LOON\'s inline carrier',
	'  apply    patch it once, after backing the file up; a rerun is a verified no-op',
	'  revert   put the last backed-up copy back and verify its md5',
].join('\n');

async function main(argv) {
	const { command, paths } = parseArgs(argv);
	if (command === undefined || command === 'help') {
		console.log(USAGE);
		return command === 'help' ? 0 : 1;
	}
	let result;
	try {
		result = await run(command, paths);
	} catch (error) {
		result = { ok: false, reason: error instanceof Error ? error.message : String(error) };
	}
	if (result.ok) {
		console.log(result.message);
		return 0;
	}
	console.error('inline carrier patch: ' + result.reason);
	return 1;
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
	process.exitCode = await main(process.argv.slice(2));
}
