/**
 * The unit's history: the record gentle-pi reads back after a reload.
 *
 * gentle-pi keeps one JSON file per finished task under its own history
 * directory and re-adds those records to its store on resume. Its overlay panel
 * renders the store, and the detail pane renders the stored thread, so writing
 * there is what turns an inline unit into a card that survives the session, with
 * a transcript behind it.
 *
 * The item shapes below are gentle-pi's own (`lib/agents-protocol.ts`): a tool
 * item is `{ kind: "tool", callId, name, args, output, running, isError }`, a
 * text item is `{ kind: "text", text }`, and the thread is
 * `{ items, dropped, version, limits }` where `limits` bounds the item count and
 * the output kept per tool. They are reproduced here rather than imported
 * because this is data written into a directory, not code called from a package
 * we do not own: the shape is pinned by a test that reads the file back through
 * gentle-pi's own reader.
 *
 * Everything here is display state and every failure is silent: a history file
 * that cannot be written costs a card, and an exception thrown into pi costs the
 * terminal.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { carrierId, inlineText, type InlineCarrierRecord } from './inline-carrier.ts';

/** gentle-pi's history directory, relative to the agent home it is given. */
export function historyDirectory(agentHome: string): string {
	return join(agentHome, 'gentle-agents', 'tasks');
}

/**
 * One id per unit, not one per session: a second unit must never overwrite the
 * first, and gentle-pi's restore skips an id that is already live. The name
 * still fits the `/^[a-z0-9-]+$/i` its history files require.
 */
export function unitId(sessionId: string, unit: number): string {
	return carrierId(sessionId) + '-' + unit;
}

/**
 * The id of the job a session is doing. A session is one job: the card stays
 * open while the session works, and every stretch of work between two closing
 * turns appends to the same transcript instead of starting a second card.
 * @param {string} sessionId
 * @returns {string}
 */
export function jobId(sessionId: string): string {
	return carrierId(sessionId);
}

/** The divider written into the transcript where a new request began. */
export const DIVIDER_TEXT = 'new request';

/** A thread item, as gentle-pi defines it. */
export interface UnitToolItem {
	kind: 'tool';
	callId: string;
	name: string;
	args: Record<string, unknown>;
	output: string;
	running: boolean;
	isError: boolean;
}

export interface UnitTextItem {
	kind: 'text';
	text: string;
}

/** A divider: where one stretch of work ended and the next request began. */
export interface UnitNoteItem {
	kind: 'note';
	text: string;
}

export type UnitThreadItem = UnitToolItem | UnitTextItem | UnitNoteItem;

export interface UnitThread {
	items: UnitThreadItem[];
	dropped: number;
	version: number;
	limits: { maxItems: number; maxOutputChars: number };
}

/**
 * A panel line is not a log: the item count and the output kept per call are
 * both small on purpose, and `dropped` tells the reader what was left out.
 */
export const INLINE_THREAD_LIMITS = { maxItems: 200, maxOutputChars: 1000 } as const;

/** The summary kept for one call: one line, not the whole output. */
export const INLINE_TOOL_SUMMARY_MAX = 120;

/** The closing result, as the panel shows it. */
export const INLINE_RESULT_MAX = 2000;

export function emptyUnitThread(): UnitThread {
	return { items: [], dropped: 0, version: 0, limits: { ...INLINE_THREAD_LIMITS } };
}

/** Push with the same overflow accounting gentle-pi's `applyTaskEvent` uses. */
function push(thread: UnitThread, item: UnitThreadItem): UnitThread {
	const items = [...thread.items, item];
	const overflow = Math.max(0, items.length - thread.limits.maxItems);
	return {
		...thread,
		items: overflow > 0 ? items.slice(overflow) : items,
		dropped: thread.dropped + overflow,
		version: thread.version + 1,
	};
}

/** The last `max` characters, which is the part of an output that matters. */
function keepTail(text: string, max: number): string {
	return text.length <= max ? text : '…' + text.slice(text.length - max + 1);
}

