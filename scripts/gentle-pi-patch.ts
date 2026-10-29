#!/usr/bin/env node
/**
 * Patch gentle-pi's own customization menu so it offers LOON as a third banner
 * source, and teach gentle-pi's banner to stay out of the way when LOON owns the
 * slot.
 *
 * This edits another installed package, so it is deliberately paranoid:
 *
 *   - the files must be exactly the gentle-pi 4.5.1 build the patch was written
 *     against (md5), or nothing is touched;
 *   - every anchor must appear exactly once, so a partial match cannot leave half
 *     a patch behind;
 *   - before a real file is replaced, the patched copy is imported in a child
 *     process with jiti - the loader pi itself uses - to prove it parses and still
 *     exports a factory;
 *   - the originals go to a timestamped backup first, and `revert` puts them back
 *     and verifies their md5.
 *
 *   node --experimental-strip-types scripts/gentle-pi-patch.ts check
 *   node --experimental-strip-types scripts/gentle-pi-patch.ts apply
 *   node --experimental-strip-types scripts/gentle-pi-patch.ts revert
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** The gentle-pi release this patch is written for. */
export const GENTLE_PI_VERSION = '4.5.1';

/** Every patched file carries this marker, which also makes the patch idempotent. */
export const PATCH_MARKER = 'LOON banner patch';

export interface PatchEdit {
	/** Text that must appear exactly once in the unpatched file. */
	anchor: string;
	/** What replaces it; it always contains the anchor itself. */
	replacement: string;
}

export interface TargetSpec {
	/** Path relative to the gentle-pi package root. */
	file: string;
	/** md5 of the untouched 4.5.1 build. */
	md5: string;
	edits: PatchEdit[];
}

const SHELL_INIT_ANCHOR = "\t\t\tlet banner = await readBannerConfig(bannerHome).catch(error => { close(); throw error; });\n\t\t\tif (closed) return;";
const SHELL_INIT_ADDITION = "\t\t\t// LOON banner patch: the banner source lives in LOON's own settings file,\n\t\t\t// because writeBannerConfig() persists only this file's three keys and would\n\t\t\t// drop anything else written here.\n\t\t\tconst loonSettingsPath = join(process.env.PI_CODING_AGENT_DIR || join(os.homedir(), \".pi\", \"agent\"), \"loon-tui.json\");\n\t\t\tconst readLoonSettings = async (): Promise<Record<string, unknown>> => {\n\t\t\t\ttry {\n\t\t\t\t\tconst parsed: unknown = JSON.parse(await readFile(loonSettingsPath, \"utf8\"));\n\t\t\t\t\treturn typeof parsed === \"object\" && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};\n\t\t\t\t} catch {\n\t\t\t\t\treturn {};\n\t\t\t\t}\n\t\t\t};\n\t\t\tlet loonSettings = await readLoonSettings();\n\t\t\tlet loonBannerSource: \"loon\" | \"rose\" | \"off\" = loonSettings.source === \"rose\" || loonSettings.source === \"off\" ? loonSettings.source : \"loon\";\n\t\t\tconst saveLoonBannerSource = async (source: \"loon\" | \"rose\" | \"off\") => {\n\t\t\t\tconst { mkdir, rename, writeFile } = await import(\"node:fs/promises\");\n\t\t\t\tconst next = { ...loonSettings, source };\n\t\t\t\tawait mkdir(dirname(loonSettingsPath), { recursive: true });\n\t\t\t\tconst temporary = `${loonSettingsPath}.${process.pid}.tmp`;\n\t\t\t\tawait writeFile(temporary, `${JSON.stringify(next, null, \"\\t\")}\\n`, { mode: 0o600 });\n\t\t\t\tawait rename(temporary, loonSettingsPath);\n\t\t\t\tloonSettings = next;\n\t\t\t\tloonBannerSource = source;\n\t\t\t};";

