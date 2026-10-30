/**
 * The collapsed renderer: what the main transcript draws while the parent itself
 * programs inline.
 *
 * A subagent's work happens in a child, so the parent transcript sees one call.
 * Inline work is the opposite: every read, grep, edit and bash lands in the
 * transcript as its own row, and a long unit pushes the previous summaries out of
 * reach. The carrier record put that work in the Agents panel; this drops the
 * rows it would otherwise draw here, so the transcript keeps the assistant's prose
 * and its closing summary.
 *
 * Three rules keep it honest. It runs for the whole session, from its first tool
 * call: pi builds a call's component while the assistant message streams, before
 * the tool runs, so anything that waited for the session's carrier would let the
 * first row of every unit through - and a unit driven through codemode can be one
 * call. It never touches a tool that is not one of the file and shell calls or
 * `codemode`, which is what leaves subagent tasks, questions for the owner and
 * `todo` untouched. And a failure is never collapsed: an errored call delegates
 * to the renderers it would have had.
 *
 * Everything is display only. No tool execution, schema or output changes.
 */
import type { Component } from '@earendil-works/pi-tui';
import type { ToolRendererResolver, ToolRenderers } from '@earendil-works/pi-coding-agent';

/**
 * The calls that flood the transcript, and the only ones this renderer drops.
 * The file and shell tools are one family; `codemode` is the other, because an
 * agent that works through it makes every single call through that one tool, so
 * the seven names alone would leave its transcript exactly as flooded as before.
 * Everything else is somebody else's row: subagent tasks, questions waiting for
 * the owner, the todo list and the gentle tools.
 */
export const COLLAPSED_TOOL_NAMES: ReadonlySet<string> = new Set([
	'read',
	'bash',
	'grep',
	'find',
	'ls',
	'edit',
	'write',
	'codemode',
]);

/** How much of a failure is kept when the tool it came from has no renderer. */
export const FAILURE_ROW_LIMIT = 20;

/**
 * A call that occupies nothing. pi draws a zero-line component of a
 * `renderShell: "self"` tool as no rows at all, which is the whole collapse.
 */
export const EMPTY_COMPONENT: Component = Object.freeze({
	render: (): string[] => [],
	invalidate: (): void => {},
});

/** Tool output can carry escape sequences; a fallback row must not paint them. */
function plainLines(text: string, limit: number): string[] {
	const stripped = text.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '');
	return stripped
		.split('\n')
		.map((line) => line.replace(/\s+$/, ''))
		.filter((line, index, all) => line.length > 0 || all.length === 1)
		.slice(0, limit);
}

/** The text a tool result carries, which is all a fallback row can show. */
function resultText(result: unknown): string {
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

/**
 * A failed call whose tool has no renderer of its own still has to say what
 * happened. This is the last resort, never the normal path: the file and shell
 * tools all have a renderer, and an error delegates to it.
 */
function failureComponent(toolName: string, result: unknown): Component {
	const rows = ['', toolName + ' failed'];
	const text = resultText(result);
	if (text.trim().length > 0) rows.push('', ...plainLines(text, FAILURE_ROW_LIMIT));
	return { render: (): string[] => rows, invalidate: (): void => {} };
}

/**
 * Renderers that draw nothing, or draw what the call would have drawn when the
 * row is one a reader asked for or one that failed.
 */
export function collapseRenderers(
	toolName: string,
	next: () => ToolRenderers | undefined,
): ToolRenderers {
	return {
		// The frame pi would paint around a normal call is rows too.
		renderShell: 'self',
		renderCall(args, theme, context) {
			if (context?.expanded === true || context?.isError === true) {
				const native = next()?.renderCall?.(args, theme, context);
				if (native !== undefined) return native;
			}
			return EMPTY_COMPONENT;
		},
		renderResult(result, options, theme, context) {
			if (options?.expanded === true || context?.isError === true) {
				const native = next()?.renderResult?.(result, options, theme, context);
				if (native !== undefined) return native;
				return failureComponent(toolName, result);
			}
			return EMPTY_COMPONENT;
		},
	};
}

/**
 * The resolver pi asks for a tool's renderers. `isLive` answers whether this is
 * an inline session right now - a session that started and has not shut down -
 * which is what keeps a session before its start, a disabled extension and every
 * other tool drawing exactly what they drew before.
 */
export function collapseResolver(isLive: () => boolean): ToolRendererResolver {
	return (toolName, next) => {
		if (!COLLAPSED_TOOL_NAMES.has(toolName)) return next();
		if (!isLive()) return next();
		return collapseRenderers(toolName, next);
	};
}
