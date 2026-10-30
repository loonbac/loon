#!/usr/bin/env node
/**
 * LOON inline carrier patch: teach gentle-pi to draw, and to keep drawing, the
 * parent's inline work.
 *
 * The records come from LOON's own extension (extensions/inline-work.ts writes a
 * TaskRecord-shaped file per unit, keeps a live one under
 * <agent home>/state/loon-inline/, and persists a closed one into gentle-pi's own
 * history directory). Two installed files need to know those records exist:
 *
 *   - extensions/gentle-agents.ts, whose visibleTasks() feeds the card above the
 *     editor;
 *   - lib/agents-view.ts, whose list and detail panes feed the overlay panel,
 *     where the record has to appear while the unit runs and flip when it ends.
 *
 * This edits another installed package, so it is deliberately paranoid:
 *
 *   - every anchor must appear exactly once, and the whole patch is planned for
 *     all files before a single byte is written, so a newer gentle-pi is refused
 *     instead of half-patched;
 *   - each patched text is checked for balance and, when the repository's own
 *     TypeScript is available, transpiled to prove it still parses;
 *   - the originals go to one timestamped backup first, and revert puts them back
 *     only if every file still carries exactly the bytes this patch wrote;
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

/** Every patched file carries a marker, which also makes the patch idempotent. */
export const PATCH_MARKER = 'LOON inline carrier patch';

/** The card list, relative to the gentle-pi package root. */
export const TARGET_FILE = 'extensions/gentle-agents.ts';

/** The overlay panel, relative to the gentle-pi package root. */
export const VIEW_FILE = 'lib/agents-view.ts';

/** The exact line the card patch replaces, in gentle-pi 4.5.x. */
export const ANCHOR = '\tconst visibleTasks = (): TaskRecord[] => store.list(activeSessionId());';

/** Backup directories are named after this, mirroring the banner patch. */
export const BACKUP_PREFIX = 'loon-inline-carrier-patch-';

/** The carrier directory, relative to the agent home. */
export const CARRIER_DIR = 'state/loon-inline';

/**
 * The card replacement: a reader for the carrier file plus the same visibleTasks
 * the package had, now with the carrier appended. Only imports the file already
 * has (existsSync, readFileSync, join, TASK_STATUS, TaskRecord) are used, so no
 * import line changes.
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

/** The panel marker. Distinct from the card's so each file is classified by its own patch. */
export const VIEW_PATCH_MARKER = 'LOON inline overlay patch';

/** refreshTasks: the statement that decides what the panel lists. */
export const VIEW_LIST_ANCHOR = [
	'\t\tconst local = this.deps.store.list().filter((task) => task.parentSessionId === this.deps.sessionId',
	'\t\t\t&& (isFinished(task.status) || (this.deps.isLocalTask?.(task) ?? true)));',
].join('\n');

/**
 * The list replacement keeps that statement byte for byte and appends the
 * provider's records, so the panel's own filtering, ordering and de-duplication
 * still run over everything it draws.
 */
export const VIEW_LIST_REPLACEMENT = [
	VIEW_LIST_ANCHOR,
	'\t\t// LOON inline overlay patch: the parent inline units are not in the store.',
	'\t\t// The provider is registered by LOON own extension; without it this file',
	'\t\t// behaves exactly as gentle-pi ships.',
	'\t\tconst loonPanel = (globalThis as unknown as { __loonInlinePanel?: { tasks?: (sessionId: string, known: string[]) => TaskRecord[] } }).__loonInlinePanel;',
	'\t\tlocal.push(...(loonPanel?.tasks?.(this.deps.sessionId ?? "", local.map((task) => task.id)) ?? []));',
].join('\n');

/** threadWindow: where the detail pane takes its thread from. */
export const VIEW_THREAD_ANCHOR = '\t\tconst lines = this.threadLines(this.remoteThreads.get(task.id) ?? this.deps.store.thread(task.id), width);';

/** The detail replacement asks the provider before the store, never instead of it. */
export const VIEW_THREAD_REPLACEMENT = [
	'\t\t// LOON inline overlay patch: an inline unit has no store entry to read.',
	'\t\tconst loonThread = (globalThis as unknown as { __loonInlinePanel?: { thread?: (id: string) => TaskThread | undefined } }).__loonInlinePanel;',
	'\t\tconst lines = this.threadLines(this.remoteThreads.get(task.id) ?? loonThread?.thread?.(task.id) ?? this.deps.store.thread(task.id), width);',
].join('\n');

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
 * Each replacement has to be balanced on its own: the anchors were balanced
 * statements, so a balanced replacement cannot unbalance the file it lands in.
 * @returns {boolean}
 */
