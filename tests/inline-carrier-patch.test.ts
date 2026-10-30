import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	ANCHOR,
	BACKUP_PREFIX,
	PATCH_MARKER,
	TARGETS,
	TARGET_FILE,
	VIEW_FILE,
	VIEW_LIST_ANCHOR,
	VIEW_PATCH_MARKER,
	VIEW_THREAD_ANCHOR,
	classify,
	classifyTarget,
	md5,
	patchTargetText,
	patchText,
	replacementBalanced,
	run,
	verifyPatched,
	verifyViewPatched,
} from '../scripts/apply-inline-carrier-patch.mjs';

const SCRIPT = fileURLToPath(new URL('../scripts/apply-inline-carrier-patch.mjs', import.meta.url));

/**
 * A file shaped like the part of gentle-pi's gentle-agents.ts the patch lives in:
 * the same imports, the same surrounding lines, the exact anchor.
 */
function fixture(options: { anchor?: boolean | 'twice' } = {}): string {
	const lines = [
		'import { existsSync, readFileSync } from "node:fs";',
		'import { join } from "node:path";',
		'import { TASK_STATUS, type TaskRecord } from "../lib/agents-protocol.ts";',
		'',
		'export const install = (pi: unknown, store: any, agentHome: string) => {',
		'\tconst activeSessionId = (): string | undefined => undefined;',
		'\tconst ownedActive = () => store.list(activeSessionId()).filter((task: TaskRecord) => task.id !== "");',
		'\tconst warming = { tasks: store.list(activeSessionId()) };',
	];
	if (options.anchor !== false) lines.push(ANCHOR);
	if (options.anchor === 'twice') lines.push(ANCHOR);
	lines.push('', '\ttype SessionTransport = { generation: number };', '};', '');
	return lines.join('\n');
}

/**
 * A file shaped like the part of lib/agents-view.ts the panel patch lives in: the
 * class method that lists tasks, and the one that draws a task's thread.
 */
function viewFixture(options: { list?: boolean | 'twice'; thread?: boolean | 'twice' } = {}): string {
	const lines = [
		'export class AgentsView {',
		'\tprivate refreshTasks(): void {',
	];
	if (options.list === 'twice') lines.push(VIEW_LIST_ANCHOR, VIEW_LIST_ANCHOR);
	else if (options.list !== false) lines.push(VIEW_LIST_ANCHOR);
	lines.push('\t\tconst active = local.filter((task: TaskRecord) => task.status === "running");', '\t}', '', '\tprivate threadWindow(rows: number, width: number): string[] {');
	if (options.thread === 'twice') lines.push(VIEW_THREAD_ANCHOR, VIEW_THREAD_ANCHOR);
	else if (options.thread !== false) lines.push(VIEW_THREAD_ANCHOR);
	lines.push('\t\treturn lines;', '\t}', '}', '');
	return lines.join('\n');
}

interface Paths {
	install: string;
	backups: string;
}

function scratch(): Paths {
	const root = mkdtempSync(join(tmpdir(), 'loon-inline-patch-'));
	const install = join(root, 'gentle-pi');
	const backups = join(root, 'backups');
	mkdirSync(dirname(join(install, TARGET_FILE)), { recursive: true });
	mkdirSync(dirname(join(install, VIEW_FILE)), { recursive: true });
	mkdirSync(backups, { recursive: true });
	return { install, backups };
}

/** Both files the patch owns, because a patch that half-applies is the failure. */
function writeTarget(paths: Paths, text: string, view: string = viewFixture()): void {
	writeFileSync(join(paths.install, TARGET_FILE), text);
	writeFileSync(join(paths.install, VIEW_FILE), view);
}

function readTarget(paths: Paths): string {
	return readFileSync(join(paths.install, TARGET_FILE), 'utf8');
}

function readView(paths: Paths): string {
	return readFileSync(join(paths.install, VIEW_FILE), 'utf8');
}

function backupDirs(paths: Paths): string[] {
	return readdirSync(paths.backups).filter((name) => name.startsWith(BACKUP_PREFIX));
}

function cli(paths: Paths, command: string): { status: number; stdout: string; stderr: string } {
	return cliRaw([command, '--install', paths.install, '--backups', paths.backups]);
}

/**
 * Run the script with exact arguments and a scratch HOME. The HOME override is
 * what makes a bad argument observable: the script's default paths resolve
 * under it, so a fallback that patches "the default installation" changes a
 * file this test owns instead of the real one.
 */
function cliRaw(args: string[], home?: string): { status: number; stdout: string; stderr: string } {
	try {
		const stdout = execFileSync(process.execPath, [SCRIPT, ...args], {
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'pipe'],
			env: home === undefined ? process.env : { ...process.env, HOME: home },
		});
		return { status: 0, stdout, stderr: '' };
	} catch (error) {
		const failure = error as { status?: number; stdout?: string; stderr?: string };
		return { status: failure.status ?? -1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' };
	}
}

