import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { md5, patchText, TARGETS, type TargetSpec } from '../scripts/gentle-pi-patch.ts';
import { pristineSource, readPristine } from './support/pristine.ts';

/**
 * The rule this file pins: under a theme LOON generated the rose gives way to the Agent
 * marks - ✻ at rest, seven marks spinning while the agent works - and the working activity
 * leaves the prompt frame for the row above it, where Pi's own `⠼ Working` loader would be.
 * Every other theme keeps gentle-pi's bytes exactly as shipped.
 *
 * Rendered bytes, no pixels: each module is the real `apply` output, imported through the
 * same jiti loader pi uses.
 */
const GENTLE = join(homedir(), '.pi', 'agent', 'npm', 'node_modules', 'gentle-pi');
const PI_ROOT = join(homedir(), '.local', 'share', 'loon-pi', 'npm-prefix', 'lib', 'node_modules', '@earendil-works', 'pi-coding-agent');

const PRISTINE = pristineSource();
/** Everything the modules below need: the package's own lib/, plus the pristine targets. */
const available =
	PRISTINE.ok && existsSync(join(GENTLE, 'lib', 'shell-hover.ts')) && existsSync(join(PI_ROOT, 'package.json'))
		? undefined
		: 'no pristine gentle-pi 4.6.0 sources or no installed package to build them in';

/** The exact bytes `apply` writes for one target. */
function patchedText(target: TargetSpec): string {
	if (!PRISTINE.ok) throw new Error('no pristine source');
	const result = patchText(readPristine(PRISTINE.source, target.file), target);
	if (!result.ok) throw new Error(target.file + ': ' + result.reason);
	return result.text;
}

const target = (file: string): TargetSpec => {
	const found = TARGETS.find((item) => item.file === file);
	if (found === undefined) throw new Error('no target for ' + file);
	return found;
};

/**
 * A scratch package holding the patched prompt and card modules. The support modules come
 * from the installed package - they are not patch targets - and the two modules under test
 * are the bytes this repo's edit set produces, so nothing here reads our own patch output
 * from the install.
 */
function patchedPackage(): string {
	const root = mkdtempSync(join(tmpdir(), 'loon-marks-'));
	cpSync(join(GENTLE, 'lib'), join(root, 'lib'), { recursive: true });
	// shell-bar reaches the package's own scripts/ through the review sidebar; support files,
	// not patch targets, so they are the installed bytes as they are.
	cpSync(join(GENTLE, 'scripts'), join(root, 'scripts'), { recursive: true });
	for (const file of ['lib/shell-prompt.ts', 'lib/shell-card.ts', 'lib/shell-bar.ts']) {
		writeFileSync(join(root, file), patchedText(target(file)));
	}
	// The scratch package lives outside the worktree and does not outlive the run.
	SCRATCH.push(root);
	return root;
}

const SCRATCH: string[] = [];
after(() => {
	for (const root of SCRATCH) rmSync(root, { recursive: true, force: true });
});

interface PromptModule {
	PROMPT_STATE: Record<string, string>;
	PROMPT_PETAL: string;
	AGENT_MARK_GLYPH: string;
	petalGlyph: (state: string, tick: number, agentMarks?: boolean) => string;
	agentActivityRow: (options: Record<string, unknown>, width: number) => string;
	framePromptLines: (lines: string[], width: number, options: Record<string, unknown>, layout?: unknown) => string[];
	resolvePromptLayout: (width: number, style: string, bg: unknown) => unknown;
}

interface CardModule {
	CARD_GLYPH: string;
	CARD_TONE: Record<string, string>;
	cardTop: (card: Record<string, unknown>, theme: Record<string, unknown>, width: number, hint?: string) => string;
	cardTopRows: (card: Record<string, unknown>, theme: Record<string, unknown>, width: number, hint?: string) => string[];
	panelHeaderRow: (theme: Record<string, unknown>, width: number, tone?: string) => number;
	renderCard: (card: Record<string, unknown>, theme: Record<string, unknown>, width: number, options: Record<string, unknown>) => string[];
}

