/**
 * The header body: one rounded box, the Pi mark and the tagline on the left,
 * the tips sidebar on the right, one accent divider between them.
 *
 * Pure: it takes one width and plain label strings, so the golden test can pin
 * the exact output at a fixed width.
 */
import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui';
import { TIPS_RULE_WIDTH, center, headerColumnWidths, padRight } from './layout.ts';
import { renderLogo } from './logo.ts';
import type { Palette } from './palette.ts';

/** Below this width only the version label fits. */
export const MIN_BANNER_WIDTH = 34;

export interface BannerInput {
	/** Total width, borders included. */
	width: number;
	/** Host version, shown in the top border. */
	version: string;
	/** Already formatted model label, e.g. `openai-codex/gpt-5.5`. */
	model: string;
	/** Thinking effort, e.g. `high`. */
	effort: string;
	/** Already shortened cwd. */
	cwd: string;
	/** Slash-prefixed tip commands: the restore command, then three real ones. */
	tips: readonly string[];
	palette: Palette;
}

type Paint = (text: string) => string;

/** `╭─── label ─────╮`, sized to `width`, painted as one accent run. */
function borderLine(left: string, label: string, right: string, width: number, paint: Paint): string {
	if (width <= 1) return '';
	if (width < 8 || label.length === 0) {
		return paint(truncateToWidth(left + '─'.repeat(Math.max(0, width - 2)) + right, width, ''));
	}

	const before = '─── ';
	const after = ' ─────';
	const fixedWidth = visibleWidth(before) + visibleWidth(label) + visibleWidth(after);
	const fill = Math.max(0, width - 2 - fixedWidth);
	return paint(`${left}${before}${label}${after}${'─'.repeat(fill)}${right}`);
}

/** One body row, framed by painted vertical rules. */
function boxedLine(content: string, width: number, paint: Paint): string {
	if (width <= 2) return truncateToWidth(content, width, '');
	return `${paint('│')}${padRight(content, width - 2)}${paint('│')}`;
}

/** Left half and tips sidebar side by side; tips truncate with an ellipsis. */
function twoColumn(left: string, right: string, leftWidth: number, rightWidth: number, paint: Paint): string {
	return `${padRight(left, leftWidth)} ${paint('│')} ${padRight(right, rightWidth, '…')}`;
}

/** Render the whole header, one string per terminal row. */
export function renderBanner(input: BannerInput): string[] {
	const { width, palette } = input;
	const title = `Pi v${input.version}`;

	if (width < MIN_BANNER_WIDTH) {
		return [truncateToWidth(palette.frame(title), Math.max(0, width), '')];
	}

	const innerWidth = width - 2;
	const { leftWidth, rightWidth, useTips } = headerColumnWidths(innerWidth);

	// The captured arrangement, measured from the reference: the mark starts two
	// rows below the top border (level with `Ask Pi to build it`), a blank row
	// separates it from the tagline, and the cwd closes the interior.
	const leftLines = [
		'',
		'',
		...renderLogo(palette).map((line) => center(line, leftWidth)),
		'',
		center(palette.tagline("Let's build something great"), leftWidth),
		center(palette.body(`${input.model} · ${input.effort} effort`), leftWidth),
		center(palette.subtle(input.cwd), leftWidth),
	];

	const rule = palette.divider('─'.repeat(Math.max(8, Math.min(rightWidth, TIPS_RULE_WIDTH))));
	const [tip0 = '', tip1 = '', tip2 = '', tip3 = ''] = input.tips;
	const tipLines = [
		'',
		palette.heading('Getting started'),
		palette.body('Ask Pi to build it'),
		rule,
		palette.heading('Commands'),
		palette.body(tip0),
		palette.body(tip1),
		palette.body(tip2),
		palette.body(tip3),
		'',
	];

	// Both columns carry the same number of rows; a shorter one is padded at the
	// bottom so the box never grows a ragged edge.
	const bodyRows = Math.max(leftLines.length, tipLines.length);
	const leftPadded = [
		...leftLines,
		...Array<string>(Math.max(0, bodyRows - leftLines.length)).fill(''),
	];

	const lines = [borderLine('╭', title, '╮', width, palette.frame)];
	for (let i = 0; i < bodyRows; i++) {
		const content = useTips
			? twoColumn(leftPadded[i] ?? '', tipLines[i] ?? '', leftWidth, rightWidth, palette.frame)
			: padRight(leftPadded[i] ?? '', leftWidth);
		lines.push(boxedLine(content, width, palette.frame));
	}
	lines.push(borderLine('╰', '', '╯', width, palette.frame));
	return lines.map((line) => truncateToWidth(line, width, ''));
}
