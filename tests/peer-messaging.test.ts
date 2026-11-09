/**
 * S6 and S7 of odd/tasks/orchestrator-peer-labels.md, measured on the bytes the patch writes.
 *
 * Both defects are invisible from the outside until something goes slightly wrong, so both
 * are driven here the way they actually fail: a receiver that takes the message and is slow
 * to acknowledge it, and one presence directory holding a header nobody can read. The files
 * under test are never the installed package - each case patches a copy of the pristine 4.7.0
 * bytes in a scratch directory and imports that, so what is asserted is the patch's own
 * output and an `apply` on a person's machine cannot change these results.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, normalize } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
	GENTLE_PI_VERSION,
	TARGETS,
	installedVersion,
	patchText,
	type TargetSpec,
} from '../scripts/gentle-pi-patch.ts';
import { pristineSource, readPristine } from './support/pristine.ts';

const AGENTS_TRANSPORT = 'lib/agents-session-transport.ts';
const WINDOWS_TRANSPORT = 'lib/windows-session-transport.ts';
const DISCOVERY = 'lib/orchestrator-discovery.ts';

/** The pristine 4.7.0 bytes, resolved and hash-checked at run time; never committed. */
const PRISTINE = pristineSource();
/** The package the scratch copy is built in: the installed tree supplies the modules that
 * are not patch targets, and every target is rewritten from the pristine bytes. */
const BASE = join(homedir(), '.pi', 'agent', 'npm', 'node_modules', 'gentle-pi');

/**
 * Every module the discovery file pulls in, found by following its relative imports from
 * the stock package instead of naming them here. A hand written list missed one file that
 * another one imports, and the copy then could not be loaded at all. Type-only imports are
 * followed too: copying a file nobody loads costs nothing and keeps this from needing to
 * know which import is erased.
 */
function supportFiles(root: string, entry: string): string[] {
	const seen = new Set<string>([entry]);
	const pending = [entry];
	while (pending.length > 0) {
		const file = pending.pop()!;
		let text: string;
		try {
			text = readFileSync(join(root, file), 'utf8');
		} catch {
			continue;
		}
		for (const match of text.matchAll(/^\s*(?:import|export)[^;]*?from\s+["'](\.[^"']+)["']/gm)) {
			const next = normalize(join(dirname(file), match[1]!));
			if (seen.has(next)) continue;
			seen.add(next);
			pending.push(next);
		}
	}
	seen.delete(entry);
	return [...seen].sort();
}

/** What a node:test callback can do for cleanup; the shape is all these helpers need. */
interface Teardown {
	after(fn: () => void): void;
	skip(message?: string): void;
}

function target(file: string): TargetSpec {
	const found = TARGETS.find((spec) => spec.file === file);
	assert.ok(found, 'the patch has no target for ' + file + ', so nothing repairs it');
	return found;
}

/**
 * A scratch package holding the patch's own bytes for the requested files, plus - when a
 * case needs them - the untouched dependencies copied beside them from the installed tree.
 * Returns undefined when this machine holds no pristine 4.7.0 bytes, which each case reports
 * as a skip.
 */
function patchedTree(t: Teardown, files: string[], supportFrom?: string): string | undefined {
	if (!PRISTINE.ok) return undefined;
	const contents = new Map<string, string>();
	for (const file of files) {
		const spec = target(file);
		const patched = patchText(readPristine(PRISTINE.source, file), spec);
		assert.ok(patched.ok, file + ': ' + (patched.ok ? '' : patched.reason));
		contents.set(file, patched.text);
	}
	if (supportFrom !== undefined) {
		for (const file of supportFiles(supportFrom, DISCOVERY)) contents.set(file, readFileSync(join(supportFrom, file), 'utf8'));
	}
	const root = mkdtempSync(join(tmpdir(), 'loon-peer-repair-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	// The package's own manifest, so the scratch copy is an ESM package exactly like the one
	// these files come from.
	writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'gentle-pi', version: GENTLE_PI_VERSION, type: 'module' }));
	for (const [file, text] of contents) {
		mkdirSync(dirname(join(root, file)), { recursive: true });
		writeFileSync(join(root, file), text);
	}
	return root;
}

