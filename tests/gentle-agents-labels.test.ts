import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildAliases, findPiInstall, jitiEntry, patchText, TARGETS, type TargetSpec } from '../scripts/gentle-pi-patch.ts';
import { PRISTINE_FILES, pristineSource, readPristine } from './support/pristine.ts';

/**
 * The rule this file pins: a person or an agent reading a recipient label sees what the
 * peer published - its subject, session name, workspace and topic - and never the raw
 * session UUID. The same identity heads the `orchestrator_list` row, and a child or
 * single-shot session resolves its own recipient instead of handing the choice to the
 * owner.
 *
 * Bytes, not intentions: the module under test is the patch's own output, imported through
 * the jiti loader pi uses, over a presence profile this test writes.
 */
const TARGET_FILE = 'extensions/gentle-agents.ts';

const PRISTINE = pristineSource();
/** The package the scratch copy is built from: the installed tree supplies the modules that
 * are not patch targets, and every target is overwritten with pristine 4.7.0 bytes. */
const BASE = join(homedir(), '.pi', 'agent', 'npm', 'node_modules', 'gentle-pi');
const available = PRISTINE.ok && existsSync(join(BASE, 'extensions', 'gentle-agents.ts'))
	? undefined
	: 'no pristine gentle-pi sources or no installed package to build them in';

const SCRATCH: string[] = [];
after(() => {
	for (const root of SCRATCH) rmSync(root, { recursive: true, force: true });
});

function target(): TargetSpec {
	const found = TARGETS.find((item) => item.file === TARGET_FILE);
	if (found === undefined) throw new Error('no patch target for ' + TARGET_FILE);
	return found;
}

/** The exact bytes `apply` writes for the gentl-agents extension. */
function patchedText(): string {
	if (!PRISTINE.ok) throw new Error('no pristine source');
	const spec = target();
	const result = patchText(readPristine(PRISTINE.ok ? PRISTINE.source : { root: '', label: '' }, spec.file), spec);
	if (!result.ok) throw new Error(spec.file + ': ' + result.reason);
	return result.text;
}

let cachedRoot: string | undefined;

/**
 * A scratch package: the installed tree for the modules that are not patch targets, every
 * target reset to its pristine bytes, and the extension under test written from our own
 * edit set. Nothing here reads our patch output out of the install.
 */
function patchedPackage(): string {
	if (cachedRoot !== undefined) return cachedRoot;
	if (!PRISTINE.ok) throw new Error('no pristine source');
	const root = realpathSync(mkdtempSync(join(tmpdir(), 'loon-agents-labels-')));
	SCRATCH.push(root);
	cpSync(BASE, root, { recursive: true, dereference: true });
	// Every target starts from the pristine build, so no import below can read our patch
	// output out of the install; the one module under test is then written from our edits.
	for (const file of PRISTINE_FILES) writeFileSync(join(root, file), readPristine(PRISTINE.source, file));
	writeFileSync(join(root, TARGET_FILE), patchedText());
	cachedRoot = root;
	return root;
}

interface AgentsModule {
	peerIdentity?: (peer: Peer) => string | undefined;
	recipientSelectionLabels?: (profile: string, candidates: readonly Activation[], activations?: readonly Activation[]) => string[];
	interactiveRecipientSelection?: (ctx: { hasUI: boolean; mode: string }, env?: NodeJS.ProcessEnv) => boolean;
	recipientResolutionText?: (labels: readonly string[]) => string;
}

interface Peer {
	sessionId: string;
	label?: string;
	legacyLabel?: string;
	workspace?: string;
	aliases?: { initialAlias: string | null; currentAlias: string | null };
	workRecord?: { work: { area?: string; topic?: string } | null; recordedAt: number };
}

interface Activation {
	version: 1;
	sessionId: string;
	endpoint: string;
	createdAt: number;
}

const PI_ROOT = findPiInstall();
const available2 = available ?? (PI_ROOT === undefined ? 'no pi install to borrow the jiti loader from' : undefined);

let cachedModule: AgentsModule | undefined;

async function agents(): Promise<AgentsModule> {
	if (cachedModule !== undefined) return cachedModule;
	const root = patchedPackage();
	if (PI_ROOT === undefined) throw new Error('no pi install');
	const { createJiti } = (await import(jitiEntry(PI_ROOT))) as {
		createJiti: (url: string, options: Record<string, unknown>) => { import: (path: string) => Promise<unknown> };
	};
	const jiti = createJiti(import.meta.url, { moduleCache: false, interopDefault: true, fsCache: false, alias: buildAliases(PI_ROOT) });
	cachedModule = (await jiti.import(join(root, TARGET_FILE))) as AgentsModule;
	return cachedModule;
}

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

/** A presence profile the extension's own discovery reads: one header per peer, plus the
 * discovery sidecar that carries the published identity. */
interface PeerFixture {
	sessionId: string;
	label: string;
	workspace: string;
	subject?: string;
	topic?: string;
	/** No sidecar at all: a peer that never published discovery. */
	silent?: boolean;
}