const SHELL_ROWS_ANCHOR = "\t\t\tadd(() => `Banner rose: ${banner.showRose ? \"on\" : \"off\"}`, \"Banner saved; applies at next startup.\", async () => {\n\t\t\t\tconst next = { ...await readBannerConfigForEdit(bannerHome) };\n\t\t\t\tnext.showRose = !next.showRose;\n\t\t\t\tawait writeBannerConfig(next, bannerHome);\n\t\t\t\tbanner = next;\n\t\t\t}, () => bannerPreview({ ...banner, showRose: !banner.showRose }));\n\t\t\tadd(() => `Banner text logo: ${banner.showTextLogo ? \"on\" : \"off\"}`, \"Banner saved; applies at next startup.\", async () => {\n\t\t\t\tconst next = { ...await readBannerConfigForEdit(bannerHome) };\n\t\t\t\tnext.showTextLogo = !next.showTextLogo;\n\t\t\t\tawait writeBannerConfig(next, bannerHome);\n\t\t\t\tbanner = next;\n\t\t\t}, () => bannerPreview({ ...banner, showTextLogo: !banner.showTextLogo }));";
const SHELL_ROWS_REPLACEMENT = "\t\t\t// LOON banner patch: one row, three states, cycling on select.\n\t\t\tconst LOON_BANNER_SOURCES = [\"loon\", \"rose\", \"off\"] as const;\n\t\t\tconst nextLoonBannerSource = () => LOON_BANNER_SOURCES[(LOON_BANNER_SOURCES.indexOf(loonBannerSource) + 1) % LOON_BANNER_SOURCES.length];\n\t\t\tadd(() => `Banner: ${loonBannerSource}`, \"Banner saved; applies at next startup.\", async () => {\n\t\t\t\tawait saveLoonBannerSource(nextLoonBannerSource());\n\t\t\t}, () => {\n\t\t\t\tconst next = nextLoonBannerSource();\n\t\t\t\tif (next === \"rose\") return bannerPreview(banner);\n\t\t\t\treturn next === \"off\"\n\t\t\t\t\t? { title: \"Banner · off (static)\", sample: \"·  pi's own header at next startup\" }\n\t\t\t\t\t: { title: \"Banner · LOON (static)\", sample: \"█  LOON header at next startup\" };\n\t\t\t});\n\t\t\tif (loonBannerSource === \"rose\") add(() => `Banner text logo: ${banner.showTextLogo ? \"on\" : \"off\"}`, \"Banner saved; applies at next startup.\", async () => {\n\t\t\t\tconst next = { ...await readBannerConfigForEdit(bannerHome) };\n\t\t\t\tnext.showTextLogo = !next.showTextLogo;\n\t\t\t\tawait writeBannerConfig(next, bannerHome);\n\t\t\t\tbanner = next;\n\t\t\t}, () => bannerPreview({ ...banner, showTextLogo: !banner.showTextLogo }));";

const BANNER_CONFIG_ANCHOR = "    const bannerConfig = await readBannerConfig();";
const BANNER_CONFIG_ADDITION = "    // LOON banner patch: LOON's own setting decides who paints the header. \"rose\"\n    // - and a missing setting, so an unpatched LOON keeps working - leaves this\n    // banner in charge; \"loon\" and \"off\" both mean it must not install.\n    const loonBannerSource = await readLoonBannerSource();\n    if (loonBannerSource === \"loon\" || loonBannerSource === \"off\") return;";

const BANNER_EVENT_ANCHOR = "  pi.on(\"session_start\", async (_event, ctx) => {";
const BANNER_EVENT_REPLACEMENT = "  // LOON banner patch: read the banner source from LOON's own settings file.\n  async function readLoonBannerSource(): Promise<string | undefined> {\n    try {\n      const { readFile } = await import(\"node:fs/promises\");\n      const { join } = await import(\"node:path\");\n      const { homedir } = await import(\"node:os\");\n      const home = process.env.PI_CODING_AGENT_DIR || join(homedir(), \".pi\", \"agent\");\n      const parsed: unknown = JSON.parse(await readFile(join(home, \"loon-tui.json\"), \"utf8\"));\n      if (typeof parsed !== \"object\" || parsed === null) return undefined;\n      const source = (parsed as Record<string, unknown>).source;\n      return typeof source === \"string\" ? source : undefined;\n    } catch {\n      return undefined;\n    }\n  }\n  pi.on(\"session_start\", async (_event, ctx) => {";

/** The exact anchors, so a test can build a stand-in file around them. */
export const ANCHORS = {
	shellInit: SHELL_INIT_ANCHOR,
	shellRows: SHELL_ROWS_ANCHOR,
	bannerConfig: BANNER_CONFIG_ANCHOR,
	bannerEvent: BANNER_EVENT_ANCHOR,
};

