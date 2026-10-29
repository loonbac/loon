/**
 * The static Pi mark: a block-letter P and i drawn on a 10 x 7 grid of three-
 * column cells, in one colour of the active theme.
 *
 * The grid is data, not geometry, so changing the glyph is a one-line edit.
 */
import type { Palette } from './palette.ts';

/** One filled cell: three block characters. */
export const LOGO_CELL = '███';

/**
 * The mark, one string per row; `#` is a filled cell and `.` an empty one.
 *
 * ```
 * #####  ###
 * #   #
 * #   #  ###
 * #####  ###
 * #      ###
 * #      ###
 * #      ###
 * ```
 */
export const LOGO_GRID: readonly string[] = [
	'#####..###',
	'#...#.....',
	'#...#..###',
	'#####..###',
	'#......###',
	'#......###',
	'#......###',
];

/** Width of the mark in terminal columns. */
export const LOGO_WIDTH = Math.max(...LOGO_GRID.map((row) => row.length)) * LOGO_CELL.length;

/** Render the mark: one line per grid row, all cells in the same theme role. */
export function renderLogo(palette: Palette): string[] {
	const painted = palette.logo(LOGO_CELL);
	const blank = ' '.repeat(LOGO_CELL.length);
	return LOGO_GRID.map((row) =>
		[...row].map((cell) => (cell === '#' ? painted : blank)).join(''),
	);
}
