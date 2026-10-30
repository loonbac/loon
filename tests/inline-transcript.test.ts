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
 * on a later repaint, never touch a user message or the thinking text, and leave
 * the opening and the closing of the turn legible.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
	MARKER_SUFFIX,
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
} = {}) {
	const memory = createTranscriptMemory(options.memory);
	let live = options.live ?? true;
	let closing = options.closing;
	const built = createTranscriptTransformer({
		mode: options.mode ?? 'summary',
		isLive: () => live,
		closingText: () => closing,
		memory,
	});
	return {
		...built,
		setLive: (value: boolean): void => {
			live = value;
		},
		setClosing: (value: string | undefined): void => {
			closing = value;
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

test('thinking is never touched', () => {
	const t = transformer({ live: true });
	const context = { messageType: 'assistant-thinking' as const, isStreaming: true, availableWidth: 100 };
	assert.equal(t.transformer(PARAGRAPHS, context), PARAGRAPHS);
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
