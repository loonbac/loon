/**
 * The banner body: a boxed two-column header, rendered from a palette.
 *
 * Pure: it takes one width, one frame index and plain label strings, so the
 * golden test can pin the exact output at a fixed width.
 */
import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui';
import { center, headerColumnWidths, padRight } from './layout.ts';
import { logoFrameLines } from './logo.ts';
import type { Palette } from './palette.ts';

/** Below this width only the version label fits. */
export const MIN_BANNER_WIDTH = 24;

export interface BannerInput {
	/** Total width, borders included. */
	width: number;
	/** Logo animation frame index; wraps around `LOGO_FRAME_COUNT`. */
	frame: number;
	/** Host version, shown next to the LOON wordmark. */
	version: string;
	/** Already formatted model label, e.g. `anthropic/claude`. */
	model: string;
	/** Thinking effort, e.g. `high`. */
	effort: string;
	/** Already shortened cwd. */
	cwd: string;
	/** Slash-prefixed tip commands. */
	tips: readonly string[];
	palette: Palette;
}

type Paint = (text: string) => string;

/** `╭─── label ─────╮`, sized to `width`. */
function borderLine(left: string, label: string, right: string, width: number, paint: Paint): string {
	if (width <= 1) return '';
	if (width < 8 || label.length === 0) {
		return paint(truncateToWidth(left + '─'.repeat(Math.max(0, width - 2)) + right, width, ''));
	}

	const before = '─── ';
	const after = ' ─────';
	const fixedWidth = visibleWidth(before) + visibleWidth(label) + visibleWidth(after);
	const fill = Math.max(0, width - 2 - fixedWidth);
	return `${paint(left)}${paint(before)}${label}${paint(after)}${paint('─'.repeat(fill))}${paint(right)}`;
}

/** One body row, framed by painted vertical rules. */
function boxedLine(content: string, width: number, paint: Paint): string {
	if (width <= 2) return truncateToWidth(content, width, '');
	return `${paint('│')}${padRight(content, width - 2)}${paint('│')}`;
}

/** The logo half and the tips sidebar side by side; tips truncate with an ellipsis. */
function twoColumn(left: string, right: string, leftWidth: number, rightWidth: number, paint: Paint): string {
	return `${padRight(left, leftWidth)} ${paint('│')} ${padRight(right, rightWidth, '…')}`;
}

/** Render the whole banner, one string per terminal row. */
export function renderBanner(input: BannerInput): string[] {
	const { width, palette } = input;

	if (width < MIN_BANNER_WIDTH) {
		return [truncateToWidth(`${palette.label('LOON')} Pi v${input.version}`, Math.max(0, width), '')];
	}

	const innerWidth = width - 2;
	const { leftWidth, rightWidth, useTips } = headerColumnWidths(innerWidth);

	const leftLines = [
		...logoFrameLines(input.frame, palette).map((line) => center(line, leftWidth)),
		center(palette.label('Let’s build something great'), leftWidth),
		center(palette.body(`${input.model} · ${input.effort} effort`), leftWidth),
		center(palette.subtle(input.cwd), leftWidth),
	];

	const tipDivider = palette.divider('─'.repeat(Math.max(8, Math.min(rightWidth, 22))));
	const [tip0 = '', tip1 = '', tip2 = '', tip3 = ''] = input.tips;
	const tipLines = [
		'',
		palette.label('Getting started'),
		palette.body('Ask Pi to build it'),
		tipDivider,
		palette.label('Commands'),
		palette.body(tip0),
		palette.body(tip1),
		palette.body(tip2),
		palette.body(tip3),
		'',
	];

	const title = `${palette.label('LOON')} Pi v${input.version}`;
	const lines = [borderLine('╭', title, '╮', width, palette.frame)];
	for (let i = 0; i < leftLines.length; i++) {
		const content = useTips
			? twoColumn(leftLines[i] ?? '', tipLines[i] ?? '', leftWidth, rightWidth, palette.frame)
			: padRight(leftLines[i] ?? '', leftWidth);
		lines.push(boxedLine(content, width, palette.frame));
	}
	lines.push(borderLine('╰', '', '╯', width, palette.frame));
	return lines.map((line) => truncateToWidth(line, width, ''));
}
