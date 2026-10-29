/**
 * The header body: one rounded box, the Pi mark and the tagline on the left,
 * the tips sidebar on the right, one accent divider between them.
 *
 * Pure: it takes one width and plain label strings, so the golden test can pin
 * the exact output at a fixed width.
 */
import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui';
import type { Density } from './gentle-config.ts';
import { center, headerColumnWidths, padRight, wrapLabel } from './layout.ts';
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
	/** gentle-pi's density; `comfortable` is the captured layout. */
	density?: Density;
	/** Draw the Pi mark. LOON's own switch, not gentle-pi's `showTextLogo`. */
	showLogo?: boolean;
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

/**
 * Centre a text line, clipping it first so a long model label keeps a blank
 * column on each side instead of sitting flush against the border.
 */
function centerClipped(text: string, width: number): string {
	if (visibleWidth(text) <= width) return center(text, width);
	return center(truncateToWidth(text, Math.max(1, width - 2), '…'), width);
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
	const density = input.density ?? 'comfortable';
	const showLogo = input.showLogo ?? true;
	const modelLabel = `${input.model} · ${input.effort} effort`;

	// minimal: one content row, no mark, no tagline, no cwd, no sidebar.
	if (density === 'minimal') {
		return [
			borderLine('╭', title, '╮', width, palette.frame),
			boxedLine(centerClipped(palette.body(modelLabel), innerWidth), width, palette.frame),
			borderLine('╰', '', '╯', width, palette.frame),
		].map((line) => truncateToWidth(line, width, ''));
	}

	const { leftWidth, rightWidth, useTips } = headerColumnWidths(innerWidth);

	// The captured arrangement, measured from the reference: the mark starts two
	// rows below the top border (level with `Ask Pi to build it`), a blank row
	// separates it from the tagline, and the cwd closes the interior.
	// A model id is long enough to overrun the half; it wraps instead of losing
	// its tail to an ellipsis, and the box grows to whatever the wrap needs.
	const modelLines = wrapLabel(modelLabel, Math.max(1, leftWidth - 2)).map((line) =>
		centerClipped(palette.body(line), leftWidth),
	);
	const mark = showLogo ? renderLogo(palette).map((line) => center(line, leftWidth)) : [];
	// comfortable keeps the captured rhythm: two blank rows, the mark, a blank row,
	// the tagline. compact drops the blank row above the mark and the tagline.
	const leftLines = density === 'compact'
		? [...mark, ...modelLines, centerClipped(palette.subtle(input.cwd), leftWidth)]
		: [
			'',
			'',
			...mark,
			'',
			centerClipped(palette.tagline("Let's build something great"), leftWidth),
			...modelLines,
			centerClipped(palette.subtle(input.cwd), leftWidth),
		];

	// The rule spans the sidebar, like the capture: a fixed 22 would look broken
	// in a 43-column column. One column stays blank so it never touches the border.
	const rule = palette.divider('─'.repeat(Math.max(8, rightWidth - 1)));
	const [tip0 = '', tip1 = '', tip2 = '', tip3 = ''] = input.tips;
	const tipBody = [
		palette.body(tip0),
		palette.body(tip1),
		palette.body(tip2),
		palette.body(tip3),
	];
	// compact drops the short rule and the blank rows around the sidebar block.
	const tipLines = density === 'compact'
		? [
			palette.heading('Getting started'),
			palette.body('Ask Pi to build it'),
			palette.heading('Commands'),
			...tipBody,
		]
		: [
			'',
			palette.heading('Getting started'),
			palette.body('Ask Pi to build it'),
			rule,
			palette.heading('Commands'),
			...tipBody,
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
