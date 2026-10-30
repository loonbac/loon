/**
 * LOON inline work view: while the parent itself programs inline, its work is
 * drawn as one card in gentle-pi's Agents panel.
 *
 * A subagent gets a card because a child process streams events into gentle-pi's
 * task store. Inline work has no child, so it gets no card, and every tool call
 * lands in the main transcript instead until the previous summary is out of
 * scrollback. This extension writes the card's missing record; the matching
 * reader patch (`scripts/apply-inline-carrier-patch.mjs`) teaches gentle-pi's
 * Agents card to draw it. The same extension then stops the flood at its
 * source: while the session has a carrier, the renderer in
 * `./lib/inline-collapse.ts` draws no rows for the parent's own file and shell
 * calls, so the main transcript keeps the assistant's prose and its closing
 * summary.
 *
 * It is display only. Nothing moves out of the parent: no child process, no
 * second model call, no change to token accounting, and no launch authority. The
 * record is not a real subagent and never claims to be one.
 *
 * Everything here is wrapped so it can never throw into pi: a broken extension
 * would break the terminal a person is working in, and a missing card is a much
 * smaller failure than that.
 */
import type {
	AgentEndEvent,
	ExtensionAPI,
	ExtensionContext,
	MessageEndEvent,
	SessionShutdownEvent,
	SessionStartEvent,
	ToolCallEvent,
	ToolExecutionEndEvent,
	ToolRendererResolver,
	TurnEndEvent,
} from '@earendil-works/pi-coding-agent';
import { collapseResolver } from './lib/inline-collapse.ts';
import { clearLiveThread, installOverlayPanel, writeLiveThread } from './lib/inline-overlay.ts';
import {
	INLINE_RESULT_MAX,
	addText,
	addToolEnd,
	addToolStart,
	boundedArgs,
	addDivider,
	consolidateLegacyHistory,
	emptyUnitThread,
	jobId,
	toolSummary,
	writeUnitHistory,
	type UnitThread,
} from './lib/inline-history.ts';
import {
	INLINE_LABEL_MAX,
	INLINE_STATUS,
	agentHomeDirectory,
	buildCarrierRecord,
	inlineText,
	inlineWorkEnabled,
	isCarrierSessionId,
	pruneDeadCarriers,
	removeCarrier,
	stepLabel,
	workUnitName,
	writeCarrier,
	type InlineCarrierRecord,
	type InlineStatus,
} from './lib/inline-carrier.ts';

/** How often a running record says it is still alive. */
export const DEFAULT_HEARTBEAT_MS = 20_000;

/** Test seams: nothing here changes behaviour in a real session. */
export interface InlineWorkDeps {
	/** Where the carrier files live. Defaults to pi's agent home. */
	agentHome?: string;
	env?: NodeJS.ProcessEnv;
	now?: () => number;
	pid?: number;
	heartbeatMs?: number;
}

/**
 * The record's closing line: the first line of the agent's final answer, which
 * is the summary a person would have read. Undefined when there is no text to
 * take, in which case the last step stays on the card.
 */
