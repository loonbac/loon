/**
 * The animated logo, ported from pi-claude-code-tui (MIT, see NOTICE).
 *
 * The frame table, the cell-coordinate helpers and the per-cell colour rules
 * are upstream's. The only change is that a cell asks the palette for its
 * colour instead of writing an SGR sequence, so the logo follows the theme.
 */
import type { LogoCellColor, PaintedLogoCellColor, Palette } from './palette.ts';

/** One logo cell: three block characters, drawn in a single colour. */
export const LOGO_CELL = '███';

/** Upstream animation cadence. */
export const LOGO_ANIMATION_INTERVAL_MS = 120;

interface LogoFrame {
	phase: number;
	active: 'left' | 'top' | 'right' | 'none';
	ax: number;
	ay: number;
	flash: boolean;
	white: boolean;
}

/** The 22 frames of the logo animation: four strokes, the mark, then the flashes. */
export const LOGO_FRAMES: readonly LogoFrame[] = [
	...Array.from({ length: 4 }, (_, ay) => ({ phase: 0, active: 'left' as const, ax: 2, ay, flash: false, white: false })),
	...Array.from({ length: 3 }, (_, ay) => ({ phase: 1, active: 'top' as const, ax: 2, ay, flash: false, white: false })),
	...Array.from({ length: 5 }, (_, ay) => ({ phase: 2, active: 'right' as const, ax: 5, ay, flash: false, white: false })),
	{ phase: 3, active: 'none', ax: 0, ay: 0, flash: false, white: false },
	{ phase: 3, active: 'none', ax: 0, ay: 0, flash: true, white: false },
	{ phase: 3, active: 'none', ax: 0, ay: 0, flash: false, white: false },
	{ phase: 3, active: 'none', ax: 0, ay: 0, flash: true, white: false },
	{ phase: 4, active: 'none', ax: 0, ay: 0, flash: false, white: false },
	{ phase: 5, active: 'none', ax: 0, ay: 0, flash: false, white: false },
	{ phase: 5, active: 'none', ax: 0, ay: 0, flash: false, white: true },
	{ phase: 5, active: 'none', ax: 0, ay: 0, flash: false, white: false },
	{ phase: 5, active: 'none', ax: 0, ay: 0, flash: false, white: true },
	{ phase: 6, active: 'none', ax: 0, ay: 0, flash: false, white: false },
];

export const LOGO_FRAME_COUNT = LOGO_FRAMES.length;

/** Paint one cell: a colour of the theme, or blank space for the panel. */
export function paintLogoCell(color: LogoCellColor, palette: Palette): string {
	if (color === 'panel') return ' '.repeat(LOGO_CELL.length);
	return palette.logoCell(color, LOGO_CELL);
}

function hasCell(y: number, x: number, cells: string): boolean {
	return cells.split(' ').includes(`${y},${x}`);
}

function hasPiece(y: number, x: number, py: number, px: number, cells: string): boolean {
	return cells.split(' ').some((item) => {
		const [dy, dx] = item.split(',').map(Number);
		return y === py + dy && x === px + dx;
	});
}

/** Upstream colour rules for one cell of one frame. */
function logoCellColor(frame: LogoFrame, y: number, x: number): LogoCellColor {
	if (frame.white) {
		return hasCell(y, x, '3,2 3,3 3,4 4,2 4,4 5,2 5,3 5,5 6,2 6,5') ? 'white' : 'panel';
	}
	if (frame.flash && y === 6 && x >= 1 && x <= 6) return 'flash';

	switch (frame.active) {
		case 'left':
			if (hasPiece(y, x, frame.ay, frame.ax, '0,0 1,0 1,1 2,0')) return 'red';
			break;
		case 'top':
			if (hasPiece(y, x, frame.ay, frame.ax, '0,0 0,1 0,2 1,2')) return 'cyan';
			break;
		case 'right':
			if (hasPiece(y, x, frame.ay, frame.ax, '0,0 1,0 2,0 2,1')) return 'green';
			break;
	}

	if (frame.phase === 6) {
		return hasCell(y, x, '3,2 3,3 3,4 4,4 4,2 5,2 5,3 5,5 6,2 6,5') ? 'brand' : 'panel';
	}

	if (frame.phase === 4) {
		if (hasCell(y, x, '2,2 2,3 2,4 3,4')) return 'cyan';
		if (hasCell(y, x, '3,2 4,2 4,3 5,2')) return 'red';
		if (hasCell(y, x, '4,5 5,5')) return 'green';
		return 'panel';
	}

	if (frame.phase >= 5) {
		if (hasCell(y, x, '3,2 3,3 3,4 4,4')) return 'cyan';
		if (hasCell(y, x, '4,2 5,2 5,3 6,2')) return 'red';
		if (hasCell(y, x, '5,5 6,5')) return 'green';
		return 'panel';
	}

	if (frame.phase <= 3 && hasCell(y, x, '6,1 6,2 6,3 6,4')) return 'orange';
	if (frame.phase >= 2 && hasCell(y, x, '2,2 2,3 2,4 3,4')) return 'cyan';
	if (frame.phase >= 1 && hasCell(y, x, '3,2 4,2 4,3 5,2')) return 'red';
	if (frame.phase >= 3 && hasCell(y, x, '4,5 5,5 6,5 6,6')) return 'green';
	return 'panel';
}

/**
 * Render one animation frame as seven rows of painted cells.
 *
 * The 9-row install canvas is cropped to rows 1-7 for a compact header, then
 * tight-cropped horizontally so the mark centers cleanly in the logo half.
 */
export function logoFrameLines(frameIndex: number, palette: Palette): string[] {
	const frame = LOGO_FRAMES[frameIndex % LOGO_FRAMES.length]!;
	const grid: LogoCellColor[][] = [];
	for (let y = 1; y <= 7; y++) {
		const row: LogoCellColor[] = [];
		for (let x = 1; x <= 8; x++) row.push(logoCellColor(frame, y, x));
		grid.push(row);
	}

	let minX = 7;
	let maxX = 0;
	for (const row of grid) {
		row.forEach((cell, x) => {
			if (cell !== 'panel') {
				minX = Math.min(minX, x);
				maxX = Math.max(maxX, x);
			}
		});
	}
	if (maxX < minX) {
		minX = 0;
		maxX = 7;
	}

	return grid.map((row) => {
		let line = '';
		for (let x = minX; x <= maxX; x++) line += paintLogoCell(row[x]!, palette);
		return line;
	});
}