export function replacementBalanced() {
	const text = [REPLACEMENT, VIEW_LIST_REPLACEMENT, VIEW_THREAD_REPLACEMENT].join('\n');
	const pairs = [['{', '}'], ['(', ')'], ['[', ']']];
	return pairs.every(([open, close]) => occurrences(text, open) === occurrences(text, close));
}

/**
 * Everything this script promises about the patched card file, in one place.
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
 * The same promise for the panel: the list statement survives verbatim, the
 * provider is consulted once in each of the two places, and the store fallback in
 * the detail pane is still there.
 * @param {string} text
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function verifyViewPatched(text) {
	if (!text.includes(VIEW_PATCH_MARKER)) return { ok: false, reason: 'the marker is missing' };
	if (occurrences(text, VIEW_LIST_ANCHOR) !== 1) return { ok: false, reason: 'the list statement is missing or duplicated' };
	if (occurrences(text, 'loonPanel?.tasks?.(this.deps.sessionId') !== 1) return { ok: false, reason: 'the provider lookup in the list is missing or duplicated' };
	if (occurrences(text, VIEW_THREAD_ANCHOR) !== 0) return { ok: false, reason: 'the unpatched detail line is still there' };
	if (occurrences(text, 'loonThread?.thread?.(task.id) ?? this.deps.store.thread(task.id)') !== 1) return { ok: false, reason: 'the detail pane no longer falls back to the store' };
	return { ok: true };
}

/**
 * Every file this patch touches, with its own anchors and its own verifier.
 * @type {{ file: string, label: string, marker: string, anchors: { find: string, replace: string, name: string }[], verify: (text: string) => { ok: true } | { ok: false, reason: string } }[]}
 */
export const TARGETS = [
	{
		file: TARGET_FILE,
		label: 'the Agents card list',
		marker: PATCH_MARKER,
		anchors: [{ find: ANCHOR, replace: REPLACEMENT, name: 'visibleTasks' }],
		verify: verifyPatched,
	},
	{
		file: VIEW_FILE,
		label: 'the overlay panel list and detail',
		marker: VIEW_PATCH_MARKER,
		anchors: [
			{ find: VIEW_LIST_ANCHOR, replace: VIEW_LIST_REPLACEMENT, name: 'refreshTasks list' },
			{ find: VIEW_THREAD_ANCHOR, replace: VIEW_THREAD_REPLACEMENT, name: 'threadWindow detail' },
		],
		verify: verifyViewPatched,
	},
];

/**
 * @param {(typeof TARGETS)[number]} target
 * @param {string | undefined} text
 * @returns {'missing' | 'clean' | 'patched' | 'patched-modified' | 'different-version'}
 */
export function classifyTarget(target, text) {
	if (text === undefined) return 'missing';
	if (text.includes(target.marker)) return target.verify(text).ok ? 'patched' : 'patched-modified';
	return target.anchors.every((anchor) => occurrences(text, anchor.find) === 1) ? 'clean' : 'different-version';
}

/**
 * Which anchor of a different-version file is wrong, so the refusal names it.
 * @param {(typeof TARGETS)[number]} target
 * @param {string} text
 * @returns {string}
 */
export function anchorReport(target, text) {
	for (const anchor of target.anchors) {
		const found = occurrences(text, anchor.find);
		if (found === 0) {
			return target.file + ': the anchor for ' + anchor.name + ' moved: this exact text is not in the file\n    ' + anchor.find.trim() + '\ngentle-pi changed. Update scripts/apply-inline-carrier-patch.mjs against the new build instead of forcing it.';
		}
		if (found > 1) return target.file + ': the anchor for ' + anchor.name + ' appears ' + found + ' times, expected exactly 1';
	}
	return target.file + ': the file does not match this patch';
}

/**
 * The card file, classified. Kept because it is the shape the first slice used.
 * @param {string | undefined} text
 * @returns {'missing' | 'clean' | 'patched' | 'patched-modified' | 'different-version'}
 */
export function classify(text) {
	return classifyTarget(TARGETS[0], text);
}

/**
 * The pure transformation for one file: text in, patched text out. Nothing is
 * written, and a file that already carries its marker is returned untouched.
 * @param {(typeof TARGETS)[number]} target
 * @param {string} text
 * @returns {{ ok: true, text: string, changed: boolean } | { ok: false, reason: string }}
 */