/** The installed package the scratch copy borrows its untouched modules from, when it is
 * the build this patch was written against. */
function stockPackage(): string | undefined {
	if (!PRISTINE.ok) return undefined;
	if (installedVersion(BASE) !== GENTLE_PI_VERSION) return undefined;
	if (!existsSync(join(BASE, DISCOVERY))) return undefined;
	return BASE;
}

async function load(root: string, file: string): Promise<Record<string, any>> {
	return (await import(pathToFileURL(join(root, file)).href)) as Record<string, any>;
}

/* ------------------------------------------------------------------ transport doubles */

/** A socket the client cannot complete a round trip on unless the case says so. */
class FakeSocket extends EventEmitter {
	readonly written: Buffer[] = [];
	destroyed = false;
	ended = false;
	write(bytes: Buffer): boolean {
		this.written.push(bytes);
		return true;
	}
	end(bytes?: Buffer): void {
		if (bytes !== undefined) this.written.push(bytes);
		this.ended = true;
	}
	destroy(): void {
		this.destroyed = true;
	}
}

interface Timer {
	callback: () => void;
	delay: number;
}

/** The client's clock, so a two-second deadline is a value the case fires on purpose. */
function fakeScheduler(): { scheduler: { setTimeout: (cb: () => void, delay: number) => unknown; clearTimeout: (handle: unknown) => void }; delays: () => number[]; fire: (delay: number) => boolean } {
	const timers = new Map<number, Timer>();
	let next = 0;
	return {
		scheduler: {
			setTimeout: (callback: () => void, delay: number) => {
				next += 1;
				timers.set(next, { callback, delay });
				return next;
			},
			clearTimeout: (handle: unknown) => {
				timers.delete(handle as number);
			},
		},
		delays: () => [...timers.values()].map((timer) => timer.delay),
		fire: (delay: number) => {
			for (const [handle, timer] of [...timers]) {
				if (timer.delay !== delay) continue;
				timers.delete(handle);
				timer.callback();
				return true;
			}
			return false;
		},
	};
}

interface PeerRecord {
	version: 1;
	sessionId: string;
	endpoint: string;
	createdAt: number;
}

const peerRecord = (sessionId: string): PeerRecord => ({ version: 1, sessionId, endpoint: '/tmp/loon-peer-' + sessionId, createdAt: 1_000 });

function fakeRegistry(peer: PeerRecord): { resolve: (sessionId: string) => Promise<PeerRecord>; removeOwn: () => Promise<void> } {
	return {
		resolve: async (sessionId: string) => {
			assert.equal(sessionId, peer.sessionId, 'the client resolved a peer nobody asked for');
			return peer;
		},
		removeOwn: async () => undefined,
	};
}

/** Let the client's async begin() reach the connect step. */
const flush = async (): Promise<void> => {
	await new Promise((resolve) => setImmediate(resolve));
	await new Promise((resolve) => setImmediate(resolve));
};

type Outcome = { value: { id: string; accepted: true } } | { code: string };

function outcomeOf(pending: Promise<{ id: string; accepted: true }>): Promise<Outcome> {
	return pending.then(
		(value) => ({ value }),
		(error: { code?: string }) => ({ code: error.code ?? 'no-code' }),
	);
}

/**
 * Drive the client to the point where the frame is written and the ACK is awaited.
 *
 * The outcome travels boxed: an async function that returned the promise itself would adopt
 * it, so the caller would wait for a settlement it can only cause by firing the deadline
 * afterwards. That adoption is a deadlock, and it is what hung the first run of this file.
 */
