/**
 * The order, not just the decision.
 *
 * The prose collapse decides whether a message becomes one line. That decision
 * is only half of what a person sees: pi draws the finished message once, and a
 * transformer that is never asked again decides nothing new. So these tests
 * reproduce the real order against pi's real component:
 *
 *   1. the message is drawn while it streams,
 *   2. the turn ends and the answer is exempted,
 *   3. pi rebuilds the finished message,
 *   4. the frame shows the answer.
 *
 * They also pin the two facts that make the naive fixes wrong: a bare repaint
 * never re-runs a transformer (the Markdown component caches its lines by text
 * and width), and a collapsed message cannot be reopened with Ctrl+O. That is
 * why the answer has to be exempt *before* the rebuild, and why the rebuild is
 * pi's job at message_end rather than a repaint we could request ourselves.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { createInlineWork } from '../extensions/inline-work.ts';
import { MARKER_SUFFIX } from '../extensions/lib/inline-transcript.ts';

const PI_ROOT = join(process.cwd(), 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist');
const COMPONENT_FILE = join(PI_ROOT, 'modes', 'interactive', 'components', 'assistant-message.js');

/** pi's own assistant component, with our transformer, as the terminal builds it. */
async function piComponent(transformers: readonly unknown[]) {
	const loaded = (await import(pathToFileURL(COMPONENT_FILE).href)) as {
		AssistantMessageComponent: new (
			message: unknown,
			hideThinkingBlock: boolean,
			markdownTheme: unknown,
			hiddenThinkingLabel: string,
			outputPad: number,
			markdownTransformers: readonly unknown[],
		) => { updateContent(message: unknown, isStreaming?: boolean): void; render(width: number): string[] };
	};
	return (message: unknown) => new loaded.AssistantMessageComponent(message, false, undefined, 'Thinking...', 1, transformers);
}

const SESSION_ID = 'order-session';
const ANSWER = 'La respuesta final del turno, con dos líneas.\n\nY la segunda.';

function scratch(): string {
	return mkdtempSync(join(tmpdir(), 'loon-order-'));
}

function sessionContext(): ExtensionContext {
	return {
		sessionManager: { getSessionId: () => SESSION_ID, getEntries: () => [] },
		cwd: '/repo',
		model: { provider: 'anthropic', id: 'claude-opus-4' },
		thinkingLevel: 'high',
	} as unknown as ExtensionContext;
}

function work(agentHome: string) {
	const handlers = new Map<string, ((event: unknown, ctx: unknown) => void)[]>();
	const transformers: ((markdown: string, context: unknown) => string)[] = [];
	const api = {
		on: (event: string, handler: (event: unknown, ctx: unknown) => void): (() => void) => {
			handlers.set(event, [...(handlers.get(event) ?? []), handler]);
			return () => {};
		},
		registerToolRenderer: (): void => {},
		registerMessageRenderer: (): void => {},
		registerMarkdownTransformer: (transformer: unknown): void => {
			transformers.push(transformer as (markdown: string, context: unknown) => string);
		},
	} as unknown as ExtensionAPI;
	createInlineWork(api, { env: {}, agentHome, heartbeatMs: 0 });
	const fire = (event: string, payload: unknown): void => {
		for (const handler of handlers.get(event) ?? []) handler(payload, sessionContext());
	};
	fire('session_start', { type: 'session_start' });
	fire('tool_call', { type: 'tool_call', toolName: 'read', input: { path: 'README.md' } });
	return { fire, transformers };
}

const assistantMessage = (text: string): unknown => ({ role: 'assistant', content: [{ type: 'text', text }] });

test('the answer drawn during the turn does not change by repainting: only the rebuild shows it whole', async () => {
	const agentHome = scratch();
	try {
		const { fire, transformers } = work(agentHome);
		const component = await piComponent(transformers);
		const view = component(undefined);
		const message = assistantMessage(ANSWER);

		// 1. pi draws the message while it streams.
		view.updateContent(message, true);
		const streaming = view.render(100).join('\n');
		assert.ok(streaming.includes(MARKER_SUFFIX), 'the answer is collapsed while it is still streaming: ' + streaming);
		assert.ok(!streaming.includes('Y la segunda'), 'and its text is not in the transcript yet');

		// 2. The turn ends: the message is exempted before pi rebuilds it.
		fire('message_end', { type: 'message_end', message });

		// 3. A bare repaint - what a widget repaint or requestRender does - reuses the
		//    cached lines of the Markdown component. This is the reason the exemption
		//    cannot be delivered by asking for a frame.
		const repainted = view.render(100).join('\n');
		assert.equal(repainted, streaming, 'a repaint redraws the same component, cached lines included');

		// 4. pi rebuilds the finished message at message_end, which re-runs the
		//    transformers with the exemption already remembered.
		view.updateContent(message, false);
		const finished = view.render(100).join('\n');
		assert.ok(finished.includes('La respuesta final del turno'), 'the finished answer reads in full: ' + finished);
		assert.ok(finished.includes('Y la segunda'), 'both paragraphs, not the first line only');
		assert.ok(!finished.includes(MARKER_SUFFIX), 'and the marker is gone: ' + finished);
	} finally {
		rmSync(agentHome, { recursive: true, force: true });
	}
});

test('the rebuild after message_end is what pi does, in that order', () => {
	// Half of the guarantee above is pi's: extensions are notified first, and its
	// own message_end handler rebuilds the streaming component right after. If a
	// future pi version drops either, this test fails before the terminal does.
	const session = readFileSync(join(PI_ROOT, 'core', 'agent-session.js'), 'utf8');
	assert.ok(
		session.includes('Emit to extensions first, then notify public listeners.'),
		'extensions still see message_end before pi own listeners',
	);
	const interactive = readFileSync(join(PI_ROOT, 'modes', 'interactive', 'interactive-mode.js'), 'utf8');
	assert.ok(
		interactive.includes('this.streamingComponent.updateContent(this.streamingMessage, false)'),
		'pi still rebuilds the finished assistant message with isStreaming false',
	);
});

test('the restored conversation is still drawn after session_start, which is when it is seeded', () => {
	const session = readFileSync(join(PI_ROOT, 'core', 'agent-session.js'), 'utf8');
	assert.ok(
		session.includes('await this._extensionRunner.emit(this._sessionStartEvent)'),
		'session_start is still emitted from the session initialization',
	);
	const interactive = readFileSync(join(PI_ROOT, 'modes', 'interactive', 'interactive-mode.js'), 'utf8');
	assert.ok(
		interactive.includes('rebuildChatFromMessages()') &&
			interactive.includes('this.renderSessionEntries(this.sessionManager.buildContextEntries())'),
		'and the restored chat is still built by a separate step, after it',
	);
});

test('a custom message renderer is not a way out: it only renders custom messages', () => {
	// The alternative path - owning the component so its render() can re-decide -
	// does not exist for assistant text: the extension API registers renderers for
	// CustomMessageEntry only.
	const types = readFileSync(join(PI_ROOT, 'core', 'extensions', 'types.d.ts'), 'utf8');
	assert.ok(types.includes('Register a custom renderer for CustomMessageEntry.'), 'the hook is custom-message only');
	assert.ok(existsSync(COMPONENT_FILE), 'and the component we rely on is pi own, unchanged');
});
