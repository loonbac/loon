import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	ACCENT_SOURCES,
	BANNER_SOURCES,
	DEFAULT_LOON_SETTINGS,
	LOON_CONFIG_FILE_NAME,
	parseLoonSettings,
	piConfigHome,
	readLoonSettings,
	writeLoonSettings,
} from '../extensions/lib/loon-config.ts';

const home = () => mkdtempSync(join(tmpdir(), 'loon-config-'));

/* S5: own persistence in pi's config home, atomic write, unreadable file =
 * defaults, no crash. */

test('a missing file means the defaults', () => {
	assert.deepEqual(readLoonSettings('/nonexistent/pi-home'), DEFAULT_LOON_SETTINGS);
	assert.deepEqual(DEFAULT_LOON_SETTINGS, { enabled: true, accent: 'banner', mark: true, source: 'loon' });
	assert.deepEqual(parseLoonSettings(undefined), DEFAULT_LOON_SETTINGS);
});

test('malformed or foreign content falls back per field', () => {
	assert.deepEqual(parseLoonSettings('{ broken'), DEFAULT_LOON_SETTINGS);
	assert.deepEqual(parseLoonSettings('[1,2,3]'), DEFAULT_LOON_SETTINGS);
	assert.deepEqual(parseLoonSettings(JSON.stringify({ enabled: false })), { enabled: false, accent: 'banner', mark: true, source: 'loon' });
	assert.deepEqual(parseLoonSettings(JSON.stringify({ mark: false })), { enabled: true, accent: 'banner', mark: false, source: 'loon' });
	// gentle-pi's menu owns `source`; anything it cannot mean is LOON's default.
	assert.deepEqual(parseLoonSettings(JSON.stringify({ source: 'rose' })), { ...DEFAULT_LOON_SETTINGS, source: 'rose' });
	assert.deepEqual(parseLoonSettings(JSON.stringify({ source: 'off' })), { ...DEFAULT_LOON_SETTINGS, source: 'off' });
	assert.deepEqual(parseLoonSettings(JSON.stringify({ source: 'nope' })), DEFAULT_LOON_SETTINGS);
	assert.equal(parseLoonSettings(JSON.stringify({ source: 7 })).source, 'loon');
	assert.deepEqual(parseLoonSettings(JSON.stringify({ mark: 'off' })), DEFAULT_LOON_SETTINGS);
	assert.deepEqual(parseLoonSettings(JSON.stringify({ accent: 'neon' })), DEFAULT_LOON_SETTINGS);
	assert.deepEqual(parseLoonSettings(JSON.stringify({ enabled: 'off', accent: 'theme', extra: 1 })), {
		enabled: true,
		accent: 'theme',
		mark: true,
		source: 'loon',
	});
});

test('what is written is what is read back', () => {
	const dir = home();
	const path = writeLoonSettings({ enabled: false, accent: 'theme', mark: false, source: 'rose' }, dir);
	assert.equal(path, join(dir, LOON_CONFIG_FILE_NAME));
	assert.deepEqual(readLoonSettings(dir), { enabled: false, accent: 'theme', mark: false, source: 'rose' });
	assert.equal(JSON.parse(readFileSync(path, 'utf8')).enabled, false);
	assert.equal(JSON.parse(readFileSync(path, 'utf8')).mark, false);
});

test('the write is atomic and leaves no temporary behind', () => {
	const dir = home();
	writeLoonSettings({ ...DEFAULT_LOON_SETTINGS, accent: 'theme' }, dir);
	writeLoonSettings({ ...DEFAULT_LOON_SETTINGS, enabled: false, mark: false }, dir);
	assert.deepEqual(readdirSync(dir), [LOON_CONFIG_FILE_NAME], 'a temporary file survived the write');
	assert.equal(statSync(join(dir, LOON_CONFIG_FILE_NAME)).mode & 0o777, 0o600);
});

test('an unreadable file is the defaults, not a crash', () => {
	const dir = home();
	const path = join(dir, LOON_CONFIG_FILE_NAME);
	writeFileSync(path, '{ broken');
	assert.deepEqual(readLoonSettings(dir), DEFAULT_LOON_SETTINGS);
});

test('the settings file lives in pi’s own config home', () => {
	assert.equal(piConfigHome({ PI_CODING_AGENT_DIR: '/tmp/agent' }, '/home/someone'), '/tmp/agent');
	assert.equal(piConfigHome({}, '/home/someone'), join('/home/someone', '.pi', 'agent'));
	assert.deepEqual([...ACCENT_SOURCES], ['theme', 'banner']);
	assert.deepEqual([...BANNER_SOURCES], ['loon', 'rose', 'off']);
});
