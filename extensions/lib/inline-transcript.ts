/**
 * The prose collapse: what the main transcript keeps of an assistant message
 * while the session is working inline.
 *
 * pi renders Markdown through a supported hook - registerMarkdownTransformer, "a
 * transformer for user and assistant Markdown before Pi renders it in the
 * interactive transcript" - and tells the transformer whether the message is
 * from the user, from the assistant, or is the model thinking. That is exactly
 * enough to leave everything except assistant prose alone.
 *
 * The rules, because this is the one place that can hide an answer:
 *
 *   - only an assistant message is ever transformed, and only while the inline
 *     carrier is live; a session that is not working inline renders as before;
 *   - the first decision about a message is the one that sticks: a message first
 *     rendered while a unit was running stays collapsed when it repaints, and a
 *     message that was already history when the unit began stays whole. Stickiness
 *     by content is what stops the transcript refilling behind the reader;
 *   - the closing message of a turn is exempt, in full, for good: an answer that
 *     exists only in the panel would be worse than the prose we set out to hide;
 *   - the memory is bounded. At the cap the oldest decision is forgotten and that
 *     message is decided again from scratch on its next render.
 *
 * Everything here is display only: no message, transcript file or model call
 * changes.
 */
import { createHash } from 'node:crypto';
import type { MarkdownTransformContext, MarkdownTransformer } from '@earendil-works/pi-coding-agent';

/** How the inline session's prose is drawn. */
export type TranscriptMode = 'summary' | 'off' | 'full';

/** Summarise the message, or drop the excerpt and keep only the pointer. */
export const TRANSCRIPT_MODE_DEFAULT: TranscriptMode = 'summary';

/** Where the full text lives, appended to the compact line. */
export const MARKER_SUFFIX = '· inline · /gentle:agents';

/** How much of the first line survives in the marker. */
export const EXCERPT_MAX = 80;

/**
 * What a collapsed reasoning block says. Its own marker: the reasoning of a
 * turn is not inline work, and a person reading one line should know which of
 * the two they are looking at.
 */
export const THINKING_SUFFIX = '· pensamiento · /gentle:agents';

/**
 * How many decisions are remembered. A long session is a few hundred messages;
 * at the cap the oldest decision is forgotten, and only then can a repaint
 * change it - so the cap is stated here and in the README rather than guessed.
 */
export const TRANSCRIPT_MEMORY = 500;

/** What a message was decided to be the first time it was seen. */
type Decision = 'collapsed' | 'kept' | 'exempt';

/** How much of a message identifies it as the answer of the turn. */
const CLOSING_PREFIX = 120;

/**
 * Whether this message is the answer captured at unit close. Exact equality is
 * the rule; the shared opening is the safety net for the ways a renderer can
 * normalise the edges of a text, which would otherwise collapse the one message
 * that must never be collapsed.
 * @param {string} markdown
 * @param {string | undefined} closing
 * @returns {boolean}
 */
export function isClosingMessage(markdown: string, closing: string | undefined): boolean {
	if (closing === undefined || closing.length === 0) return false;
	const left = markdown.trim();
	const right = closing.trim();
	if (left === right) return true;
	// A long answer keeps its opening as its identity, which survives the ways a
	// renderer can add or drop edges. A short one has no identity to spare.
	const head = left.slice(0, CLOSING_PREFIX);
	return head.length >= 40 && head === right.slice(0, CLOSING_PREFIX);
}

/**
 * The env knob. An unknown value falls back to the default: a typo must not be a
 * way to lose the final answer.
 * @param {Record<string, string | undefined>} env
 * @returns {TranscriptMode}
 */
export function transcriptMode(env: Record<string, string | undefined>): TranscriptMode {
	const value = (env.LOON_INLINE_TRANSCRIPT ?? '').trim().toLowerCase();
	if (value === 'off') return 'off';
	if (value === 'full') return 'full';
	return TRANSCRIPT_MODE_DEFAULT;
}

function digest(text: string): string {
	return createHash('sha1').update(text).digest('hex');
}

/**
 * The first line of a message, without markdown syntax, bounded.
 * @param {string} markdown
 * @returns {string}
 */