function profile(peers: readonly PeerFixture[]): { root: string; activations: Activation[] } {
	const root = realpathSync(mkdtempSync(join(tmpdir(), 'loon-agents-profile-')));
	SCRATCH.push(root);
	const presence = join(root, 'gentle-agents', 'presence');
	mkdirSync(presence, { recursive: true, mode: 0o700 });
	chmodSync(presence, 0o700);
	const activations: Activation[] = [];
	peers.forEach((peer, index) => {
		const incarnation = `00000000-0000-4000-8000-00000000000${index + 1}`;
		const endpoint = join(root, `peer-${index}.sock`);
		const createdAt = 1_700_000_000_000 + index;
		const activation = { version: 1 as const, sessionId: peer.sessionId, endpoint, createdAt };
		activations.push(activation);
		const hash = sha256(peer.sessionId);
		const header = {
			schema: 1,
			sessionHash: hash,
			incarnation,
			label: peer.label,
			heartbeat: Date.now(),
			generation: 1,
			counts: { running: 0, queued: 0, waiting: 0, finished: 0 },
			digest: sha256('activity'),
			unavailable: null,
		};
		writeFileSync(join(presence, `${hash}.${incarnation}.header.json`), JSON.stringify(header));
		if (peer.silent) return;
		const aliases = peer.subject === undefined ? undefined : { initialAlias: peer.subject, currentAlias: peer.subject };
		const work = peer.topic === undefined ? undefined : { work: { area: 'agents', topic: peer.topic } };
		const state = work === undefined ? undefined : {
			schema: 2,
			sessionId: peer.sessionId,
			recordedAt: 1_700_000_000_000,
			cwd: peer.workspace,
			source: 'owner-curated' as const,
			ownerReply: false as const,
			authority: 'none' as const,
			state: work,
		};
		writeFileSync(
			join(presence, `${hash}.${incarnation}.discovery.json`),
			JSON.stringify({
				schema: 1,
				sessionHash: hash,
				incarnation,
				generation: 1,
				metadata: {
					activation: sha256(JSON.stringify([peer.sessionId, endpoint, createdAt])),
					workspace: peer.workspace,
					tasks: [],
					omitted: 0,
					...(aliases === undefined ? {} : { aliases }),
					...(state === undefined ? {} : { state }),
				},
			}),
		);
	});
	return { root, activations };
}

const UUID_LIKE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
const SESSION_A = '5b0f1f1e-61a7-4f7d-9a51-8cbb1d2a9d01';
const SESSION_B = '9a6c4d2b-3f58-4c2e-8a77-1d6f0b3c5e02';

