import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	ANCHORS,
	GENTLE_PI_VERSION,
	PATCH_MARKER,
	TARGETS,
	anchorsFit,
	classify,
	defaultPaths,
	md5,
	patchText,
	type TargetSpec,
} from '../scripts/gentle-pi-patch.ts';

const spec = (file: string, text: string, anchors: string[]): TargetSpec => ({
	file,
	md5: md5(text),
	edits: anchors.map((anchor) => ({ anchor, replacement: anchor + '\n// ' + PATCH_MARKER })),
});

const shellFixture = ['// head', ANCHORS.shellInit, '// between', ANCHORS.shellRows, '// tail'].join('\n');
const bannerFixture = ['// head', ANCHORS.bannerEvent, '// body', ANCHORS.bannerConfig, '// tail'].join('\n');

test('the patch targets the gentle-pi build it was written for', () => {
	assert.equal(GENTLE_PI_VERSION, '4.5.1');
	assert.deepEqual(
		TARGETS.map((target) => [target.file, target.md5]),
		[
			['extensions/gentle-shell.ts', 'ad1bfce79b655fc4f7cae71449d05d88'],
			['extensions/startup-banner.ts', '028bd98910468c7076ef31c65f36e09f'],
		],
	);
});

test('a file is classified by what it is', () => {
	const shell = spec('shell.ts', shellFixture, [ANCHORS.shellInit, ANCHORS.shellRows]);
	assert.equal(classify(undefined, shell), 'missing');
	assert.equal(classify(shellFixture, shell), 'clean');
	assert.equal(classify('something else entirely', shell), 'different-version');
	const result = patchText(shellFixture, shell);
	assert.ok(result.ok);
	assert.equal(classify(result.text, shell), 'patched');
});

test('the patch is idempotent', () => {
	const shell = spec('shell.ts', shellFixture, [ANCHORS.shellInit, ANCHORS.shellRows]);
	const first = patchText(shellFixture, shell);
	assert.ok(first.ok);
	assert.equal(first.changed, true);

	const second = patchText(first.text, shell);
	assert.ok(second.ok);
	assert.equal(second.changed, false, 'applying twice changed the file again');
	assert.equal(second.text, first.text);
});

test('an anchor that is missing or repeated refuses instead of half-patching', () => {
	const missing = spec('shell.ts', 'no anchors here', [ANCHORS.shellRows]);
	const missingResult = patchText('no anchors here', missing);
	assert.equal(missingResult.ok, false);
	if (!missingResult.ok) assert.match(missingResult.reason, /appears 0 time/);

	const doubled = shellFixture + '\n' + ANCHORS.shellRows;
	const doubledResult = patchText(doubled, spec('shell.ts', doubled, [ANCHORS.shellRows]));
	assert.equal(doubledResult.ok, false);
	if (!doubledResult.ok) assert.match(doubledResult.reason, /appears 2 time/);
});

test('the banner patch stops the install unless rose is asked for', () => {
	const banner = TARGETS.find((target) => target.file === 'extensions/startup-banner.ts')!;
	const result = patchText(bannerFixture, banner);
	assert.ok(result.ok);
	const text = result.text;

	assert.ok(text.includes(PATCH_MARKER));
	assert.ok(text.includes('async function readLoonBannerSource()'));
	assert.ok(
		text.includes('if (loonBannerSource === "loon" || loonBannerSource === "off") return;'),
		'the early return that keeps gentle-pi out of LOON\'s way is missing',
	);
	assert.ok(
		text.indexOf('readLoonBannerSource') < text.indexOf(ANCHORS.bannerEvent),
		'the helper must be declared before the session_start handler',
	);
	assert.ok(text.includes('loon-tui.json'), 'the source is read from LOON\'s own file');
});

test('the menu patch leaves one Banner row and no rose or text-logo row', () => {
	const shell = TARGETS.find((target) => target.file === 'extensions/gentle-shell.ts')!;
	const result = patchText(shellFixture, shell);
	assert.ok(result.ok);
	const text = result.text;

	assert.ok(!text.includes('Banner rose:'), 'the old rose row survived');
	// The text-logo row survives, but only inside rose mode: in loon it does nothing.
	assert.equal(text.split('Banner text logo:').length - 1, 1, 'the text logo row must appear exactly once');
	assert.ok(
		text.includes('if (loonBannerSource === "rose") add('),
		'the text-logo row is not conditional',
	);
	assert.ok(text.includes('add(() => `Banner: ${loonBannerSource}`'), 'the cycling row is missing');
	assert.ok(text.includes('const LOON_BANNER_SOURCES = ["loon", "rose", "off"] as const;'));
	assert.ok(
		text.includes('if (loonBannerSource === "rose") add('),
		'the text-logo row must only appear in rose mode',
	);
	assert.ok(text.includes('saveLoonBannerSource'), 'the choice is not persisted');
	assert.ok(text.includes('rename('), 'the settings write is not atomic');
});

test('the real installed files still match the anchors, when they are here', () => {
	const paths = defaultPaths();
	for (const target of TARGETS) {
		const path = join(paths.install, target.file);
		if (!existsSync(path)) {
			assert.ok(true, 'gentle-pi is not installed here; nothing to compare');
			continue;
		}
		const text = readFileSync(path, 'utf8');
		const state = classify(text, target);
		assert.ok(
			state === 'clean' || state === 'patched',
			`${target.file} is ${state}: the anchors no longer match the installed build`,
		);
		if (state === 'clean') assert.ok(anchorsFit(text, target), 'an anchor is not exactly once');
	}
});
