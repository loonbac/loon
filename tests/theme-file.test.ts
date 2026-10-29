import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	THEME_DIR_NAME,
	ensureWallpaperTheme,
	readThemeFile,
	themesDir,
} from '../extensions/lib/theme-file.ts';
import { CARD_SURFACE_CONTRAST, WALLPAPER_THEME_NAME, deriveWallpaperTheme, themeFileName } from '../extensions/lib/wallpaper-theme.ts';

const dir = () => mkdtempSync(join(tmpdir(), 'loon-themes-'));
const ACCENT: [number, number, number] = [213, 169, 240];

/* S3/S6/S7: the file, when it is written, and what is never touched. */

test('the themes directory is pi’s own agent directory plus /themes', () => {
	assert.equal(THEME_DIR_NAME, 'themes');
	assert.equal(themesDir({}, '/home/someone'), join('/home/someone', '.pi', 'agent', 'themes'));
	assert.equal(themesDir({ PI_CODING_AGENT_DIR: '/tmp/agent' }, '/home/someone'), join('/tmp/agent', 'themes'));
});

test('a missing theme is written under the name the rule fixes', () => {
	const dirPath = dir();
	const result = ensureWallpaperTheme({ accent: ACCENT, dir: dirPath });
	assert.equal(result.result, 'written');
	assert.equal(result.path, join(dirPath, themeFileName(WALLPAPER_THEME_NAME)));
	const written = JSON.parse(readFileSync(result.path, 'utf8')) as { name: string };
	assert.equal(written.name, WALLPAPER_THEME_NAME);
	assert.deepEqual(readdirSync(dirPath), [themeFileName(WALLPAPER_THEME_NAME)], 'a temporary file survived');
});

test('a fresh theme is left alone, a stale one is regenerated', () => {
	const dirPath = dir();
	const first = ensureWallpaperTheme({ accent: ACCENT, dir: dirPath });
	// Milliseconds everywhere, the unit statSync().mtimeMs reports; utimesSync takes
	// seconds, so the seconds value is derived from it.
	const accentMs = Date.now();
	const touch = (ms: number) => utimesSync(first.path, ms / 1000, ms / 1000);

	// Fresh: the theme is newer than the accent file.
	touch(accentMs + 10_000);
	assert.equal(ensureWallpaperTheme({ accent: ACCENT, dir: dirPath, accentModifiedAt: accentMs }).result, 'up-to-date');

	// Stale: the wallpaper changed after the theme was written.
	touch(accentMs - 10_000);
	assert.equal(ensureWallpaperTheme({ accent: ACCENT, dir: dirPath, accentModifiedAt: accentMs }).result, 'written');
});

test('a file whose palette rules changed is regenerated even when the accent did not', () => {
	// The accent is unchanged and the file is newer than it, so an mtime check says
	// "up to date". The palette rules are what moved - the card surfaces are placed by
	// contrast now - and a stale file would mean the new rule never reaches the screen.
	const dirPath = dir();
	const first = ensureWallpaperTheme({ accent: ACCENT, dir: dirPath });
	const stored = JSON.parse(readFileSync(first.path, 'utf8')) as { vars: Record<string, string> };
	stored.vars.toolSuccessBg = '#231D0A';
	stored.vars.toolPendingBg = '#231D0A';
	writeFileSync(first.path, JSON.stringify(stored, null, '\t') + '\n');
	const accentMs = Date.now();
	utimesSync(first.path, (accentMs + 10_000) / 1000, (accentMs + 10_000) / 1000);

	assert.equal(ensureWallpaperTheme({ accent: ACCENT, dir: dirPath, accentModifiedAt: accentMs }).result, 'written');
	const rewritten = JSON.parse(readFileSync(first.path, 'utf8')) as { vars: Record<string, string> };
	assert.equal(rewritten.vars.toolSuccessBg, deriveWallpaperTheme(ACCENT).vars.toolSuccessBg);
	assert.notEqual(rewritten.vars.toolPendingBg, '#231D0A', 'the collapsed pair came back');
	assert.ok(CARD_SURFACE_CONTRAST > 1.6);
});

test('a file that is not ours is never clobbered', () => {
	const dirPath = dir();
	mkdirSync(dirPath, { recursive: true });
	const foreign = join(dirPath, themeFileName(WALLPAPER_THEME_NAME));
	const content = JSON.stringify({ name: 'Someone else', vars: {}, colors: {} }, null, 2);
	writeFileSync(foreign, content);

	const result = ensureWallpaperTheme({ accent: ACCENT, dir: dirPath });
	assert.equal(result.result, 'skipped-foreign');
	assert.equal(readFileSync(foreign, 'utf8'), content, 'the foreign file was modified');
});

test('an unreadable theme at our own path is rewritten', () => {
	const dirPath = dir();
	mkdirSync(dirPath, { recursive: true });
	const broken = join(dirPath, themeFileName(WALLPAPER_THEME_NAME));
	writeFileSync(broken, '{ not json');
	assert.equal(ensureWallpaperTheme({ accent: ACCENT, dir: dirPath }).result, 'written');
	assert.equal((JSON.parse(readFileSync(broken, 'utf8')) as { name: string }).name, WALLPAPER_THEME_NAME);
});

test('without an accent nothing is written and nothing is invented', () => {
	const dirPath = dir();
	const result = ensureWallpaperTheme({ accent: undefined, dir: dirPath });
	assert.equal(result.result, 'skipped-no-accent');
	assert.equal(existsSync(result.path), false);
});

test('the written file is accepted by pi’s own theme loader, when reachable', async () => {
	const dirPath = dir();
	const result = ensureWallpaperTheme({ accent: ACCENT, dir: dirPath });
	let loader: { loadThemeFromPath(path: string): Promise<{ name: string; fg(role: string, text: string): string } | undefined> };
	try {
		loader = (await import(
			'/home/loonbac/.local/share/loon-pi/npm-prefix/lib/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js'
		)) as never;
	} catch {
		assert.ok(true, 'pi is not installed here; nothing to load with');
		return;
	}
	const theme = await loader.loadThemeFromPath(result.path);
	assert.ok(theme, 'pi refused the generated theme');
	if (theme) {
		assert.equal(theme.name, WALLPAPER_THEME_NAME);
		assert.match(theme.fg('accent', 'X'), /38;2;/);
	}
});

test('readThemeFile reports what is on disk', () => {
	const dirPath = dir();
	const written = ensureWallpaperTheme({ accent: ACCENT, dir: dirPath });
	const read = readThemeFile(written.path);
	assert.equal(read?.name, WALLPAPER_THEME_NAME);
	assert.equal(readThemeFile(join(dirPath, 'nope.json')), undefined);
});