test('the patch ships a readable peer identity, so no label can be a UUID', { skip: available }, () => {
	const spec = target();
	assert.equal(spec.edits.length, 3, 'the extension patch is three edits: the identity helper, the selector gate, the list row');
	const patched = patchedText();
	// The identity travels through the artifact we ship, not only through a test.
	assert.ok(patched.includes('function peerIdentity('), 'peerIdentity is not in the patched bytes');
	assert.ok(patched.includes('export function recipientSelectionLabels('), 'the label helper is not exported for a caller to test');
	assert.ok(!patched.includes('if (!ctx.hasUI) return text(`Several recipient orchestrators'), 'the old owner-asking path is still there');
	assert.ok(!/`- \$\{peer\.sessionId\}\$\{context\}/.test(patched), 'the list row still heads with the raw session id');
});

test('the list row heads with the readable identity and relegates the id to the end', { skip: available }, () => {
	const patched = patchedText();
	const row = patched.split('\n').find((line) => line.includes('${context} · ${legacy ? "repository: not published"'));
	assert.ok(row !== undefined, 'the orchestrator_list row was not found in the patched bytes');
	assert.match(row!, /return `- \$\{peerIdentity\(peer\)/, 'the row does not head with the identity: ' + row);
	const head = row!.indexOf('peerIdentity(peer)');
	const tail = row!.indexOf('session id (internal value');
	assert.ok(tail > head, 'the session id is not an internal value at the end of the row');
	assert.match(row!.slice(tail), /\$\{peer\.sessionId\}/, 'the id is no longer reachable as the internal value');
});

test('a label names the subject, session name, workspace and topic, and never the UUID', { skip: available2 }, async () => {
	const { recipientSelectionLabels, peerIdentity } = await agents();
	assert.equal(typeof recipientSelectionLabels, 'function', 'recipientSelectionLabels is not exported');
	assert.equal(typeof peerIdentity, 'function', 'peerIdentity is not exported');
	if (typeof recipientSelectionLabels !== 'function') return;
	const fixture = profile([
		{ sessionId: SESSION_A, label: 'Pi session A', workspace: '/home/loon/Proyectos/repo-alpha', subject: 'peer labels', topic: 'enrutar destinos' },
		{ sessionId: SESSION_B, label: 'Pi session B', workspace: '/home/loon/Proyectos/repo-beta', subject: 'shell chrome', topic: 'barra' },
	]);
	const labels = recipientSelectionLabels(fixture.root, fixture.activations);
	assert.equal(labels.length, 2);
	for (const [index, expected] of [
		{ subject: 'peer labels', name: 'Pi session A', workspace: 'repo-alpha', topic: 'enrutar destinos' },
		{ subject: 'shell chrome', name: 'Pi session B', workspace: 'repo-beta', topic: 'barra' },
	].entries()) {
		const label = labels[index]!;
		assert.match(label, new RegExp(expected.subject), label);
		assert.match(label, new RegExp(expected.name), 'the session name is missing from ' + label);
		assert.match(label, new RegExp(expected.workspace), 'the workspace is missing from ' + label);
		assert.match(label, new RegExp(expected.topic), 'the topic is missing from ' + label);
		assert.ok(!label.includes(fixture.activations[index]!.sessionId), 'the label carries the raw session id: ' + label);
		assert.ok(!UUID_LIKE.test(label), 'the label carries a UUID: ' + label);
	}
	assert.notEqual(labels[0], labels[1], 'two peers share one label');
});

test('a peer that published nothing still gets a label a person can read, and no UUID', { skip: available2 }, async () => {
	const { recipientSelectionLabels } = await agents();
	if (typeof recipientSelectionLabels !== 'function') return;
	const fixture = profile([
		{ sessionId: SESSION_A, label: 'Pi session A', workspace: '/home/loon/Proyectos/repo-alpha', silent: true },
		{ sessionId: SESSION_B, label: 'Pi session B', workspace: '/home/loon/Proyectos/repo-beta', silent: true },
	]);
	const labels = recipientSelectionLabels(fixture.root, fixture.activations);
	assert.equal(labels.length, 2);
	for (const label of labels) {
		assert.ok(!label.includes(SESSION_A) && !label.includes(SESSION_B), 'the fallback label carries a session id: ' + label);
		assert.ok(!UUID_LIKE.test(label), 'the fallback label carries a UUID: ' + label);
	}
	assert.notEqual(labels[0], labels[1], 'two unresolved peers share one label, so a choice would be ambiguous');
});

test('two peers with the same published identity stay distinguishable without a UUID', { skip: available2 }, async () => {
	const { recipientSelectionLabels } = await agents();
	if (typeof recipientSelectionLabels !== 'function') return;
	const fixture = profile([
		{ sessionId: SESSION_A, label: 'Pi session', workspace: '/home/loon/Proyectos/repo', subject: 'same work' },
		{ sessionId: SESSION_B, label: 'Pi session', workspace: '/home/loon/Proyectos/repo', subject: 'same work' },
	]);
	const labels = recipientSelectionLabels(fixture.root, fixture.activations);
	assert.equal(new Set(labels).size, 2, 'the labels collide: ' + JSON.stringify(labels));
	for (const label of labels) assert.ok(!UUID_LIKE.test(label) && !label.includes(SESSION_A) && !label.includes(SESSION_B), label);
});

test('a child, a single-shot run or a session without UI never gets the owner selector', { skip: available2 }, async () => {
	const { interactiveRecipientSelection } = await agents();
	assert.equal(typeof interactiveRecipientSelection, 'function', 'interactiveRecipientSelection is not exported');
	if (typeof interactiveRecipientSelection !== 'function') return;
	const human = { hasUI: true, mode: 'tui' };
	assert.equal(interactiveRecipientSelection(human, { PATH: '/bin' }), true, 'the interactive human lost the selector');
	assert.equal(interactiveRecipientSelection(human, { GENTLE_PI_AGENTS_CHILD: '1' }), false, 'a child would open the owner selector');
	assert.equal(interactiveRecipientSelection({ hasUI: true, mode: 'json' }, {}), false, 'a json run would open the owner selector');
	assert.equal(interactiveRecipientSelection({ hasUI: true, mode: 'print' }, {}), false, 'a print run would open the owner selector');
	assert.equal(interactiveRecipientSelection({ hasUI: false, mode: 'tui' }, {}), false, 'a session without UI would open the owner selector');
});

test('the resolution error orders orchestrator_list and an explicit recipient_session_id', { skip: available2 }, async () => {
	const { recipientResolutionText } = await agents();
	assert.equal(typeof recipientResolutionText, 'function', 'recipientResolutionText is not exported');
	if (typeof recipientResolutionText !== 'function') return;
	const text = recipientResolutionText(['peer labels · Session name: Pi session A · repo-alpha']);
	assert.match(text, /orchestrator_list/, text);
	assert.match(text, /subject, topic or workspace/, text);
	assert.match(text, /recipient_session_id/, text);
	assert.match(text, /peer labels/, 'the identities are not listed: ' + text);
	assert.doesNotMatch(text, /Ask the user to choose/, 'the error still hands the choice to the owner: ' + text);
});
