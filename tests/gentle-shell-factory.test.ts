import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { patchText, TARGETS } from '../scripts/gentle-pi-patch.ts';
import { pristineSource, readPristine } from './support/pristine.ts';

/**
 * The rule this file pins: the text the patch injects into `installPrompt` must run where it
 * lands. `installPrompt` is a module-level function, so anything it closes over has to be
 * declared inside it, imported, or module scope — a delegate that reaches into the
 * `session_start` handler's locals is a free identifier, and the factory that reads it runs
 * when pi builds the editor at startup. That failure is a `ReferenceError` that takes the
 * whole extension down: no prompt and no shell bar. The suite was green with exactly that
 * defect inside it, because every test imported modules and called functions; nothing ran
 * the factory in a process.
 *
 * So this file runs the real path: it imports the patched `extensions/gentle-shell.ts`, calls
 * the private installer with a minimal fake context, then calls the factory pi would call and
 * renders the editor. A free identifier anywhere the flags are read fails here.
 *
 * The installer is private on purpose, so the test writes its own copy of the module with one
 * extra export line appended. The shipped file is not touched.
 */
const GENTLE = join(homedir(), '.pi', 'agent', 'npm', 'node_modules', 'gentle-pi');
const PI_ROOT = join(homedir(), '.local', 'share', 'loon-pi', 'npm-prefix', 'lib', 'node_modules', '@earendil-works', 'pi-coding-agent');

const PRISTINE = pristineSource();
const available =
	PRISTINE.ok && existsSync(join(GENTLE, 'extensions', 'gentle-shell.ts')) && existsSync(join(PI_ROOT, 'package.json'))
		? undefined
		: 'no pristine gentle-pi 4.6.0 sources or no installed package to build them in';

const SCRATCH: string[] = [];
after(() => {
	for (const root of SCRATCH) rmSync(root, { recursive: true, force: true });
});

/**
 * A scratch package holding exactly the bytes `apply` writes: the installed package, whose
 * modules are not patch targets, with every target replaced by the pristine file plus this
 * repo's edit set. Built once: three tests read the same bytes.
 */
let scratchPackage: string | undefined;

function patchedPackage(): string {
	if (scratchPackage !== undefined) return scratchPackage;
	if (!PRISTINE.ok) throw new Error('no pristine source');
	const root = mkdtempSync(join(tmpdir(), 'loon-factory-'));
	SCRATCH.push(root);
	cpSync(GENTLE, root, { recursive: true });
	for (const target of TARGETS) {
		const result = patchText(readPristine(PRISTINE.source, target.file), target);
		if (!result.ok) throw new Error(target.file + ': ' + result.reason);
		writeFileSync(join(root, target.file), result.text);
	}
	scratchPackage = root;
	return root;
}

const PI_ALIASES = {
	'@earendil-works/pi-coding-agent': join(PI_ROOT, 'dist', 'index.js'),
	'@earendil-works/pi-tui': join(PI_ROOT, 'node_modules', '@earendil-works', 'pi-tui', 'dist', 'index.js'),
	'@earendil-works/pi-agent-core': join(PI_ROOT, 'node_modules', '@earendil-works', 'pi-agent-core', 'dist', 'index.js'),
	'@earendil-works/pi-ai': join(PI_ROOT, 'node_modules', '@earendil-works', 'pi-ai', 'dist', 'compat.js'),
};

interface Installer {
	installPrompt: (
		ctx: Record<string, unknown>,
		onCreated: (prompt: unknown) => void,
		promptDeps: Record<string, unknown>,
	) => boolean;
}

interface PhaseRegistry {
	report: (sessionId: string, phase: string) => unknown;
	clear: (sessionId: string) => void;
}

/** The patched extension, loaded the way pi loads it, with the private installer exported. */
const loaded = new Map<string, Promise<{ installer: Installer; phases: { oddPhaseRegistry: PhaseRegistry } }>>();

