/**
 * The inline work carrier: one `TaskRecord`-shaped file per session that tells
 * gentle-pi's Agents card the parent itself is programming right now.
 *
 * gentle-pi's Agents card lists `TaskRecord`s from its own store, and that store
 * only ever hears about child processes. Inline work has no child, so it has no
 * record, and its tool calls pile up in the main transcript instead. This module
 * writes the missing record and nothing else: no child, no second model call, no
 * change to token accounting. It changes what is drawn, never what is executed.
 *
 * The file is display state, so every failure here is silent by design. A record
 * that cannot be written costs a card; an exception thrown into pi costs the
 * terminal.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

/** Kill switch: `LOON_INLINE_WORK=0` in the environment disables the extension. */
export const INLINE_WORK_ENV = 'LOON_INLINE_WORK';

/** The card prints `task.agent`; it names the role the inline work is playing. */
export const INLINE_AGENT = 'gentle-ai-worker';

/** `task.mode`, so a record that never had a child is still recognisable as one. */
export const INLINE_MODE = 'inline';

/** gentle-pi's own status strings: its renderer maps them to glyphs and roles. */
export const INLINE_STATUS = {
	RUNNING: 'running',
	COMPLETED: 'completed',
} as const;

export type InlineStatus = (typeof INLINE_STATUS)[keyof typeof INLINE_STATUS];

/** Where the carrier files live, under the agent home. */
export const INLINE_DIR_NAME = 'loon-inline';

/** Every carrier id starts here, which no real task id can collide with. */
export const INLINE_ID_PREFIX = 'loon-inline-';

/** One line for the card: the step, or the closing summary. */
export const INLINE_LABEL_MAX = 72;

/** The last step kept for detail, same budget. */
export const INLINE_STEP_MAX = 72;

/** A carrier left by a dead pi is garbage after this long without a heartbeat. */
export const INLINE_STALE_MS = 24 * 60 * 60 * 1000;

/**
 * A `TaskRecord` from gentle-pi's `lib/agents-protocol.ts`, field for field, so
 * its renderer needs no special case. `prompt`, `sessionPath` and `error` are
 * null or empty because there is no launch behind this record, and `thinking`
 * may be undefined, exactly as the interface allows.
 */
export interface InlineCarrierRecord {
	id: string;
	agent: string;
	mode: string;
	prompt: string;
	label: string;
	cwd: string;
	parentSessionId: string;
	status: InlineStatus;
	createdAt: number;
	startedAt: number | null;
	endedAt: number | null;
	model: string;
	thinking: string | undefined;
	sessionPath: string | null;
	error: string | null;
	result: string | null;
	lastStep: string;
	lastActivityAt: number;
	turns: number;
	toolCalls: number;
	tokens: number;
	cost: number;
	/**
	 * Not part of `TaskRecord` (gentle-pi reads only the fields it knows). It
	 * says which process owns the file, so a record whose writer died can be
	 * pruned instead of posing as live work.
	 */
	pid: number;
	/**
	 * Who ended the job: `agent` for the explicit signal, `idle` for the
	 * fallback, `session` for a shutdown. Not part of TaskRecord; gentle-pi
	 * ignores it, and it is what tells a reader why a card is finished.
	 */
	closedBy?: string;
}

/** What the extension knows about the session at the moment it writes. */
export interface CarrierState {
	sessionId: string;
	/**
	 * The record's id, when it must not be the session's default one. The live
	 * card and the persisted history entry share it, so gentle-pi's reader can
	 * tell they are the same unit and never draws two cards for one.
	 */
	id?: string;
	cwd: string;
	status: InlineStatus;
	createdAt: number;
	startedAt: number | null;
	endedAt: number | null;
	label: string;
	lastStep: string;
	lastActivityAt: number;
	model: string;
	thinking?: string | undefined;
	turns: number;
	toolCalls: number;
	tokens: number;
	cost: number;
	pid?: number;
	result?: string | null;
}

export function carrierId(sessionId: string): string {
	return INLINE_ID_PREFIX + sessionId;
}

/** The whole extension is off only for the exact value `0`. */
export function inlineWorkEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
	const raw = env[INLINE_WORK_ENV];
	return typeof raw !== 'string' || raw.trim() !== '0';
}

/** The agent home pi and gentle-pi already use, in the same precedence order. */
export function agentHomeDirectory(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
	for (const candidate of [env.GENTLE_PI_AGENT_HOME, env.PI_CODING_AGENT_DIR]) {
		if (typeof candidate === 'string' && candidate.trim().length > 0) return candidate;
	}
	return join(home, '.pi', 'agent');
}

export function carrierDirectory(agentHome: string): string {
	return join(agentHome, 'state', INLINE_DIR_NAME);
}

/**
 * Where the explicit completion signal lands: a file the agent writes through
 * `scripts/inline-job.mjs`, which this extension consumes on its next event.
 * @param {string} agentHome
 * @param {string} sessionId
 * @returns {string}
 */
export function closeRequestPath(agentHome: string, sessionId: string): string {
	return join(carrierDirectory(agentHome), sessionId + '.close.json');
}

/**
 * Consume the agent's completion signal. Reading it removes it, so one signal
 * closes one job and the next request opens the next card.
 * @param {string} agentHome
 * @param {string} sessionId
 * @returns {boolean} whether there was a signal to consume
 */
export function takeCloseRequest(agentHome: string, sessionId: string): boolean {
	try {
		const path = closeRequestPath(agentHome, sessionId);
		if (!existsSync(path)) return false;
		unlinkSync(path);
		return true;
	} catch {
		return false;
	}
}

