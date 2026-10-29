/**
 * Layout and text helpers for the banner, ported from pi-claude-code-tui
 * (MIT, see NOTICE). Upstream's working-verb list is not ported: the LOON
 * feature is the startup banner only.
 */
import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui';

/** Narrowest left column that still fits the animated logo (8x3 cells). */
export const MIN_LEFT_WIDTH = 28;
/** Narrowest tips sidebar; below this, tips are hidden. */
export const MIN_TIPS_WIDTH = 16;
/** Cap tips so they never steal the logo half on wide terminals. */
export const MAX_TIPS_WIDTH = 28;
/** ` space + divider + space ` between the two columns. */
const COLUMN_GAP = 3;

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

/** Pad to exactly `width` columns, optionally truncating with `ellipsis`. */
export function padRight(text: string, width: number, ellipsis = ''): string {
	const clipped = truncateToWidth(text, width, ellipsis);
	return clipped + ' '.repeat(Math.max(0, width - visibleWidth(clipped)));
}

/**
 * Column widths for the banner body.
 *
 * The tips sidebar takes about 28% of the inner width, clamped so the logo
 * half stays the wider one; when both cannot fit, tips are dropped and the
 * logo half takes everything.
 */
export function headerColumnWidths(
	innerWidth: number,
	minTipsWidth = MIN_TIPS_WIDTH,
	maxTipsWidth = MAX_TIPS_WIDTH,
	minLeftWidth = MIN_LEFT_WIDTH,
): { leftWidth: number; rightWidth: number; useTips: boolean } {
	if (innerWidth <= 0) {
		return { leftWidth: 0, rightWidth: 0, useTips: false };
	}

	if (innerWidth < minLeftWidth + COLUMN_GAP + minTipsWidth) {
		return { leftWidth: innerWidth, rightWidth: 0, useTips: false };
	}

	let rightWidth = Math.min(maxTipsWidth, Math.max(minTipsWidth, Math.round(innerWidth * 0.28)));
	let leftWidth = innerWidth - COLUMN_GAP - rightWidth;

	if (leftWidth < minLeftWidth) {
		leftWidth = minLeftWidth;
		rightWidth = innerWidth - COLUMN_GAP - leftWidth;
	}

	if (leftWidth <= rightWidth) {
		leftWidth = Math.ceil((innerWidth - COLUMN_GAP) * 0.65);
		rightWidth = innerWidth - COLUMN_GAP - leftWidth;
	}

	if (rightWidth < minTipsWidth || leftWidth < minLeftWidth) {
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
 * the pool. Returns slash-prefixed names, e.g. `[loon:default, /model]`.
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