interface BarModule {
	renderShellTitleRow: (model: Record<string, unknown>, theme: Record<string, unknown>, width: number, options?: Record<string, unknown>) => string;
	renderShellStatusBar: (
		model: Record<string, unknown>,
		theme: Record<string, unknown>,
		width: number,
		usageHint?: string,
		presentation?: Record<string, unknown>,
		paint?: unknown,
		extras?: Record<string, unknown>,
	) => { rows: string[] };
}

const PI_ALIASES = {
	'@earendil-works/pi-tui': join(PI_ROOT, 'node_modules', '@earendil-works', 'pi-tui', 'dist', 'index.js'),
	'@earendil-works/pi-agent-core': join(PI_ROOT, 'node_modules', '@earendil-works', 'pi-agent-core', 'dist', 'index.js'),
	'@earendil-works/pi-ai': join(PI_ROOT, 'node_modules', '@earendil-works', 'pi-ai', 'dist', 'compat.js'),
	// shell-bar reaches the package root through background-jobs-tools; the dist entry is enough.
	'@earendil-works/pi-coding-agent': join(PI_ROOT, 'dist', 'index.js'),
};

async function load<T>(root: string, file: string): Promise<T> {
	const { createJiti } = (await import(join(PI_ROOT, 'node_modules', 'jiti', 'lib', 'jiti-static.mjs'))) as {
		createJiti: (url: string, options: Record<string, unknown>) => { import: (path: string) => Promise<unknown> };
	};
	const jiti = createJiti(import.meta.url, { moduleCache: false, interopDefault: true, fsCache: false, alias: PI_ALIASES });
	return (await jiti.import(join(root, file))) as T;
}

/** A theme with no styling, so a row's own text is what the assertions read. */
const plainTheme = (name?: string): Record<string, unknown> => ({
	...(name === undefined ? {} : { name }),
	fg: (_role: string, text: string) => text,
	bg: (_role: string, text: string) => text,
	bold: (text: string) => text,
});