export function patchTargetText(target, text) {
	if (text.includes(target.marker)) return { ok: true, text, changed: false };
	for (const anchor of target.anchors) {
		const found = occurrences(text, anchor.find);
		if (found === 0) {
			return {
				ok: false,
				reason:
					target.file + ': the anchor for ' + anchor.name + ' moved: this exact text is not in the file\n' +
					'    ' + anchor.find.trim() + '\n' +
					'gentle-pi changed. Update scripts/apply-inline-carrier-patch.mjs against the new build instead of forcing it.',
			};
		}
		if (found > 1) return { ok: false, reason: target.file + ': the anchor for ' + anchor.name + ' appears ' + found + ' times, expected exactly 1' };
		text = text.replace(anchor.find, () => anchor.replace);
	}
	return { ok: true, text, changed: true };
}

/**
 * The pure transformation for the card file.
 * @param {string} text
 * @returns {{ ok: true, text: string, changed: boolean } | { ok: false, reason: string }}
 */
export function patchText(text) {
	return patchTargetText(TARGETS[0], text);
}

/**
 * A syntax gate, so a typo in a replacement cannot reach a person's terminal.
 * Only the repository's own TypeScript is used, and only when it is installed:
 * a missing compiler is reported, never invented.
 * @param {string} text
 * @param {string} [file]
 * @returns {Promise<{ ok: true, detail: string } | { ok: false, reason: string }>}
 */
export async function checkSyntax(text, file = TARGET_FILE) {
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
		fileName: file,
	});
	const errors = (result.diagnostics ?? []).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
	if (errors.length === 0) return { ok: true, detail: 'typescript' };
	const rendered = errors.slice(0, 3).map((diagnostic) => {
		const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ');
		if (diagnostic.start === undefined || diagnostic.file === undefined) return message;
		const at = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
		return 'line ' + (at.line + 1) + ', column ' + (at.character + 1) + ': ' + message;
	});
	return { ok: false, reason: file + ' does not parse once patched:\n    ' + rendered.join('\n    ') };
}

function timestamp() {
	const now = new Date();
	const pad = (value) => String(value).padStart(2, '0');
	return [now.getFullYear(), pad(now.getMonth() + 1), pad(now.getDate()), pad(now.getHours()), pad(now.getMinutes()), pad(now.getSeconds())].join('');
}

/**
 * Keep the files that were there, with the digest that proves it, and the digest
 * of what the patch wrote next to each. Without the second one a revert cannot
 * tell "the file this patch produced" from "a file somebody replaced later", and
 * it would restore an old backup over newer code.
 * @param {{ backups: string }} paths
 * @param {{ file: string, text: string, patched: string }[]} entries
 * @returns {string}
 */
export function backupOriginal(paths, entries) {
	const base = BACKUP_PREFIX + timestamp();
	let dir = join(paths.backups, base);
	for (let copy = 2; existsSync(dir); copy += 1) dir = join(paths.backups, base + '-' + copy);
	for (const entry of entries) {
		const copy = join(dir, entry.file);
		mkdirSync(dirname(copy), { recursive: true });
		writeFileSync(copy, entry.text);
	}
	writeFileSync(
		join(dir, 'manifest.json'),
		JSON.stringify(
			{ at: new Date().toISOString(), files: entries.map((entry) => ({ file: entry.file, md5: md5(entry.text), patchedMd5: md5(entry.patched) })) },
			null,
			'\t',
		) + '\n',
	);
	return dir;
}

/**
 * The newest trustworthy backup for one file: its bytes must be the ones its
 * manifest names.
 * @param {{ backups: string }} paths
 * @param {string} [file]
 * @returns {{ dir: string, text: string, patchedMd5?: string } | undefined}
 */
export function latestBackup(paths, file = TARGET_FILE) {
	if (!existsSync(paths.backups)) return undefined;
	const names = readdirSync(paths.backups)
		.filter((name) => name.startsWith(BACKUP_PREFIX))
		.sort()
		.reverse();
	for (const name of names) {
		const dir = join(paths.backups, name);
		const path = join(dir, file);
		if (!existsSync(path)) continue;
		let recorded;
		try {
			const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
			recorded = Array.isArray(manifest.files) ? manifest.files.find((entry) => entry && entry.file === file) : undefined;
		} catch {
			continue;
		}
		if (typeof recorded?.md5 !== 'string') continue;
		const text = readFileSync(path, 'utf8');
		if (md5(text) !== recorded.md5) continue;
		const patchedMd5 = typeof recorded.patchedMd5 === 'string' ? recorded.patchedMd5 : undefined;
		return patchedMd5 === undefined ? { dir, text } : { dir, text, patchedMd5 };
	}
	return undefined;
}