export function firstLine(markdown: string): string {
	for (const raw of markdown.split('\n')) {
		const stripped = raw
			.replace(/^\s*(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/, '')
			.replace(/\*\*|__|\*|_|\x60/g, '')
			.trim();
		if (stripped.length > 0) return stripped.length > EXCERPT_MAX ? stripped.slice(0, EXCERPT_MAX - 1) + '…' : stripped;
	}
	return '';
}

/**
 * The one-line replacement for a collapsed message.
 * @param {string} markdown
 * @param {TranscriptMode} mode
 * @param {string} [suffix]
 * @returns {string}
 */
export function collapseMarker(markdown: string, mode: TranscriptMode, suffix: string = MARKER_SUFFIX): string {
	if (mode === 'off') return suffix;
	const excerpt = firstLine(markdown);
	return excerpt.length > 0 ? '▸ ' + excerpt + ' ' + suffix : suffix;
}

/** The bounded memory of what was decided about which message. */
export interface TranscriptMemory {
	get(text: string): Decision | undefined;
	set(text: string, decision: Decision): void;
	size(): number;
}

/**
 * A bounded first-decision memory, oldest out first at the cap.
 * @param {number} [limit]
 * @returns {TranscriptMemory}
 */
export function createTranscriptMemory(limit: number = TRANSCRIPT_MEMORY): TranscriptMemory {
	const decisions = new Map<string, Decision>();
	const cap = Math.max(1, Math.floor(limit));
	return {
		get(text) {
			return decisions.get(digest(text));
		},
		set(text, decision) {
			const key = digest(text);
			decisions.delete(key);
			decisions.set(key, decision);
			// An answer that was exempt is exempt for good, so the cap takes the oldest
			// decision that is not one. Only a session made entirely of answers forgets
			// an exemption, and there the oldest one is the only candidate left.
			while (decisions.size > cap) {
				let victim: string | undefined;
				for (const [candidate, decided] of decisions) {
					if (decided !== 'exempt') {
						victim = candidate;
						break;
					}
				}
				if (victim === undefined) victim = decisions.keys().next().value;
				if (victim === undefined) break;
				decisions.delete(victim);
			}
		},
		size() {
			return decisions.size;
		},
	};
}

/** The transformer plus the one thing the unit close needs to say. */
export interface TranscriptCollapse {
	transformer: MarkdownTransformer;
	/** Mark a text as the answer of a turn: it renders in full, for good. */
	exempt(text: string): void;
	/** Remember a decision taken elsewhere, such as the ones a resume seeds. */
	remember(text: string, decision: Decision, kind?: DecisionKind): void;
}

/** Which memory a seeded decision belongs to. */
export type DecisionKind = 'prose' | 'thinking';

export interface RestoredDecision {
	text: string;
	decision: Decision;
	kind: DecisionKind;
}

/**
 * The decisions a resumed conversation was already given, read from the session
 * entries pi restored.
 *
 * A resume renders the whole restored conversation through the transformers
 * again, in a fresh process with an empty memory. Without this the history looks
 * like work in progress: every old answer would be collapsed for good and every
 * old reasoning block would be captured into the job that just started, which
 * credits one job with another job's thinking.
 *
 * So the restored conversation is seeded as history: prose and reasoning stay as
 * they were read (kept), and a message that ends without a tool call was an
 * answer, which is exempt for good.
 * @param {unknown} entries pi's session entries
 * @returns {RestoredDecision[]}
 */
export function restoredDecisions(entries: unknown): RestoredDecision[] {
	const list = Array.isArray(entries) ? entries : [];
	const out: RestoredDecision[] = [];
	const put = (text: string, decision: Decision, kind: DecisionKind): void => {
		const trimmed = text.trim();
		if (trimmed.length === 0) return;
		if (out.some((entry) => entry.text === trimmed && entry.kind === kind)) return;
		out.push({ text: trimmed, decision, kind });
	};
	for (const entry of list) {
		const candidate = entry as { type?: unknown; message?: unknown } | undefined;
		if (candidate?.type !== 'message') continue;
		const message = candidate.message as { role?: unknown; content?: unknown } | undefined;
		if (message === null || typeof message !== 'object' || message.role !== 'assistant') continue;
		const content = message.content;
		if (!Array.isArray(content)) continue;
		const answer = !content.some((part) => (part as { type?: unknown } | undefined)?.type === 'toolCall');
		for (const part of content) {
			const block = part as { type?: unknown; text?: unknown; thinking?: unknown } | undefined;
			if (block?.type === 'thinking' && typeof block.thinking === 'string') put(block.thinking, 'kept', 'thinking');
			if (block?.type === 'text' && typeof block.text === 'string') put(block.text, answer ? 'exempt' : 'kept', 'prose');
		}
	}
	return out;
}

/**
 * Build the transformer pi will call for every Markdown message.
 * @param {{ mode: TranscriptMode, isLive: () => boolean, closingText: () => string | undefined, memory?: TranscriptMemory }} options
 * @returns {TranscriptCollapse}
 */
export function createTranscriptTransformer(options: {
	mode: TranscriptMode;
	modeOf?: () => TranscriptMode;
	isLive: () => boolean;
	/**
	 * Whether the turn being drawn is heavy work. A light turn - a status check,
	 * a question and two commands - is a conversation and reads in full; the
	 * collapse is for turns that really work. Default: always heavy.
	 */
	isHeavy?: () => boolean;
	closingText: () => string | undefined;
	memory?: TranscriptMemory;
	thinkingMemory?: TranscriptMemory;
	onThinking?: (text: string, isStreaming: boolean) => void;
}): TranscriptCollapse {
	const memory = options.memory ?? createTranscriptMemory();
	const thinkingMemory = options.thinkingMemory ?? createTranscriptMemory();
	const modeOf = options.modeOf ?? ((): TranscriptMode => options.mode);

	/**
	 * The reasoning path: the same knob, a different marker.
	 *
	 * A collapsed markdown transform cannot be opened again with the expand key,
	 * so the whole block is handed to the panel *before* any decision is taken.
	 * Losing the reasoning would be a worse trade than the noise it replaces.
	 * @param {string} markdown
	 * @param {MarkdownTransformContext} context
	 * @returns {string}
	 */
	const reasoning = (markdown: string, context: MarkdownTransformContext): string => {
		const streaming = context?.isStreaming === true;
		if (markdown.trim().length === 0) return markdown;
		const decided = thinkingMemory.get(markdown);
		// Only what this process is writing is captured. A block already decided is
		// either restored history or a block already given to the panel, and a resume
		// renders the whole conversation again: capturing there would credit the job
		// that just started with another job's thinking.
		if (decided !== 'kept' && decided !== 'exempt') {
			// Every frame is handed over, not only the last one: pi may finish a block
			// without drawing it again, and a block that was read must not be lost.
			// Whoever keeps the panel decides whether a frame grows its item.
			options.onThinking?.(markdown, streaming);
		}
		if (decided === 'kept' || decided === 'exempt') return markdown;
		if (decided === 'collapsed') return collapseMarker(markdown, modeOf(), THINKING_SUFFIX);
		// No liveness is not a decision: without a live session there is nobody to
		// decide for, and remembering "kept" here would freeze the block that the
		// session had not started writing yet.
		if (!options.isLive()) return markdown;
		if (modeOf() === 'full') {
			if (!streaming) thinkingMemory.set(markdown, 'kept');
			return markdown;
		}
		if (!streaming) thinkingMemory.set(markdown, 'collapsed');
		return collapseMarker(markdown, modeOf(), THINKING_SUFFIX);
	};

	return {
		exempt(text: string): void {
			if (text.trim().length > 0) memory.set(text, 'exempt');
		},
		remember(text: string, decision: Decision, kind: DecisionKind = 'prose'): void {
			if (text.trim().length === 0) return;
			(kind === 'thinking' ? thinkingMemory : memory).set(text, decision);
		},
		transformer(markdown: string, context: MarkdownTransformContext): string {
			try {
				if (context?.messageType === 'assistant-thinking') return reasoning(markdown, context);
				if (context?.messageType !== 'assistant') return markdown;
				if (markdown.trim().length === 0) return markdown;
				const decided = memory.get(markdown);
				if (decided === 'exempt' || decided === 'kept') return markdown;
				if (decided === 'collapsed') return collapseMarker(markdown, modeOf());
				if (isClosingMessage(markdown, options.closingText())) {
					memory.set(markdown, 'exempt');
					return markdown;
				}
				// No liveness is not a decision, for the same reason as the reasoning:
				// the turn's own prose may be drawn before the card exists.
				if (!options.isLive()) return markdown;
				if (modeOf() === 'full') {
					memory.set(markdown, 'kept');
					return markdown;
				}
				// A light turn is a conversation: its narration is what the person is
				// reading, not work to be filed. The decision is taken once, when the
				// message is drawn, and never revisited - so a turn that turns heavy
				// later never shrinks what was already read in full.
				if (options.isHeavy !== undefined && !options.isHeavy()) {
					memory.set(markdown, 'kept');
					return markdown;
				}
				memory.set(markdown, 'collapsed');
				return collapseMarker(markdown, modeOf());
			} catch {
				// A transformer that throws would break the transcript: show the message.
				return markdown;
			}
		},
	};
}