export function carrierPath(agentHome: string, sessionId: string): string {
	return join(carrierDirectory(agentHome), sessionId + '.json');
}

/**
 * A session id becomes a file name, so it is validated before it is one. The
 * shape is the one pi generates and gentle-pi already accepts for its own
 * session files.
 */
export function isCarrierSessionId(value: unknown): value is string {
	return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);
}

/** One line a terminal can always draw: no control characters, bounded length. */
export function inlineText(value: unknown, max: number = INLINE_LABEL_MAX): string {
	if (typeof value !== 'string') return '';
	const single = value
		.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	if (single.length <= max) return single;
	return single.slice(0, Math.max(0, max - 1)).trimEnd() + '…';
}

/** The argument that says what a tool call is about, in preference order. */
const SUBJECT_KEYS = ['command', 'path', 'file_path', 'filePath', 'file', 'pattern', 'query', 'url', 'description'] as const;

/**
 * `edit extensions/lib/inline-carrier.ts`: the card's task column. The tool name
 * stays first so the line reads as an action, and the subject is what makes two
 * consecutive edits distinguishable.
 */
export function stepLabel(toolName: unknown, input: unknown): string {
	const name = inlineText(toolName, 24) || 'tool';
	const args = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
	let subject = '';
	for (const key of SUBJECT_KEYS) {
		subject = inlineText(args[key], INLINE_STEP_MAX);
		if (subject.length > 0) break;
	}
	return subject.length === 0 ? name : inlineText(name + ' ' + subject, INLINE_LABEL_MAX);
}

/** The working directory's last segment: the card has one line, not a path. */
export function workUnitName(cwd: string): string {
	const name = inlineText(basename(cwd), 32);
	return name.length === 0 ? 'inline work' : name;
}

export function buildCarrierRecord(state: CarrierState): InlineCarrierRecord {
	const label = inlineText(state.label) || INLINE_MODE;
	return {
		id: state.id ?? carrierId(state.sessionId),
		agent: INLINE_AGENT,
		mode: INLINE_MODE,
		// There is no launch prompt behind inline work, and pretending there is
		// would turn a display record into something that could be replayed.
		prompt: '',
		label,
		cwd: state.cwd,
		parentSessionId: state.sessionId,
		status: state.status,
		createdAt: state.createdAt,
		startedAt: state.startedAt,
		endedAt: state.endedAt,
		model: state.model,
		thinking: state.thinking,
		sessionPath: null,
		error: null,
		result: state.result ?? null,
		lastStep: inlineText(state.lastStep) || label,
		lastActivityAt: state.lastActivityAt,
		turns: state.turns,
		toolCalls: state.toolCalls,
		tokens: state.tokens,
		cost: state.cost,
		pid: state.pid ?? process.pid,
	};
}

/**
 * Write the record in one atomic step: a temporary file in the same directory,
 * then a rename. The reader runs inside a TUI frame and must never see half a
 * JSON document.
 */
export function writeCarrier(agentHome: string, record: InlineCarrierRecord): void {
	const directory = carrierDirectory(agentHome);
	mkdirSync(directory, { recursive: true, mode: 0o700 });
	const path = carrierPath(agentHome, record.parentSessionId);
	const temporary = path + '.' + record.pid + '.tmp';
	writeFileSync(temporary, JSON.stringify(record, null, '\t') + '\n', { mode: 0o600 });
	renameSync(temporary, path);
}

export function removeCarrier(agentHome: string, sessionId: string): void {
	try {
		rmSync(carrierPath(agentHome, sessionId), { force: true });
	} catch {
		// Nothing to clean, or nothing we may touch: both are fine here.
	}
}

/** True when a process with this pid exists. Signal 0 only asks. */
export function processAlive(pid: unknown): boolean {
	if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		// EPERM means the process is there and belongs to someone else.
		return (error as NodeJS.ErrnoException).code === 'EPERM';
	}
}

/**
 * Remove carrier files whose writer is gone, and the temporary files of writes
 * that never completed. A dead session's record is the only way inline work
 * could still look live, so those files are deleted rather than trusted.
 */
export function pruneDeadCarriers(agentHome: string, keepSessionId?: string): void {
	const directory = carrierDirectory(agentHome);
	let names: string[];
	try {
		names = readdirSync(directory);
	} catch {
		return;
	}
	const now = Date.now();
	for (const name of names) {
		if (name === keepSessionId + '.json') continue;
		const path = join(directory, name);
		// `<session>.json.<pid>.tmp`: a write that never reached its rename.
		const temporary = /\.json\.(\d+)\.tmp$/.exec(name);
		if (temporary !== null) {
			if (processAlive(Number(temporary[1]))) continue;
			try {
				rmSync(path, { force: true });
			} catch {
				// Leave it for the next start.
			}
			continue;
		}
		if (!name.endsWith('.json')) continue;
		let record: unknown;
		try {
			record = JSON.parse(readFileSync(path, 'utf8'));
		} catch {
			record = undefined;
		}
		if (typeof record === 'object' && record !== null && !Array.isArray(record)) {
			const owner = record as { pid?: unknown; lastActivityAt?: unknown };
			// A live writer keeps its file, however long the session has run.
			if (processAlive(owner.pid)) continue;
			// A record without a readable timestamp is judged by its file time, so a
			// hand-edited file cannot live forever either.
			if (typeof owner.lastActivityAt !== 'number') {
				try {
					if (now - statSync(path).mtimeMs < INLINE_STALE_MS) continue;
				} catch {
					continue;
				}
			}
		}
		try {
			rmSync(path, { force: true });
		} catch {
			// Leave it for the next start.
		}
	}
}
