import assert from "node:assert/strict";
import test from "node:test";
import { formatExitBanner, PLAIN_PAINT } from "./session-summary.ts";
import { PI_LOGO, PI_LOGO_WIDTH } from "./pi-logo.ts";

/** Column where the text starts: widest logo row plus the gap. */
const INFO_COLUMN = PI_LOGO_WIDTH + 3;

const sample = {
	cwd: "/home/loonbac/Proyectos/pi-custom",
	branch: "master",
	turns: 1,
	durationMs: 35_000,
	cost: 0,
	contextTokens: 11_700,
};

function banner(data = sample, paint = PLAIN_PAINT): string[] {
	return formatExitBanner(data, paint).split("\n");
}

/** The text of a banner row, with the mark and its gap removed. */
function infoAt(lines: string[], row: number): string {
	return lines[row]!.slice(INFO_COLUMN);
}

test("a session with no turns stays silent", () => {
	assert.equal(formatExitBanner({ ...sample, turns: 0 }, PLAIN_PAINT), "");
});

test("the banner is the six-row mark, then a blank spacer line", () => {
	const lines = banner();
	// Rows without a fact carry the bare mark; row 6 separates banner from the
	// resume line pi prints underneath.
	for (const row of [0, 2, 5]) assert.equal(lines[row], PI_LOGO[row]!.trimEnd());
	assert.equal(lines[6], "");
	assert.equal(lines.length, 8); // six rows + spacer + trailing empty from the newline
});

test("the totals sit in one column beside the mark", () => {
	const lines = banner();
	// Rows 0-5 are pure mark; the heading starts one row below the top and the
	// remaining two facts follow it.
	for (const row of [0, 1, 2, 3, 4, 5]) assert.ok(lines[row]!.startsWith("█"), `row ${row}`);
	assert.equal(infoAt(lines, 1), "✻ LOON — 35s");
	assert.equal(infoAt(lines, 3), "~/Proyectos/pi-custom ⎇ master");
	assert.equal(infoAt(lines, 4), "1 turn · ctx 11.7k");
});

test("the gap is padding, so the text column lands past the widest row", () => {
	const lines = banner();
	for (const row of [1, 3, 4]) {
		// Everything before the text column is mark plus spaces — nothing else.
		assert.equal(lines[row]!.slice(0, INFO_COLUMN).trimEnd(), PI_LOGO[row]!.trimEnd());
	}
	// Row 0 is the widest mark, and it carries no text.
	assert.equal(PI_LOGO_WIDTH, 14);
});

test("cost appears only when there was spend", () => {
	assert.equal(infoAt(banner({ ...sample, cost: 0.4261 }), 4), "1 turn · ctx 11.7k · $0.43");
	assert.doesNotMatch(formatExitBanner(sample, PLAIN_PAINT), /\$\d/);
});

test("a missing branch leaves just the collapsed path", () => {
	assert.equal(infoAt(banner({ ...sample, branch: undefined }), 3), "~/Proyectos/pi-custom");
});

test("turns are counted in the plural form", () => {
	assert.match(formatExitBanner({ ...sample, turns: 4 }, PLAIN_PAINT), /4 turns/);
});

test("painters wrap only the mark and the text, never the gap", () => {
	const lines = formatExitBanner(
		sample,
		{ accent: (t) => `<a>${t}</a>`, dim: (t) => `<d>${t}</d>` },
	).split("\n");
	assert.equal(lines[0], `<a>${PI_LOGO[0]!.trimEnd()}</a>`);
	assert.match(lines[1]!, /<d>✻ LOON — 35s<\/d>$/);
	assert.doesNotMatch(lines[2]!, /<d>/);
});

test("sub-1000 context tokens are not abbreviated", () => {
	assert.equal(infoAt(banner({ ...sample, contextTokens: 812 }), 4), "1 turn · ctx 812");
});