export const TARGETS: TargetSpec[] = [
	{
		file: 'extensions/gentle-shell.ts',
		md5: 'ad1bfce79b655fc4f7cae71449d05d88',
		edits: [
			{ anchor: SHELL_INIT_ANCHOR, replacement: SHELL_INIT_ANCHOR + '\n' + SHELL_INIT_ADDITION },
			{ anchor: SHELL_ROWS_ANCHOR, replacement: SHELL_ROWS_REPLACEMENT },
		],
	},
	{
		file: 'extensions/startup-banner.ts',
		md5: '028bd98910468c7076ef31c65f36e09f',
		edits: [
			{ anchor: BANNER_EVENT_ANCHOR, replacement: BANNER_EVENT_REPLACEMENT },
			{ anchor: BANNER_CONFIG_ANCHOR, replacement: BANNER_CONFIG_ANCHOR + '\n' + BANNER_CONFIG_ADDITION },
		],
	},
];

export type PatchState = 'missing' | 'patched' | 'clean' | 'different-version';

export function md5(text: string): string {
	return createHash('md5').update(text).digest('hex');
}

/** What the file on disk is, relative to this patch. */
export function classify(text: string | undefined, spec: TargetSpec): PatchState {
	if (text === undefined) return 'missing';
	if (text.includes(PATCH_MARKER)) return 'patched';
	if (md5(text) === spec.md5) return 'clean';
	return 'different-version';
}

export type PatchResult = { ok: true; text: string; changed: boolean } | { ok: false; reason: string };

/** Apply every edit of one target to its text. Idempotent and anchor-checked. */
export function patchText(text: string, spec: TargetSpec): PatchResult {
	if (text.includes(PATCH_MARKER)) return { ok: true, text, changed: false };

	let next = text;
	for (const edit of spec.edits) {
		const occurrences = next.split(edit.anchor).length - 1;
		if (occurrences !== 1) {
			return { ok: false, reason: 'anchor for ' + spec.file + ' appears ' + occurrences + ' time(s), expected exactly 1' };
		}
		next = next.replace(edit.anchor, () => edit.replacement);
	}
	return { ok: true, text: next, changed: next !== text };
}

/** Every anchor present exactly once: the file is the build this patch knows. */
export function anchorsFit(text: string, spec: TargetSpec): boolean {
	return spec.edits.every((edit) => text.split(edit.anchor).length - 1 === 1);
}

export interface PatchPaths {
	install: string;
	backups: string;
}

export function defaultPaths(): PatchPaths {
	return {
		install: join(homedir(), '.pi', 'agent', 'npm', 'node_modules', 'gentle-pi'),
		backups: join(homedir(), '.pi', 'agent', 'backups'),
	};
}

function readTarget(spec: TargetSpec, paths: PatchPaths): string | undefined {
	try {
		return readFileSync(join(paths.install, spec.file), 'utf8');
	} catch {
		return undefined;
	}
}

/** The jiti entry pi itself loads extensions with, or undefined when not found. */
export function findPiInstall(paths: PatchPaths = defaultPaths()): string | undefined {
	const roots = [
		process.env.PI_NPM_PREFIX ? join(process.env.PI_NPM_PREFIX, 'lib', 'node_modules') : undefined,
		join(homedir(), '.local', 'share', 'loon-pi', 'npm-prefix', 'lib', 'node_modules'),
		join(dirname(process.execPath), '..', 'lib', 'node_modules'),
		join(paths.install, '..'),
	].filter((root): root is string => root !== undefined);
	for (const root of roots) {
		const candidate = join(root, '@earendil-works', 'pi-coding-agent');
		if (existsSync(join(candidate, 'package.json'))) return candidate;
	}
	return undefined;
}

/** The jiti entry inside a pi install, the loader pi itself loads extensions with. */
export function jitiEntry(piRoot: string): string {
	return join(piRoot, 'node_modules', 'jiti', 'lib', 'jiti-static.mjs');
}

/**
 * The module aliases pi hands to jiti, so an extension that imports
 * `@earendil-works/pi-coding-agent` resolves here exactly as it does at runtime.
 * Those packages are not installed next to gentle-pi; pi injects them.
 */