export function addToolStart(thread: UnitThread, call: { callId: string; name: string; args: Record<string, unknown> }): UnitThread {
	return push(thread, {
		kind: 'tool',
		callId: call.callId,
		name: call.name,
		args: call.args,
		output: '',
		running: true,
		isError: false,
	});
}

export function addToolEnd(
	thread: UnitThread,
	call: { callId: string; output: string; isError: boolean },
): UnitThread {
	const index = thread.items.findIndex((item) => item.kind === 'tool' && item.callId === call.callId);
	if (index < 0) return thread;
	const current = thread.items[index] as UnitToolItem;
	const items = [...thread.items];
	items[index] = {
		...current,
		output: keepTail(clean(call.output), thread.limits.maxOutputChars),
		running: false,
		isError: call.isError,
	};
	return { ...thread, items, version: thread.version + 1 };
}

/**
 * The closing result. Consecutive text merges into one item, as gentle-pi does
 * for streamed text, so a summary never becomes a stack of one-line items.
 */
/**
 * Append a divider, so the accumulated transcript says where a new request
 * began. It is a gentle-pi note item: the panel already renders that kind.
 * @param {UnitThread} thread
 * @returns {UnitThread}
 */
export function addDivider(thread: UnitThread): UnitThread {
	return push(thread, { kind: 'note', text: DIVIDER_TEXT });
}

export function addText(thread: UnitThread, raw: string): UnitThread {
	const text = keepTail(clean(raw), INLINE_RESULT_MAX);
	if (text.trim().length === 0) return thread;
	const last = thread.items[thread.items.length - 1];
	if (last?.kind === 'text') {
		return {
			...thread,
			items: [...thread.items.slice(0, -1), { kind: 'text', text: keepTail(last.text + text, INLINE_RESULT_MAX) }],
			version: thread.version + 1,
		};
	}
	return push(thread, { kind: 'text', text });
}

/** Drop control characters: a history file is read back into a terminal. */
function clean(value: unknown): string {
	if (typeof value !== 'string') return '';
	return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, '');
}

/** The text a tool result carries. */
export function resultTextOf(result: unknown): string {
	const content = (result as { content?: unknown } | undefined)?.content;
	if (!Array.isArray(content)) return '';
	const parts: string[] = [];
	for (const part of content) {
		if (typeof part !== 'object' || part === null) continue;
		const candidate = part as { type?: unknown; text?: unknown };
		if (candidate.type === 'text' && typeof candidate.text === 'string') parts.push(candidate.text);
	}
	return parts.join('\n');
}

/** One line for the panel: what the call produced, and how much of it. */
export function toolSummary(result: unknown): string {
	const lines = clean(resultTextOf(result))
		.split('\n')
		.filter((line) => line.trim().length > 0);
	if (lines.length === 0) return '';
	const first = inlineText(lines[0], INLINE_TOOL_SUMMARY_MAX);
	if (lines.length === 1) return first;
	return first + ' · ' + lines.length + ' lines';
}

/** The arguments worth keeping: a few short scalars, never a wall of text. */
export function boundedArgs(input: unknown, maxKeys = 4): Record<string, unknown> {
	const source = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
	const kept: Record<string, unknown> = {};
	let count = 0;
	for (const [key, value] of Object.entries(source)) {
		if (count >= maxKeys) break;
		const name = inlineText(key, 40);
		if (name.length === 0) continue;
		if (typeof value === 'string') {
			kept[name] = inlineText(value, 80);
			count += 1;
		} else if (typeof value === 'number' || typeof value === 'boolean') {
			kept[name] = value;
			count += 1;
		}
	}
	return kept;
}

/**
 * The next unit number for this session: one past the highest record already on
 * disk, never below the number this process has already handed out. A resume
 * therefore continues the sequence instead of reusing a taken id.
 */
