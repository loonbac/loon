/**
 * Width and text helpers for the header: the divider sits at a fixed share of
 * the interior, the tips sidebar truncates with an ellipsis, and the left half
 * centres its content. Width helpers follow pi-claude-code-tui (MIT, NOTICE).
 */
import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui';
import { LOGO_WIDTH } from './logo.ts';

/**
 * Share of the interior width where the vertical divider sits. The mark block
 * only needs room for itself, so the sidebar gets the rest: a 53-column half
 * around a 12-column mark read as an empty band, not as a logo section.
 */
export const DIVIDER_RATIO = 0.42;
/** Ceiling for the left half: past this the mark floats again on wide screens. */
export const MAX_LEFT_WIDTH = 40;
/** The left half must fit the mark plus breathing room. */
export const MIN_LEFT_WIDTH = LOGO_WIDTH + 4;
/** Narrowest tips sidebar; below this the sidebar is dropped. */
export const MIN_TIPS_WIDTH = 16;

/** Show the home directory as `~` so a long cwd keeps its useful part. */
export function formatCwd(cwd: string, home: string | undefined = process.env.HOME): string {
	return home && cwd.startsWith(home) ? `~${cwd.slice(home.length)}` : cwd;
}

/** Prefer `provider/id`, the same label pi uses elsewhere. */
export function formatModelLabel(model: { provider?: string; id?: string } | null | undefined): string {
	if (!model?.id) return 'Default model';
	return model.provider ? `${model.provider}/${model.id}` : model.id;
}

/** Center within `width` columns, truncating with an ellipsis when too wide. */
export function center(text: string, width: number): string {
	if (width <= 0) return '';
	const w = visibleWidth(text);
	if (w >= width) return truncateToWidth(text, width, '…');
	return `${' '.repeat(Math.floor((width - w) / 2))}${text}`;
}

/** Preferred places to break a long token, best first: path, then words. */
const BREAK_PREFERENCE = ['/', '-'] as const;

/** Split after every separator it contains, keeping the separator attached. */
function unitsBy(text: string, separator: string): string[] {
	const units: string[] = [];
	let current = '';
	for (const char of text) {
		current += char;
		if (char === separator) {
			units.push(current);
			current = '';
		}
	}
	if (current) units.push(current);
	return units;
}

/** Last resort: cut at the width, without inventing a character. */
function hardSplit(text: string, width: number): string[] {
	const lines: string[] = [];
	let current = '';
	let used = 0;
	for (const char of text) {
		const w = visibleWidth(char);
		if (current && used + w > width) {
			lines.push(current);
			current = '';
			used = 0;
		}
		current += char;
		used += w;
	}
	if (current) lines.push(current);
	return lines;
}

/** Break one token that does not fit, following BREAK_PREFERENCE. */
function breakToken(token: string, width: number, depth = 0): string[] {
	if (visibleWidth(token) <= width) return [token];
	const separator = BREAK_PREFERENCE[depth];
	if (separator === undefined) return hardSplit(token, width);

	const lines: string[] = [];
	let current = '';
	for (const unit of unitsBy(token, separator)) {
		for (const piece of breakToken(unit, width, depth + 1)) {
			if (current && visibleWidth(current) + visibleWidth(piece) > width) {
				lines.push(current);
				current = '';
			}
			current += piece;
		}
	}
	if (current) lines.push(current);
	return lines;
}

/**
 * Wrap at one fixed width. Also reports whether the last line came from a token
 * that had to be split, which is the one case where a single token on the final
 * line is legitimate rather than a widow.
 */
function wrapAt(text: string, width: number): { lines: string[]; splitTail: boolean } {
	if (width <= 0) return { lines: [], splitTail: false };
	const lines: string[] = [];
	let current = '';
	let fresh = false;
	const flush = () => {
		if (current) {
			lines.push(current);
			current = '';
		}
	};

	for (const word of text.split(' ').filter((word) => word.length > 0)) {
		if (fresh) {
			flush();
			fresh = false;
		}
		if (visibleWidth(word) <= width) {
			if (!current) current = word;
			else if (visibleWidth(current) + 1 + visibleWidth(word) <= width) current = current + ' ' + word;
			else {
				flush();
				current = word;
			}
			continue;
		}

		flush();
		const pieces = breakToken(word, width);
		current = pieces.pop() ?? '';
		lines.push(...pieces);
		fresh = true;
	}

	flush();
	return { lines: lines.length > 0 ? lines : [''], splitTail: fresh };
}

/** Number of space-separated tokens on a line. */
function tokenCount(line: string): number {
	return line.split(' ').filter((token) => token.length > 0).length;
}