function loadExtension(root: string): Promise<{ installer: Installer; phases: { oddPhaseRegistry: PhaseRegistry } }> {
	const cached = loaded.get(root);
	if (cached !== undefined) return cached;
	const pending = loadUncached(root);
	loaded.set(root, pending);
	return pending;
}

async function loadUncached(root: string): Promise<{ installer: Installer; phases: { oddPhaseRegistry: PhaseRegistry } }> {
	const source = readFileSync(join(root, 'extensions', 'gentle-shell.ts'), 'utf8');
	const probe = join(root, 'extensions', '__loon-probe-gentle-shell.ts');
	writeFileSync(probe, source + '\nexport { installPrompt };\n');
	const { createJiti } = (await import(join(PI_ROOT, 'node_modules', 'jiti', 'lib', 'jiti-static.mjs'))) as {
		createJiti: (url: string, options: Record<string, unknown>) => { import: (path: string) => Promise<unknown> };
	};
	const jiti = createJiti(import.meta.url, { moduleCache: false, interopDefault: true, fsCache: false, alias: PI_ALIASES });
	const mod = (await jiti.import(probe)) as Installer;
	const phases = (await jiti.import(join(root, 'lib', 'odd-phase.ts'))) as { oddPhaseRegistry: PhaseRegistry };
	return { installer: mod, phases };
}

