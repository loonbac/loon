/**
 * The static Pi mark: a block-letter P and i drawn on a 4 x 4 grid of three-
 * column cells, in one colour of the active theme.
 *
 * The grid is data, not geometry, so changing the glyph is a one-line edit.
 * It reproduces the captured mark: the P's top bar and bowl on the left, the
 * i as a single column that starts one row down.
 */
import type { Palette } from './palette.ts';

/** One filled cell: three block characters. */
export const LOGO_CELL = '███';

/**
 * The mark, one string per row; `#` is a filled cell and `.` an empty one.
 *
 * ```
 * ###.
 * #.#.
 * ##.#
 * #..#
 * ```
 *
 * Row 0 is the P's top bar, row 1 its counter, row 2 the bowl closing with the
 * top of the i, row 3 the stem with the i's body.
 */
export const LOGO_GRID: readonly string[] = ['###.', '#.#.', '##.#', '#..#'];

/** Width of the mark in terminal columns. */
export const LOGO_WIDTH = Math.max(...LOGO_GRID.map((row) => row.length)) * LOGO_CELL.length;

/**
 * Render the mark: one line per grid row, all cells in the same theme role.
 *
 * Every row is exactly `LOGO_WIDTH` columns wide, trailing blanks included, so
 * the block centres as one rectangle and its left edge stays straight. Trimming
 * a row would centre that row on its own ink and stagger the glyph.
 */
export function renderLogo(palette: Palette): string[] {
	const painted = palette.logo(LOGO_CELL);
	const blank = ' '.repeat(LOGO_CELL.length);
	return LOGO_GRID.map((row) => [...row].map((cell) => (cell === '#' ? painted : blank)).join(''));
}
