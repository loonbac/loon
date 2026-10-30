import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
	ANCHORS,
	GENTLE_PI_VERSION,
	apply,
	isMarked,
	planRestore,
	report,
	revert,
	PATCH_MARKER,
	TARGETS,
	anchorsFit,
	classify,
	defaultPaths,
	md5,
	diagnoseAnchors,
	patchText,
	verifyPatched,
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

const shellFixture = ['// head', ANCHORS.shellInit, '// between', ANCHORS.shellRows, '// preview', ANCHORS.shellCardPreview, '// tail', '', 'export class Editor {', ANCHORS.shellMouse, '}'].join('\n');
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
	// The mouse anchor is a class method, so it has to stand inside one: a method body in a
	// plain function is a parse error, and the gate validates the bytes it is about to write.
	return [
		'export default async function stand() {', ANCHORS.shellInit, '// between', ANCHORS.shellRows, '// preview', ANCHORS.shellCardPreview, '}',
		'',
		'export class Editor {', ANCHORS.shellMouse, '}',
		'',
	].join('\n');
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
	assert.ok(
		text.includes('loonSettings.accent !== "wallpaper" && loonSettings.accent !== "theme" && banner.color === color'),
		'a named colour claims (current) while the accent is the theme colour',
	);
	// The theme accent is a menu choice too: without it the only way to ask for it is
	// a command, and the commands are going away.
	assert.ok(text.includes('Banner color: theme (LOON)'), 'the theme accent has no row in the menu');
	assert.ok(text.includes('await saveLoonAccent("theme")'), 'the theme row does not store the choice');
	assert.ok(
		text.includes('async (accent: "theme" | "banner" | "wallpaper")'),
		'the menu cannot store the theme accent at all',
	);
	assert.ok(text.includes('accent.txt'), 'the wallpaper accent is not read');
	// The marker is the first thing to go when the row is too narrow; (current) never is.
	assert.ok(
		text.includes('labelWidth >= full.length + suffix.length'),
		'the label must decide on the width the layout reports',
	);
	assert.ok(text.includes('return (fits ? full : short) + suffix;'), 'the fallback label is missing');
	// The mark is LOON's own switch, and it has to be reachable from the menu: the
	// command that used to carry it is going away.
	assert.ok(text.includes('Mark: '), 'the menu has no mark row');
	assert.ok(text.includes('mark: loonSettings.mark === false'), 'the mark row does not toggle the setting');
	assert.ok(text.includes('Mark saved.'), 'the mark row reports nothing when it saves');
	assert.ok(!text.includes('Banner rose:'), 'the old rose row survived');
});

/**
 * One stand-in file per target, holding that target's anchors in order: enough for
 * the anchor scan, not a module the loader could import - the drift path never
 * reaches the loader, which is the point of the case.
 */
function standFor(target: TargetSpec): string {
	return ['// head', ...target.edits.map((edit) => edit.anchor), '// tail'].join('\n');
}

/** Run a function with the two console channels captured, in order. */
function captureOutput(run: () => number): { code: number; output: string } {
	const lines: string[] = [];
	const log = console.log;
	const error = console.error;
	console.log = (...args: unknown[]) => {
		lines.push(args.join(' '));
	};
	console.error = (...args: unknown[]) => {
		lines.push(args.join(' '));
	};
	try {
		return { code: run(), output: lines.join('\n') };
	} finally {
		console.log = log;
		console.error = error;
	}
}

