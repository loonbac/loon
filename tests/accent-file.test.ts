/**
 * Where the accent comes from, on a machine that is not this one.
 *
 * The accent used to have exactly one source: `~/.config/mpvpaper/accent.txt`, written
 * by the wallpaper script running on the owner's desktop. Every other person's colour
 * lives somewhere else — a pywal cache, a matugen output, a hand-written line — and no
 * integration per tool is worth writing for a file that holds one `#RRGGBB` line.
 *
 * So the rule is a path, and the path has to behave like the rest of LOON's own
 * settings: tolerant. A relative path, a missing file and an unreadable one all resolve
 * to "no accent from here", which falls back to the theme, never to a crash and never to
 * a silent black.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
	ACCENT_SOURCES,
	DEFAULT_LOON_SETTINGS,
	parseLoonSettings,
	piAgentHome,
	defaultAccentFile,
} from '../extensions/lib/loon-config.ts';
import { accentPath, readAccentFrom } from '../extensions/lib/wallpaper-accent.ts';

const HOME = '/home/someone';

test('the accent file is a setting, and its default needs no configuration', () => {
	assert.ok((ACCENT_SOURCES as readonly string[]).includes('file'));
	// The rule is a pure function of the home; the exported default is that function's
	// answer for this process, computed once at import. Both are asserted, because a
	// settings file and the constant disagreeing is how a reader sees two accents.
	assert.equal(
		defaultAccentFile({}, HOME),
		join(HOME, '.pi', 'agent', 'state', 'loon-accent.txt'),
		'the default lives under pi\'s agent home, so nobody has to invent a path',
	);
	assert.equal(
		parseLoonSettings(undefined).accentFile,
		DEFAULT_LOON_SETTINGS.accentFile,
		'the parsed fallback and the exported default must be the same value',
	);
});

test('an absolute accentFile is honoured and a relative one is refused', () => {
	const absolute = '/mnt/data/pywal/color';
	assert.equal(parseLoonSettings(JSON.stringify({ accentFile: absolute })).accentFile, absolute);
	assert.equal(
		parseLoonSettings(JSON.stringify({ accentFile: 'pywal/color' })).accentFile,
		defaultAccentFile(),
		'a relative path is resolved against an unknown cwd, so it is not a path at all',
	);
});

test('a non-string accentFile falls back instead of throwing', () => {
	for (const bad of [null, 7, {}, [], true]) {
		const settings = parseLoonSettings(JSON.stringify({ accentFile: bad }));
		assert.equal(settings.accentFile, defaultAccentFile(), JSON.stringify(bad));
	}
});

test('the accent file respects pi\'s own agent home, so a moved install still resolves', () => {
	assert.equal(piAgentHome({ PI_CODING_AGENT_DIR: '/tmp/pihome' }, HOME), '/tmp/pihome');
	assert.equal(piAgentHome({ GENTLE_PI_AGENT_HOME: '/tmp/gh' }, HOME), '/tmp/gh');
	assert.equal(piAgentHome({}, HOME), join(HOME, '.pi', 'agent'));
});

test('reading the accent from a configured file works, and every failure is just undefined', () => {
	const dir = mkdtempSync(join(tmpdir(), 'loon-accent-'));
	const good = join(dir, 'accent.txt');
	writeFileSync(good, '#58a6ff\n');
	assert.deepEqual(readAccentFrom(good), [0x58, 0xa6, 0xff], 'a one-line #RRGGBB is the whole format');

	assert.equal(readAccentFrom(join(dir, 'nope.txt')), undefined, 'missing file');
	assert.equal(readAccentFrom(undefined), undefined, 'no path at all');
	writeFileSync(join(dir, 'junk.txt'), 'not a colour\n');
	assert.equal(readAccentFrom(join(dir, 'junk.txt')), undefined, 'unparsable content');
	const nested = join(dir, 'sub', 'x.txt');
	assert.equal(readAccentFrom(nested), undefined, 'missing directory');
	assert.doesNotThrow(() => readAccentFrom(nested));
});

test('accentPath answers with the configured file only for the file source', () => {
	const settings = { ...parseLoonSettings(undefined), accent: 'file' as const, accentFile: '/mnt/a.txt' };
	assert.equal(accentPath(settings), '/mnt/a.txt');

	const wp = { ...settings, accent: 'wallpaper' as const };
	assert.match(String(accentPath(wp)), /mpvpaper/, 'the wallpaper source keeps its historical path');
});

test('the settings file still round-trips a file accent', () => {
	const settings = { ...DEFAULT_LOON_SETTINGS, accent: 'file' as const, accentFile: '/mnt/a.txt' };
	assert.deepEqual(parseLoonSettings(JSON.stringify(settings)), settings);
});
