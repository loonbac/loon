/**
 * The prose collapse: what the main transcript keeps of an assistant message
 * while the session is working inline.
 *
 * A subagent's prose never reaches the parent transcript, because it happens in
 * a child. Inline prose does, and it is the same text the panel shows as the
 * unit's thread. pi exposes a supported hook for this
 * (registerMarkdownTransformer: "a transformer for user and assistant Markdown
 * before Pi renders it in the interactive transcript"), and these tests pin what
 * it must do: collapse the message while the carrier is live, keep it collapsed
 * on a later repaint, never touch a user message, collapse the thinking block
 * under the same knob while handing its full text to whoever keeps the panel,
 * and leave the opening and the closing of the turn legible.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
	MARKER_SUFFIX,
	THINKING_SUFFIX,
	TRANSCRIPT_MEMORY,
	collapseMarker,
	createTranscriptMemory,
	isClosingMessage,
	createTranscriptTransformer,
	transcriptMode,
} from '../extensions/lib/inline-transcript.ts';

const PARAGRAPHS = [
	'Voy a mirar el estado del repositorio antes de tocar nada.',
	'',
	'El slice anterior dejó el registro escrito y el panel funcionando, así que',
	'ahora solo queda mover la prosa al panel y dejar el cierre legible.',
].join('\n');

const OTHER = 'Segundo mensaje, con otro contenido distinto del primero.';

function transformer(options: {
	mode?: 'summary' | 'off' | 'full';
	live?: boolean;
	closing?: string;
	memory?: number;
	onThinking?: (text: string, isStreaming: boolean) => void;
} = {}) {
	const memory = createTranscriptMemory(options.memory);
	let live = options.live ?? true;
	let closing = options.closing;
	let mode = options.mode ?? 'summary';
	const built = createTranscriptTransformer({
		mode,
		isLive: () => live,
		closingText: () => closing,
		memory,
		...(options.onThinking === undefined ? {} : { onThinking: options.onThinking }),
		modeOf: () => mode,
	});
	return {
		...built,
		setLive: (value: boolean): void => {
			live = value;
		},
		setClosing: (value: string | undefined): void => {
			closing = value;
		},
		setMode: (value: 'summary' | 'off' | 'full'): void => {
			mode = value;
		},
	};
}

const assistant = (isStreaming = false): { messageType: 'assistant'; isStreaming: boolean; availableWidth: number } => ({
	messageType: 'assistant',
	isStreaming,
	availableWidth: 100,
});

test('an assistant message collapses while the carrier is live', () => {
	const t = transformer({ live: true });
	const rendered = t.transformer(PARAGRAPHS, assistant());
	assert.equal(rendered.split('\n').length, 1, 'the whole message becomes one line');
	assert.match(rendered, /Voy a mirar el estado del repositorio/);
	assert.ok(rendered.includes(MARKER_SUFFIX), 'and it says where the rest lives: ' + rendered);
	assert.ok(rendered.length < PARAGRAPHS.length, 'the collapse has to be shorter than the message');
});

test('the same text still renders collapsed on a later repaint', () => {
	const t = transformer({ live: true });
	const first = t.transformer(PARAGRAPHS, assistant(true));
	// The turn closed: the carrier is gone or finished, and the message repaints.
	t.setLive(false);
	const second = t.transformer(PARAGRAPHS, assistant(false));
	assert.equal(second, first, 'a message collapsed while live must not expand afterwards');
});

test('the closing message of the turn renders in full, and stays that way', () => {
	const t = transformer({ live: true, closing: PARAGRAPHS });
	assert.equal(t.transformer(PARAGRAPHS, assistant()), PARAGRAPHS, 'the answer is the point: it stays legible');
	t.setLive(false);
	assert.equal(t.transformer(PARAGRAPHS, assistant()), PARAGRAPHS);
	t.setLive(true);
	assert.equal(t.transformer(PARAGRAPHS, assistant()), PARAGRAPHS, 'and a later repaint during work must not eat it');
});

test('a user message is byte-identical, live or not, in every mode', () => {
	for (const mode of ['summary', 'off', 'full'] as const) {
		const t = transformer({ mode, live: true });
		const context = { messageType: 'user' as const, isStreaming: false, availableWidth: 100 };
		assert.equal(t.transformer(PARAGRAPHS, context), PARAGRAPHS);
	}
});

const thinking = (isStreaming = false): { messageType: 'assistant-thinking'; isStreaming: boolean; availableWidth: number } => ({
	messageType: 'assistant-thinking',
	isStreaming,
	availableWidth: 100,
});

test('a thinking block collapses to one line while the session is live', () => {
	const t = transformer({ live: true });
	const rendered = t.transformer(PARAGRAPHS, thinking());
	assert.equal(rendered.split('\n').length, 1, 'the reasoning is the noise: one line');
	assert.ok(rendered.startsWith('▸ '), rendered);
	assert.ok(rendered.includes(THINKING_SUFFIX), 'and it says what it is: ' + rendered);
	assert.ok(!rendered.includes(MARKER_SUFFIX), 'thinking is not inline work: ' + rendered);
});

test('off leaves only the thinking marker, and full leaves the block alone', () => {
	const off = transformer({ mode: 'off', live: true });
	assert.equal(off.transformer(PARAGRAPHS, thinking()), THINKING_SUFFIX);
	const full = transformer({ mode: 'full', live: true });
	assert.equal(full.transformer(PARAGRAPHS, thinking()), PARAGRAPHS);
});

test('a collapsed thinking block stays collapsed, and a kept one stays kept', () => {
	const t = transformer({ live: true });
	const first = t.transformer(PARAGRAPHS, thinking());
	t.setLive(false);
	assert.equal(t.transformer(PARAGRAPHS, thinking()), first, 'a repaint must not bring the noise back');
	// The mirror bug: a decision taken as "kept" must not be collapsed later by a
	// mode change any more than a collapsed one may be expanded.
	const mirror = transformer({ mode: 'full', live: true });
	assert.equal(mirror.transformer(PARAGRAPHS, thinking()), PARAGRAPHS, 'full keeps the block');
	mirror.setMode('summary');
	assert.equal(mirror.transformer(PARAGRAPHS, thinking()), PARAGRAPHS, 'and a later summary must not shrink it');
});

test('the thinking text reaches the sink when it stops streaming, never while it streams', () => {
	const seen: Array<{ text: string; streaming: boolean }> = [];
	const t = transformer({ live: true, onThinking: (text, streaming) => seen.push({ text, streaming }) });
	t.transformer('Voy pensando en el siguiente paso', thinking(true));
	assert.equal(seen.length, 0, 'a streaming frame is not a block: capturing it would fill the panel with prefixes');
	t.transformer(PARAGRAPHS, thinking(false));
	assert.deepEqual(seen, [{ text: PARAGRAPHS, streaming: false }], 'the whole block, once, for the panel');
});

test('the closing exemption is about the answer, and never about thinking', () => {
	const t = transformer({ live: true, closing: PARAGRAPHS });
	assert.equal(t.transformer(PARAGRAPHS, assistant()), PARAGRAPHS, 'the answer stays legible');
	const asThinking = t.transformer(PARAGRAPHS, thinking());
	assert.ok(asThinking.includes(THINKING_SUFFIX), 'the same text as reasoning is collapsed: ' + asThinking);
});

test('with no carrier, nothing is transformed - and it stays that way', () => {
	const t = transformer({ live: false });
	assert.equal(t.transformer(PARAGRAPHS, assistant()), PARAGRAPHS);
	// A message first rendered while no unit was running is history: a later
	// repaint during work must not shrink it.
	t.setLive(true);
	assert.equal(t.transformer(PARAGRAPHS, assistant()), PARAGRAPHS);
});

test('the second mode says inline without an excerpt, and full changes nothing', () => {
	const off = transformer({ mode: 'off', live: true });
	assert.equal(off.transformer(PARAGRAPHS, assistant()), MARKER_SUFFIX, 'off leaves only the marker');
	const full = transformer({ mode: 'full', live: true });
	assert.equal(full.transformer(PARAGRAPHS, assistant()), PARAGRAPHS, 'full is the old behaviour');
});

test('the answer is recognised even when a repaint normalises its edges', () => {
	assert.equal(isClosingMessage('Hecho: cerrado.\n', 'Hecho: cerrado.'), true);
	assert.equal(isClosingMessage('Hecho: cerrado.  ', 'Hecho: cerrado.'), true);
	// A long answer keeps its opening as the identity, so a trailing edit cannot
	// turn it back into "work".
	const long = 'Hecho: el slice quedó con sus pruebas, el registro escrito y el panel mostrando una sola tarjeta por trabajo, con la transcripción acumulada y los totales del trabajo completo en el registro.';
	assert.equal(isClosingMessage(long + '\n\nFin.', long), true);
	assert.equal(isClosingMessage('Otra cosa distinta, sin relación.', long), false);
	assert.equal(isClosingMessage('Hecho: cerrado.', undefined), false);
});

test('an empty or blank message is left alone', () => {
	const t = transformer({ live: true });
	assert.equal(t.transformer('', assistant()), '');
	assert.equal(t.transformer('   \n\n ', assistant()), '   \n\n ');
});

test('the remembered set is bounded, and the oldest forgets first', () => {
	const t = transformer({ live: true, memory: 2 });
	const first = t.transformer(PARAGRAPHS, assistant());
	const second = t.transformer(OTHER, assistant());
	const third = t.transformer('Tercer mensaje distinto.', assistant());
	assert.ok([first, second, third].every((rendered) => rendered.includes(MARKER_SUFFIX)));
	// Two remembered, so the first was forgotten: it is decided again. While the
	// carrier is still live that means collapsed again, which is why the cap has
	// to be far larger than any transcript a person scrolls through.
	t.setLive(false);
	assert.equal(t.transformer(PARAGRAPHS, assistant()), PARAGRAPHS, 'a forgotten message is decided again from scratch');
	assert.equal(TRANSCRIPT_MEMORY >= 100, true, 'the real cap leaves room for a long session');
});

test('the mode comes from LOON_INLINE_TRANSCRIPT, defaulting to summary', () => {
	assert.equal(transcriptMode({}), 'summary');
	assert.equal(transcriptMode({ LOON_INLINE_TRANSCRIPT: 'off' }), 'off');
	assert.equal(transcriptMode({ LOON_INLINE_TRANSCRIPT: 'full' }), 'full');
	assert.equal(transcriptMode({ LOON_INLINE_TRANSCRIPT: ' FULL ' }), 'full');
	assert.equal(transcriptMode({ LOON_INLINE_TRANSCRIPT: 'nonsense' }), 'summary', 'an unknown value is not a way to lose the answer');
});

test('the marker keeps the first line and the pointer, and does not paint markdown', () => {
	const marked = collapseMarker('## Un titulo\n\nY el cuerpo.', 'summary');
	assert.equal(marked.split('\n').length, 1);
	assert.match(marked, /Un titulo/);
	assert.doesNotMatch(marked, /##/, 'markdown syntax must not survive into the marker');
	assert.doesNotMatch(marked, /\*\*/);
	const long = collapseMarker('x'.repeat(400), 'summary');
	assert.ok(long.length <= 120, 'the marker stays one short line: ' + long.length);
});