test('the patch replaces one line and keeps the store lookup', () => {
	const original = fixture();
	const result = patchText(original);
	assert.ok(result.ok);
	assert.equal(result.changed, true);
	assert.equal(original.includes(PATCH_MARKER), false, 'the fixture did not start patched');
	assert.equal(result.text.includes(PATCH_MARKER), true);
	assert.equal(result.text.includes(ANCHOR), false, 'the anchor must not survive');
	assert.equal(result.text.includes('const tasks = store.list(activeSessionId());'), true, 'the card still lists the store');
	assert.equal(result.text.includes('const visibleTasks = (): TaskRecord[] => {'), true);
	assert.equal(result.text.includes('const inlineCarrierTask = (sessionId: string | undefined)'), true);
	assert.deepEqual(verifyPatched(result.text), { ok: true });
	assert.equal(replacementBalanced(), true);
});

test('applying twice changes nothing the second time', () => {
	const first = patchText(fixture());
	assert.ok(first.ok);
	const second = patchText(first.text);
	assert.ok(second.ok);
	assert.equal(second.changed, false, 'a patched file must not be patched again');
	assert.equal(second.text, first.text);
});

test('a moved or duplicated anchor fails loudly instead of half-patching', () => {
	const moved = patchText(fixture({ anchor: false }));
	assert.ok(!moved.ok, 'a moved anchor must be refused');
	assert.match(moved.reason, /the anchor for visibleTasks moved/);
	assert.match(moved.reason, /Update scripts\/apply-inline-carrier-patch\.mjs/);

	const twice = patchText(fixture({ anchor: 'twice' }));
	assert.ok(!twice.ok, 'a duplicated anchor must be refused');
	assert.match(twice.reason, /appears 2 times, expected exactly 1/);
});

test('a file is classified by what it is', () => {
	assert.equal(classify(undefined), 'missing');
	assert.equal(classify(fixture()), 'clean');
	assert.equal(classify(fixture({ anchor: false })), 'different-version');
	const patched = patchText(fixture());
	assert.ok(patched.ok);
	assert.equal(classify(patched.text), 'patched');
	// Somebody edited the patched file afterwards: it carries the marker, so it is
	// neither clean nor ours, and forcing it would hide the drift.
	const tampered = patched.text.replace('const inlineCarrierTask = (sessionId: string | undefined)', 'const inlineCarrierTask = (sessionId: string)');
	assert.equal(classify(tampered), 'patched-modified');
	assert.equal(verifyPatched(tampered).ok, false);
});

test('apply backs the file up, verifies the write, and is idempotent', async () => {
	const paths = scratch();
	const original = fixture();
	writeTarget(paths, original);

	const applied = await run('apply', paths);
	assert.equal(applied.ok, true, applied.ok ? '' : applied.reason);
	const patched = readTarget(paths);
	assert.equal(classify(patched), 'patched');
	assert.equal(backupDirs(paths).length, 1, 'the original is kept before the first write');
	const backup = join(paths.backups, backupDirs(paths)[0] ?? '', TARGET_FILE);
	assert.equal(readFileSync(backup, 'utf8'), original, 'the backup is the file that was there');
	const manifest = JSON.parse(readFileSync(join(paths.backups, backupDirs(paths)[0] ?? '', 'manifest.json'), 'utf8')) as {
		files: { file: string; md5: string }[];
	};
	assert.equal(manifest.files[0]?.file, TARGET_FILE);
	assert.equal(manifest.files[0]?.md5, md5(original));

	const again = await run('apply', paths);
	assert.equal(again.ok, true);
	assert.match(again.ok ? again.message : '', /already patched/);
	assert.equal(readTarget(paths), patched, 'a rerun must not rewrite the file');
	assert.equal(backupDirs(paths).length, 1, 'a rerun must not add a second backup');

	const checked = await run('check', paths);
	assert.equal(checked.ok, true);
	rmSync(join(paths.backups, '..'), { recursive: true, force: true });
});

test('revert puts the backed-up copy back and verifies it', async () => {
	const paths = scratch();
	const original = fixture();
	writeTarget(paths, original);
	assert.equal((await run('apply', paths)).ok, true);
	assert.equal((await run('revert', paths)).ok, true);
	assert.equal(readTarget(paths), original);
	assert.equal(md5(readTarget(paths)), md5(original));
	// Nothing left to revert is a success, not an error.
	const clean = await run('revert', paths);
	assert.equal(clean.ok, true);
	assert.match(clean.ok ? clean.message : '', /already unpatched/);
	rmSync(join(paths.backups, '..'), { recursive: true, force: true });
});