test('a drifted target is refused with the file, the anchor and the address to fix', () => {
	for (const target of TARGETS) {
		const root = mkdtempSync(join(tmpdir(), 'loon-drift-'));
		const install = join(root, 'gentle-pi');
		const backups = join(root, 'backups');
		const pristine = standFor(target);
		// One byte inside the first anchor: what a gentle-pi update does to a target.
		const firstAnchor = target.edits[0]!.anchor;
		const at = pristine.indexOf(firstAnchor) + Math.floor(firstAnchor.length / 2);
		const drifted = pristine.slice(0, at) + 'X' + pristine.slice(at + 1);
		const spec: TargetSpec = { ...target, md5: md5(pristine) };
		const path = join(install, target.file);
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, drifted);

		const { code, output } = captureOutput(() => apply({ install, backups }, [spec]));

		assert.equal(code, 2, target.file + ': a drifted target must be refused');
		assert.equal(readFileSync(path, 'utf8'), drifted, target.file + ': a refused apply rewrote the target');
		assert.ok(
			!existsSync(backups) || readdirSync(backups).length === 0,
			target.file + ': a refused apply wrote a backup',
		);
		assert.ok(output.includes(target.file), target.file + ': the failure does not name the target');
		assert.ok(output.includes(spec.md5), target.file + ': the failure does not print the expected md5');
		assert.ok(output.includes(md5(drifted)), target.file + ': the failure does not print the md5 it found');
		assert.ok(output.includes('pinned to 4.5.1'), target.file + ': the failure does not name the pinned version');
		assert.ok(output.includes('nothing was written'), target.file + ': the failure does not say nothing was written');
		assert.ok(
			output.includes('scripts/gentle-pi-patch.ts:'),
			target.file + ': the failure does not point at the line that holds the anchor',
		);
		assert.ok(
			output.includes(firstAnchor.split('\n')[0]!.trim().slice(0, 40)),
			target.file + ': the failure does not show the anchor that stopped matching',
		);
	}
});

test('every anchor of every target reports where it lives', () => {
	// The first anchor of a file is rarely the one an update breaks: each one is moved
	// here, so an anchor that cannot be addressed - an array literal, say - is caught.
	for (const target of TARGETS) {
		for (const [index, edit] of target.edits.entries()) {
			const stand = standFor(target);
			const at = stand.indexOf(edit.anchor) + Math.max(1, Math.floor(edit.anchor.length / 2));
			const drifted = stand.slice(0, at) + 'X' + stand.slice(at + 1);
			const problems = diagnoseAnchors(drifted, target);
			const problem = problems.find((item) => item.anchor === edit.anchor);
			assert.ok(problem, target.file + ' edit ' + index + ': the broken anchor was not reported');
			assert.ok(problem.address, target.file + ' edit ' + index + ': the anchor has no address in the patch script');
			assert.match(problem.address, /^scripts\/gentle-pi-patch\.ts:\d+/);
			assert.ok(problem.expected.length > 0, target.file + ' edit ' + index + ': the anchor is not shown');
		}
	}
});

/* The band's row count is what pi's mouse model reads. The patch that leaves the label
 * slot without a surface keeps the native count for loon - so loon needs no row shift -
 * while float still opens with a padding row and does.
 *
 * This is a COUPLING GUARD, not a behavioural test: it matches the emitted source, with
 * comments stripped so a comment cannot satisfy it. There is no behavioural mouse test
 * and there cannot be one here - it would need pi's editor, which these tests replace
 * with a double - so what is checked is the pair that can desynchronise.
 *
 * The limit, stated: there is no behavioural proof of the mouse mapping, and there cannot
 * be one here - it would need pi's editor, which these tests replace with a double. What
 * can desynchronise is the label row and the shift, so that pair is what is asserted, with
 * the row numbers spelled out. */
test('the label slot and the mouse shift stay in step', () => {
	const shell = TARGETS.find((target) => target.file === 'extensions/gentle-shell.ts')!;
	const prompt = TARGETS.find((target) => target.file === 'lib/shell-prompt.ts')!;
	// Comments out first: a comment mentioning the string must not satisfy the guard.
	const withoutComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
	const replacements = (target: typeof shell) => target.edits.map((edit) => withoutComments(edit.replacement)).join('\n');
	const labelOutside = replacements(prompt).includes('layout.chrome === "loon" ? label');
	const mouseSource = replacements(shell);
	const shift = /layout\.chrome === "loon" \? (\d) : (\d)/.exec(mouseSource);
	const loonShift = shift ? Number(shift[1]) : 1;
	const floatShift = shift ? Number(shift[2]) : 1;
	const expected = labelOutside ? { loonShift: 0, floatShift: 1 } : { loonShift: 1, floatShift: 1 };
	assert.deepEqual(
		{ loonShift, floatShift },
		expected,
		labelOutside
			? 'the label is painted outside the surface, so loon must not shift its mouse rows and float must shift exactly one'
			: 'the label opens the surface, so both chromes must shift exactly one mouse row',
	);
});