async function writtenAndWaiting(client: any, socket: FakeSocket, id: string): Promise<{ outcome: Promise<Outcome> }> {
	const outcome = outcomeOf(client.sendNotification('peer-2', 'hola', { id }));
	await flush();
	socket.emit('connect');
	await flush();
	assert.equal(socket.written.length, 1, 'the frame was never written to the receiver');
	return { outcome };
}

/* ------------------------------------------------------------------------ S6: the ACK */

test('a written message is still accepted when the receiver never acknowledges it', async (t) => {
	const root = patchedTree(t, [AGENTS_TRANSPORT]);
	if (root === undefined) {
		t.skip('no untouched gentle-pi ' + GENTLE_PI_VERSION + ' bytes on this machine; set GENTLE_PI_ROOT');
		return;
	}
	const transport = await load(root, AGENTS_TRANSPORT);
	const socket = new FakeSocket();
	const clock = fakeScheduler();
	const client = new transport.ActiveSessionClient(fakeRegistry(peerRecord('peer-2')), 'sender-1', {
		scheduler: clock.scheduler,
		connect: () => socket,
		connectDeadlineMs: 500,
		ackDeadlineMs: 2000,
	});

	const { outcome } = await writtenAndWaiting(client, socket, 'message-1');
	assert.deepEqual(clock.delays(), [2000], 'the ACK deadline is not the only timer left');
	// The receiver took the frame and stayed silent. The deadline was a delivery verdict
	// once, and the whole tool answered "not accepted" for a message that had arrived.
	clock.fire(2000);
	assert.deepEqual(await outcome, { value: { id: 'message-1', accepted: true } });
});

test('a receiver that hangs up without acknowledging still took the message', async (t) => {
	const root = patchedTree(t, [AGENTS_TRANSPORT]);
	if (root === undefined) {
		t.skip('no untouched gentle-pi ' + GENTLE_PI_VERSION + ' bytes on this machine; set GENTLE_PI_ROOT');
		return;
	}
	const transport = await load(root, AGENTS_TRANSPORT);
	const socket = new FakeSocket();
	const clock = fakeScheduler();
	const client = new transport.ActiveSessionClient(fakeRegistry(peerRecord('peer-2')), 'sender-1', {
		scheduler: clock.scheduler,
		connect: () => socket,
		connectDeadlineMs: 500,
		ackDeadlineMs: 2000,
	});

	const { outcome } = await writtenAndWaiting(client, socket, 'message-2');
	socket.emit('close');
	assert.deepEqual(await outcome, { value: { id: 'message-2', accepted: true } });
});

test('a receiver that rejects the message still fails the send', async (t) => {
	const root = patchedTree(t, [AGENTS_TRANSPORT]);
	if (root === undefined) {
		t.skip('no untouched gentle-pi ' + GENTLE_PI_VERSION + ' bytes on this machine; set GENTLE_PI_ROOT');
		return;
	}
	const transport = await load(root, AGENTS_TRANSPORT);
	const socket = new FakeSocket();
	const clock = fakeScheduler();
	const client = new transport.ActiveSessionClient(fakeRegistry(peerRecord('peer-2')), 'sender-1', {
		scheduler: clock.scheduler,
		connect: () => socket,
		connectDeadlineMs: 500,
		ackDeadlineMs: 2000,
	});

	const { outcome } = await writtenAndWaiting(client, socket, 'message-3');
	// An explicit rejection is a verdict, not a lost confirmation: the repair must not turn
	// it into a success.
	socket.emit('data', transport.encodeAckFrame({ version: 1, kind: 'ack', id: 'message-3', accepted: false, error: 'rejected' }));
	socket.emit('end');
	assert.deepEqual(await outcome, { code: 'remote_rejected' });
});

