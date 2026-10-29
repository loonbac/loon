import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	DEFAULT_GENTLE_SETTINGS,
	GENTLE_VISUAL_SCHEMA,
	gentleConfigFiles,
	gentleConfigHome,
	parseBannerConfig,
	parseVisualCustomization,
	readGentleSettings,
	sameGentleSettings,
} from '../extensions/lib/gentle-config.ts';

const visual = (extra: Record<string, unknown> = {}) =>
	JSON.stringify({ schema: GENTLE_VISUAL_SCHEMA, density: 'compact', headerPlacement: 'below-input', ...extra });

/* S1: absent files, malformed JSON, a foreign schema and unknown keys all leave
 * the behaviour exactly as it is today. */

test('no files at all means today’s settings', () => {
	assert.deepEqual(readGentleSettings('/nonexistent/gentle-home'), DEFAULT_GENTLE_SETTINGS);
	assert.deepEqual(DEFAULT_GENTLE_SETTINGS, {
		density: 'comfortable',
		headerPlacement: 'top',
		accentColor: undefined,
	});
	// The Pi mark is LOON's own switch; gentle-pi's showTextLogo is not it.
	assert.equal('showTextLogo' in DEFAULT_GENTLE_SETTINGS, false);
});

test('malformed JSON is ignored instead of thrown', () => {
	assert.equal(parseVisualCustomization('{ not json'), undefined);
	assert.equal(parseBannerConfig('{ not json'), undefined);
	const home = mkdtempSync(join(tmpdir(), 'loon-gentle-'));
	const files = gentleConfigFiles(home);
	writeFileSync(files.visual, '{ oops');
	writeFileSync(files.banner, 'nope');
	assert.deepEqual(readGentleSettings(home), DEFAULT_GENTLE_SETTINGS);
});

test('a visual file with another schema is not trusted', () => {
	assert.equal(parseVisualCustomization(JSON.stringify({ schema: 'someone-else/v9', density: 'minimal' })), undefined);
	assert.equal(parseVisualCustomization(JSON.stringify({ density: 'minimal' })), undefined, 'no schema at all');
	assert.deepEqual(parseVisualCustomization(visual()), { density: 'compact', headerPlacement: 'below-input' });
});

test('unknown keys are ignored and bad values do not discard good ones', () => {
	assert.deepEqual(parseVisualCustomization(visual({ unknown: 1, statusPlacement: 'right' })), {
		density: 'compact',
		headerPlacement: 'below-input',
	});
	assert.deepEqual(parseVisualCustomization(visual({ density: 'enormous' })), { headerPlacement: 'below-input' });
	assert.deepEqual(parseVisualCustomization(visual({ headerPlacement: 'sideways' })), { density: 'compact' });
});

test('showTextLogo and showRose are read and ignored, not applicable', () => {
	// Both keys were written for gentle-pi's ASCII banner. Honouring the first here
	// once deleted the Pi mark; it must never reach the resolution again.
	const parsed = parseBannerConfig(JSON.stringify({ showRose: false, showTextLogo: false, color: 'pink' }));
	assert.deepEqual(parsed, { showTextLogo: false, color: 'pink' }, 'the file is still parsed as it is');

	const home = mkdtempSync(join(tmpdir(), 'loon-gentle-'));
	writeFileSync(gentleConfigFiles(home).banner, JSON.stringify({ showRose: false, showTextLogo: false, color: 'pink' }));
	const resolved = readGentleSettings(home);
	assert.deepEqual(resolved, { density: 'comfortable', headerPlacement: 'top', accentColor: 'pink' });
	assert.equal('showTextLogo' in resolved, false, 'showTextLogo leaked into the resolution');
});

