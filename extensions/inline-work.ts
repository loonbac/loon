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
	createTranscriptTransformer,
	restoredDecisions,
	transcriptMode,
	type TranscriptCollapse,
} from './lib/inline-transcript.ts';
import {
	INLINE_RESULT_MAX,
	addText,
	addToolEnd,
	addToolStart,
	boundedArgs,
	addDivider,
	addNote,
	emptyUnitThread,
	jobId,
	nextUnitNumber,
	toolSummary,
	upsertThinking,
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
	takeCloseRequest,
	stepLabel,
	workUnitName,
	writeCarrier,
	type InlineCarrierRecord,
	type InlineStatus,
} from './lib/inline-carrier.ts';

/** How often a running record says it is still alive. */
export const DEFAULT_HEARTBEAT_MS = 20_000;

/**
 * A job that has shown no real activity for this long closes itself as
 * completed, so an agent that forgets the signal cannot leave a running card on
 * the panel forever. Ten minutes is longer than any pause between the turns of
 * one piece of work, and short enough that a forgotten job is gone while the
 * person still remembers asking for it.
 */
export const IDLE_CLOSE_MS = 10 * 60 * 1000;

/**
 * How many tool calls make a turn "heavy work" and turn the prose collapse on.
 *
 * Below this the turn is a conversation - a status check, a question answered
 * with two commands - and its narration is what the person is reading, so it is
 * drawn as written. From the third call on, the narration that follows is work
 * and goes to the panel. The count is per turn: a long job made of light turns
 * never inherits the weight of the turn before.
 */
export const INLINE_HEAVY_CALLS = 3;

/**
 * The tools that keep the record instead of working on the repository.
 *
 * A turn of `todo` plus `mem_save` plus one status check is a conversation: it
 * asks and answers, it does not build anything. Counting bookkeeping as weight
 * turned exactly such a turn into "heavy work" and hid a narration that was the
 * answer. An entry ending in `_` is a family prefix; anything else is an exact
 * name. `codemode` is deliberately absent: it is where the real work of this
 * environment happens, tests and git included. A new bookkeeping tool is added
 * here; the threshold itself does not move.
 */
export const INLINE_ACCOUNTING_TOOLS: readonly string[] = ['todo', 'mem_', 'orchestrator_'];

/**
 * Whether a tool call keeps the record rather than working on the repository.
 * @param {string} name the tool name pi reports
 * @returns {boolean}
 */
export function isAccountingTool(name: string): boolean {
	const tool = typeof name === 'string' ? name.trim() : '';
	if (tool.length === 0) return false;
	return INLINE_ACCOUNTING_TOOLS.some((entry) => (entry.endsWith('_') ? tool.startsWith(entry) : tool === entry));
}

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
/**
 * The last assistant text, untouched: what the transcript must keep in full.
 * @param {unknown} messages
 * @returns {string}
 */
export function rawClosingText(messages: unknown): string {
	const list = Array.isArray(messages) ? messages : [];
	for (let index = list.length - 1; index >= 0; index -= 1) {
		const message = list[index] as { role?: unknown; content?: unknown };
		if (message === null || typeof message !== 'object' || message.role !== 'assistant' || !Array.isArray(message.content)) continue;
		const parts: string[] = [];
		for (const part of message.content) {
			const candidate = part as { type?: unknown; text?: unknown };
			if (candidate?.type === 'text' && typeof candidate.text === 'string') parts.push(candidate.text);
		}
		const text = parts.join('\n\n');
		if (text.trim().length > 0) return text;
	}
	return '';
}

/**
 * Ask the TUI for one frame. Removing a widget that was never set still triggers
 * a render, which is enough for a message the transformer has just exempted to
 * expand without waiting for the next keystroke.
 * @param {ExtensionContext | undefined} ctx
 */
export function repaintTranscript(ctx: ExtensionContext | undefined): void {
	try {
		const ui = (ctx as { ui?: { setWidget?: (key: string, content: string[] | undefined) => void } } | undefined)?.ui;
		ui?.setWidget?.('loon-inline-prose', undefined);
	} catch {
		// A missing frame costs a collapse, never the session.
	}
}

/**
 * Exempt the answer a message carries, if it is one.
 *
 * A message that ends with a tool call is work in progress: the prose that
 * explains it belongs in the panel like the rest of the turn. A message that
 * ends without one is the answer the person is waiting for, and it stays whole.
 * @param {Pick<TranscriptCollapse, 'exempt'>} collapse
 * @param {unknown} message
 */