test('the Windows transport keeps the same rule', async (t) => {
	const root = patchedTree(t, [AGENTS_TRANSPORT, WINDOWS_TRANSPORT]);
	if (root === undefined) {
		t.skip('no untouched gentle-pi ' + GENTLE_PI_VERSION + ' bytes on this machine; set GENTLE_PI_ROOT');
		return;
	}
	const transport = await load(root, WINDOWS_TRANSPORT);
	// The frame encoder lives in the shared transport, not in the Windows one that imports
	// it: reading it from the Windows module would find nothing at run time.
	const frames = await load(root, AGENTS_TRANSPORT);
	const clock = fakeScheduler();

	const silent = new FakeSocket();
	const silentClient = new transport.WindowsActiveSessionClient(fakeRegistry(peerRecord('peer-2')), 'sender-1', {
		scheduler: clock.scheduler,
		connect: () => silent,
		connectDeadlineMs: 500,
		ackDeadlineMs: 2000,
	});
	const lostAck = await writtenAndWaiting(silentClient, silent, 'message-4');
	assert.deepEqual(clock.delays(), [2000], 'the ACK deadline is not the only timer left');
	clock.fire(2000);
	assert.deepEqual(await lostAck.outcome, { value: { id: 'message-4', accepted: true } });

	const rejecting = new FakeSocket();
	const rejectingClient = new transport.WindowsActiveSessionClient(fakeRegistry(peerRecord('peer-2')), 'sender-1', {
		scheduler: fakeScheduler().scheduler,
		connect: () => rejecting,
		connectDeadlineMs: 500,
		ackDeadlineMs: 2000,
	});
	const rejected = await writtenAndWaiting(rejectingClient, rejecting, 'message-5');
	rejecting.emit('data', frames.encodeAckFrame({ version: 1, kind: 'ack', id: 'message-5', accepted: false, error: 'rejected' }));
	rejecting.emit('end');
	assert.deepEqual(await rejected.outcome, { code: 'remote_rejected' });
});

/* ------------------------------------------------------------- S7: presence discovery */

const digest = (value: string): string => createHash('sha256').update(value).digest('hex');
const activationOf = (peer: PeerRecord): string => digest(JSON.stringify([peer.sessionId, peer.endpoint, peer.createdAt]));

/** A profile with the private presence directory the discovery module reads. */
function presenceProfile(t: Teardown): { profile: string; presence: string } {
	const root = mkdtempSync(join(tmpdir(), 'loon-peer-profile-'));
	const profile = join(root, 'profile');
	const presence = join(profile, 'gentle-agents', 'presence');
	mkdirSync(presence, { recursive: true, mode: 0o700 });
	chmodSync(presence, 0o700);
	t.after(() => {
		try {
			chmodSync(presence, 0o700);
		} catch {
			// The case may have removed the directory or never restored its mode.
		}
		rmSync(root, { recursive: true, force: true });
	});
	return { profile, presence };
}

interface PeerOptions {
	label: string;
	heartbeat?: number;
	incarnation?: string;
	discovery?: { workspace: string; activation?: string; currentAlias?: string | null; initialAlias?: string | null };
}

/** One peer's published header, and its discovery sidecar when the peer publishes one. */
function writePeer(presence: string, peer: PeerRecord, options: PeerOptions): string {
	const incarnation = options.incarnation ?? randomUUID();
	const header = {
		schema: 1,
		sessionHash: digest(peer.sessionId),
		incarnation,
		label: options.label,
		heartbeat: options.heartbeat ?? Date.now(),
		generation: 1,
		counts: { running: 0, queued: 0, waiting: 0, finished: 0 },
		digest: digest('activity'),
		unavailable: null,
	};
	const base = header.sessionHash + '.' + incarnation;
	writeFileSync(join(presence, base + '.header.json'), JSON.stringify(header));
	if (options.discovery !== undefined) {
		const aliases = options.discovery.currentAlias === undefined
			? {}
			: { aliases: { initialAlias: options.discovery.initialAlias ?? options.discovery.currentAlias, currentAlias: options.discovery.currentAlias } };
		const metadata = { activation: options.discovery.activation ?? activationOf(peer), workspace: options.discovery.workspace, tasks: [], omitted: 0, ...aliases };
		writeFileSync(join(presence, base + '.discovery.json'), JSON.stringify({ schema: 1, sessionHash: header.sessionHash, incarnation, generation: 1, metadata }));
	}
	return base;
}

