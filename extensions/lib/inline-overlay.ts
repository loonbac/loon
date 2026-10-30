/**
 * The inline unit, as the Agents panel sees it.
 *
 * gentle-pi's overlay lists store.list() and draws the detail from
 * store.thread(id). Our unit is deliberately not in that store (it is not a
 * child process, not cancellable, not launch authority), so the panel needs a
 * second source that answers two questions: which records belong to this
 * session, and what is this record's transcript.
 *
 * This module is that source. The patched panel asks it through one global,
 * __loonInlinePanel, and calls tasks(sessionId, knownIds) and thread(id).
 * Three things can carry the same unit - the live carrier file, the persisted
 * history record, and the store entry a resume restored - and they must never
 * add up to two cards, so everything here is keyed by unit and de-duplicated by
 * id before it is returned.
 *
 * Nothing in this file may throw at the panel: an unreadable, malformed or
 * foreign record is absent, exactly as gentle-pi treats its own broken history.
 */
import { existsSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { processAlive } from './inline-carrier.ts';

/** How long a running carrier stays believable without a heartbeat. */
const LIVE_WINDOW_MS = 10 * 60 * 1000;

/** How long a finished carrier stays believable: the session's own history. */
const FINISHED_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Where the live thread of the running unit is kept, next to its carrier. */
export function liveThreadPath(agentHome: string, sessionId: string): string {
	return join(agentHome, 'state', 'loon-inline', sessionId + '.thread.json');
}

/** The minimum a record must be for the panel to receive it as a task. */
export interface OverlayTask {
	id: string;
	agent: string;
	mode: string;
	status: string;
	parentSessionId: string;
	label: string;
	createdAt: number;
	lastActivityAt: number;
	[key: string]: unknown;
}

/** The thread shape gentle-pi renders, with only what a panel row needs kept. */
export interface OverlayThread {
	version: number;
	dropped: number;
	items: { kind: string; [key: string]: unknown }[];
	limits: { maxItems: number; maxOutputChars: number };
}

/**
 * The unit an id names, whatever source it came from: two records of the same
 * unit share a key, and a numberless id from before units existed is its own
 * legacy key so it can be recognised and dropped.
 *
 * The session id has to be given: it can end in digits itself, so splitting the
 * id on its last dash would read a session as a unit.
 * @param {string} id
 * @param {string} [sessionId]
 * @returns {string}
 */
export function unitKey(id: string, sessionId?: string): string {
	if (sessionId !== undefined && sessionId.length > 0) {
		const prefix = 'loon-inline-' + sessionId;
		if (id === prefix) return prefix + '#legacy';
		if (id.startsWith(prefix + '-')) return prefix + '#' + id.slice(prefix.length + 1);
	}
	const match = /^(.*)-(\d+)$/.exec(id);
	return match === null ? id + '#legacy' : match[1] + '#' + match[2];
}

function readJson(path: string): unknown {
	try {
		if (!existsSync(path)) return undefined;
		return JSON.parse(readFileSync(path, 'utf8'));
	} catch {
		return undefined;
	}
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asTask(value: unknown): OverlayTask | undefined {
	if (!isObject(value)) return undefined;
	if (typeof value.id !== 'string' || value.id.length === 0) return undefined;
	if (typeof value.agent !== 'string' || typeof value.label !== 'string') return undefined;
	if (typeof value.parentSessionId !== 'string' || value.parentSessionId.length === 0) return undefined;
	if (value.status !== 'running' && value.status !== 'completed' && value.status !== 'failed') return undefined;
	if (typeof value.createdAt !== 'number') return undefined;
	return value as OverlayTask;
}

function asThread(value: unknown): OverlayThread | undefined {
	if (!isObject(value)) return undefined;
	const items = value.items;
	if (!Array.isArray(items)) return undefined;
	const kept = items.filter((item): item is { kind: string } => isObject(item) && typeof item.kind === 'string');
	return {
		version: typeof value.version === 'number' ? value.version : kept.length,
		dropped: typeof value.dropped === 'number' ? value.dropped : 0,
		items: kept,
		limits: isObject(value.limits)
			? { maxItems: Number(value.limits.maxItems) || 0, maxOutputChars: Number(value.limits.maxOutputChars) || 0 }
			: { maxItems: 0, maxOutputChars: 0 },
	};
}

function fresh(task: OverlayTask, now: number): boolean {
	const seen = typeof task.lastActivityAt === 'number' ? task.lastActivityAt : 0;
	const age = now - seen;
	if (!Number.isFinite(age) || age < 0) return false;
	if (task.status !== 'running') return age <= FINISHED_WINDOW_MS;
	// A running record whose writer is gone is not live work, whatever its file says.
	if (typeof task.pid === 'number' && task.pid > 0 && !processAlive(task.pid)) return false;
	return age <= LIVE_WINDOW_MS;
}

/** The records this session persisted when its units closed. */
function historyRecords(agentHome: string, sessionId: string): OverlayTask[] {
	const dir = join(agentHome, 'gentle-agents', 'tasks');
	let names: string[];
	try {
		if (!existsSync(dir)) return [];
		names = readdirSync(dir).filter((name) => name.startsWith('loon-inline-') && name.endsWith('.json'));
	} catch {
		return [];
	}
	const records: OverlayTask[] = [];
	for (const name of names) {
		const stored = readJson(join(dir, name));
		if (!isObject(stored)) continue;
		const task = asTask(stored.task);
		if (task === undefined || task.parentSessionId !== sessionId) continue;
		records.push(task);
	}
	return records;
}

/** The carrier of the unit that is running right now, if there is one. */
function liveCarrier(agentHome: string, sessionId: string, now: number): OverlayTask | undefined {
	const carrier = asTask(readJson(join(agentHome, 'state', 'loon-inline', sessionId + '.json')));
	if (carrier === undefined || carrier.parentSessionId !== sessionId) return undefined;
	return fresh(carrier, now) ? carrier : undefined;
}

/**
 * The panel's list: this session's units, one entry per unit, minus the ids the
 * store already serves.
 * @param {string} agentHome
 * @param {string} sessionId
 * @param {string[]} [known] ids the store already lists for this session
 * @param {number} [now]
 * @returns {OverlayTask[]}
 */
export function overlayTasks(agentHome: string, sessionId: string, known: string[] = [], now: number = Date.now()): OverlayTask[] {
	try {
		if (sessionId.length === 0) return [];
		const knownIds = new Set(known);
		const byUnit = new Map<string, OverlayTask>();
		for (const task of historyRecords(agentHome, sessionId)) {
			if (knownIds.has(task.id)) continue;
			const key = unitKey(task.id, sessionId);
			if (!byUnit.has(key)) byUnit.set(key, task);
		}
		const live = liveCarrier(agentHome, sessionId, now);
		if (live !== undefined && !knownIds.has(live.id)) {
			const key = unitKey(live.id, sessionId);
			if (!byUnit.has(key)) byUnit.set(key, live);
		}
		// A numberless carrier is a record from before units had numbers. Once the
		// session has any numbered record, that numberless one is the same unit as
		// the first: keeping both prints the same work twice.
		const numbered = new Set([...byUnit.keys()].filter((key) => !key.endsWith('#legacy')).map((key) => key.slice(0, key.lastIndexOf('#'))));
		for (const key of [...byUnit.keys()]) {
			if (key.endsWith('#legacy') && numbered.has(key.slice(0, key.length - '#legacy'.length))) byUnit.delete(key);
		}
		return [...byUnit.values()].sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
	} catch {
		return [];
	}
}

/**
 * The panel's detail: the persisted thread of a closed unit, or the live one of
 * the unit still running. Undefined when there is nothing to show, never an
 * exception and never a placeholder.
 * @param {string} agentHome
 * @param {string} id
 * @returns {OverlayThread | undefined}
 */
export function overlayThread(agentHome: string, id: string): OverlayThread | undefined {
	try {
		const history = readJson(join(agentHome, 'gentle-agents', 'tasks', id + '.json'));
		if (isObject(history)) {
			const thread = asThread(history.thread);
			if (thread !== undefined) return thread;
		}
		const liveDir = join(agentHome, 'state', 'loon-inline');
		if (!existsSync(liveDir)) return undefined;
		for (const name of readdirSync(liveDir)) {
			if (!name.endsWith('.thread.json')) continue;
			const live = readJson(join(liveDir, name));
			if (!isObject(live) || live.id !== id) continue;
			const thread = asThread(live.thread);
			if (thread !== undefined) return thread;
		}
		return undefined;
	} catch {
		return undefined;
	}
}

/**
 * Keep the running unit's transcript where the panel can read it. Replaced on
 * every step, so it is always the current unit and never a stale one.
 * @param {string} agentHome
 * @param {string} sessionId
 * @param {string} id
 * @param {unknown} thread the unit's thread, as the panel will read it back
 */
export function writeLiveThread(agentHome: string, sessionId: string, id: string, thread: unknown): void {
	try {
		writeFileSync(liveThreadPath(agentHome, sessionId), JSON.stringify({ id, thread }), { mode: 0o600 });
	} catch {
		// A panel detail that cannot be written costs the detail, never the session.
	}
}

/**
 * Remove the live transcript, on shutdown or when its unit is gone.
 * @param {string} agentHome
 * @param {string} sessionId
 */
export function clearLiveThread(agentHome: string, sessionId: string): void {
	try {
		const path = liveThreadPath(agentHome, sessionId);
		if (existsSync(path)) unlinkSync(path);
	} catch {
		// Same rule as above: nothing here may reach the session.
	}
}

/** The shape the panel calls through the global. */
export interface OverlayPanel {
	tasks(sessionId: string, known: string[]): OverlayTask[];
	thread(id: string): OverlayThread | undefined;
}

const PANEL_GLOBAL = '__loonInlinePanel';

/**
 * Publish (or withdraw) the provider the patched panel looks for. Without it the
 * panel draws exactly what gentle-pi draws, which is the degradation we want if
 * the patch is gone, the version moved, or this extension is off.
 * @param {{ agentHome: string } | undefined} panel
 */
export function installOverlayPanel(panel: { agentHome: string } | undefined): void {
	const host = globalThis as unknown as Record<string, unknown>;
	try {
		if (panel === undefined) {
			delete host[PANEL_GLOBAL];
			return;
		}
		host[PANEL_GLOBAL] = {
			tasks: (sessionId: string, known: string[]) => overlayTasks(panel.agentHome, sessionId, Array.isArray(known) ? known : []),
			thread: (id: string) => overlayThread(panel.agentHome, id),
		} satisfies OverlayPanel;
	} catch {
		// Publishing is best effort: no panel is better than a broken one.
	}
}