/**
 * What a revert must find on disk before it may overwrite anything. Backups
 * written by an older script carry no patchedMd5, but the patch is
 * deterministic: recomputing it from the backed-up bytes proves the same thing.
 * @param {(typeof TARGETS)[number]} target
 * @param {{ text: string, patchedMd5?: string }} backup
 * @returns {string | undefined}
 */
function expectedPatchedDigest(target, backup) {
	if (typeof backup.patchedMd5 === 'string') return backup.patchedMd5;
	const patched = patchTargetText(target, backup.text);
	return patched.ok ? md5(patched.text) : undefined;
}

/**
 * Read every file the patch owns, with its state, or explain why not.
 * @param {{ install: string }} paths
 * @returns {{ ok: true, entries: { target: (typeof TARGETS)[number], path: string, text: string, state: string }[] } | { ok: false, reason: string }}
 */
function readAll(paths) {
	if (!existsSync(paths.install)) return { ok: false, reason: 'no gentle-pi installation at ' + paths.install };
	const entries = [];
	for (const target of TARGETS) {
		const path = join(paths.install, target.file);
		if (!existsSync(path)) return { ok: false, reason: target.file + ' is missing from ' + paths.install };
		const text = readFileSync(path, 'utf8');
		entries.push({ target, path, text, state: classifyTarget(target, text) });
	}
	return { ok: true, entries };
}

/**
 * The state of every file, one line each, so a check answers for the whole patch.
 * @param {{ target: (typeof TARGETS)[number], state: string }[]} entries
 * @returns {string}
 */
function stateReport(entries) {
	return entries.map((entry) => entry.target.file + ': ' + entry.state).join('; ');
}

/**
 * One command, one outcome. Every failure is a message a person can act on, and
 * the exit code is 1 so a wrapper never mistakes it for success.
 * @param {string} command
 * @param {{ install: string, backups: string }} paths
 * @returns {Promise<{ ok: true, message: string } | { ok: false, reason: string }>}
 */
export async function run(command, paths) {
	const read = readAll(paths);
	if (!read.ok) return read;
	const entries = read.entries;

	if (command === 'check') {
		const bad = entries.filter((entry) => entry.state !== 'patched');
		if (bad.length === 0) return { ok: true, message: 'patched and verified: ' + entries.map((entry) => entry.target.file).join(', ') };
		const reasons = bad.map((entry) => {
			if (entry.state === 'clean') return entry.target.file + ' is not patched: the inline unit would not be drawn there';
			if (entry.state === 'patched-modified') return entry.target.file + ' carries the marker but does not verify: ' + entry.target.verify(entry.text).reason;
			if (entry.state === 'different-version') return anchorReport(entry.target, entry.text);
			return entry.target.file + ' is ' + entry.state;
		});
		return { ok: false, reason: reasons.join('\n') };
	}

	if (command === 'apply') {
		const weird = entries.filter((entry) => entry.state === 'patched-modified' || entry.state === 'different-version');
		if (weird.length > 0) {
			const reasons = weird.map((entry) =>
				entry.state === 'patched-modified'
					? entry.target.file + ' carries the marker but does not verify: ' + entry.target.verify(entry.text).reason
					: anchorReport(entry.target, entry.text),
			);
			return { ok: false, reason: reasons.join('\n') + '\nnothing was written.' };
		}
		// Everything is planned and syntax-checked before the first write: a patch
		// that half-applies to a newer gentle-pi is worse than no patch at all.
		const planned = [];
		for (const entry of entries) {
			if (entry.state === 'patched') continue;
			const patched = patchTargetText(entry.target, entry.text);
			if (!patched.ok) return { ok: false, reason: patched.reason + '\nnothing was written.' };
			const syntax = await checkSyntax(patched.text, entry.target.file);
			if (!syntax.ok) return { ok: false, reason: syntax.reason + '\nnothing was written.' };
			planned.push({ entry, patched: patched.text, syntax: syntax.detail });
		}
		if (planned.length === 0) return { ok: true, message: 'already patched and verified; nothing to do' };
		const dir = backupOriginal(paths, planned.map((item) => ({ file: item.entry.target.file, text: item.entry.text, patched: item.patched })));
		for (const item of planned) writeFileSync(item.entry.path, item.patched);
		for (const item of planned) {
			const verified = item.entry.target.verify(readFileSync(item.entry.path, 'utf8'));
			if (!verified.ok) return { ok: false, reason: 'the write to ' + item.entry.target.file + ' did not verify: ' + verified.reason + '. The originals are in ' + dir };
		}
		const files = planned.map((item) => item.entry.target.file).join(' and ');
		const syntax = planned.every((item) => item.syntax === 'typescript') ? 'syntax: typescript' : 'syntax: ' + planned.map((item) => item.syntax).join(', ');
		return { ok: true, message: 'patched ' + files + ' (' + syntax + '); originals in ' + dir };
	}

	if (command === 'revert') {
		const patchedEntries = entries.filter((entry) => entry.state === 'patched');
		const foreign = entries.filter((entry) => entry.state === 'patched-modified' || entry.state === 'different-version');
		if (foreign.length > 0) {
			const reasons = foreign.map((entry) =>
				entry.state === 'patched-modified'
					? entry.target.file + ' carries the marker but was changed after the patch; refusing to overwrite it from ' + paths.backups
					: entry.target.file + ' is not one this patch wrote (gentle-pi changed or was replaced); refusing to overwrite it with a backup',
			);
			return { ok: false, reason: reasons.join('\n') + '\nnothing was restored.' };
		}
		if (patchedEntries.length === 0) return { ok: true, message: 'already unpatched; nothing to do' };
		// Every file is checked before any file is restored: a partial restore is the
		// half-patched state this script exists to avoid.
		const plan = [];
		for (const entry of patchedEntries) {
			const backup = latestBackup(paths, entry.target.file);
			if (backup === undefined) return { ok: false, reason: 'no trustworthy backup under ' + paths.backups + ' for ' + entry.target.file + '\nnothing was restored.' };
			const expected = expectedPatchedDigest(entry.target, backup);
			if (expected === undefined) return { ok: false, reason: 'the backup in ' + backup.dir + ' cannot prove which bytes this patch wrote for ' + entry.target.file + '; refusing to guess' };
			if (md5(entry.text) !== expected) {
				return { ok: false, reason: 'the installed ' + entry.target.file + ' changed after the backup was made; refusing to overwrite it with ' + backup.dir + '\nnothing was restored.' };
			}
			plan.push({ entry, backup });
		}
		for (const item of plan) writeFileSync(item.entry.path, item.backup.text);
		for (const item of plan) {
			if (md5(readFileSync(item.entry.path, 'utf8')) !== md5(item.backup.text)) return { ok: false, reason: 'the restore of ' + item.entry.target.file + ' did not verify; the copy is still in ' + item.backup.dir };
		}
		return { ok: true, message: 'restored ' + plan.map((item) => item.entry.target.file).join(' and ') + ' from ' + plan[0].backup.dir };
	}

	return { ok: false, reason: 'unknown command: ' + String(command) };
}