const strip = (text: string): string => text.replace(/\u001b\[[0-9;]*m/g, '');

const FLOWERS = ['✿', '❀', '❁', '✾'];
const MARKS = ['·', '✢', '✳', '✶', '✻', '✽', '⏺'];

let cached: { prompt: PromptModule; card: CardModule; bar: BarModule } | undefined;

/** The modules under test, patched once for the whole file. */
async function modules(): Promise<{ prompt: PromptModule; card: CardModule; bar: BarModule }> {
	if (cached !== undefined) return cached;
	const root = patchedPackage();
	cached = {
		prompt: await load<PromptModule>(root, 'lib/shell-prompt.ts'),
		card: await load<CardModule>(root, 'lib/shell-card.ts'),
		bar: await load<BarModule>(root, 'lib/shell-bar.ts'),
	};
	return cached;
}

test('the glyph a LOON theme shows is ✻ at rest and seven Agent marks while working', { skip: available }, async () => {
	const prompt = (await modules()).prompt;
	const { IDLE, WORKING } = prompt.PROMPT_STATE as { IDLE: string; WORKING: string };

	// The exports keep their names, and the shipped glyph keeps its bytes.
	assert.equal(prompt.PROMPT_PETAL, '✿', 'PROMPT_PETAL is what every other theme renders');
	assert.equal(prompt.AGENT_MARK_GLYPH, '✻');

	for (const tick of [0, 1, 6, 9]) {
		assert.equal(prompt.petalGlyph(IDLE!, tick, true), '✻', 'the mark at rest stands still');
	}
	assert.deepEqual(
		Array.from({ length: 7 }, (_unused, tick) => prompt.petalGlyph(WORKING!, tick, true)),
		MARKS,
		'the working mark spins through the seven Agent marks',
	);
	assert.equal(prompt.petalGlyph(WORKING!, 7, true), MARKS[0], 'the spinner wraps');
});

test('any other theme keeps the rose and the four flowers, byte for byte', { skip: available }, async () => {
	const prompt = (await modules()).prompt;
	const { IDLE, WORKING } = prompt.PROMPT_STATE as { IDLE: string; WORKING: string };

	for (const tick of [0, 3]) {
		assert.equal(prompt.petalGlyph(IDLE!, tick, false), '✿');
		// The flag absent is the shipped call, and it is the same as passing false.
		assert.equal(prompt.petalGlyph(IDLE!, tick), '✿');
	}
	assert.deepEqual(
		Array.from({ length: 4 }, (_unused, tick) => prompt.petalGlyph(WORKING!, tick, false)),
		FLOWERS,
	);
	assert.equal(prompt.petalGlyph(WORKING!, 4, false), FLOWERS[0], 'the four flowers still wrap');
});

test('under a LOON theme the prompt frame drops the activity and the row beside it carries it', { skip: available }, async () => {
	const prompt = (await modules()).prompt;
	const { IDLE, WORKING } = prompt.PROMPT_STATE as { IDLE: string; WORKING: string };
	const fg = (role: string, text: string) => text;
	const options = (state: string, tick: number, agentMarks: boolean) => ({ style: 'loon', bg: (role: string, text: string) => text, state, tick, borderColor: (text: string) => text, fg, bold: (text: string) => text, workingLabel: 'exploring…', agentMarks });

	const layout = prompt.resolvePromptLayout(120, 'loon', (role: string, text: string) => text);
	const frame = (state: string, agentMarks: boolean) =>
		prompt.framePromptLines(['', 'hello', ''], 120, options(state, 4, agentMarks), layout).map(strip);

	// LOON theme, working: the frame says neither the label nor the mark.
	const loonWorking = frame(WORKING!, true);
	for (const row of loonWorking) {
		assert.ok(!row.includes('exploring…'), 'the working label is still painted in the prompt frame: ' + JSON.stringify(row));
		assert.ok(!MARKS.some((mark) => row.includes(mark)), 'an Agent mark is still painted in the prompt frame: ' + JSON.stringify(row));
		assert.ok(!FLOWERS.some((flower) => row.includes(flower)), 'a flower is still painted in the prompt frame: ' + JSON.stringify(row));
	}

	// The same frame under any other theme is untouched: the label and the flower.
	const otherWorking = frame(WORKING!, false);
	assert.ok(otherWorking.some((row) => row.includes('exploring…')), 'the label left the frame for a theme that is not LOON');
	assert.ok(otherWorking.some((row) => row.includes(FLOWERS[0]!)), 'the flower left the frame for a theme that is not LOON');

	// At rest the prompt still carries the mark, under LOON.
	assert.ok(frame(IDLE!, true).some((row) => row.includes('✻')), 'the mark at rest is missing from the LOON prompt');
});

test('the activity row says what the agent is doing, under the Agent marks', { skip: available }, async () => {
	const prompt = (await modules()).prompt;
	const { WORKING } = prompt.PROMPT_STATE as { WORKING: string };
	const fg = (role: string, text: string) => text;

	// The seven marks, one per tick, with the dynamic label gentle-pi reports.
	for (const [index, mark] of MARKS.entries()) {
		const row = strip(prompt.agentActivityRow({ state: WORKING, tick: index, fg, bold: (text: string) => text, workingLabel: 'implementing…' }, 80));
		assert.ok(row.includes(mark), 'frame ' + index + ' does not show ' + mark + ': ' + JSON.stringify(row));
		assert.ok(row.includes('implementing…'), 'the row does not carry the dynamic label: ' + JSON.stringify(row));
	}

	// The rest mark is one of the frames it spins through, never the only one.
	assert.ok(MARKS.includes('✻'), 'the ✻ frame is not part of the spinner');

	// The label is the one gentle-pi reports, whatever it says - a worker's name included.
	const worker = strip(prompt.agentActivityRow({ state: WORKING, tick: 0, fg, bold: (text: string) => text, workingLabel: 'loon-author' }, 80));
	assert.ok(worker.includes('loon-author'), 'a worker label is dropped: ' + JSON.stringify(worker));

	// Without a label it falls back to the same wording the frame used.
	const bare = strip(prompt.agentActivityRow({ state: WORKING, tick: 0, fg }, 80));
	assert.ok(bare.includes('working…'), 'the row has no label at all: ' + JSON.stringify(bare));

	// The row never exceeds the width it is given, and it is padded to it.
	for (const width of [0, 6, 33, 120]) {
		const row = prompt.agentActivityRow({ state: WORKING, tick: 3, fg, bold: (text: string) => text, workingLabel: 'checking…' }, width);
		assert.equal(strip(row).length, width, 'the row is not exactly ' + width + ' cells wide');
	}
});

test('the rounded and panel frames drop the activity too, and only while working', { skip: available }, async () => {
	const prompt = (await modules()).prompt;
	const { IDLE, WORKING } = prompt.PROMPT_STATE as { IDLE: string; WORKING: string };
	const fg = (role: string, text: string) => text;
	const options = (state: string, agentMarks: boolean) => ({ style: 'neon', state, tick: 1, borderColor: (text: string) => text, fg, bold: (text: string) => text, workingLabel: 'exploring…', agentMarks });

	// Neon paints its title into the top rule, and the wide IDE panel into its own rule.
	for (const lines of [['', 'hello', ''], ['head 1 more', 'hello', 'tail 2 more']]) {
		const loon = prompt.framePromptLines(lines, 100, options(WORKING!, true)).map(strip);
		const other = prompt.framePromptLines(lines, 100, options(WORKING!, false)).map(strip);
		assert.ok(other.some((row) => row.includes('exploring…')), 'the label left the frame of another theme');
		assert.ok(!loon.some((row) => row.includes('exploring…')), 'the LOON frame still paints the working label');
	}

	// A scroll indicator is not the activity, so it stays where it was.
	const scrolled = prompt.framePromptLines(['↑ 3 more', 'hello', ''], 100, options(WORKING!, true)).map(strip);
	assert.ok(scrolled.some((row) => row.includes('↑ 3 more')), 'the scroll indicator was dropped with the activity');

	// At rest the LOON neon frame shows the mark.
	const idle = prompt.framePromptLines(['', 'hello', ''], 100, options(IDLE!, true)).map(strip);
	assert.ok(idle.some((row) => row.includes('✻')), 'the mark at rest is missing from the LOON neon frame');
});

test('a card heading leads with ✻ under a LOON theme and with ✿ under any other', { skip: available }, async () => {
	const card = (await modules()).card;
	const subject = { title: 'read', subtitle: 'a.ts', body: ['one line'], tone: 'info' };
	const loon = plainTheme('Wallpaper (LOON)');
	const other = plainTheme('Catppuccin Mocha');
	const unnamed = plainTheme();

	assert.equal(card.CARD_GLYPH, '✿', 'the shipped card glyph changed bytes');

	const top = (theme: Record<string, unknown>) => strip(card.cardTop(subject, theme, 60));
	assert.ok(top(loon).includes('✻ read'), 'the LOON heading does not lead with the mark: ' + JSON.stringify(top(loon)));
	assert.ok(!top(loon).includes('✿'), 'the LOON heading still leads with the rose');
	assert.ok(top(other).includes('✿ read'), 'another theme lost the rose: ' + JSON.stringify(top(other)));
	assert.ok(!top(other).includes('✻'), 'another theme gained the Agent mark');
	assert.ok(top(unnamed).includes('✿ read'), 'a theme with no name must keep the rose');

	// Every heading path reads the same decision, not a copy of it.
	const rows = (theme: Record<string, unknown>) => card.cardTopRows({ ...subject, title: 'read\nthe whole file' }, theme, 40).map(strip).join('\n');
	assert.ok(rows(loon).includes('✻'), 'cardTopRows kept the rose under a LOON theme');
	assert.ok(rows(other).includes('✿'), 'cardTopRows lost the rose under another theme');

	const panelled = (theme: Record<string, unknown>) => card.renderCard({ ...subject, subtitle: undefined, panel: true }, theme, 60, { expanded: true }).map(strip).join('\n');
	assert.ok(panelled(loon).includes('✻'), 'the panel header kept the rose under a LOON theme');
	assert.ok(panelled(other).includes('✿'), 'the panel header lost the rose under another theme');

	// headingFits() has no theme in hand and keeps CARD_GLYPH; that is only safe while both
	// marks occupy one cell, so the equality is asserted rather than assumed.
	assert.equal(strip('✿').length, 1);
	assert.equal(strip('✻').length, 1);
	assert.equal(strip(MARKS.join('')).length, MARKS.length, 'an Agent mark is not one cell wide');
});

/**
 * The header the chrome paints: the title row above the transcript and the status bar's own
 * project identity. Both lead with `✿`, and that rose is the brand the shell bar drops under
 * a LOON theme - so it goes there too, and every other theme keeps the glyph and its bytes.
 * Rendered from the patched scratch copy, never from the installed package.
 */
test('the header never paints the rose under a LOON theme', { skip: available }, async () => {
	const bar = (await modules()).bar;
	const loon = plainTheme('Wallpaper (LOON)');
	const other = plainTheme('Gentle');
	const unnamed = plainTheme();
	// The shape the chrome hands the bar, values included: the identity decision must not
	// depend on an incomplete fixture.
	const model = {
		cwd: '/home/loon/proj',
		branch: 'master',
		dirty: 0,
		sessionName: undefined,
		modelId: 'gpt-5',
		effort: 'high',
		profile: 'reviewer',
		contextPercent: 12,
		contextWindow: 200000,
		costTotal: 0.42,
		subscription: false,
		usage: undefined,
		statuses: [],
	};
	const presentation = {
		density: 'comfortable',
		visibility: { changes: true, rdd: true, agents: true, todo: true, usageCost: true, modelDetails: true, contextWarning: true, stats: false },
	};
	const title = (theme: Record<string, unknown>, width: number, options?: Record<string, unknown>): string => strip(bar.renderShellTitleRow(model, theme, width, options));
	const status = (theme: Record<string, unknown>): string =>
		bar.renderShellStatusBar(model, theme, 120, undefined, presentation, undefined, { project: true }).rows.map(strip).join('\n');

	// The identity stays; only the rose goes. Measured at the widths the chrome picks, and
	// with the model-bearing variant of the narrow layout.
	for (const width of [120, 90, 40]) {
		const row = title(loon, width);
		assert.equal(row.includes('✿'), false, 'the rose survived in the title row at width ' + width + ': ' + JSON.stringify(row));
		assert.ok(row.includes('proj'), 'the project identity left the title row with the rose: ' + JSON.stringify(row));
	}
	assert.equal(
		title(loon, 90, { model: true }).includes('✿'),
		false,
		'the model-bearing title row kept the rose: ' + JSON.stringify(title(loon, 90, { model: true })),
	);
	const loonStatus = status(loon);
	assert.equal(loonStatus.includes('✿'), false, 'the status bar kept the rose under a LOON theme: ' + JSON.stringify(loonStatus));
	assert.ok(loonStatus.includes('proj'), 'the status bar lost the project identity with the rose: ' + JSON.stringify(loonStatus));

	// Every other theme is untouched, byte for byte, and a theme with no name fails open.
	for (const theme of [other, unnamed]) {
		for (const width of [120, 40]) {
			assert.ok(
				title(theme, width).includes('✿ proj'),
				'the rose left the title row of a theme that is not LOON, at width ' + width + ': ' + JSON.stringify(title(theme, width)),
			);
		}
		assert.ok(status(theme).includes('✿ proj'), 'the rose left the status bar of a theme that is not LOON: ' + JSON.stringify(status(theme)));
	}
});

/**
 * COUPLING GUARD, not a rendering test: the flag is taken from the theme in gentle-shell, and
 * the row is placed through the `topRows` mechanism the editor already calls. Both are inside
 * one file, so they are asserted from the emitted source - comments stripped, so a comment
 * cannot satisfy it - the same way the mouse-row guard in gentle-pi-patch.test.ts does.
 */
test('the activity row is wired through the row the editor already draws, and never doubled', () => {
	const shell = target('extensions/gentle-shell.ts');
	const withoutComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
	const emitted = shell.edits.map((edit) => withoutComments(edit.replacement)).join('\n');

	assert.match(emitted, /agentMarks: this\.deps\.agentMarks\?\.\(\) \?\? false,/, 'the flag never reaches the prompt frame');
	assert.match(emitted, /topRows\.push\(agentActivityRow\(/, 'the activity row is not added to the rows above the editor');
	assert.match(emitted, /name\.endsWith\(" \(LOON\)"\)/, 'the theme convention is not the one the rest of the patch uses');
	// The Herdr gate, and the reason it takes no argument: `installPrompt` is module level, so
	// the handler's `env` is not in reach there. Only the declaration inside the installer and
	// this delegate may mention the decision - a second one elsewhere is the free identifier
	// that took the extension down (tests/gentle-shell-factory.test.ts runs the factory).
	assert.match(emitted, /activityRow: \(\) => loonMarks\(\) && !keepNativeWorkingRow\(\),/, 'the row would be painted while Pi paints its own');
	assert.ok(!/keepNativeWorkingRow\(env\)/.test(emitted), 'the injected text reads an `env` that is not in scope where it lands');
	assert.equal(emitted.split('const loonMarks =').length - 1, 1, 'the decision is declared more than once in the file');

	// The row goes after the shell's own rows, so their indices and clicks do not move.
	const pushAt = emitted.indexOf('topRows.push(agentActivityRow(');
	const ownRows = emitted.indexOf('const topRows = this.deps.topRows?.(width, this.hoveredTopRow) ?? [];');
	assert.ok(ownRows >= 0 && ownRows < pushAt, 'the row is prepended, which would shift the rows the shell owns');

	// The prompt is what sheds the label: the flag has to reach framePromptLines too.
	const promptTarget = target('lib/shell-prompt.ts');
	const promptEmitted = promptTarget.edits.map((edit) => withoutComments(edit.replacement)).join('\n');
	assert.match(promptEmitted, /agentMarks\?: boolean;/, 'PromptFrameOptions cannot carry the flag');
	assert.match(promptEmitted, /AGENT_MARK_FRAMES = \["·", "✢", "✳", "✶", "✻", "✽", "⏺"\]/, 'the spinner frames are not the ones the owner asked for');
});

test('the pinned digest of every file this change touches is what its edits produce', { skip: available }, () => {
	for (const file of ['lib/shell-prompt.ts', 'lib/shell-card.ts', 'extensions/gentle-shell.ts']) {
		const spec = target(file);
		const text = patchedText(spec);
		assert.equal(md5(text), spec.md5Patched, file + ': md5Patched is not what the edits produce');
		// The pristine targets are what the apply path starts from, so they are hashed too.
		if (!PRISTINE.ok) continue;
		assert.equal(md5(readPristine(PRISTINE.source, file)), spec.md5, file + ': the fixture is not the pinned pristine build');
	}
});