/* A digest nobody checks is a digest that drifts. These fixtures are the pristine 4.5.1
 * sources of the seven targets, committed so the test reads neither git history nor the
 * user's install: every anchor occurs once and the edits must produce the pinned digest. */
const PRISTINE = join(dirname(new URL(import.meta.url).pathname), 'fixtures', 'gentle-pi-4.5.1');

test('every pinned digest is what the patch produces from the pristine file', () => {
	for (const target of TARGETS) {
		const pristine = readFileSync(join(PRISTINE, target.file), 'utf8');
		assert.equal(md5(pristine), target.md5, target.file + ': the fixture is not the pinned pristine build');
		const patched = patchText(pristine, target);
		assert.ok(patched.ok, target.file + ': the patch no longer applies to the pristine fixture');
		if (!patched.ok) continue;
		assert.equal(
			md5(patched.text),
			target.md5Patched,
			target.file + ': the pinned patched digest is not what the edits produce; recompute md5Patched or fix the edits',
		);
	}
});

/* The other direction, and the reason the lists exist: a digest that already shipped has to
 * keep answering 'patched-v1', or whoever has that build installed is refused instead of
 * upgraded. The record is a fixture; the lists may only grow. */
test('every digest that shipped is still accepted', () => {
	const recorded = JSON.parse(readFileSync(join(PRISTINE, '..', 'patch-digests.json'), 'utf8')) as Record<
		string,
		{ md5Patched: string; md5PatchedV1: string[] }
	>;
	for (const target of TARGETS) {
		const past = recorded[target.file];
		assert.ok(past, target.file + ' is missing from the digest record');
		const accepted = new Set<string>([target.md5Patched ?? '', ...(target.md5PatchedV1 ?? [])]);
		for (const digest of [past.md5Patched, ...past.md5PatchedV1]) {
			assert.ok(
				accepted.has(digest),
				target.file + ': ' + digest + ' shipped and is no longer accepted; an install at that build would be refused',
			);
		}
		const legacy = target.md5PatchedV1 ?? [];
		assert.equal(new Set(legacy).size, legacy.length, target.file + ': md5PatchedV1 repeats a digest');
		assert.ok(!legacy.includes(target.md5Patched ?? 'x'), target.file + ': the current digest is also listed as legacy');
	}
});