test('one unreadable header does not take the healthy peers down with it', async (t) => {
	const support = stockPackage();
	if (support === undefined) {
		t.skip('no stock gentle-pi ' + GENTLE_PI_VERSION + ' package on this machine; set GENTLE_PI_ROOT');
		return;
	}
	const root = patchedTree(t, [DISCOVERY], support);
	if (root === undefined) {
		t.skip('no untouched gentle-pi ' + GENTLE_PI_VERSION + ' bytes on this machine; set GENTLE_PI_ROOT');
		return;
	}
	const { profile, presence } = presenceProfile(t);
	const alpha = peerRecord('peer-alpha');
	const beta = peerRecord('peer-beta');
	writePeer(presence, alpha, { label: 'alpha session', discovery: { workspace: '/work/alpha', currentAlias: 'map the footer' } });
	writePeer(presence, beta, { label: 'beta session' });
	// A header nobody can parse, in the same directory every peer publishes to.
	writeFileSync(join(presence, 'corrupt.header.json'), '{ this is not a header');

	const discovery = await load(root, DISCOVERY);
	const found = discovery.discoverOrchestrators(profile, [alpha, beta]);

	assert.deepEqual(
		found.map((peer: { label?: string; legacyLabel?: string }) => peer.label ?? peer.legacyLabel),
		['alpha session', 'beta session'],
		'a corrupt header for one peer blanked the others',
	);
	assert.equal(found[0].freshness, 'recent');
	assert.equal(found[0].aliases?.currentAlias, 'map the footer', 'the published subject (alias) was lost');
	assert.equal(found[0].workspace, '/work/alpha');
});

test('a scan that runs out of budget labels what it scanned and leaves the rest unknown', async (t) => {
	const support = stockPackage();
	if (support === undefined) {
		t.skip('no stock gentle-pi ' + GENTLE_PI_VERSION + ' package on this machine; set GENTLE_PI_ROOT');
		return;
	}
	const root = patchedTree(t, [DISCOVERY], support);
	if (root === undefined) {
		t.skip('no untouched gentle-pi ' + GENTLE_PI_VERSION + ' bytes on this machine; set GENTLE_PI_ROOT');
		return;
	}
	const { profile, presence } = presenceProfile(t);
	const peers: PeerRecord[] = [];
	for (let index = 0; index < 129; index += 1) {
		const peer = peerRecord('peer-' + String(index).padStart(3, '0'));
		peers.push(peer);
		// No sidecar: these are peers whose header is all they publish, which is enough
		// evidence to name them.
		writePeer(presence, peer, { label: 'session ' + index });
	}

	const discovery = await load(root, DISCOVERY);
	const found = discovery.discoverOrchestrators(profile, peers);

	const named = found.filter((peer: { legacyLabel?: string }) => peer.legacyLabel !== undefined);
	// The first page holds exactly 128 headers; the one the page budget never reached is the
	// only peer that stays unknown.
	assert.equal(named.length, 128, 'the peers the page scanned were not named');
	assert.equal(found.length - named.length, 1, 'a peer the scan never reached was named anyway');
	for (const peer of named) assert.match(peer.legacyLabel, /^session \d+$/);
});