test('apply refuses a file whose anchor moved, and leaves everything alone', async () => {
	const paths = scratch();
	const moved = fixture({ anchor: false });
	writeTarget(paths, moved);
	const result = await run('apply', paths);
	assert.equal(result.ok, false);
	assert.match(result.ok ? '' : result.reason, /the anchor for visibleTasks moved/);
	assert.equal(readTarget(paths), moved, 'the file must not be touched');
	assert.equal(backupDirs(paths).length, 0, 'a refusal must not leave a backup of nothing');
	rmSync(join(paths.backups, '..'), { recursive: true, force: true });
});

test('the command line reports success and failure in its exit code', () => {
	const paths = scratch();
	writeTarget(paths, fixture());

	const missing = cli(paths, 'check');
	assert.equal(missing.status, 1, 'an unpatched install is not a passing check');
	assert.match(missing.stderr, /not patched/);

	const applied = cli(paths, 'apply');
	assert.equal(applied.status, 0, applied.stderr);
	assert.match(applied.stdout, /patched/);

	const repeated = cli(paths, 'apply');
	assert.equal(repeated.status, 0, repeated.stderr);
	assert.match(repeated.stdout, /already patched/);

	const checked = cli(paths, 'check');
	assert.equal(checked.status, 0, checked.stderr);
	assert.match(checked.stdout, /patched and verified/);

	const reverted = cli(paths, 'revert');
	assert.equal(reverted.status, 0, reverted.stderr);
	assert.equal(readTarget(paths), fixture());

	const unknown = cli(paths, 'frobnicate');
	assert.equal(unknown.status, 1);
	assert.match(unknown.stderr, /unknown command/);
	rmSync(join(paths.backups, '..'), { recursive: true, force: true });
});

test('a malformed option fails closed and never reaches the default installation', () => {
	// HOME points at a scratch directory, so the script's default installation is
	// a decoy we can watch. If a bad argument falls back to it, that file changes
	// and this test reports a write, not just a message.
	const home = mkdtempSync(join(tmpdir(), 'loon-inline-home-'));
	const decoy = join(home, '.pi', 'agent', 'npm', 'node_modules', 'gentle-pi');
	mkdirSync(dirname(join(decoy, TARGET_FILE)), { recursive: true });
	writeFileSync(join(decoy, TARGET_FILE), fixture());
	const decoyPath = join(decoy, TARGET_FILE);
	const before = readFileSync(decoyPath, 'utf8');
	const backupsDir = join(home, '.pi', 'agent', 'backups');

	const cases: string[][] = [
		['apply', '--install'],
		['apply', '--backups'],
		['apply', '--instal', '/tmp/elsewhere'],
		['apply', '/tmp/elsewhere'],
		['apply', '--install', '/tmp/one', '--install', '/tmp/two'],
	];
	for (const args of cases) {
		const result = cliRaw(args, home);
		assert.equal(result.status, 1, 'must fail closed: ' + args.join(' '));
		assert.match(result.stderr, /needs a directory|unknown option|unexpected argument|more than once/, 'the message must name the problem: ' + args.join(' '));
		assert.equal(result.stdout, '', 'a rejected argument reports nothing but the error');
	}

	assert.equal(readFileSync(decoyPath, 'utf8'), before, 'a rejected argument must not write to the default installation');
	assert.equal(existsSync(backupsDir), false, 'a rejected argument must not create a backup');
	rmSync(home, { recursive: true, force: true });
});

test('revert refuses a file that is no longer the one the backup recorded', async () => {
	const paths = scratch();
	writeTarget(paths, fixture());
	const applied = await run('apply', paths);
	assert.ok(applied.ok, applied.ok ? '' : applied.reason);
	const patched = readTarget(paths);

	// A newer gentle-pi drops the patch entirely: no marker, no anchor.
	const newer = fixture({ anchor: false });
	writeTarget(paths, newer);
	const refused = await run('revert', paths);
	assert.ok(!refused.ok, 'a different build must not be overwritten by a stale backup');
	assert.match(refused.reason, /refus|changed|not one this patch wrote/);
	assert.equal(readTarget(paths), newer, 'the newer file survives untouched');

	// The same hazard with the marker still on disk: somebody edited our patch.
	writeTarget(paths, patched + '\n// edited by hand after the patch\n');
	const edited = await run('revert', paths);
	assert.ok(!edited.ok, 'a file edited after the patch must not be overwritten either');
	assert.match(edited.reason, /refus|changed|not one this patch wrote/);

	// The file this patch really wrote still restores.
	writeTarget(paths, patched);
	const restored = await run('revert', paths);
	assert.ok(restored.ok, restored.ok ? '' : restored.reason);
	assert.equal(readTarget(paths), fixture());
	rmSync(join(paths.backups, '..'), { recursive: true, force: true });
});

