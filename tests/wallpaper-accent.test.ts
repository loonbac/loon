import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ACCENT_RGB, accentPainter, parseHexColor, rgbPainter } from '../extensions/lib/accent.ts';
import { readWallpaperAccent, wallpaperAccentPath, WALLPAPER_ACCENT_FILE } from '../extensions/lib/wallpaper-accent.ts';

const home = () => mkdtempSync(join(tmpdir(), 'loon-wallpaper-'));

/* S5: the hex parser accepts what the wallpaper script writes and nothing else. */

test('a measured accent file parses to its three channels', () => {
	// The real file: one line, uppercase, trailing newline.
	assert.deepEqual(parseHexColor('#9B484A\n'), [155, 72, 74]);
	assert.deepEqual(parseHexColor('  9b484a  '), [155, 72, 74], 'lowercase and bare hex are the same colour');
	assert.deepEqual(parseHexColor('#000000'), [0, 0, 0], 'black is a colour, not an error');
});

test('anything that is not six hex digits is rejected', () => {
	for (const value of ['', '   ', '#9B484', '#9B484AB', 'zzz', '#9B484A extra', undefined, null]) {
		assert.equal(parseHexColor(value as string | undefined), undefined, JSON.stringify(value));
	}
});

test('the painter is generalised over an RGB triple, and accentPainter is a thin wrapper', () => {
	assert.equal(rgbPainter([155, 72, 74])('X'), '\x1b[38;2;155;72;74mX\x1b[39m');
	assert.equal(rgbPainter([155, 72, 74])(''), '', 'an empty run emits nothing');
	for (const colour of ['pink', 'cyan', 'yellow', 'green'] as const) {
		assert.equal(accentPainter(colour)('X'), rgbPainter(ACCENT_RGB[colour])('X'), colour);
	}
});

/* S2/S5: the reader, and its tolerance. */

test('the wallpaper accent is read from the measured path', () => {
	assert.equal(WALLPAPER_ACCENT_FILE, 'accent.txt');
	assert.match(wallpaperAccentPath('/home/someone'), /\/home\/someone\/\.config\/mpvpaper\/accent\.txt$/);

	const dir = home();
	const file = join(dir, 'accent.txt');
	writeFileSync(file, '#9B484A\n');
	assert.deepEqual(readWallpaperAccent(file), [155, 72, 74]);

	writeFileSync(file, '#1E90FF\n');
	assert.deepEqual(readWallpaperAccent(file), [30, 144, 255], 'a new wallpaper is picked up');
});

test('a missing, malformed or unreadable file is undefined, never a colour', () => {
	const dir = home();
	assert.equal(readWallpaperAccent(join(dir, 'nope.txt')), undefined, 'missing');
	const broken = join(dir, 'broken.txt');
	writeFileSync(broken, 'not a colour\n');
	assert.equal(readWallpaperAccent(broken), undefined, 'malformed');
	writeFileSync(broken, '');
	assert.equal(readWallpaperAccent(broken), undefined, 'empty');
	assert.equal(readWallpaperAccent(dir), undefined, 'a directory is not a colour file');
});

test('an atomic replace is noticed by watching the directory', async () => {
	// S2: accent.txt is written with os.replace(), so its inode changes on every
	// wallpaper. A watch on the file dies; the directory watch keeps reporting.
	const dir = home();
	const file = join(dir, 'accent.txt');
	writeFileSync(file, '#9B484A\n');
	const { watchConfigDirs } = await import('../extensions/lib/config-watch.ts');
	let changes = 0;
	const dispose = watchConfigDirs([dir], () => {
		changes += 1;
	}, { debounceMs: 20 });
	try {
		writeFileSync(join(dir, '.accent.txt.tmp'), '#1E90FF\n');
		renameSync(join(dir, '.accent.txt.tmp'), file);
		await new Promise((resolve) => setTimeout(resolve, 400));
		assert.ok(changes >= 1, 'a rename over the watched directory was not reported');
		assert.deepEqual(readWallpaperAccent(file), [30, 144, 255], 'the new colour is readable');
	} finally {
		dispose();
		rmSync(dir, { recursive: true, force: true });
	}
});