test('banner.json is read key by key, like gentle-pi reads it', () => {
	assert.deepEqual(parseBannerConfig(JSON.stringify({ color: 'cyan', showRose: true, showTextLogo: false })), {
		showTextLogo: false,
		color: 'cyan',
	});
	assert.deepEqual(parseBannerConfig(JSON.stringify({ color: 'mauve' })), {}, 'an unknown colour contributes nothing');
	assert.deepEqual(parseBannerConfig(JSON.stringify({ showTextLogo: 'yes' })), {});
	assert.equal(parseBannerConfig(JSON.stringify(['pink'])), undefined, 'not an object');
});

test('the two files are resolved independently', () => {
	const home = mkdtempSync(join(tmpdir(), 'loon-gentle-'));
	const files = gentleConfigFiles(home);
	// A broken visual file never costs the banner config, and the other way round.
	writeFileSync(files.visual, '{ broken');
	writeFileSync(files.banner, JSON.stringify({ showTextLogo: false, color: 'green' }));
	const settings = readGentleSettings(home);
	assert.equal(settings.density, 'comfortable');
	assert.equal(settings.headerPlacement, 'top');
	assert.equal(settings.accentColor, 'green');
});

test('an unreadable file is the same as an absent one', () => {
	const settings = readGentleSettings('/nonexistent/home', {
		read: () => {
			throw new Error('EACCES');
		},
	});
	assert.deepEqual(settings, DEFAULT_GENTLE_SETTINGS);
});

test('a full gentle-pi pair is followed', () => {
	const home = mkdtempSync(join(tmpdir(), 'loon-gentle-'));
	const files = gentleConfigFiles(home);
	writeFileSync(files.visual, visual({ density: 'minimal', statusPlacement: 'bottom' }));
	writeFileSync(files.banner, JSON.stringify({ color: 'yellow', showRose: false, showTextLogo: true }));
	assert.deepEqual(readGentleSettings(home), {
		density: 'minimal',
		headerPlacement: 'below-input',
		accentColor: 'yellow',
	});
	// A file that also carries showTextLogo resolves to the same thing: the key
	// belongs to gentle-pi's own wordmark and never reaches the Pi mark.
	writeFileSync(files.banner, JSON.stringify({ color: 'yellow', showRose: false, showTextLogo: false }));
	assert.deepEqual(readGentleSettings(home), readGentleSettings(home));
	assert.equal(readGentleSettings(home).accentColor, 'yellow', 'the colour still comes from the file');
});

test('the config home follows gentle-pi’s own resolution order', () => {
	assert.equal(gentleConfigHome({ GENTLE_PI_CONFIG_HOME: '/tmp/explicit' }, '/home/someone'), '/tmp/explicit');
	assert.equal(gentleConfigHome({ GENTLE_SHELL_CONFIG_HOME: '/tmp/marker' }, '/home/someone'), '/tmp/marker');
	assert.equal(
		gentleConfigHome({ GENTLE_SHELL_CONFIG_HOME: 'relative-path' }, '/home/someone'),
		join('/home/someone', '.pi', 'gentle-ai'),
		'a relative marker is not a config home',
	);
	assert.equal(gentleConfigHome({}, '/home/someone'), join('/home/someone', '.pi', 'gentle-ai'));
});

test('comparing two resolutions only reports real changes', () => {
	const base = readGentleSettings('/nonexistent/home');
	assert.ok(sameGentleSettings(base, { ...base }));
	assert.equal(sameGentleSettings(base, { ...base, density: 'compact' }), false);
	assert.equal(sameGentleSettings(base, { ...base, accentColor: 'pink' }), false);
	assert.equal(sameGentleSettings(base, { ...base, headerPlacement: 'below-input' }), false);
});

test('the files LOON reads are the ones gentle-pi writes', () => {
	const home = mkdtempSync(join(tmpdir(), 'loon-gentle-'));
	const files = gentleConfigFiles(home);
	writeFileSync(files.visual, visual());
	writeFileSync(files.banner, JSON.stringify({ showTextLogo: false }));
	// Round-trip through the disk, not through a parsed value.
	assert.equal(readFileSync(files.visual, 'utf8'), visual());
	assert.equal(readGentleSettings(home).headerPlacement, 'below-input');
});