test('a transient listing failure is retried instead of blanking every label', { skip: process.getuid?.() === 0 ? 'root ignores the directory mode this case needs' : false }, async (t) => {
	const support = stockPackage();
	if (support === undefined) {
		t.skip('no stock gentle-pi ' + GENTLE_PI_VERSION + ' package on this machine; set GENTLE_PI_ROOT');
		return;
	}
	const root = patchedTree(t, [DISCOVERY], support);
	if (root === undefined) {
		t.skip('no untouched gentle-pi ' + GENTLE_PI_VERSION + ' bytes on this machine; set GENTLE_PI_ROOT');
		return;
	}
	const { profile, presence } = presenceProfile(t);
	const alpha = peerRecord('peer-alpha');
	writePeer(presence, alpha, { label: 'alpha session' });
	const discovery = await load(root, DISCOVERY);

	// The repair waits synchronously, so the permission has to come back from outside this
	// process: a short-lived shell restores it while the backoff runs, exactly like a
	// filesystem that was busy and is not any more.
	const restore = spawn('sh', ['-c', "sleep 0.01; chmod 700 '" + presence + "'"], { stdio: 'ignore' });
	// A case that fails early must not leave the restore running behind it.
	t.after(() => {
		if (restore.exitCode === null && restore.signalCode === null) restore.kill('SIGKILL');
	});
	chmodSync(presence, 0o000);
	const found = discovery.discoverOrchestrators(profile, [alpha]);
	await new Promise<void>((resolve) => restore.once('close', () => resolve()));

	assert.equal(found[0].legacyLabel, 'alpha session', 'one transient listing failure left every peer unnamed');
});

test('a profile that is simply not there still fails closed, without waiting for it', async (t) => {
	const support = stockPackage();
	if (support === undefined) {
		t.skip('no stock gentle-pi ' + GENTLE_PI_VERSION + ' package on this machine; set GENTLE_PI_ROOT');
		return;
	}
	const root = patchedTree(t, [DISCOVERY], support);
	if (root === undefined) {
		t.skip('no untouched gentle-pi ' + GENTLE_PI_VERSION + ' bytes on this machine; set GENTLE_PI_ROOT');
		return;
	}
	const { profile, presence } = presenceProfile(t);
	const alpha = peerRecord('peer-alpha');
	writePeer(presence, alpha, { label: 'alpha session' });
	const discovery = await load(root, DISCOVERY);

	const empty = join(profile, 'never-published');
	mkdirSync(empty, { recursive: true, mode: 0o700 });
	const found = discovery.discoverOrchestrators(empty, [alpha]);
	// Nothing was scanned, so nothing may be labelled: a missing presence directory is not a
	// transient failure, it is a session that has published nothing.
	assert.deepEqual({ label: found[0].label, legacyLabel: found[0].legacyLabel }, { label: undefined, legacyLabel: undefined });
	assert.equal(found[0].freshness, 'unknown');
});

test('a peer with no readable header stays unknown while its neighbours are named', async (t) => {
	const support = stockPackage();
	if (support === undefined) {
		t.skip('no stock gentle-pi ' + GENTLE_PI_VERSION + ' package on this machine; set GENTLE_PI_ROOT');
		return;
	}
	const root = patchedTree(t, [DISCOVERY], support);
	if (root === undefined) {
		t.skip('no untouched gentle-pi ' + GENTLE_PI_VERSION + ' bytes on this machine; set GENTLE_PI_ROOT');
		return;
	}
	const { profile, presence } = presenceProfile(t);
	const healthy = peerRecord('peer-healthy');
	const absent = peerRecord('peer-absent');
	const ambiguous = peerRecord('peer-ambiguous');
	writePeer(presence, healthy, { label: 'healthy session' });
	// Two live headers for one session: the registry cannot say which activation this peer
	// is, so this peer fails closed - and only this one.
	writePeer(presence, ambiguous, { label: 'first incarnation' });
	writePeer(presence, ambiguous, { label: 'second incarnation' });

	const discovery = await load(root, DISCOVERY);
	const found = discovery.discoverOrchestrators(profile, [healthy, absent, ambiguous]);
	const byId = new Map<string, { legacyLabel?: string }>(found.map((peer: { sessionId: string; legacyLabel?: string }) => [peer.sessionId, peer]));

	assert.equal(byId.get(healthy.sessionId)?.legacyLabel, 'healthy session');
	assert.equal(byId.get(absent.sessionId)?.legacyLabel, undefined, 'a peer that published nothing was named');
	assert.equal(byId.get(ambiguous.sessionId)?.legacyLabel, undefined, 'an ambiguous peer was labelled anyway');
});