export function nextUnitNumber(agentHome: string, sessionId: string, floor = 0): number {
	const prefix = carrierId(sessionId) + '-';
	let highest = 0;
	try {
		for (const name of readdirSync(historyDirectory(agentHome))) {
			if (!name.startsWith(prefix) || !name.endsWith('.json')) continue;
			const number = Number(name.slice(prefix.length, -'.json'.length));
			if (Number.isInteger(number) && number > highest) highest = number;
		}
	} catch {
		// No history yet, or none we may read: the floor still applies.
	}
	return Math.max(highest, floor) + 1;
}

/**
 * Write `{ task, thread }` where gentle-pi's `loadHistory` will find it. Atomic,
 * because a reader can open the panel mid-write.
 */
/**
 * The previous design wrote one record per unit (`<job>-1.json`, `<job>-2.json`).
 * gentle-pi restores every file it finds, so a session from that design would
 * come back as one card per request. This merges those records into the job
 * record - their transcripts in order, with a divider between them - and then
 * removes the numbered files, which are ours and whose content is now in the
 * merged record.
 *
 * Runs once, at session start, and only when the session has no job record yet.
 * @param {string} agentHome
 * @param {string} sessionId
 * @returns {string | undefined} the job record it wrote, when it wrote one
 */
export function consolidateLegacyHistory(agentHome: string, sessionId: string): string | undefined {
	try {
		const directory = historyDirectory(agentHome);
		if (!existsSync(directory)) return undefined;
		const job = jobId(sessionId);
		if (existsSync(join(directory, job + '.json'))) return undefined;
		const prefix = job + '-';
		const legacy: { name: string; stored: { task: InlineCarrierRecord; thread: UnitThread } }[] = [];
		for (const name of readdirSync(directory)) {
			if (!name.startsWith(prefix) || !name.endsWith('.json')) continue;
			const text = readFileSync(join(directory, name), 'utf8');
			const parsed: unknown = JSON.parse(text);
			if (typeof parsed !== 'object' || parsed === null) continue;
			const stored = parsed as { task?: InlineCarrierRecord; thread?: UnitThread };
			if (stored.task === undefined || !Array.isArray(stored.thread?.items)) continue;
			if (stored.task.parentSessionId !== sessionId) continue;
			legacy.push({ name, stored: { task: stored.task, thread: stored.thread } });
		}
		if (legacy.length === 0) return undefined;
		legacy.sort((a, b) => (a.stored.task.createdAt ?? 0) - (b.stored.task.createdAt ?? 0));
		let thread: UnitThread = emptyUnitThread();
		for (const { stored } of legacy) {
			if (thread.items.length > 0) thread = addDivider(thread);
			for (const item of stored.thread.items) {
				if (item.kind === 'tool') {
					thread = addToolStart(thread, { callId: item.callId, name: item.name, args: item.args });
					thread = addToolEnd(thread, { callId: item.callId, output: item.output, isError: item.isError });
				} else if (item.kind === 'text') {
					thread = addText(thread, item.text);
				}
			}
		}
		const newest = legacy[legacy.length - 1]?.stored.task;
		if (newest === undefined) return undefined;
		const record: InlineCarrierRecord = { ...newest, id: job, parentSessionId: sessionId };
		writeUnitHistory(agentHome, record, thread);
		for (const { name } of legacy) {
			try {
				unlinkSync(join(directory, name));
			} catch {
				// Leaving one behind costs a duplicate card at the next restart, never the session.
			}
		}
		return join(directory, job + '.json');
	} catch {
		return undefined;
	}
}

export function writeUnitHistory(agentHome: string, task: InlineCarrierRecord, thread: UnitThread): void {
	const directory = historyDirectory(agentHome);
	mkdirSync(directory, { recursive: true, mode: 0o700 });
	const target = join(directory, task.id + '.json');
	const temporary = target + '.' + process.pid + '.' + Math.random().toString(36).slice(2, 8) + '.tmp';
	writeFileSync(temporary, JSON.stringify({ task, thread }), { mode: 0o600 });
	renameSync(temporary, target);
}