test('the panel is patched in two places, and the store stays in front', () => {
	const original = viewFixture();
	const patched = patchTargetText(TARGETS[1], original);
	assert.ok(patched.ok, patched.ok ? '' : patched.reason);
	assert.equal(patched.changed, true);
	assert.equal(original.includes(VIEW_PATCH_MARKER), false);
	assert.equal(patched.text.includes(VIEW_PATCH_MARKER), true);
	assert.equal(patched.text.includes(VIEW_LIST_ANCHOR), true, 'the list statement survives byte for byte');
	assert.equal(patched.text.includes('loonPanel?.tasks?.(this.deps.sessionId'), true);
	assert.equal(patched.text.includes(VIEW_THREAD_ANCHOR), false, 'the detail line is replaced, not supplemented');
	assert.equal(patched.text.includes('loonThread?.thread?.(task.id) ?? this.deps.store.thread(task.id)'), true);
	assert.deepEqual(verifyViewPatched(patched.text), { ok: true });

	// Applying it twice is the same file: the marker is the whole test.
	const again = patchTargetText(TARGETS[1], patched.text);
	assert.ok(again.ok);
	assert.equal(again.changed, false);
	assert.equal(again.text, patched.text);
});

test('a panel anchor that moved or repeated is refused, and nothing is written', async () => {
	const paths = scratch();
	const moved = fixture();
	const view = viewFixture({ thread: false });
	writeTarget(paths, moved, view);
	const refused = await run('apply', paths);
	assert.equal(refused.ok, false);
	assert.match(refused.ok ? '' : refused.reason, /lib\/agents-view\.ts/);
	assert.match(refused.ok ? '' : refused.reason, /threadWindow detail moved/);
	assert.match(refused.ok ? '' : refused.reason, /nothing was written/);
	assert.equal(readTarget(paths), moved, 'the other file must not be patched either');
	assert.equal(readView(paths), view);
	assert.equal(backupDirs(paths).length, 0, 'a refusal leaves no backup behind');

	const repeated = await run('apply', { install: paths.install, backups: paths.backups });
	assert.equal(repeated.ok, false);
	writeTarget(paths, moved, viewFixture({ list: 'twice' }));
	const twice = await run('apply', paths);
	assert.equal(twice.ok, false);
	assert.match(twice.ok ? '' : twice.reason, /refreshTasks list appears 2 times/);
	assert.equal(readTarget(paths), moved);
	rmSync(join(paths.backups, '..'), { recursive: true, force: true });
});

test('check answers for both files, and revert restores both', async () => {
	const paths = scratch();
	const card = fixture();
	const view = viewFixture();
	writeTarget(paths, card, view);

	const applied = await run('apply', paths);
	assert.ok(applied.ok, applied.ok ? '' : applied.reason);
	assert.match(applied.ok ? applied.message : '', /extensions\/gentle-agents\.ts/);
	assert.match(applied.ok ? applied.message : '', /lib\/agents-view\.ts/);
	assert.equal(classifyTarget(TARGETS[1], readView(paths)), 'patched');

	// One file losing its patch is a failed check for the whole install, and the
	// report has to say which file it is.
	writeFileSync(join(paths.install, VIEW_FILE), view);
	const half = await run('check', paths);
	assert.equal(half.ok, false);
	assert.match(half.ok ? '' : half.reason, /lib\/agents-view\.ts is not patched/);

	// A file that already lost its patch on its own is left alone, and the file
	// that still carries it comes back from its own backup: reverting finishes the
	// job instead of stopping halfway.
	writeFileSync(join(paths.install, TARGET_FILE), card);
	const oneSided = await run('revert', paths);
	assert.ok(oneSided.ok, oneSided.ok ? '' : oneSided.reason);
	assert.equal(readTarget(paths), card, 'a clean file is not rewritten');
	assert.equal(readView(paths), view, 'the patched file is restored from its backup');

	// And the pair comes back together when both are patched.
	assert.ok((await run('apply', paths)).ok, 'apply patches the half that was missing');
	assert.ok((await run('revert', paths)).ok);
	assert.equal(readTarget(paths), card);
	assert.equal(readView(paths), view);
	rmSync(join(paths.backups, '..'), { recursive: true, force: true });
});

test('a missing installation is reported, never invented', async () => {
	const paths = scratch();
	const result = await run('apply', { install: join(paths.install, 'absent'), backups: paths.backups });
	assert.equal(result.ok, false);
	assert.match(result.ok ? '' : result.reason, /no gentle-pi installation/);
	rmSync(join(paths.backups, '..'), { recursive: true, force: true });
});
