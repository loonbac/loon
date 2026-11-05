#!/usr/bin/env node
/**
 * The gentle-pi configuration payload LOON asks the owner to install.
 *
 * gentle-pi 4.6.0 keeps its preferences under the human-controlled directory
 * ~/.pi/gentle-ai/. A model tool cannot write there, so this script prepares the
 * payload, hands the owner one command, and verifies the result with gentle-pi's
 * own parsers instead of a copy of its rules.
 *
 *   node scripts/gentle-ai-payload.mjs show      print the payload and the command
 *   node scripts/gentle-ai-payload.mjs verify    check the live files (reads only)
 *   node scripts/gentle-ai-payload.mjs verify --dir <path>
 *   node scripts/gentle-ai-payload.mjs apply     back up, install, verify
 *
 * apply is the owner's action: it is the only subcommand that writes outside this
 * repository, and it is never run by an agent.
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(HERE, '..');
export const PAYLOAD = join(REPO, 'config', 'gentle-ai');
/** The files this payload owns, in the order they are installed. */
export const PAYLOAD_FILES = ['card-style.json', 'visual-profiles.json'];

const CANDIDATE_PACKAGES = [
	join(homedir(), '.pi', 'agent', 'npm', 'node_modules', 'gentle-pi'),
	join(homedir(), '.local', 'share', 'loon-pi', 'npm-prefix', 'lib', 'node_modules', 'gentle-pi'),
];

/**
 * The installed gentle-pi package, or a loud failure: an absent package means the
 * payload cannot be checked against the rules that will actually read it.
 * @returns {string}
 */
export function gentlePiRoot() {
	const override = process.env.GENTLE_PI_ROOT;
	const found = (override === undefined ? CANDIDATE_PACKAGES : [override]).find((path) => existsSync(join(path, 'package.json')));
	if (found === undefined) {
		throw new Error('gentle-pi is not installed where LOON expects it: ' + CANDIDATE_PACKAGES.join(', '));
	}
	return found;
}

/**
 * gentle-pi's own module of every rule the payload has to satisfy.
 *
 * Its sources cannot be imported where they live: node refuses to strip types
 * under node_modules. So the library is copied to a scratch directory, given a
 * module package.json and the one TUI module the shell pulls in, and imported
 * from there. The rules are then gentle-pi's, not a copy that can drift.
 * @param {string} [root]
 * @returns {Promise<Record<string, any>>}
 */
export async function loadGentlePi(root = gentlePiRoot()) {
	const staged = mkdtempSync(join(tmpdir(), 'loon-gentle-payload-'));
	const lib = join(staged, 'lib');
	cpSync(join(root, 'lib'), lib, { recursive: true });
	cpSync(join(root, 'extensions'), join(staged, 'extensions'), { recursive: true, filter: (source) => source.endsWith('startup-banner.ts') });
	writeFileSync(join(staged, 'package.json'), JSON.stringify({ type: 'module' }));
	const stub = join(staged, 'node_modules', '@earendil-works', 'pi-tui');
	mkdirSync(stub, { recursive: true });
	writeFileSync(join(stub, 'package.json'), JSON.stringify({ name: '@earendil-works/pi-tui', version: '0.0.0', type: 'module', main: 'index.js' }));
	writeFileSync(
		join(stub, 'index.js'),
		[
			'export const truncateToWidth = (text, width) => String(text).slice(0, Math.max(0, width));',
			'export const visibleWidth = (text) => String(text).replace(/\\u001b\\[[0-9;]*m/g, \'\').length;',
			'export const wrapTextWithAnsi = (text) => [String(text)];',
		].join('\n'),
	);
	try {
		const modules = {};
		for (const name of ['agent-home', 'card-style-policy', 'visual-customization-policy', 'visual-profiles', 'animation-policy']) {
			modules[name] = await import(pathToFileURL(join(lib, name + '.ts')).href);
		}
		return { staged, modules };
	} catch (error) {
		rmSync(staged, { recursive: true, force: true });
		throw error;
	}
}