export function exemptAnswer(collapse: Pick<TranscriptCollapse, 'exempt'>, message: unknown): void {
	if (message === null || typeof message !== 'object') return;
	const content = (message as { content?: unknown }).content;
	if (!Array.isArray(content)) return;
	if (content.some((part) => (part as { type?: unknown } | undefined)?.type === 'toolCall')) return;
	for (const part of content) {
		const candidate = part as { type?: unknown; text?: unknown };
		if (candidate?.type !== 'text' || typeof candidate.text !== 'string') continue;
		const text = candidate.text.trim();
		if (text.length > 0) collapse.exempt(text);
	}
}

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
		// How the assistant's prose is drawn while this session works inline.
		const proseMode = transcriptMode(env);

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
		// Calls in this turn only: the weight that decides whether its prose is
		// narration or work. Reset when a turn opens and when one ends.
		let toolCallsInTurn = 0;
		let tokens = 0;
		let cost = 0;
		// No card exists until the session actually works: an idle session must not
		// show a running subagent.
		let written = false;
		let closed = false;
		let heartbeat: ReturnType<typeof setInterval> | undefined;
		// The job: the work the person asked for, which can take several turns. It
		// opens with the first inline activity after the previous job closed and it
		// closes only on the agent's own signal, on the idle fallback or at
		// shutdown - never because a turn ended.
		let job = 0;
		let jobOpen = false;
		let jobClosedBy: 'agent' | 'idle' | 'session' | undefined;
		let thread: UnitThread = emptyUnitThread();
		// Reasoning written before the card exists: the first call of the turn opens
		// the job, and this is what it starts from.

		// True when pi could not hand over the conversation it restored. Until this
		// process ends its first message, nothing is collapsed or captured: the
		// alternative is deciding about messages we cannot tell apart from our own.
		let historyUnread = false;
		let historyWritten = false;
		let turnOpen = false;
		let lastRealActivity = 0;
		let lastResult: string | null = null;
		// The answer of the current turn, untruncated, kept so the transcript can
		// refuse to collapse it even after the turn is over.
		let closingFull: string | undefined;
		const prose = createTranscriptTransformer({
			mode: proseMode,
			// The gate is the session, not the carrier. Reasoning and the first prose of
			// a turn are drawn before its first tool call, and the card only exists after
			// that call: gating on the card would keep half of every turn in the
			// transcript forever, because a decision is sticky.
			isLive: () => sessionId !== undefined && !closed && !historyUnread,
			isHeavy: () => toolCallsInTurn >= INLINE_HEAVY_CALLS,
			closingText: () => closingFull,
			onThinking: (text: string, streaming: boolean): void => {
				// Collapsing is not losing: the transcript keeps one line, and the panel
				// keeps the block. Only a block that was hidden arrives here, and a
				// block is only hidden once its turn is heavy, which means the card
				// already exists.
				if (closed || sessionId === undefined || historyUnread) return;
				thread = upsertThinking(thread, text, streaming);
				const id = currentId();
				if (id !== undefined) writeLiveThread(agentHome, sessionId, id, thread);
			},
		});

		const currentId = (): string | undefined => (sessionId === undefined || job === 0 ? undefined : jobId(sessionId, job));

		/**
		 * Open a job if none is open. A job is the work the person asked for: it can
		 * take many turns, and inside it every turn appends to the same thread behind
		 * a divider where the new request began. Its id is its own, so the job that
		 * follows a closed one is a second card and never a continuation.
		 * @param {boolean} newRequest whether the previous turn already closed
		 */
		const openJob = (newRequest: boolean): void => {
			if (sessionId === undefined) return;
			if (jobOpen) {
				if (newRequest && thread.items.length > 0) thread = addDivider(thread);
				return;
			}
			job = nextUnitNumber(agentHome, sessionId, job);
			jobOpen = true;
			jobClosedBy = undefined;
			historyWritten = false;
			turnOpen = false;

			lastResult = null;
			turns = 0;
			toolCalls = 0;
			tokens = 0;
			cost = 0;
			createdAt = 0;
			startedAt = null;
			endedAt = null;
			lastRealActivity = 0;
			status = INLINE_STATUS.RUNNING;
		};

		/**
		 * Close the job: one record, written where gentle-pi restores it, with the
		 * accumulated transcript. The reason is kept in the record because "closed
		 * because nobody spoke" is not the same as "closed because the work was
		 * done".
		 * @param {'agent' | 'idle' | 'session'} reason
		 */
		const closeJob = (reason: 'agent' | 'idle' | 'session'): void => {
			if (!jobOpen || sessionId === undefined) return;
			const at = now();
			jobClosedBy = reason;
			status = INLINE_STATUS.COMPLETED;
			endedAt = at;
			lastActivityAt = at;
			if (reason === 'idle') {
				thread = addNote(thread, 'closed after ' + Math.round(IDLE_CLOSE_MS / 60000) + ' minutes without activity: the agent never signalled completion');
			}
			const record = snapshot();
			if (record !== undefined) writeUnitHistory(agentHome, { ...record, result: lastResult ?? record.result }, thread);
			jobOpen = false;
			historyWritten = true;
			stopHeartbeat();
			persist();
			const id = currentId();
			if (id !== undefined) writeLiveThread(agentHome, sessionId, id, thread);
		};

		/** Consume the agent's explicit signal, if it wrote one. */
		const takeSignal = (): void => {
			if (!jobOpen || sessionId === undefined) return;
			if (!takeCloseRequest(agentHome, sessionId)) return;
			closeJob('agent');
		};

		/** The fallback: a job nobody has touched for a while is over. */
		const closeIfIdle = (): void => {
			if (!jobOpen) return;
			if (now() - lastRealActivity < IDLE_CLOSE_MS) return;
			closeJob('idle');
		};

		const snapshot = (): InlineCarrierRecord | undefined => {
			if (sessionId === undefined) return undefined;
			const record = buildCarrierRecord({
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
			return jobClosedBy === undefined ? record : { ...record, closedBy: jobClosedBy };
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
					// The signal and the idle fallback are checked here too, so a job
					// closes even when the agent says nothing else afterwards.
					takeSignal();
					closeIfIdle();
					if (!jobOpen || status !== INLINE_STATUS.RUNNING) return;
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
			if (createdAt === 0) {
				createdAt = at;
				startedAt = at;
			}
			written = true;
			status = INLINE_STATUS.RUNNING;
			endedAt = null;
			lastStep = step;
			label = step;
			lastActivityAt = at;
			lastRealActivity = at;
			persist();
			startHeartbeat();
		};

		/**
		 * Register a handler that cannot throw into pi. Handlers are synchronous and
		 * return nothing: this extension never blocks, steers, or vetoes anything.
		 */
		/**
		 * Seed the decisions with the conversation pi restored.
		 * @param {ExtensionContext} ctx
		 * @returns {'seeded' | 'empty' | 'unavailable'}
		 */
		const seedRestored = (ctx: ExtensionContext): 'seeded' | 'empty' | 'unavailable' => {
			const manager = ctx?.sessionManager as { getEntries?: () => unknown } | undefined;
			if (typeof manager?.getEntries !== 'function') return 'unavailable';
			let entries: unknown;
			try {
				entries = manager.getEntries();
			} catch {
				return 'unavailable';
			}
			if (!Array.isArray(entries)) return 'unavailable';
			const restored = restoredDecisions(entries);
			for (const decision of restored) prose.remember(decision.text, decision.decision, decision.kind);
			return restored.length > 0 ? 'seeded' : 'empty';
		};

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
			toolCallsInTurn = 0;
			tokens = 0;
			cost = 0;
			written = false;
			closed = false;
			job = 0;
			jobOpen = false;
			jobClosedBy = undefined;
			turnOpen = false;
			lastRealActivity = 0;
			lastResult = null;
			thread = emptyUnitThread();
			historyWritten = false;
			stopHeartbeat();
			// The conversation pi restored is history, not work in progress: seed the
			// decisions before the first frame, or a resume collapses every old answer
			// for good and credits the new job with the previous job's reasoning.
			const seeded = seedRestored(ctx);
			historyUnread = seeded === 'unavailable';
			if (sessionId !== undefined) {
				// A resumed session starts its card from its own first step again.
				removeCarrier(agentHome, sessionId);
			}
			pruneDeadCarriers(agentHome, sessionId);
			// The panel finds the inline units through this provider. Publishing it is
			// what makes a unit appear while it runs, without a restart; withdrawing
			// it at shutdown leaves the panel exactly as gentle-pi ships it.
			installOverlayPanel({ agentHome });
		}));

		pi.on('tool_call', safeHandler((event: ToolCallEvent, ctx: ExtensionContext): void => {
			if (closed || sessionId === undefined) return;
			// A nested call belongs to the step that made it, not to a step of its own.
			if (typeof event.parentToolCallId === 'string') return;
			const current = modelLabel(ctx);
			model = current.model;
			thinking = current.thinking;
			// A call with no turn open is the first activity after a close: the same
			// job continues, or a new one opens.
			openJob(!turnOpen);
			turnOpen = true;
			toolCalls += 1;
			// Bookkeeping is not weight: it is the record, not the work.
			if (!isAccountingTool(event.toolName)) toolCallsInTurn += 1;
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
			if (closed || !jobOpen) return;
			// A nested call belongs to the step that made it, exactly as above.
			if (typeof event.parentToolCallId === 'string') return;
			thread = addToolEnd(thread, {
				callId: event.toolCallId,
				output: toolSummary((event as { result?: unknown }).result),
				isError: event.isError === true,
			});
			const endedId = currentId();
			if (endedId !== undefined && sessionId !== undefined) writeLiveThread(agentHome, sessionId, endedId, thread);
			takeSignal();
		}));

		pi.on('message_end', safeHandler((event: MessageEndEvent): void => {
			if (closed) return;
			const message = event.message as unknown;
			if (typeof message !== 'object' || message === null || (message as { role?: unknown }).role !== 'assistant') return;
			// The answer of the turn is exempt here, not when the job closes: a job spans
			// many turns, so waiting for the close leaves every answer in between to be
			// collapsed. Extensions see this event before pi rebuilds the finished
			// message, so the exemption is already remembered when it is drawn last.
			exemptAnswer(prose, message);
			// The first message this process ends is the line between restored history
			// and our own work, when history could not be read at all.
			historyUnread = false;
			if (!jobOpen) return;
			const totals = usageTotals(message);
			tokens += totals.tokens;
			cost += totals.cost;
			lastActivityAt = now();
			lastRealActivity = lastActivityAt;
			persist();
			takeSignal();
		}));

		pi.on('turn_end', safeHandler((_event: TurnEndEvent): void => {
			if (closed || !jobOpen) return;
			turns += 1;
			lastActivityAt = now();
			lastRealActivity = lastActivityAt;
			persist();
			takeSignal();
		}));

		pi.on('agent_end', safeHandler((event: AgentEndEvent, ctx: ExtensionContext): void => {
			// The turn is over whatever we do next: the next one starts at zero calls.
			toolCallsInTurn = 0;
			if (closed || !jobOpen) return;
			const at = now();
			turnOpen = false;
			lastActivityAt = at;
			lastRealActivity = at;
			const messages = (event as { messages?: unknown }).messages;
			const summary = summaryLine(messages);
			if (summary !== undefined) label = summary;
			const closing = closingText(messages);
			if (closing.length > 0) {
				thread = addText(thread, closing);
				lastResult = closing;
			}
			// The answer of the turn must stay legible in the transcript: exempt its
			// exact text, then ask for one frame, because the message may already have
			// been drawn while it still looked like work in progress.
			const answer = rawClosingText(messages);
			closingFull = answer.length > 0 ? answer : undefined;
			if (closingFull !== undefined) prose.exempt(closingFull);
			repaintTranscript(ctx);
			// The turn is over; the job is not. It stays running until the agent says
			// the work is done, because only the agent knows that.
			status = INLINE_STATUS.RUNNING;
			persist();
			const openId = currentId();
			if (openId !== undefined && sessionId !== undefined) writeLiveThread(agentHome, sessionId, openId, thread);
			takeSignal();
		}));

		// The live carrier is display state for a running session and goes with it.
		// The history is not: a unit that closed stays readable, which is the
		// whole reason it is written under gentle-pi's own directory.
		pi.on('session_shutdown', safeHandler((_event: SessionShutdownEvent): void => {
			// The session going away is not the agent's signal, but it is a fact: the
			// job is over and its record has to survive.
			closeJob('session');
			closed = true;
			written = false;
			stopHeartbeat();
			thread = emptyUnitThread();
			job = 0;
			jobOpen = false;
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
		// The prose half: pi renders every Markdown message through this hook, so an
		// assistant message of a live inline session collapses to one line and the
		// panel keeps the whole text. User messages, thinking and the closing answer
		// are never touched.
		const proseHost = pi as ExtensionAPI & {
			registerMarkdownTransformer?: (transformer: (markdown: string, context: never) => string) => void;
		};
		if (typeof proseHost.registerMarkdownTransformer === 'function') {
			proseHost.registerMarkdownTransformer(prose.transformer);
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
