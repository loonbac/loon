import assert from "node:assert/strict";
import test from "node:test";
import { formatSessionSummary } from "./session-summary.ts";

test("a session with no turns stays silent", () => {
	assert.equal(
		formatSessionSummary({
			cwd: "/home/loonbac/Proyectos/pi-custom",
			turns: 0,
			durationMs: 90_000,
			cost: 0,
			contextTokens: 0,
		}),
		"",
	);
});

test("the detail line collapses home and lists branch, turns, context and cost", () => {
	const summary = formatSessionSummary({
		cwd: "/home/loonbac/Proyectos/pi-custom",
		branch: "master",
		turns: 3,
		durationMs: 12 * 60_000 + 4_000,
		cost: 0.4261,
		contextTokens: 48_200,
	});
	const lines = summary.split("\n");
	assert.match(lines[0]!, /^✻ LOON — 12m 4s/);
	// ANSI dim codes wrap the detail line; compare the plain text between them.
	const detail = lines[1]!.replace(/\x1b\[[0-9;]*m/g, "");
	assert.equal(detail, "  ~/Proyectos/pi-custom · ⎇ master · 3 turns · ctx 48.2k · $0.43");
	assert.ok(summary.endsWith("\n"));
});

test("a single turn, no branch and no spend stay terse", () => {
	const summary = formatSessionSummary({
		cwd: "/tmp",
		turns: 1,
		durationMs: 4_500,
		cost: 0,
		contextTokens: 0,
	});
	const lines = summary.split("\n");
	assert.match(lines[0]!, /^✻ LOON — 4s/);
	const detail = lines[1]!.replace(/\x1b\[[0-9;]*m/g, "");
	assert.equal(detail, "  /tmp · 1 turn");
});

test("sub-1000 context tokens are not abbreviated", () => {
	const summary = formatSessionSummary({
		cwd: "/tmp",
		turns: 1,
		durationMs: 1_000,
		cost: 0,
		contextTokens: 812,
	});
	const detail = summary.split("\n")[1]!.replace(/\x1b\[[0-9;]*m/g, "");
	assert.match(detail, /ctx 812/);
});