const strip = (text: string): string => text.replace(/\u001b\[[0-9;]*m/g, '');
const AGENT_MARKS = ['·', '✢', '✳', '✶', '✻', '✽', '⏺'];
const FLOWERS = ['✿', '❀', '❁', '✾'];

/**
 * Drive what pi drives: the installer, then the factory, then a render of a working editor.
 * The fake context is only what the two of them read - the theme, the editor slot, the session
 * id - and the fake host is only what the editor touches while rendering.
 */
function renderWorkingPrompt(
	installer: Installer,
	phases: PhaseRegistry,
	themeName: string | undefined,
): string[] {
	const session = 'factory-probe-' + String(themeName);
	let factory: ((tui: unknown, theme: unknown, keybindings: unknown) => { render: (width: number) => string[]; setWorking: (working: boolean) => void }) | undefined;
	const theme = {
		...(themeName === undefined ? {} : { name: themeName }),
		fg: (_role: string, text: string) => text,
		bg: (_role: string, text: string) => text,
		bold: (text: string) => text,
	};
	const ctx = {
		ui: {
			getEditorComponent: () => undefined,
			setEditorComponent: (created: typeof factory) => {
				factory = created;
			},
			theme,
			notify: () => {},
		},
		hasPendingMessages: () => false,
		sessionManager: { getSessionId: () => session },
	};
	const installed = installer.installPrompt(ctx, () => {}, {
		now: () => 0,
		doubleEscCancelEnabled: () => false,
		dispatchQueuedText: () => {},
	});
	assert.equal(installed, true, 'the installer refused to take the editor slot');
	assert.equal(typeof factory, 'function', 'the installer never handed a factory to pi');

	// The label the activity row must carry, reported the way the orchestrator does it.
	phases.report(session, 'exploring');

	const host = { requestRender: () => {}, terminal: { columns: 100, rows: 40 }, mode: 'inline' };
	// The editor factory's theme argument is pi-tui's EditorTheme: a border colour and the
	// select-list theme, no name. The active pi theme is the one the context exposes.
	const editor = factory!(host, { borderColor: (text: string) => text, selectList: {} }, { matches: () => false, getKeys: () => [] });
	editor.setWorking(true);
	const rows = editor.render(100);
	phases.clear(session);
	return rows;
}

test('the factory the patch installs builds the editor and paints the activity row under a LOON theme', { skip: available }, async () => {
	const { installer, phases } = await loadExtension(patchedPackage());
	const rows = renderWorkingPrompt(installer, phases.oddPhaseRegistry, 'Wallpaper (LOON)').map(strip);
	assert.ok(rows.length > 1, 'the editor rendered nothing');

	// One row above the prompt, and it says what the agent is doing under an Agent mark.
	const activity = rows[0] ?? '';
	assert.ok(AGENT_MARKS.some((mark) => activity.includes(mark)), 'no Agent mark in the activity row: ' + JSON.stringify(activity));
	assert.ok(activity.includes('exploring…'), 'the activity row lost the reported label: ' + JSON.stringify(activity));

	// The frame below it carries neither the mark nor the label.
	const frame = rows.slice(1);
	for (const row of frame) {
		assert.ok(!row.includes('exploring…'), 'the working label is still painted in the prompt frame: ' + JSON.stringify(row));
		assert.ok(!AGENT_MARKS.some((mark) => row.includes(mark)), 'an Agent mark is still painted in the prompt frame: ' + JSON.stringify(row));
		assert.ok(!FLOWERS.some((flower) => row.includes(flower)), 'a flower is still painted in the prompt frame: ' + JSON.stringify(row));
	}
});

test('a theme that is not LOON keeps one frame, with the label inside it', { skip: available }, async () => {
	const { installer, phases } = await loadExtension(patchedPackage());
	const rows = renderWorkingPrompt(installer, phases.oddPhaseRegistry, 'Catppuccin Mocha').map(strip);

	// No second row: the frame carries the activity alone, exactly as gentle-pi ships it.
	assert.ok(!AGENT_MARKS.some((mark) => rows[0]!.includes(mark)), 'an Agent mark leaked into another theme: ' + JSON.stringify(rows[0]));
	assert.ok(
		rows.some((row) => row.includes('exploring…')),
		'the working label is not painted anywhere for another theme: ' + JSON.stringify(rows),
	);
	assert.ok(
		rows.some((row) => FLOWERS.some((flower) => row.includes(flower))),
		'the flower is gone for another theme: ' + JSON.stringify(rows),
	);
});

test('a theme with no name fails open to the shipped prompt', { skip: available }, async () => {
	const { installer, phases } = await loadExtension(patchedPackage());
	const rows = renderWorkingPrompt(installer, phases.oddPhaseRegistry, undefined).map(strip);
	assert.ok(rows.some((row) => row.includes('exploring…')), 'the label vanished for a theme with no name');
	assert.ok(rows.some((row) => FLOWERS.some((flower) => row.includes(flower))), 'the flower vanished for a theme with no name');
});

/**
 * The shape behind the defect, pinned cheaply: one decision, declared in the function that
 * reads it. Two declarations - one in the handler, one in the installer - is how the free
 * identifier happened, and it is invisible to a test that only patches a string.
 */
test('the mark decision is declared once, inside installPrompt', () => {
	const shell = TARGETS.find((target) => target.file === 'extensions/gentle-shell.ts');
	assert.ok(shell, 'the gentle-shell target is missing');
	const replacement = shell.edits.map((edit) => edit.replacement).join('\n');
	assert.equal(replacement.split('const loonMarks =').length - 1, 1, 'the decision is injected more than once');

	// The delegate is built where `ctx` and the module scope are the only things in reach: no
	// name from the session_start handler, and no `env`, which installPrompt does not receive.
	const emitted = replacement.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
	assert.match(emitted, /const loonMarks = \(\) => \{/, 'the decision is not a declaration inside the installer');
	assert.ok(!/keepNativeWorkingRow\(env\)/.test(emitted), 'the injected text still reads the handler\'s `env`');
	assert.match(emitted, /activityRow: \(\) => loonMarks\(\) && !keepNativeWorkingRow\(\)/, 'the Herdr gate is gone');

	// And the pristine file has exactly one place to put it: the anchor the decision rides on.
	if (!PRISTINE.ok) return;
	assert.equal(
		replacement.split('const previous = ctx.ui.getEditorComponent() as PromptFactory | undefined;').length - 1,
		1,
		'the installer body is not where the decision is anchored',
	);
});