/**
 * Strict on purpose: this command edits a live installation. A silently ignored
 * flag would fall back to the default paths and patch the real gentle-pi while
 * the caller believes it is pointing at a copy, so anything unexpected is an
 * error before a single byte is read or written.
 * @param {string[]} argv
 * @returns {{ command: string | undefined, paths: { install: string, backups: string } }}
 */
function parseArgs(argv) {
	const paths = defaultPaths();
	const seen = new Set();
	let command;
	for (let index = 0; index < argv.length; index += 1) {
		const value = argv[index];
		if (value === '--install' || value === '--backups') {
			if (seen.has(value)) throw new Error(value + ' was given more than once');
			seen.add(value);
			const given = argv[index + 1];
			if (given === undefined || given.startsWith('-')) throw new Error(value + ' needs a directory');
			if (value === '--install') paths.install = given;
			else paths.backups = given;
			index += 1;
		} else if (value === '--help' || value === '-h') {
			command = 'help';
		} else if (value.startsWith('-')) {
			throw new Error('unknown option: ' + value);
		} else if (command === undefined) {
			command = value;
		} else {
			throw new Error('unexpected argument: ' + value);
		}
	}
	return { command, paths };
}

export const USAGE = [
	'node scripts/apply-inline-carrier-patch.mjs <check|apply|revert> [--install <gentle-pi dir>] [--backups <dir>]',
	'',
	'  check    report, file by file, whether the installed gentle-pi draws LOON inline work',
	'           in the card above the editor and in the overlay panel',
	'  apply    patch both files once, after backing them up; a rerun is a verified no-op',
	'  revert   put the last backed-up copies back and verify their md5',
].join('\n');

async function main(argv) {
	let parsed;
	try {
		parsed = parseArgs(argv);
	} catch (error) {
		console.error('inline carrier patch: ' + (error instanceof Error ? error.message : String(error)));
		console.error(USAGE.split('\n')[0]);
		return 1;
	}
	const { command, paths } = parsed;
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