export function buildAliases(piRoot: string): Record<string, string> {
	const nested = join(piRoot, 'node_modules', '@earendil-works');
	const candidate = (relative: string): string | undefined => {
		const path = join(nested, relative);
		return existsSync(path) ? path : undefined;
	};
	const agentCore = candidate(join('pi-agent-core', 'dist', 'index.js'));
	const tui = candidate(join('pi-tui', 'dist', 'index.js'));
	const ai = candidate(join('pi-ai', 'dist'));
	const piIndex = join(piRoot, 'dist', 'index.js');
	const aliases: Record<string, string> = {};
	const add = (specifier: string, path: string | undefined): void => {
		if (path !== undefined) aliases[specifier] = path;
	};

	for (const prefix of ['@earendil-works', '@mariozechner']) {
		add(prefix + '/pi-coding-agent', piIndex);
		add(prefix + '/pi-agent-core', agentCore);
		add(prefix + '/pi-tui', tui);
		add(prefix + '/pi-ai', ai === undefined ? undefined : join(ai, 'compat.js'));
		add(prefix + '/pi-ai/compat', ai === undefined ? undefined : join(ai, 'compat.js'));
		add(prefix + '/pi-ai/oauth', ai === undefined ? undefined : join(ai, 'oauth.js'));
		add(prefix + '/pi-ai/models', ai === undefined ? undefined : join(ai, 'models.js'));
		add(prefix + '/pi-ai/providers/all', ai === undefined ? undefined : join(ai, 'providers', 'all.js'));
	}

	const piRequire = createRequire(join(piRoot, 'package.json'));
	for (const specifier of ['typebox', 'typebox/compile', 'typebox/value', '@sinclair/typebox', '@sinclair/typebox/compile', '@sinclair/typebox/value']) {
		try {
			add(specifier, piRequire.resolve(specifier));
		} catch {
			// Not installed beside pi: nothing to alias.
		}
	}
	return aliases;
}

const VALIDATOR_SOURCE = "const fs = await import('node:fs');\nconst [entry, aliasesPath, target] = process.argv.slice(2);\nconst aliases = JSON.parse(fs.readFileSync(aliasesPath, 'utf8'));\nlet createJiti;\nif (entry) {\n  const mod = await import(entry);\n  createJiti = mod.createJiti ?? mod.default?.createJiti;\n}\nif (typeof createJiti === 'function') {\n  const jiti = createJiti(import.meta.url, { moduleCache: false, interopDefault: true, fsCache: false, alias: aliases });\n  const factory = await jiti.import(target, { default: true });\n  if (typeof factory !== 'function') throw new Error('module has no default factory export');\n} else {\n  const mod = await import(target);\n  if (typeof mod.default !== 'function') throw new Error('module has no default factory export');\n}\nconsole.log('ok');";

