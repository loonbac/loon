// pi brand mark — the geometric P+i logo (pi.dev/logo-auto.svg), 6-row grid.
//
// Lives alone, with no imports, so both the startup banner and the exit recap
// can paint it without pulling `@earendil-works/pi-tui` into a module that
// stays testable under `node --experimental-strip-types`. Every glyph is a
// full block or a space, so `.length` is the display width of every row.
export const PI_LOGO: readonly string[] = [
	"██████████    ",
	"████  ████    ",
	"████  ████    ",
	"████████  ████",
	"████      ████",
	"████      ████",
];

/** Display width of the widest logo row, i.e. the column its art ends at. */
export const PI_LOGO_WIDTH = PI_LOGO.reduce((w, row) => Math.max(w, row.length), 0);