/**
 * Check one directory of gentle-pi configuration with gentle-pi's parsers.
 * @param {string} home the configuration directory to read
 * @param {Record<string, any>} modules the loaded gentle-pi modules
 * @returns {{ problems: string[], fixes: string[] }}
 */
export function checkDirectory(home, modules) {
	const problems = [];
	const fixes = [];
	// Whether this install carries LOON's third card style. Stock gentle-pi knows two.
	const loonKnown =
		modules['card-style-policy'].parseCardStyleFile(JSON.stringify({ schema: modules['card-style-policy'].CARD_STYLE_SCHEMA, style: 'loon' })) === 'loon';
	const cardStylePath = join(home, 'card-style.json');
	if (!existsSync(cardStylePath)) {
		problems.push('card-style.json is missing: Cards cannot save a style');
	} else {
		const style = modules['card-style-policy'].parseCardStyleFile(readFileSync(cardStylePath, 'utf8'));
		if (style === undefined) {
			const wantsLoon = (() => {
				try {
					return JSON.parse(readFileSync(cardStylePath, 'utf8')).style === 'loon';
				} catch {
					return false;
				}
			})();
			problems.push(
				'card-style.json is not a valid gentle-pi.card-style/v1 file: Cards will read it as malformed and refuse to save' +
					(wantsLoon && !loonKnown
						? ' — it asks for the LOON geometry and this install does not carry it: run node --experimental-strip-types scripts/gentle-pi-patch.ts apply first'
						: ''),
			);
		} else {
			fixes.push('card style reads as ' + style);
		}
	}
	const profilesPath = join(home, 'visual-profiles.json');
	if (!existsSync(profilesPath)) {
		problems.push('visual-profiles.json is missing: Profiles cannot offer the loon profile');
	} else {
		const raw = readFileSync(profilesPath, 'utf8');
		const profiles = modules['visual-profiles'].parseVisualProfilesFile(raw);
		if (profiles === undefined) {
			problems.push('visual-profiles.json is not a valid gentle-pi.visual-profiles/v1 file: Profiles will read it as malformed');
		} else if (profiles.length === 0) {
			problems.push('visual-profiles.json holds no profile');
		} else {
			for (const profile of profiles) {
				if (modules['visual-customization-policy'].isVisualSettings(profile.visual) !== true) {
					problems.push('profile ' + profile.name + ' has visual settings gentle-pi rejects');
					continue;
				}
				fixes.push('profile ' + profile.name + ' reads with theme ' + profile.themeName + ' and ' + Object.keys(profile.visual.visibility).length + ' section keys');
			}
		}
	}
	return { problems, fixes };
}

/**
 * Where the routing repository lives, when it is installed next to this one.
 * @param {NodeJS.ProcessEnv} [env]
 * @param {string} [here]
 * @returns {string | undefined}
 */
export function routingRepository(env = process.env, here = HERE) {
	const explicit = env.LOON_ROUTING_REPO;
	if (explicit !== undefined && explicit.trim() !== '') return resolve(explicit.trim());
	const sibling = resolve(here, '..', '..', 'loon-routing');
	return existsSync(join(sibling, 'scripts', 'gentle-pi-patch.mjs')) ? sibling : undefined;
}

/**
 * Apply the routing patches *now*, as part of installing, instead of at the next session start.
 *
 * Pi loads an extension when a session starts, so a patch written from that session's own hook can only
 * take effect on the following one — the owner saw that as "I restarted and nothing changed", twice. The
 * hook keeps its auto-apply as a safety net for `pi update` replacing the file; doing it here is what
 * removes the second restart.
 * @param {string} repository
 * @returns {{ ok: boolean, output: string }}
 */
export function applyRoutingPatch(repository) {
	const script = join(repository, 'scripts', 'gentle-pi-patch.mjs');
	const result = spawnSync(process.execPath, [script, 'apply'], { encoding: 'utf8' });
	const output = ((result.stdout ?? '') + (result.stderr ?? '')).trimEnd();
	return { ok: result.status === 0, output };
}

