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
 * @returns {string}
 */
export function collapseMarker(markdown: string, mode: TranscriptMode): string {
	if (mode === 'off') return MARKER_SUFFIX;
	const excerpt = firstLine(markdown);
	return excerpt.length > 0 ? '▸ ' + excerpt + ' ' + MARKER_SUFFIX : MARKER_SUFFIX;
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
			while (decisions.size > cap) {
				const oldest = decisions.keys().next().value;
				if (oldest === undefined) break;
				decisions.delete(oldest);
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
}

/**
 * Build the transformer pi will call for every Markdown message.
 * @param {{ mode: TranscriptMode, isLive: () => boolean, closingText: () => string | undefined, memory?: TranscriptMemory }} options
 * @returns {TranscriptCollapse}
 */
export function createTranscriptTransformer(options: {
	mode: TranscriptMode;
	isLive: () => boolean;
	closingText: () => string | undefined;
	memory?: TranscriptMemory;
}): TranscriptCollapse {
	const memory = options.memory ?? createTranscriptMemory();
	return {
		exempt(text: string): void {
			if (text.trim().length > 0) memory.set(text, 'exempt');
		},
		transformer(markdown: string, context: MarkdownTransformContext): string {
			try {
				if (options.mode === 'full') return markdown;
				if (context?.messageType !== 'assistant') return markdown;
				if (markdown.trim().length === 0) return markdown;
				const decided = memory.get(markdown);
				if (decided === 'exempt') return markdown;
				if (decided === 'collapsed') return collapseMarker(markdown, options.mode);
				if (decided === 'kept') return markdown;
				if (isClosingMessage(markdown, options.closingText())) {
					memory.set(markdown, 'exempt');
					return markdown;
				}
				if (!options.isLive()) {
					memory.set(markdown, 'kept');
					return markdown;
				}
				memory.set(markdown, 'collapsed');
				return collapseMarker(markdown, options.mode);
			} catch {
				// A transformer that throws would break the transcript: show the message.
				return markdown;
			}
		},
	};
}