/**
 * Break a label into lines that fit the width, so a long model id keeps every
 * character instead of losing its tail to an ellipsis. Breaks at a space when
 * there is one, splits an over-long token at a slash and then a dash, and cuts
 * at the width only when a single run has no separator left. A token that had
 * to be split ends its line, so the words after it start on a fresh one.
 *
 * A final line holding a single word reads as a broken label, so the wrap is
 * retried at a slightly smaller width and the widest result whose last line has
 * at least two words wins. The retry stops at half the width and keeps the
 * original result when nothing improves; a token that had to be split is a
 * whole line by nature and is never re-wrapped.
 */
export function wrapLabel(text: string, width: number): string[] {
	const original = wrapAt(text, width);
	if (original.lines.length < 2 || original.splitTail) return original.lines;
	if (tokenCount(original.lines[original.lines.length - 1] ?? '') > 1) return original.lines;

	const floor = Math.max(1, Math.ceil(width / 2));
	for (let narrower = width - 1; narrower >= floor; narrower -= 1) {
		const candidate = wrapAt(text, narrower);
		if (candidate.splitTail) continue;
		const last = candidate.lines[candidate.lines.length - 1] ?? '';
		if (tokenCount(last) > 1) return candidate.lines;
	}

	return original.lines;
}

/** Pad to exactly `width` columns, optionally truncating with `ellipsis`. */
export function padRight(text: string, width: number, ellipsis = ''): string {
	const clipped = truncateToWidth(text, width, ellipsis);
	return clipped + ' '.repeat(Math.max(0, width - visibleWidth(clipped)));
}

/**
 * Column widths for the header body.
 *
 * The divider sits at `DIVIDER_RATIO` of the interior, with one space on each
 * side, but the left half never grows past `MAX_LEFT_WIDTH`: ten body rows make
 * roughly 40 columns the point where the mark section reads square rather than
 * stretched. When the left half could not fit the mark or the sidebar would be
 * too narrow, the sidebar is dropped and the left half takes the whole interior.
 */
export function headerColumnWidths(innerWidth: number): {
	leftWidth: number;
	rightWidth: number;
	useTips: boolean;
} {
	if (innerWidth <= 0) {
		return { leftWidth: 0, rightWidth: 0, useTips: false };
	}

	const dividerIndex = Math.round(innerWidth * DIVIDER_RATIO);
	const leftWidth = Math.min(dividerIndex - 1, MAX_LEFT_WIDTH);
	const rightWidth = innerWidth - leftWidth - 3;

	if (leftWidth < MIN_LEFT_WIDTH || rightWidth < MIN_TIPS_WIDTH) {
		return { leftWidth: innerWidth, rightWidth: 0, useTips: false };
	}

	return { leftWidth, rightWidth, useTips: true };
}

/**
 * pi's built-in slash commands. `pi.getCommands()` returns only extension,
 * prompt and skill commands, so the built-ins are listed here to surface real
 * host commands in the tips sidebar.
 */
export const PI_BUILTIN_SLASH_COMMAND_NAMES = [
	'settings',
	'model',
	'scoped-models',
	'export',
	'import',
	'share',
	'copy',
	'name',
	'session',
	'changelog',
	'hotkeys',
	'fork',
	'clone',
	'tree',
	'trust',
	'login',
	'logout',
	'new',
	'compact',
	'resume',
	'reload',
	'quit',
] as const;

/** Host built-ins plus the commands registered in this session. */
export function collectPiCommandNames(sessionCommands: readonly { name: string }[]): string[] {
	const names = new Set<string>(PI_BUILTIN_SLASH_COMMAND_NAMES);
	for (const command of sessionCommands) {
		if (command.name) names.add(command.name);
	}
	return [...names];
}

/**
 * Pick the tip lines: always the `fixed` commands, then `count` samples from
 * the pool. Returns slash-prefixed names, e.g. `[/model, /theme]`.
 */
export function pickSlashCommandTips(
	availableNames: readonly string[],
	options: {
		fixed?: readonly string[];
		count?: number;
		exclude?: readonly string[];
		/** Injected RNG in [0, 1) for tests. */
		random?: () => number;
	} = {},
): string[] {
	const fixed = [...(options.fixed ?? [])];
	const count = options.count ?? 3;
	const exclude = new Set<string>([...(options.exclude ?? []), ...fixed]);
	const random = options.random ?? Math.random;

	const pool = [...new Set(availableNames.map((name) => name.trim()).filter(Boolean))].filter(
		(name) => !exclude.has(name),
	);

	// Partial Fisher-Yates for `count` unbiased samples.
	for (let i = pool.length - 1; i > 0; i--) {
		const j = Math.floor(random() * (i + 1));
		const tmp = pool[i]!;
		pool[i] = pool[j]!;
		pool[j] = tmp;
	}

	const picked = pool.slice(0, Math.max(0, count));
	return [...fixed, ...picked].map((name) => (name.startsWith('/') ? name : `/${name}`));
}