/**
 * Install the payload, keeping a copy of whatever was there first.
 * @param {string} home
 * @param {string} [payload]
 * @returns {string[]}
 */
export function install(home, payload = PAYLOAD) {
	mkdirSync(home, { recursive: true });
	const stamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
	const done = [];
	const source = (name) => JSON.stringify(JSON.parse(readFileSync(join(payload, name), 'utf8')));
	for (const name of PAYLOAD_FILES) {
		const target = join(home, name);
		// A file that already says exactly this is left alone: the owner's value wins as
		// long as it is the value LOON asks for, and rewriting it would only churn a
		// timestamp without changing anything.
		if (existsSync(target)) {
			let same = false;
			try {
				same = JSON.stringify(JSON.parse(readFileSync(target, 'utf8'))) === source(name);
			} catch {
				same = false;
			}
			if (same) {
				done.push('kept ' + target);
				continue;
			}
			const backup = target + '.bak-' + stamp;
			cpSync(target, backup);
			done.push('backup ' + backup);
		}
		cpSync(join(payload, name), target);
		done.push('installed ' + target);
	}
	return done;
}

async function main() {
	const [command, ...rest] = process.argv.slice(2);
	const dirIndex = rest.indexOf('--dir');
	const explicitDir = dirIndex >= 0 ? rest[dirIndex + 1] : undefined;
	const { staged, modules } = await loadGentlePi();
	const home = explicitDir === undefined ? modules['agent-home'].gentlePiConfigHome() : resolve(explicitDir);
	const version = JSON.parse(readFileSync(join(gentlePiRoot(), 'package.json'), 'utf8')).version;
	try {
		if (command === 'show') {
			console.log('gentle-pi ' + version + ' · configuration directory ' + home);
			for (const name of PAYLOAD_FILES) {
				console.log('');
				console.log('--- ' + name);
				console.log(readFileSync(join(PAYLOAD, name), 'utf8').trimEnd());
			}
			console.log('');
			console.log('Apply it, from this repository:');
			console.log('  node scripts/gentle-ai-payload.mjs apply');
			return 0;
		}
		if (command === 'apply') {
			for (const line of install(home)) console.log(line);
			// The routing patches edit the extension file this install just wrote, so they belong here and
			// not in a session that has already loaded it. A missing or failing sibling is reported, never
			// fatal: LOON's own install must not depend on another repository being present.
			const routing = routingRepository();
			if (routing === undefined) {
				console.log('note: no loon-routing repository next to this one (set LOON_ROUTING_REPO to it): its review patches will be applied by the next Pi start and need one more restart');
			} else {
				const routed = applyRoutingPatch(routing);
				for (const line of routed.output.split('\n')) if (line !== '') console.log('routing ' + line);
				if (!routed.ok) console.log('PROBLEM the loon-routing patch did not apply: the next Pi start will retry it and ask for a restart');
			}
			const { problems, fixes } = checkDirectory(home, modules);
			for (const fix of fixes) console.log('ok ' + fix);
			for (const problem of problems) console.log('PROBLEM ' + problem);
			if (problems.length > 0) return 1;
			console.log('');
			console.log('Restart Pi: the Cards row stops reading as malformed and Profiles offers loon.');
			return 0;
		}
		if (command === 'verify') {
			const { problems, fixes } = checkDirectory(home, modules);
			console.log('gentle-pi ' + version + ' · configuration directory ' + home);
			for (const fix of fixes) console.log('ok ' + fix);
			for (const problem of problems) console.log('PROBLEM ' + problem);
			return problems.length > 0 ? 1 : 0;
		}
		console.error('usage: gentle-ai-payload.mjs show | verify [--dir <path>] | apply');
		return 2;
	} finally {
		rmSync(staged, { recursive: true, force: true });
	}
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	main().then((code) => process.exit(code), (error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	});
}