export function summaryLine(messages: unknown, max: number = INLINE_LABEL_MAX): string | undefined {
	if (!Array.isArray(messages)) return undefined;
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (typeof message !== 'object' || message === null) continue;
		const candidate = message as { role?: unknown; content?: unknown };
		if (candidate.role !== 'assistant') continue;
		const text = messageText(candidate.content);
		for (const line of text.split('\n')) {
			// The card is one plain line: markdown markers there are noise, not
			// structure, so they are painted out before the line is taken.
			const single = inlineText(line.replace(/[#*>`]+/g, ' '), max);
			if (single.length === 0) continue;
			return single;
		}
	}
	return undefined;
}

/**
 * The closing result as the panel shows it: the assistant's final text, head
 * kept, bounded. This is what the owner reads in the thread after a reload.
 */
export function closingText(messages: unknown, max: number = INLINE_RESULT_MAX): string {
	if (!Array.isArray(messages)) return '';
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (typeof message !== 'object' || message === null) continue;
		const candidate = message as { role?: unknown; content?: unknown };
		if (candidate.role !== 'assistant') continue;
		const text = messageText(candidate.content).trim();
		if (text.length === 0) continue;
		return text.length <= max ? text : text.slice(0, Math.max(0, max - 1)).trimEnd() + '…';
	}
	return '';
}

/** Assistant content is a string or a list of parts; only text parts matter. */
function messageText(content: unknown): string {
	if (typeof content === 'string') return content;
	if (!Array.isArray(content)) return '';
	const parts: string[] = [];
	for (const part of content) {
		if (typeof part !== 'object' || part === null) continue;
		const candidate = part as { type?: unknown; text?: unknown };
		if (candidate.type === 'text' && typeof candidate.text === 'string') parts.push(candidate.text);
	}
	return parts.join('\n');
}

/** The model pi has open right now, plus its effort, for the card's meta column. */
function modelLabel(ctx: ExtensionContext): { model: string; thinking: string | undefined } {
	const current = ctx.model as { provider?: unknown; id?: unknown } | undefined;
	const provider = typeof current?.provider === 'string' ? current.provider : '';
	const id = typeof current?.id === 'string' ? current.id : '';
	const level = (ctx as { thinkingLevel?: unknown }).thinkingLevel;
	return {
		model: provider !== '' && id !== '' ? provider + '/' + id : id,
		thinking: typeof level === 'string' ? level : undefined,
	};
}

/** Token and cost fields an assistant message may carry. */
function usageTotals(message: unknown): { tokens: number; cost: number } {
	const usage = typeof message === 'object' && message !== null ? (message as { usage?: unknown }).usage : undefined;
	if (typeof usage !== 'object' || usage === null) return { tokens: 0, cost: 0 };
	const totals = usage as { totalTokens?: unknown; cost?: { total?: unknown } };
	const tokens = typeof totals.totalTokens === 'number' && Number.isFinite(totals.totalTokens) ? totals.totalTokens : 0;
	const cost = typeof totals.cost?.total === 'number' && Number.isFinite(totals.cost.total) ? totals.cost.total : 0;
	return { tokens, cost };
}

export function createInlineWork(pi: ExtensionAPI, deps: InlineWorkDeps = {}): void {
	try {
		const env = deps.env ?? process.env;
		if (!inlineWorkEnabled(env)) return;
		const now = deps.now ?? ((): number => Date.now());
		const pid = deps.pid ?? process.pid;
		const agentHome = deps.agentHome ?? agentHomeDirectory(env);
		const heartbeatMs = deps.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;

		let sessionId: string | undefined;
		let cwd = '';
		let model = '';
		let thinking: string | undefined;
		let status: InlineStatus = INLINE_STATUS.RUNNING;
		let createdAt = 0;
		let startedAt: number | null = null;
		let endedAt: number | null = null;
		let label = '';
		let lastStep = '';
		let lastActivityAt = 0;
		let turns = 0;
		let toolCalls = 0;
		let tokens = 0;
		let cost = 0;
		// No card exists until the session actually works: an idle session must not
		// show a running subagent.
		let written = false;
		let closed = false;
		let heartbeat: ReturnType<typeof setInterval> | undefined;
		// The unit's history: which unit this is, what it did, and whether that has
		// already been written to disk. One file per unit, never per session.
		let unit = 0;
		let thread: UnitThread = emptyUnitThread();
		let historyWritten = false;

		/**
		 * A unit is one stretch of work between two closing turns, and the job is the
		 * session: the first tool call after a close starts the next unit inside the
		 * same card, appending its work to the same transcript behind a divider. The
		 * card never changes identity between units, so a long session reads as one
		 * piece of work instead of one card per request.
		 */
		const startUnit = (): void => {
			if (sessionId === undefined) return;
			// A second call inside the same unit is the same unit.
			if (unit > 0 && !historyWritten && status === INLINE_STATUS.RUNNING) return;
			if (unit > 0) thread = addDivider(thread);
			unit += 1;
			historyWritten = false;
		};
		const currentId = (): string | undefined => (sessionId === undefined || unit === 0 ? undefined : jobId(sessionId));

		const snapshot = (): InlineCarrierRecord | undefined => {
			if (sessionId === undefined) return undefined;
			return buildCarrierRecord({
				sessionId,
				...(currentId() === undefined ? {} : { id: currentId() as string }),
				cwd,
				status,
				createdAt,
				startedAt,
				endedAt,
				label,
				lastStep,
				lastActivityAt,
				model,
				thinking,
				turns,
				toolCalls,
				tokens,
				cost,
				pid,
			});
		};

		const persist = (): void => {
			if (!written) return;
			const record = snapshot();
			if (record !== undefined) writeCarrier(agentHome, record);
		};

		const stopHeartbeat = (): void => {
			if (heartbeat === undefined) return;
			clearInterval(heartbeat);
			heartbeat = undefined;
		};

		// A running record has to be provably alive: the reader drops one that has
		// not spoken for a while, so a dead pi can never leave a fake subagent on
		// screen. The heartbeat is the proof, and it is cheap.
		const startHeartbeat = (): void => {
			if (heartbeat !== undefined || closed || heartbeatMs <= 0) return;
			heartbeat = setInterval(() => {
				try {
					if (!written || status !== INLINE_STATUS.RUNNING) return;
					lastActivityAt = now();
					persist();
				} catch {
					// A heartbeat that fails costs nothing.
				}
			}, heartbeatMs);
			heartbeat.unref?.();
		};

		/** Called on every step: the card exists from the first tool call on. */
		const begin = (step: string): void => {
			if (sessionId === undefined) return;
			const at = now();
			if (!written) {
				written = true;
				createdAt = at;
				startedAt = at;
			}
			status = INLINE_STATUS.RUNNING;
			endedAt = null;
			lastStep = step;
			label = step;
			lastActivityAt = at;
			persist();
			startHeartbeat();
		};

		/**
		 * Register a handler that cannot throw into pi. Handlers are synchronous and
		 * return nothing: this extension never blocks, steers, or vetoes anything.
		 */
		const safeHandler = <E,>(run: (event: E, ctx: ExtensionContext) => void): ((event: E, ctx: ExtensionContext) => void) => {
			return (event: E, ctx: ExtensionContext): void => {
				try {
					run(event, ctx);
				} catch {
					// The inline work view is optional; its failures stay invisible.
				}
			};
		};

		pi.on('session_start', safeHandler((_event: SessionStartEvent, ctx: ExtensionContext): void => {
			const id = ctx.sessionManager.getSessionId();
			sessionId = isCarrierSessionId(id) ? id : undefined;
			cwd = typeof ctx.cwd === 'string' ? ctx.cwd : '';
			const current = modelLabel(ctx);
			model = current.model;
			thinking = current.thinking;
			status = INLINE_STATUS.RUNNING;
			createdAt = 0;
			startedAt = null;
			endedAt = null;
			label = '';
			lastStep = '';
			lastActivityAt = 0;
			turns = 0;
			toolCalls = 0;
			tokens = 0;
			cost = 0;
			written = false;
			closed = false;
			unit = 0;
			thread = emptyUnitThread();
			historyWritten = false;
			stopHeartbeat();
			if (sessionId !== undefined) {
				// A resumed session starts its card from its own first step again.
				removeCarrier(agentHome, sessionId);
			}
			pruneDeadCarriers(agentHome, sessionId);
			// The panel finds the inline units through this provider. Publishing it is
			// what makes a unit appear while it runs, without a restart; withdrawing
			// it at shutdown leaves the panel exactly as gentle-pi ships it.
			installOverlayPanel({ agentHome });
			// A session that ran the previous design has one record per unit; merge
			// them now, before gentle-pi restores anything, so it comes back as the
			// one card it is.
			if (sessionId !== undefined) consolidateLegacyHistory(agentHome, sessionId);
		}));

		pi.on('tool_call', safeHandler((event: ToolCallEvent, ctx: ExtensionContext): void => {
			if (closed || sessionId === undefined) return;
			// A nested call belongs to the step that made it, not to a step of its own.
			if (typeof event.parentToolCallId === 'string') return;
			const current = modelLabel(ctx);
			model = current.model;
			thinking = current.thinking;
			toolCalls += 1;
			startUnit();
			// The thread is the transcription the owner opens in the panel: one item
			// per top-level call, with the arguments that name it.
			thread = addToolStart(thread, {
				callId: event.toolCallId,
				name: event.toolName,
				args: boundedArgs((event as { input?: unknown }).input),
			});
			begin(stepLabel(event.toolName, (event as { input?: unknown }).input));
			// The running unit's transcript, next to its carrier, so the panel can
			// open work that has not finished yet.
			const startedId = currentId();
			if (startedId !== undefined && sessionId !== undefined) writeLiveThread(agentHome, sessionId, startedId, thread);
		}));

		pi.on('tool_execution_end', safeHandler((event: ToolExecutionEndEvent): void => {
			if (closed || !written || unit === 0) return;
			// A nested call belongs to the step that made it, exactly as above.
			if (typeof event.parentToolCallId === 'string') return;
			thread = addToolEnd(thread, {
				callId: event.toolCallId,
				output: toolSummary((event as { result?: unknown }).result),
				isError: event.isError === true,
			});
			const endedId = currentId();
			if (endedId !== undefined && sessionId !== undefined) writeLiveThread(agentHome, sessionId, endedId, thread);
		}));

		pi.on('message_end', safeHandler((event: MessageEndEvent): void => {
			if (closed) return;
			const message = event.message as unknown;
			if (typeof message !== 'object' || message === null || (message as { role?: unknown }).role !== 'assistant') return;
			const totals = usageTotals(message);
			tokens += totals.tokens;
			cost += totals.cost;
			if (!written) return;
			lastActivityAt = now();
			persist();
		}));

		pi.on('turn_end', safeHandler((_event: TurnEndEvent): void => {
			if (closed || !written) return;
			turns += 1;
			lastActivityAt = now();
			persist();
		}));

		pi.on('agent_end', safeHandler((event: AgentEndEvent): void => {
			if (closed || !written) return;
			const at = now();
			status = INLINE_STATUS.COMPLETED;
			endedAt = at;
			lastActivityAt = at;
			const summary = summaryLine((event as { messages?: unknown }).messages);
			if (summary !== undefined) label = summary;
			stopHeartbeat();
			persist();
			// The unit is closed: this is the moment its history can be written, and
			// the moment it becomes a card that survives a reload. Written once.
			if (unit === 0 || historyWritten) return;
			const closing = closingText((event as { messages?: unknown }).messages);
			if (closing.length > 0) thread = addText(thread, closing);
			const record = snapshot();
			if (record === undefined) return;
			const withResult: InlineCarrierRecord = { ...record, result: closing.length > 0 ? closing : record.result };
			writeUnitHistory(agentHome, withResult, thread);
			historyWritten = true;
			const closedId = currentId();
			if (closedId !== undefined && sessionId !== undefined) writeLiveThread(agentHome, sessionId, closedId, thread);
			persist();
		}));

		// The live carrier is display state for a running session and goes with it.
		// The history is not: a unit that closed stays readable, which is the
		// whole reason it is written under gentle-pi's own directory.
		pi.on('session_shutdown', safeHandler((_event: SessionShutdownEvent): void => {
			closed = true;
			written = false;
			stopHeartbeat();
			thread = emptyUnitThread();
			unit = 0;
			historyWritten = false;
			if (sessionId !== undefined) {
				removeCarrier(agentHome, sessionId);
				clearLiveThread(agentHome, sessionId);
			}
			installOverlayPanel(undefined);
		}));

		// The other half of the feature: while this session has a carrier, its own
		// file and shell calls stop drawing rows in the transcript and live in the
		// panel entry instead. A host without the resolver API keeps the old
		// rendering, and so does LOON_INLINE_WORK=0, which returned above.
		const host = pi as ExtensionAPI & { registerToolRenderer?: (resolver: ToolRendererResolver) => void };
		if (typeof host.registerToolRenderer === 'function') {
			// The gate is the session, never the carrier. pi builds a call's component
			// while the assistant message streams, which is strictly before the tool
			// runs and therefore before this session's carrier exists: a gate that
			// waits for the carrier lets the first row of every unit through, and a
			// unit driven through codemode can be a single call. Every row of an
			// inline session belongs in the panel, from the first call to the last.
			host.registerToolRenderer(collapseResolver(() => sessionId !== undefined && !closed));
		}
	} catch {
		// Registration itself must not break pi either.
	}
}

export default function loonInlineWork(pi: ExtensionAPI): void {
	try {
		createInlineWork(pi);
	} catch {
		// A display feature that fails is not an error worth failing a session for.
	}
}