/** Import a file in a child process, the way pi loads extensions. */
export function validateImport(
	targetPath: string,
	jiti: { entry: string; aliases: Record<string, string> } | undefined,
): { ok: boolean; detail: string } {
	const dir = join(tmpdir(), 'loon-patch-validate-' + process.pid);
	mkdirSync(dir, { recursive: true });
	const script = join(dir, 'validate.mjs');
	const aliasesPath = join(dir, 'aliases.json');
	try {
		writeFileSync(script, VALIDATOR_SOURCE);
		writeFileSync(aliasesPath, JSON.stringify(jiti?.aliases ?? {}));
		const output = execFileSync(process.execPath, ['--experimental-strip-types', script, jiti?.entry ?? '', aliasesPath, targetPath], {
			encoding: 'utf8',
			timeout: 120_000,
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		return { ok: output.trim().endsWith('ok'), detail: jiti ? 'jiti' : 'node strip-types' };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { ok: false, detail: message.split('\n').slice(0, 8).join('\n') };
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

function timestamp(): string {
	const now = new Date();
	const pad = (value: number) => String(value).padStart(2, '0');
	return [now.getFullYear(), pad(now.getMonth() + 1), pad(now.getDate()), pad(now.getHours()), pad(now.getMinutes()), pad(now.getSeconds())].join('');
}

function backupOriginals(paths: PatchPaths, specs: { spec: TargetSpec; text: string }[]): string {
	const dir = join(paths.backups, 'gentle-pi-banner-patch-' + timestamp());
	for (const { spec, text } of specs) {
		const target = join(dir, spec.file);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, text);
	}
	const manifest = {
		version: GENTLE_PI_VERSION,
		at: new Date().toISOString(),
		files: specs.map(({ spec, text }) => ({ file: spec.file, md5: md5(text) })),
	};
	writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, '\t') + '\n');
	return dir;
}

function writeAtomically(path: string, text: string): void {
	const temporary = path + '.' + process.pid + '.tmp';
	writeFileSync(temporary, text);
	renameSync(temporary, path);
}

export function report(paths: PatchPaths): number {
	for (const spec of TARGETS) {
		const text = readTarget(spec, paths);
		const state = classify(text, spec);
		const extra = state === 'different-version' ? ' (md5 ' + md5(text ?? '') + ', expected ' + spec.md5 + ')' : '';
		console.log(spec.file + ': ' + state + extra);
	}
	return 0;
}

export function apply(paths: PatchPaths): number {
	const prepared: { spec: TargetSpec; text: string; patched: string }[] = [];

	for (const spec of TARGETS) {
		const text = readTarget(spec, paths);
		const state = classify(text, spec);
		if (state === 'missing') {
			console.error(spec.file + ': not found under ' + paths.install + '; nothing was changed');
			return 1;
		}
		if (state === 'patched') {
			console.log(spec.file + ': already patched, skipping');
			continue;
		}
		if (state === 'different-version') {
			console.error(spec.file + ': md5 ' + md5(text ?? '') + ', expected ' + spec.md5 + ' for gentle-pi ' + GENTLE_PI_VERSION);
			console.error('this file is not the build the patch was written against; nothing was changed');
			return 2;
		}
		const result = patchText(text ?? '', spec);
		if (!result.ok) {
			console.error(spec.file + ': ' + result.reason + '; nothing was changed');
			return 2;
		}
		prepared.push({ spec, text: text ?? '', patched: result.text });
	}

	if (prepared.length === 0) {
		console.log('already patched');
		return 0;
	}

	const piRoot = findPiInstall(paths);
	const jiti = piRoot === undefined ? undefined : { entry: jitiEntry(piRoot), aliases: buildAliases(piRoot) };
	for (const { spec, patched } of prepared) {
		const original = join(paths.install, spec.file);
		const probe = original + '.' + process.pid + '.loon-patch.tmp.ts';
		const baseline = validateImport(original, jiti);
		if (!baseline.ok) {
			console.error(spec.file + ': the loader cannot import the untouched file, so a validation would prove nothing');
			console.error(baseline.detail);
			return 3;
		}
		try {
			writeFileSync(probe, patched);
			const check = validateImport(probe, jiti);
			if (!check.ok) {
				console.error(spec.file + ': the patched copy does not load; nothing was changed');
				console.error(check.detail);
				return 3;
			}
			console.log(spec.file + ': patched copy loads with ' + check.detail);
		} finally {
			rmSync(probe, { force: true });
		}
	}

	const dir = backupOriginals(paths, prepared.map(({ spec, text }) => ({ spec, text })));
	console.log('backup: ' + dir);
	for (const { spec, patched } of prepared) {
		writeAtomically(join(paths.install, spec.file), patched);
		console.log(spec.file + ': patched');
	}
	return 0;
}

export function latestBackup(paths: PatchPaths): string | undefined {
	if (!existsSync(paths.backups)) return undefined;
	const dirs = readdirSync(paths.backups).filter((name) => name.startsWith('gentle-pi-banner-patch-')).sort();
	const latest = dirs.at(-1);
	return latest === undefined ? undefined : join(paths.backups, latest);
}

export function revert(paths: PatchPaths): number {
	const dir = latestBackup(paths);
	if (dir === undefined) {
		console.error('no backup under ' + paths.backups + '; nothing was restored');
		return 1;
	}
	for (const spec of TARGETS) {
		const saved = join(dir, spec.file);
		if (!existsSync(saved)) {
			console.error('backup is missing ' + spec.file + '; nothing was restored');
			return 1;
		}
		const text = readFileSync(saved, 'utf8');
		if (md5(text) !== spec.md5) {
			console.error('backup of ' + spec.file + ' is md5 ' + md5(text) + ', expected ' + spec.md5 + '; nothing was restored');
			return 2;
		}
		copyFileSync(saved, join(paths.install, spec.file));
		if (md5(readFileSync(join(paths.install, spec.file), 'utf8')) !== spec.md5) {
			console.error(spec.file + ': restore did not produce the original bytes');
			return 2;
		}
		console.log(spec.file + ': restored (' + spec.md5 + ')');
	}
	console.log('restored from ' + dir);
	return 0;
}

export function main(argv: string[]): number {
	const paths = defaultPaths();
	const command = argv[0];
	if (command === 'check') return report(paths);
	if (command === 'apply') return apply(paths);
	if (command === 'revert') return revert(paths);
	console.error('usage: gentle-pi-patch.ts <check|apply|revert>');
	return 64;
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
	process.exitCode = main(process.argv.slice(2));
}
