import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
	ANCHORS,
	GENTLE_PI_VERSION,
	apply,
	isMarked,
	planRestore,
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

const spec = (file: string, text: string, anchors: string[]): TargetSpec => {
	const base: TargetSpec = {
		file,
		md5: md5(text),
		edits: anchors.map((anchor) => ({ anchor, replacement: anchor + '\n// ' + PATCH_MARKER })),
	};
	// Mirror the tool's contract: a patched state is decided by the bytes written.
	const patched = patchText(text, base);
	return patched.ok ? { ...base, md5Patched: md5(patched.text) } : base;
};

const shellFixture = ['// head', ANCHORS.shellInit, '// between', ANCHORS.shellRows, '// preview', ANCHORS.shellCardPreview, '// tail'].join('\n');
const bannerFixture = ['// head', ANCHORS.bannerEvent, '// body', ANCHORS.bannerConfig, '// tail'].join('\n');

test('the patch targets the gentle-pi build it was written for', () => {
	assert.equal(GENTLE_PI_VERSION, '4.5.1');
	assert.deepEqual(
		TARGETS.map((target) => [target.file, target.md5]),
		[
			['extensions/gentle-shell.ts', 'ad1bfce79b655fc4f7cae71449d05d88'],
			// The view is patched only to hand each row the width it really has.
			['lib/visual-customize-view.ts', '6f1b71a9aa898fcf55196d73634b0076'],
			['extensions/startup-banner.ts', '028bd98910468c7076ef31c65f36e09f'],
			// The header bar's brand gives way to a theme LOON generated.
			['lib/shell-bar.ts', 'c5b3819241a587f960834409312a72a0'],
			// Card style loon: the enum and the geometry that cards, panels and the bar read.
			['lib/shell-card.ts', 'd189f85262f41f5a5e8f590a0c57ed2d'],
			['lib/card-style-policy.ts', '2833f69f68273d351a09fd1d39424756'],
			// The prompt band picks its geometry by style name, so loon needs this file too.
			['lib/shell-prompt.ts', '6dccc1c4bf36e217d308a67c5e690c14'],
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
	return ['export default async function stand() {', ANCHORS.shellInit, '// between', ANCHORS.shellRows, '// preview', ANCHORS.shellCardPreview, '}', ''].join('\n');
}

function bannerStand(): string {
	return ['export default function stand(pi: any) {', ANCHORS.bannerEvent, '// body', ANCHORS.bannerConfig, '  });', '}', ''].join('\n');
}

test('a file patched by the previous version is reported as patched-v1', () => {
	const pristine = shellStand();
	const v1 = pristine.replace(ANCHORS.shellRows, '// LOON banner patch v1\n// Banner: loon');
	const specWithV1: TargetSpec = { ...shellSpec, md5: md5(pristine), md5PatchedV1: [md5(v1)] };
	assert.equal(classify(v1, specWithV1), 'patched-v1');

	const v2 = patchText(pristine, shellSpec);
	assert.ok(v2.ok);
	const specWithV2: TargetSpec = { ...shellSpec, md5: md5(pristine), md5Patched: md5((v2 as { text: string }).text) };
	assert.equal(classify((v2 as { text: string }).text, specWithV2), 'patched');
});

test('a patched file edited afterwards is a different version, not ours', () => {
	const pristine = shellStand();
	const v2 = patchText(pristine, shellSpec);
	assert.ok(v2.ok);
	const edited = (v2 as { text: string }).text + '// someone edited this after patching\n';
	const specWithV2: TargetSpec = { ...shellSpec, md5: md5(pristine), md5Patched: md5((v2 as { text: string }).text) };
	assert.equal(classify(edited, specWithV2), 'different-version');
	assert.equal(isMarked(edited, specWithV2), true, 'the refusal should be able to explain itself');
});

test('the view hands each row the width it really has', () => {
	const view = TARGETS.find((target) => target.file === 'lib/visual-customize-view.ts');
	assert.ok(view, 'the view target is missing');
	const result = patchText(
		'\tlabel: string | (() => string);\n\t\t\tconst item = navOnly ? this.categories[start + i] : row ? typeof row.label === "function" ? row.label() : row.label : undefined;\n',
		view!,
	);
	assert.ok(result.ok);
	const text = (result as { text: string }).text;
	assert.ok(text.includes('label: string | ((width?: number) => string);'), 'the label type does not take a width');
	assert.ok(text.includes('row.label(rightWidth)'), 'the view never passes the row width');
});

test('the v2 rows add the wallpaper colour and return the accent to banner', () => {
	const result = patchText(shellStand(), shellSpec);
	assert.ok(result.ok);
	const text = result.text;

	assert.ok(text.includes('Banner color: wallpaper (LOON)'), 'the (LOON) marker is missing from the label');
	assert.ok(text.includes('labelWidth?: number'), 'the row cannot see the width the layout gives it');
	assert.ok(text.includes('Wallpaper accent'), 'the preview title is missing');
	assert.ok(text.includes('saveLoonAccent("wallpaper")'), 'the row does not store the choice');
	assert.ok(
		text.includes('await saveLoonAccent("banner")'),
		'the four named colours must return the accent to gentle-pi, or picking pink is a no-op',
	);
	assert.ok(text.includes('loonSettings.accent !== "wallpaper" && banner.color === color'), 'the current marker ignores the wallpaper mode');
	assert.ok(text.includes('accent.txt'), 'the wallpaper accent is not read');
	// The marker is the first thing to go when the row is too narrow; (current) never is.
	assert.ok(
		text.includes('labelWidth >= full.length + suffix.length'),
		'the label must decide on the width the layout reports',
	);
	assert.ok(text.includes('return (fits ? full : short) + suffix;'), 'the fallback label is missing');
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
	const shellV2 = patchText(shellText, shellSpec);
	assert.ok(shellV2.ok);
	const bannerTarget = TARGETS.find((target) => target.file === 'extensions/startup-banner.ts')!;
	const bannerV2 = patchText(bannerText, bannerTarget);
	assert.ok(bannerV2.ok);
	const v1Text = '// LOON banner patch v1\nexport default async function stand() { }\n';
	const standTargets: TargetSpec[] = [
		{
			...shellSpec,
			md5: md5(shellText),
			md5Patched: md5((shellV2 as { text: string }).text),
			md5PatchedV1: [md5(v1Text)],
			v2Marker: 'Banner color: wallpaper',
		},
		{ ...bannerTarget, md5: md5(bannerText), md5Patched: md5((bannerV2 as { text: string }).text) },
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
	writeFileSync(shellPath, v1Text);
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

	const bannerTarget = TARGETS.find((target) => target.file === 'extensions/startup-banner.ts')!;
	const bannerV2 = patchText(bannerText, bannerTarget);
	assert.ok(bannerV2.ok);
	const standTargets: TargetSpec[] = [
		{ ...shellSpec, md5: md5(shellStand()), v2Marker: 'Banner color: wallpaper' },
		{ ...bannerTarget, md5: md5(bannerText), md5Patched: md5((bannerV2 as { text: string }).text) },
	];
	assert.equal(apply({ install, backups: join(root, 'backups') }, standTargets), 2);
	assert.equal(readFileSync(join(install, 'extensions', 'gentle-shell.ts'), 'utf8'), v1, 'the file was touched');
});

/* Revert resolves the pristine snapshot per file, so backups may be split. */

const viewSpec = TARGETS.find((target) => target.file === 'lib/visual-customize-view.ts')!;

function viewStand(): string {
	return ['export class View {', ANCHORS.viewLabelType, '}', '', 'export const pick = (start: number) => {', ANCHORS.viewLabelCall, '};', ''].join('\n');
}

function threeTargets(): TargetSpec[] {
	const shellText = shellStand();
	const bannerText = bannerStand();
	const viewText = viewStand();
	const shellV2 = patchText(shellText, shellSpec);
	const bannerV2 = patchText(bannerText, TARGETS.find((target) => target.file === 'extensions/startup-banner.ts')!);
	const viewV2 = patchText(viewText, viewSpec);
	assert.ok(shellV2.ok && bannerV2.ok && viewV2.ok);
	return [
		{
			...shellSpec,
			md5: md5(shellText),
			md5Patched: md5((shellV2 as { text: string }).text),
			v2Marker: 'Banner color: wallpaper',
		},
		{ ...TARGETS.find((target) => target.file === 'extensions/startup-banner.ts')!, md5: md5(bannerText), md5Patched: md5((bannerV2 as { text: string }).text) },
		{ ...viewSpec, md5: md5(viewText), md5Patched: md5((viewV2 as { text: string }).text) },
	];
}

function plantBackup(backups: string, stamp: string, files: Record<string, string>): void {
	for (const [file, text] of Object.entries(files)) {
		const path = join(backups, stamp, file);
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, text);
	}
}

test('revert restores every target from snapshots split across backups', async () => {
	const { mkdtempSync } = await import('node:fs');
	const { tmpdir } = await import('node:os');

	const root = mkdtempSync(join(tmpdir(), 'loon-revert-split-'));
	const install = join(root, 'gentle-pi');
	const backups = join(root, 'backups');
	mkdirSync(join(install, 'extensions'), { recursive: true });
	mkdirSync(join(install, 'lib'), { recursive: true });
	const targets = threeTargets();
	const pristine = {
		'extensions/gentle-shell.ts': shellStand(),
		'extensions/startup-banner.ts': bannerStand(),
		'lib/visual-customize-view.ts': viewStand(),
	};
	// The installation is patched; the snapshots live in two different backups.
	for (const spec of targets) {
		const patched = patchText(pristine[spec.file as keyof typeof pristine]!, spec);
		assert.ok(patched.ok);
		writeFileSync(join(install, spec.file), (patched as { text: string }).text);
	}
	plantBackup(backups, 'gentle-pi-banner-patch-20260101000001', {
		'extensions/gentle-shell.ts': pristine['extensions/gentle-shell.ts'],
	});
	plantBackup(backups, 'gentle-pi-banner-patch-20260101000002', {
		'extensions/startup-banner.ts': pristine['extensions/startup-banner.ts'],
		'lib/visual-customize-view.ts': pristine['lib/visual-customize-view.ts'],
	});

	assert.equal(revert({ install, backups }, targets), 0);
	for (const spec of targets) {
		assert.equal(readFileSync(join(install, spec.file), 'utf8'), pristine[spec.file as keyof typeof pristine], spec.file + ' was not restored');
	}
});

test('a missing snapshot names the file and copies nothing at all', async () => {
	const { mkdtempSync } = await import('node:fs');
	const { tmpdir } = await import('node:os');

	const root = mkdtempSync(join(tmpdir(), 'loon-revert-missing-'));
	const install = join(root, 'gentle-pi');
	const backups = join(root, 'backups');
	mkdirSync(join(install, 'extensions'), { recursive: true });
	mkdirSync(join(install, 'lib'), { recursive: true });
	const targets = threeTargets();
	const pristine = {
		'extensions/gentle-shell.ts': shellStand(),
		'extensions/startup-banner.ts': bannerStand(),
		'lib/visual-customize-view.ts': viewStand(),
	};
	const patchedText: Record<string, string> = {};
	for (const spec of targets) {
		const patched = patchText(pristine[spec.file as keyof typeof pristine]!, spec);
		assert.ok(patched.ok);
		patchedText[spec.file] = (patched as { text: string }).text;
		writeFileSync(join(install, spec.file), patchedText[spec.file]!);
	}
	// Only the first two have a snapshot: the view's is missing everywhere.
	plantBackup(backups, 'gentle-pi-banner-patch-20260101000001', {
		'extensions/gentle-shell.ts': pristine['extensions/gentle-shell.ts'],
		'extensions/startup-banner.ts': pristine['extensions/startup-banner.ts'],
	});

	assert.equal(revert({ install, backups }, targets), 2);
	for (const spec of targets) {
		assert.equal(
			readFileSync(join(install, spec.file), 'utf8'),
			patchedText[spec.file],
			spec.file + ' was touched even though the restore could not complete',
		);
	}
	assert.deepEqual(planRestore({ install, backups }, targets), {
		ok: false,
		missing: [{ file: 'lib/visual-customize-view.ts', md5: targets[2]!.md5 }],
	});
});

/* The header bar's brand, and what a theme LOON generated does to it. */

const shellBarTarget = TARGETS.find((target) => target.file === 'lib/shell-bar.ts')!;

// The anchors in the order the real file has them, so the fixture patches into
// something that still reads like the function it stands in for.
const shellBarFixture = [
	'// head',
	ANCHORS.shellBarMarginImport,
	'function buildSegments(): string[] {',
	'\treturn [',
	ANCHORS.shellBarMinimal,
	'\t\tlocation,',
	'\t];',
	'}',
	'',
	ANCHORS.shellBarBrand,
	'',
	ANCHORS.shellBarStages,
	'\tconst withProfile = model.profile ? `${withEffort} ${theme.fg(ROLE.LABEL, "·")} ${theme.fg(ROLE.MODEL, sanitizeStatus(model.profile))}` : withEffort;',
	ANCHORS.shellBarStagesTail,
	'}',
	'',
	'\tconst leftStages = headerLeftStages(model, theme, presentation?.visibility.modelDetails !== false)',
	'\t\t.map((stage) => presentation?.density === "minimal" ? stage.slice(1) : stage);',
	ANCHORS.shellBarFallback,
	ANCHORS.shellBarUsage,
	'',
	ANCHORS.shellBarMarginRow,
	'',
	ANCHORS.shellBarMarginPadding,
	'',
	ANCHORS.shellBarMarginRule,
	'// tail',
].join('\n');

interface FakeTheme {
	name?: string;
	fg: (role: string, text: string) => string;
	bold: (text: string) => string;
}

const fakeTheme = (name?: string): FakeTheme => ({
	...(name === undefined ? {} : { name }),
	fg: (_role, text) => text,
	bold: (text) => text,
});

/**
 * Load the functions the patch emits, with the module around them stubbed, so the
 * test exercises the bytes that would be written rather than a copy of them.
 */
async function loadEmittedShellBar(): Promise<{
	loonThemeActive: (theme: FakeTheme) => boolean;
	barBrandSegments: (theme: FakeTheme, text: string, options?: { bold?: boolean; hidden?: boolean }) => string[];
	headerLeftStages: (model: { modelId: string; effort?: string; profile?: string }, theme: FakeTheme, showModelDetails: boolean, presentation?: { density?: string }) => string[][];
	usageSegmentText: (windows: Array<{ text?: string }>, theme: FakeTheme, stage: string, hint?: string) => string | undefined;
}> {
	const patched = patchText(shellBarFixture, shellBarTarget);
	assert.ok(patched.ok, 'the shell-bar fixture did not patch');
	const loon = /function loonThemeActive[\s\S]*?\n}/.exec(patched.text);
	const helper = /function barBrandSegments[\s\S]*?\n}/.exec(patched.text);
	const stages = /function headerLeftStages[\s\S]*?\n}/.exec(patched.text);
	const usage = /function usageSegmentText[\s\S]*?\n}/.exec(patched.text);
	assert.ok(loon, 'the emitted theme test is missing');
	assert.ok(helper, 'the emitted helper is missing');
	assert.ok(stages, 'the emitted header stages are missing');
	assert.ok(usage, 'the emitted usage segment is missing');

	const dir = mkdtempSync(join(tmpdir(), 'loon-shell-bar-'));
	const path = join(dir, 'shell-bar-probe.mts');
	writeFileSync(path, [
		'const ROLE = { BRAND: "brand", LABEL: "label", MODEL: "model", SEPARATOR: "separator" };',
		'const HEADER_BRAND = "✿ Gentle Shell";',
		'const USAGE_LABEL_ROLE = "label";',
		'const USAGE_HINT_ROLE = "dim";',
		'const locationSegment = () => "~/proj";',
		'const executionSegment = (id: string, effort?: string) => effort === undefined ? id : id + " " + effort;',
		'const sanitizeStatus = (text: string) => text;',
		'const usageWindowText = (window: { text?: string }) => window.text ?? "";',
		loon[0],
		helper[0],
		stages[0],
		usage[0],
		'export { loonThemeActive, barBrandSegments, headerLeftStages, usageSegmentText };',
	].join('\n'));
	// The probe is a scratch file, not evidence: it must not outlive the test.
	try {
		return (await import(pathToFileURL(path).href)) as never;
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

test('a stock theme keeps the brand, and its header stages, exactly as before', async () => {
	const { barBrandSegments, headerLeftStages } = await loadEmittedShellBar();
	const theme = fakeTheme('Gentle');
	const model = { modelId: 'gpt-5', effort: 'high', profile: 'reviewer' };

	assert.deepEqual(barBrandSegments(theme, '✿ Gentle Shell', { bold: true }), ['✿ Gentle Shell']);
	assert.deepEqual(headerLeftStages(model, theme, true), [
		['✿ Gentle Shell', '~/proj', 'gpt-5 high · reviewer'],
		['✿ Gentle Shell', '~/proj', 'gpt-5 high'],
		['✿ Gentle Shell', '~/proj', 'gpt-5'],
		['✿ Gentle Shell', 'gpt-5'],
		['✿ Gentle Shell'],
	]);
	assert.deepEqual(headerLeftStages(model, theme, false), [['✿ Gentle Shell', '~/proj'], ['✿ Gentle Shell']]);
});

test('minimal density drops the brand exactly where the old slice did', async () => {
	const { headerLeftStages } = await loadEmittedShellBar();
	const theme = fakeTheme('Gentle');
	const model = { modelId: 'gpt-5', effort: 'high', profile: 'reviewer' };
	// Both the stages and the trailing brand-alone stage must match the slice the
	// call site used to do, empty last stage included: the fallback cascade counts
	// stages, so a shorter list would render a different row at narrow widths.
	const sliced = headerLeftStages(model, theme, true).map((stage) => stage.slice(1));
	assert.deepEqual(headerLeftStages(model, theme, true, { density: 'minimal' }), sliced);
	assert.deepEqual(headerLeftStages(model, theme, false, { density: 'minimal' }), [['~/proj'], []]);
});

test('a theme LOON generated hides the brand without leaving an empty stage', async () => {
	const { barBrandSegments, headerLeftStages } = await loadEmittedShellBar();
	const theme = fakeTheme('Wallpaper (LOON)');
	const model = { modelId: 'gpt-5', effort: 'high', profile: 'reviewer' };

	assert.deepEqual(barBrandSegments(theme, '✿ Gentle Shell', { bold: true }), []);
	const stages = headerLeftStages(model, theme, true);
	assert.deepEqual(stages, [
		['~/proj', 'gpt-5 high · reviewer'],
		['~/proj', 'gpt-5 high'],
		['~/proj', 'gpt-5'],
		['gpt-5'],
	]);
	for (const stage of stages) {
		assert.ok(stage.length > 0, 'a stage is empty');
		assert.ok(
			stage.every((segment) => segment.length > 0),
			'a segment is empty, which would paint a stray separator',
		);
	}
	assert.deepEqual(headerLeftStages(model, theme, false), [['~/proj']], 'the narrowest header must not be blank');
	// Minimal density has nothing left to hide, and must not slice a real segment.
	assert.deepEqual(headerLeftStages(model, theme, true, { density: 'minimal' }), stages);
});

test('a theme with no name fails open instead of hiding the brand', async () => {
	const { barBrandSegments, headerLeftStages } = await loadEmittedShellBar();
	for (const name of [undefined, '']) {
		const theme = fakeTheme(name);
		assert.deepEqual(barBrandSegments(theme, '✿ Gentle Shell', { bold: true }), ['✿ Gentle Shell']);
		assert.equal(headerLeftStages({ modelId: 'gpt-5' }, theme, true).length, 5);
	}
});

test('the LOON theme test lives in one helper, not copied per decision', () => {
	const patched = patchText(shellBarFixture, shellBarTarget);
	assert.ok(patched.ok);
	const text = patched.text;
	assert.equal(text.split('function loonThemeActive').length - 1, 1, 'the theme test is defined more than once');
	assert.equal(text.split('endsWith(" (LOON)")').length - 1, 1, 'the suffix is compared more than once');
	assert.ok(text.includes('if (options.hidden || loonThemeActive(theme)) return [];'), 'the brand does not use the helper');
	assert.ok(text.includes('const loon = loonThemeActive(theme);'), 'the usage segment does not use the helper');
});

test('a stock theme keeps the usage hint, and its standing affordance with no data', async () => {
	const { usageSegmentText } = await loadEmittedShellBar();
	const theme = fakeTheme('Gentle');
	// No provider data: the segment still reads as a clickable affordance, as today.
	assert.equal(usageSegmentText([], theme, 'full', 'alt+u'), 'usage · alt+u');
	assert.equal(usageSegmentText([{ text: '5h 40%' }], theme, 'full', 'alt+u'), 'usage 5h 40% · alt+u');
});

test('a LOON theme silences the shortcut and never leaves an orphan usage', async () => {
	const { usageSegmentText } = await loadEmittedShellBar();
	const theme = fakeTheme('Wallpaper (LOON)');
	assert.equal(usageSegmentText([], theme, 'full', 'alt+u'), undefined, 'an orphan usage segment survived');
	assert.equal(usageSegmentText([{ text: '' }], theme, 'full', 'alt+u'), undefined, 'an empty body left a bare usage');
	// Data keeps the gauges; only the reminder goes.
	assert.equal(usageSegmentText([{ text: '5h 40%' }], theme, 'full', 'alt+u'), 'usage 5h 40%');
	assert.equal(usageSegmentText([{ text: '5h 40%' }], theme, 'primary', 'alt+u'), 'usage 5h 40%');
});

test('a theme with no name keeps the usage hint too', async () => {
	const { usageSegmentText } = await loadEmittedShellBar();
	assert.equal(usageSegmentText([], fakeTheme(undefined), 'full', 'alt+u'), 'usage · alt+u');
	assert.equal(usageSegmentText([], fakeTheme(''), 'full', 'alt+u'), 'usage · alt+u');
});