test('check shows the installed version beside the pinned one', async () => {
	const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
	const { join } = await import('node:path');
	const { tmpdir } = await import('node:os');

	const root = mkdtempSync(join(tmpdir(), 'loon-check-'));
	const install = join(root, 'gentle-pi');
	mkdirSync(join(install, 'extensions'), { recursive: true });
	const shellText = shellStand();
	writeFileSync(join(install, 'extensions', 'gentle-shell.ts'), shellText.replace('// head', '// head, edited by a newer gentle-pi'));
	writeFileSync(join(install, 'package.json'), JSON.stringify({ name: 'gentle-pi', version: '4.6.0' }));

	const { code, output } = captureOutput(() => report({ install, backups: join(root, 'backups') }, [shellSpec]));

	// Visible before anyone tries to apply, which is the whole point of check: the build
	// is not the pinned one, the anchors are intact, so it is patchable and untested.
	assert.match(output, /gentle-pi installed: 4\.6\.0/);
	assert.match(output, /patch pinned to 4\.5\.1/);
	assert.match(output, /not the build this patch was written against/);
	assert.match(output, /extensions\/gentle-shell\.ts: clean \(anchors intact: \d+ checked; md5 [0-9a-f]{32} is not the pinned [0-9a-f]{32}/);
	assert.equal(code, 0, 'check reports, it does not fail the shell');
});

test('a change outside the anchors does not block the patch', () => {
	// A newer gentle-pi with a new comment at the end of the file: our anchors are
	// untouched, so the patch applies. The md5 of the file is not the gate.
	const root = mkdtempSync(join(tmpdir(), 'loon-drift-harmless-'));
	const install = join(root, 'gentle-pi');
	const backups = join(root, 'backups');
	mkdirSync(join(install, 'extensions'), { recursive: true });
	writeFileSync(join(install, 'package.json'), JSON.stringify({ name: 'gentle-pi', version: '4.6.0' }));
	const pristine = shellStand();
	const edited = pristine + '\n// a comment a newer gentle-pi added\n';
	const path = join(install, 'extensions', 'gentle-shell.ts');
	writeFileSync(path, edited);

	const spec: TargetSpec = { ...shellSpec, md5: md5(pristine) };
	const { code, output } = captureOutput(() => apply({ install, backups }, [spec]));

	assert.equal(code, 0, 'a change that misses every anchor must not block the patch');
	assert.match(readFileSync(path, 'utf8'), /LOON banner patch/, 'the file was not patched');
	assert.equal(readFileSync(path, 'utf8').endsWith('// a comment a newer gentle-pi added\n'), true, 'the patch dropped the new tail');
	assert.match(output, /gentle-pi 4\.6\.0: \d+ anchors intact, version not tested/);
});

test('an anchor that occurs twice is refused as ambiguous', () => {
	const root = mkdtempSync(join(tmpdir(), 'loon-drift-twice-'));
	const install = join(root, 'gentle-pi');
	const backups = join(root, 'backups');
	mkdirSync(join(install, 'extensions'), { recursive: true });
	const pristine = shellStand();
	const doubled = pristine + '\n' + ANCHORS.shellInit + '\n';
	const path = join(install, 'extensions', 'gentle-shell.ts');
	writeFileSync(path, doubled);

	const spec: TargetSpec = { ...shellSpec, md5: md5(pristine) };
	const { code, output } = captureOutput(() => apply({ install, backups }, [spec]));

	assert.equal(code, 2, 'an ambiguous anchor must be refused');
	assert.equal(readFileSync(path, 'utf8'), doubled, 'a refused apply rewrote the target');
	assert.ok(!existsSync(backups) || readdirSync(backups).length === 0, 'a refused apply wrote a backup');
	assert.match(output, /occurs 2 time\(s\), expected 1/, 'the refusal does not report the ambiguity');
	assert.ok(output.includes('extensions/gentle-shell.ts'), 'the refusal does not name the target');
});

test('revert restores the file that was there before the patch, not a pinned copy', () => {
	const root = mkdtempSync(join(tmpdir(), 'loon-revert-drifted-'));
	const install = join(root, 'gentle-pi');
	const backups = join(root, 'backups');
	mkdirSync(join(install, 'extensions'), { recursive: true });
	const pristine = shellStand();
	const edited = pristine + '\n// a comment a newer gentle-pi added\n';
	const path = join(install, 'extensions', 'gentle-shell.ts');
	writeFileSync(path, edited);

	const spec: TargetSpec = { ...shellSpec, md5: md5(pristine) };
	const applied = captureOutput(() => apply({ install, backups }, [spec]));
	assert.equal(applied.code, 0, 'the harmless change was refused, so there is nothing to revert');

	const reverted = captureOutput(() => revert({ install, backups }, [spec]));
	assert.equal(reverted.code, 0, 'revert refused its own patch');
	assert.equal(readFileSync(path, 'utf8'), edited, 'revert restored a different file than the one it patched');
});

test('the patched result is verified by its substitutions, not by the marker', () => {
	// lib/visual-customize-view.ts replaces code that never mentions the marker; the
	// promise is that each substitution landed once, whatever the replacement says.
	const text = ['// head', 'REPLACE ME', '// tail', ''].join('\n');
	const spec: TargetSpec = {
		file: 'lib/example.ts',
		md5: md5(text),
		edits: [{ anchor: 'REPLACE ME', replacement: 'replaced once' }],
	};
	const result = patchText(text, spec);
	assert.ok(result.ok);
	assert.equal(verifyPatched((result as { text: string }).text, spec), undefined);
	assert.match(
		verifyPatched('// head\nreplaced once replaced once\n// tail', spec) ?? '',
		/landed 2 time/,
		'a doubled replacement must be caught',
	);
});

test('a refusal never blames a healthy anchor, and the notice counts them', () => {
	const root = mkdtempSync(join(tmpdir(), 'loon-message-'));
	const install = join(root, 'gentle-pi');
	const backups = join(root, 'backups');
	mkdirSync(join(install, 'extensions'), { recursive: true });
	writeFileSync(join(install, 'package.json'), JSON.stringify({ name: 'gentle-pi', version: '4.6.0' }));

	// A drifted target: one anchor moved, nothing else.
	const pristine = shellStand();
	const moved = ANCHORS.shellRows.slice(0, 20) + 'X' + ANCHORS.shellRows.slice(21);
	const drifted = pristine.replace(ANCHORS.shellRows, moved);
	const path = join(install, 'extensions', 'gentle-shell.ts');
	writeFileSync(path, drifted);

	const refused = captureOutput(() => apply({ install, backups }, [{ ...shellSpec, md5: md5(pristine) }]));
	assert.equal(refused.code, 2);
	assert.ok(
		!refused.output.includes('every anchor still occurs once'),
		'a refusal still claims the anchors are healthy while refusing for them',
	);
	assert.match(refused.output, /occurs 0 time\(s\), expected 1/);

	// And a healthy build of another version is patched, with the count of what was checked.
	writeFileSync(path, pristine + '\n// a newer gentle-pi wrote this\n');
	const applied = captureOutput(() => apply({ install, backups }, [{ ...shellSpec, md5: md5(pristine) }]));
	assert.equal(applied.code, 0, 'a healthy anchor set must not be refused');
	assert.match(
		applied.output,
		new RegExp('gentle-pi 4\\.6\\.0: ' + shellSpec.edits.length + ' anchors intact, version not tested'),
		'the notice does not say how many anchors were checked',
	);
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

	// a build whose anchors moved is refused and left alone; the digest is not the gate
	const moved = ANCHORS.shellRows.slice(0, 20) + 'X' + ANCHORS.shellRows.slice(21);
	const altered = shellText.replace(ANCHORS.shellRows, moved);
	writeFileSync(shellPath, altered);
	assert.equal(apply(paths, standTargets), 2);
	assert.equal(readFileSync(shellPath, 'utf8'), altered, 'a refused apply modified the file');

	// the installed file is not the one this patch wrote any more, so revert refuses
	// instead of destroying whatever replaced it
	assert.equal(revert(paths, standTargets), 2);
	assert.equal(readFileSync(shellPath, 'utf8'), altered, 'a refused revert overwrote the file');

	// give our own output back and the restore goes through, to the bytes that were there
	writeFileSync(shellPath, (shellV2 as { text: string }).text);
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
	// Every backup this tool writes carries the manifest that records its bytes.
	const recorded = Object.entries(files).map(([file, text]) => ({ file, md5: md5(text) }));
	writeFileSync(
		join(backups, stamp, 'manifest.json'),
		JSON.stringify({ version: '4.5.1', at: '2026-01-01T00:00:00.000Z', files: recorded }),
	);
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

test('a backup that does not match its own record is not a restore source', () => {
	const root = mkdtempSync(join(tmpdir(), 'loon-revert-tampered-'));
	const install = join(root, 'gentle-pi');
	const backups = join(root, 'backups');
	mkdirSync(join(install, 'extensions'), { recursive: true });
	const pristine = shellStand();
	const patched = patchText(pristine, shellSpec);
	assert.ok(patched.ok);
	const path = join(install, 'extensions', 'gentle-shell.ts');
	writeFileSync(path, (patched as { text: string }).text);

	const stamp = 'gentle-pi-banner-patch-20260101000009'; // manifest says pristine, file does not
	plantBackup(backups, stamp, { 'extensions/gentle-shell.ts': '// tampered\n' });
	writeFileSync(
		join(backups, stamp, 'manifest.json'),
		JSON.stringify({ files: [{ file: 'extensions/gentle-shell.ts', md5: md5(pristine) }] }),
	);

	const before = readFileSync(path, 'utf8');
	const { code, output } = captureOutput(() => revert({ install, backups }, [shellSpec]));
	assert.equal(code, 2, 'a tampered backup must not be restored');
	assert.equal(readFileSync(path, 'utf8'), before, 'the installed file was overwritten from a tampered backup');
	assert.ok(output.includes('extensions/gentle-shell.ts'), 'the refusal does not name the target');
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
	const plan = planRestore({ install, backups }, targets);
	assert.equal(plan.ok, false);
	if (!plan.ok) {
		// The gap is named, and so is what a restore would have accepted as ours.
		assert.deepEqual(plan.missing.map((item) => item.file), ['lib/visual-customize-view.ts']);
		assert.ok(plan.missing[0]!.expects.includes(targets[2]!.md5Patched!), 'the plan does not name our own output');
	}
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
