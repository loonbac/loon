import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	ANCHORS,
	GENTLE_PI_VERSION,
	apply,
	revert,
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
			state === 'clean' || state === 'patched' || state === 'patched-v1',
			`${target.file} is ${state}: the anchors no longer match the installed build`,
		);
		if (state === 'clean') assert.ok(anchorsFit(text, target), 'an anchor is not exactly once');
		if (state === 'patched-v1') assert.ok(!anchorsFit(text, target), 'a v1 file should not match the v2 anchors');
	}
});

/* S7: the state machine, including the upgrade over our own previous patch. */

const shellSpec = TARGETS.find((target) => target.file === 'extensions/gentle-shell.ts')!;

function shellStand(): string {
	return ['export default async function stand() {', ANCHORS.shellInit, '// between', ANCHORS.shellRows, '}', ''].join('\n');
}

function bannerStand(): string {
	return ['export default function stand(pi: any) {', ANCHORS.bannerEvent, '// body', ANCHORS.bannerConfig, '  });', '}', ''].join('\n');
}

test('a file patched by the previous version is reported as patched-v1', () => {
	const v1 = shellStand().replace(ANCHORS.shellRows, '// LOON banner patch v1\n// Banner: loon');
	assert.equal(classify(v1, shellSpec), 'patched-v1');
	const v2 = patchText(shellStand(), shellSpec);
	assert.ok(v2.ok);
	assert.equal(classify(v2.text, shellSpec), 'patched');
});

test('the v2 rows add the wallpaper colour and return the accent to banner', () => {
	const result = patchText(shellStand(), shellSpec);
	assert.ok(result.ok);
	const text = result.text;

	assert.ok(text.includes('Banner color: wallpaper'), 'the wallpaper row is missing');
	assert.ok(text.includes('Wallpaper accent'), 'the preview title is missing');
	assert.ok(text.includes('saveLoonAccent("wallpaper")'), 'the row does not store the choice');
	assert.ok(
		text.includes('await saveLoonAccent("banner")'),
		'the four named colours must return the accent to gentle-pi, or picking pink is a no-op',
	);
	assert.ok(text.includes('loonSettings.accent !== "wallpaper" && banner.color === color'), 'the current marker ignores the wallpaper mode');
	assert.ok(text.includes('accent.txt'), 'the wallpaper accent is not read');
	assert.ok(!text.includes('Banner rose:'), 'the old rose row survived');
});

test('the four patch states, end to end on a copy of the package', async () => {
	const { mkdtempSync, mkdirSync, writeFileSync, readFileSync } = await import('node:fs');
	const { join } = await import('node:path');
	const { tmpdir } = await import('node:os');

	const root = mkdtempSync(join(tmpdir(), 'loon-patch-e2e-'));
	const install = join(root, 'gentle-pi');
	const backups = join(root, 'backups');
	mkdirSync(join(install, 'extensions'), { recursive: true });
	const shellPath = join(install, 'extensions', 'gentle-shell.ts');
	const bannerPath = join(install, 'extensions', 'startup-banner.ts');
	const shellText = shellStand();
	const bannerText = bannerStand();
	writeFileSync(shellPath, shellText);
	writeFileSync(bannerPath, bannerText);

	// The stand-ins are not the 4.5.1 build, so the run uses targets pinned to them;
	// everything else - anchors, backup, jiti gate, atomic write - is the real path.
	const standTargets: TargetSpec[] = [
		{ file: 'extensions/gentle-shell.ts', md5: md5(shellText), v2Marker: 'Banner color: wallpaper', edits: shellSpec.edits },
		{ file: 'extensions/startup-banner.ts', md5: md5(bannerText), edits: TARGETS.find((target) => target.file === 'extensions/startup-banner.ts')!.edits },
	];
	const paths = { install, backups };

	// clean -> patched
	assert.equal(classify(readFileSync(shellPath, 'utf8'), standTargets[0]!), 'clean');
	assert.equal(apply(paths, standTargets), 0);
	assert.equal(classify(readFileSync(shellPath, 'utf8'), standTargets[0]!), 'patched');
	assert.equal(classify(readFileSync(bannerPath, 'utf8'), standTargets[1]!), 'patched');
	assert.ok(readFileSync(shellPath, 'utf8').includes('Banner color: wallpaper'));

	// idempotent
	assert.equal(apply(paths, standTargets), 0);
	assert.match(readFileSync(shellPath, 'utf8'), /Banner color: wallpaper/);

	// patched-v1 -> patched, over the recorded pristine backup
	writeFileSync(shellPath, '// LOON banner patch v1\nexport default async function stand() { }\n');
	assert.equal(classify(readFileSync(shellPath, 'utf8'), standTargets[0]!), 'patched-v1');
	assert.equal(apply(paths, standTargets), 0, 'the upgrade from v1 must succeed');
	assert.equal(classify(readFileSync(shellPath, 'utf8'), standTargets[0]!), 'patched');
	assert.ok(readFileSync(shellPath, 'utf8').includes('Banner color: wallpaper'));

	// a different build is refused and left alone
	const altered = shellText + '// a build this patch does not know\n';
	writeFileSync(shellPath, altered);
	assert.equal(apply(paths, standTargets), 2);
	assert.equal(readFileSync(shellPath, 'utf8'), altered, 'a refused apply modified the file');

	// revert goes back to the pristine bytes of both files
	assert.equal(revert(paths, standTargets), 0);
	assert.equal(readFileSync(shellPath, 'utf8'), shellText);
	assert.equal(readFileSync(bannerPath, 'utf8'), bannerText);
});

test('patched-v1 without a verified pristine backup refuses instead of nesting anchors', async () => {
	const { mkdtempSync, mkdirSync, writeFileSync, readFileSync } = await import('node:fs');
	const { join } = await import('node:path');
	const { tmpdir } = await import('node:os');

	const root = mkdtempSync(join(tmpdir(), 'loon-patch-nov1-'));
	const install = join(root, 'gentle-pi');
	mkdirSync(join(install, 'extensions'), { recursive: true });
	const v1 = '// LOON banner patch v1\nexport default function stand() { }\n';
	writeFileSync(join(install, 'extensions', 'gentle-shell.ts'), v1);
	const bannerText = bannerStand();
	writeFileSync(join(install, 'extensions', 'startup-banner.ts'), bannerText);

	const standTargets: TargetSpec[] = [
		{ file: 'extensions/gentle-shell.ts', md5: md5(shellStand()), v2Marker: 'Banner color: wallpaper', edits: shellSpec.edits },
		{ file: 'extensions/startup-banner.ts', md5: md5(bannerText), edits: TARGETS.find((target) => target.file === 'extensions/startup-banner.ts')!.edits },
	];
	assert.equal(apply({ install, backups: join(root, 'backups') }, standTargets), 2);
	assert.equal(readFileSync(join(install, 'extensions', 'gentle-shell.ts'), 'utf8'), v1, 'the file was touched');
});
