import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const SCRIPT = join(REPO, 'scripts', 'probe-frame.sh');

/**
 * A throwaway pi home with the four files a probe can disturb. The loon settings are
 * deliberately partial: that is the state the real machine was left in, and the probe
 * has to hand back those exact bytes, not a rebuilt default.
 */
function scratchHome(): { root: string; agent: string; gentle: string; env: NodeJS.ProcessEnv } {
	const root = mkdtempSync(join(tmpdir(), 'loon-probe-'));
	const agent = join(root, 'agent');
	const gentle = join(root, 'gentle');
	mkdirSync(join(agent, 'themes'), { recursive: true });
	mkdirSync(gentle, { recursive: true });
	writeFileSync(join(agent, 'settings.json'), '{"theme":"Gentle"}\n');
	writeFileSync(join(agent, 'loon-tui.json'), '{\n\t"accent": "wallpaper"\n}\n');
	writeFileSync(join(agent, 'themes', 'Wallpaper (LOON).json'), '{"name":"Wallpaper (LOON)"}\n');
	return {
		root,
		agent,
		gentle,
		env: {
			...process.env,
			HOME: root,
			PI_CODING_AGENT_DIR: agent,
			GENTLE_PI_REAL_HOME: gentle,
			LOON_PROBE_ROOT: join(root, 'probes'),
		},
	};
}

function run(args: string[], env: NodeJS.ProcessEnv): { status: number; stdout: string; stderr: string } {
	const result = spawnSync('bash', [SCRIPT, ...args], { encoding: 'utf8', env });
	return { status: result.status ?? -1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function snapshot(env: NodeJS.ProcessEnv, label = 'test'): string {
	return execFileSync('bash', [SCRIPT, 'snapshot', '--label', label], { encoding: 'utf8', env }).trim();
}

test('the snapshot records the four files and the themes directory', () => {
	const home = scratchHome();
	try {
		const state = snapshot(home.env);
		const manifest = readFileSync(join(state, 'manifest'), 'utf8').trim().split('\n');
		assert.equal(manifest.length, 5, 'four config files plus the themes directory');
		assert.match(manifest[0]!, /settings\.json\tfile:[0-9a-f]{64}$/);
		assert.match(manifest[1]!, /loon-tui\.json\tfile:[0-9a-f]{64}$/);
		assert.match(manifest[2]!, /visual-customization\.json\tabsent$/);
		assert.match(manifest[3]!, /banner\.json\tabsent$/);
		assert.match(manifest[4]!, /themes\tdir:[0-9a-f]{64}$/);
	} finally {
		rmSync(home.root, { recursive: true, force: true });
	}
});

test('a partial configuration is handed back byte for byte, and a deleted file comes back', () => {
	const home = scratchHome();
	try {
		const before = readFileSync(join(home.agent, 'loon-tui.json'));
		const state = snapshot(home.env);

		// What a careless probe does: rewrites the settings with a full object and
		// deletes a file it decided it did not need.
		writeFileSync(join(home.agent, 'loon-tui.json'), '{"enabled":true,"accent":"banner","mark":true,"source":"loon"}\n');
		rmSync(join(home.agent, 'settings.json'));
		writeFileSync(join(home.agent, 'themes', 'Wallpaper (LOON).json'), '{"name":"changed"}\n');

		const restored = run(['restore', '--state', state], home.env);
		assert.equal(restored.status, 0, restored.stderr + restored.stdout);
		assert.deepEqual(readFileSync(join(home.agent, 'loon-tui.json')), before, 'the partial file must come back exactly as it was');
		assert.equal(readFileSync(join(home.agent, 'settings.json'), 'utf8'), '{"theme":"Gentle"}\n', 'a deleted file must come back');
		assert.equal(readFileSync(join(home.agent, 'themes', 'Wallpaper (LOON).json'), 'utf8'), '{"name":"Wallpaper (LOON)"}\n');
		assert.equal(run(['verify', '--state', state], home.env).status, 0);
	} finally {
		rmSync(home.root, { recursive: true, force: true });
	}
});

test('a file that did not exist is removed again, not created', () => {
	const home = scratchHome();
	try {
		const state = snapshot(home.env);
		writeFileSync(join(home.gentle, 'banner.json'), '{"showRose":false}\n');
		assert.equal(run(['restore', '--state', state], home.env).status, 0);
		assert.equal(run(['verify', '--state', state], home.env).status, 0);
		assert.ok(!readdirSync(home.gentle).includes('banner.json'), 'the probe must not leave a file it invented');
	} finally {
		rmSync(home.root, { recursive: true, force: true });
	}
});

test('a difference is a failure, not a footnote', () => {
	const home = scratchHome();
	try {
		const state = snapshot(home.env);
		writeFileSync(join(home.agent, 'loon-tui.json'), '{"enabled":true}\n');
		const verified = run(['verify', '--state', state], home.env);
		assert.equal(verified.status, 3, 'a changed file must not pass verification');
		assert.match(verified.stderr, /loon-tui\.json/);
		assert.match(verified.stderr, /was file:[0-9a-f]{64}/);
		assert.match(verified.stderr, /now file:[0-9a-f]{64}/);
	} finally {
		rmSync(home.root, { recursive: true, force: true });
	}
});

test('a restore that cannot reproduce the snapshot fails loudly', () => {
	const home = scratchHome();
	try {
		const state = snapshot(home.env);
		rmSync(join(state, 'files', '1'));
		writeFileSync(join(home.agent, 'loon-tui.json'), '{"enabled":true}\n');
		const restored = run(['restore', '--state', state], home.env);
		assert.equal(restored.status, 3, 'a missing snapshot copy must not be reported as success');
		assert.match(restored.stderr, /no snapshot copy/);
	} finally {
		rmSync(home.root, { recursive: true, force: true });
	}
});

test('a corrupted snapshot copy is refused before it can overwrite the real file', () => {
	const home = scratchHome();
	try {
		const state = snapshot(home.env);
		const before = readFileSync(join(home.agent, 'loon-tui.json'), 'utf8');
		// Two corruptions: bytes that are not what was recorded. The restore has to
		// notice before copying, because copying first would leave the person's file
		// holding the corrupted bytes.
		writeFileSync(join(state, 'files', '1'), '{"garbage":true}\n');
		writeFileSync(join(home.agent, 'loon-tui.json'), '{"enabled":true}\n');
		const restored = run(['restore', '--state', state], home.env);
		assert.equal(restored.status, 3, 'a corrupt snapshot must fail the restore');
		assert.match(restored.stderr, /is corrupt/);
		assert.match(restored.stderr, /nothing was restored/);
		assert.equal(readFileSync(join(home.agent, 'loon-tui.json'), 'utf8'), '{"enabled":true}\n', 'the live file must not be overwritten with corrupt bytes');
		assert.equal(before, '{\n\t"accent": "wallpaper"\n}\n');
	} finally {
		rmSync(home.root, { recursive: true, force: true });
	}
});

test('a manifest cannot name a file the slot does not own', () => {
	const home = scratchHome();
	try {
		const outside = join(home.root, 'outside.json');
		writeFileSync(outside, 'keep me\n');

		// An absolute path elsewhere, and a traversal dressed up as a path inside the
		// agent home. The digest stays valid so the slot check is what refuses them:
		// the slot decides the path, not the manifest.
		for (const escape of [outside, join(home.agent, '..', 'outside.json')]) {
			const state = snapshot(home.env);
			const lines = readFileSync(join(state, 'manifest'), 'utf8').trim().split('\n');
			lines[0] = '0\t' + escape + '\t' + lines[0]!.split('\t')[2];
			writeFileSync(join(state, 'manifest'), lines.join('\n') + '\n');
			const restored = run(['restore', '--state', state], home.env);
			assert.notEqual(restored.status, 0, 'restore must refuse ' + escape);
			assert.match(restored.stderr, /refusing slot 0/);
			assert.equal(readFileSync(outside, 'utf8'), 'keep me\n', 'a file outside the slot must never be touched');
			assert.equal(readFileSync(join(home.agent, 'settings.json'), 'utf8'), '{"theme":"Gentle"}\n', 'the real slot file must be left alone too');
		}
	} finally {
		rmSync(home.root, { recursive: true, force: true });
	}
});

test('when the snapshot cannot be written, nothing is started', () => {
	const home = scratchHome();
	try {
		const blocked = join(home.root, 'blocked');
		mkdirSync(blocked);
		const env = { ...home.env, LOON_PROBE_ROOT: join(blocked, 'probes') };
		writeFileSync(join(blocked, 'probes'), 'not a directory\n');
		const captured = run(['capture', '--label', 'nope', '--settle', '1', '--out', join(home.root, 'frame.txt')], env);
		assert.equal(captured.status, 2, 'capture must refuse before running pi');
		assert.match(captured.stderr, /nothing was started/);
		assert.throws(() => readFileSync(join(home.root, 'frame.txt')), 'no frame may be written when the snapshot failed');
	} finally {
		rmSync(home.root, { recursive: true, force: true });
	}
});

test('a probe that never draws a frame fails, and still restores the configuration', () => {
	const home = scratchHome();
	try {
		// A session that stays blank: the old capture loop accepted it and wrote an
		// empty file, which is not a measurement.
		// The fake session both stays blank and rewrites the settings, which is what a
		// real pi does under a probe. The exit trap has to undo that.
		const mutate = 'printf \'{"enabled":true,"accent":"banner"}\' > ' + join(home.agent, 'loon-tui.json') + '; sleep 30';
		const captured = run(['capture', '--label', 'blank', '--settle', '1', '--command', mutate, '--out', join(home.root, 'frame.txt')], home.env);
		assert.equal(captured.status, 4, 'an empty pane must not count as a frame');
		assert.match(captured.stderr, /produced no frame/);
		assert.throws(() => readFileSync(join(home.root, 'frame.txt')), 'no frame file may be left behind');
		const state = /state: (\S+)/.exec(captured.stderr);
		assert.ok(state, 'the state directory must be announced before pi starts');
		assert.equal(run(['verify', '--state', state[1]!], home.env).status, 0, 'the exit trap must restore after a failed probe');
		assert.equal(readFileSync(join(home.agent, 'loon-tui.json'), 'utf8'), '{\n\t"accent": "wallpaper"\n}\n', 'the bytes must be the ones from before the probe');
	} finally {
		rmSync(home.root, { recursive: true, force: true });
	}
});

test('no script or test writes a configuration file directly', () => {
	// The failure this guards: a verification script redirecting a partial object into
	// pi's real loon-tui.json, or deleting it, and leaving it that way.
	const files: string[] = [];
	const walk = (dir: string): void => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
			const path = join(dir, entry.name);
			if (entry.isDirectory()) walk(path);
			else if (/\.(sh|ts|mts)$/.test(entry.name)) files.push(path);
		}
	};
	walk(join(REPO, 'scripts'));
	walk(join(REPO, 'tests'));

	const forbidden = [
		// a shell redirect into the settings file, complete or not
		/(^|[^<0-9])>\s*"?[^\s"]*loon-tui\.json/m,
		// deleting the file the person's settings live in
		/\brm\s+(-[a-zA-Z]+\s+)*[^\s]*loon-tui\.json/m,
		// writing it from code
		/writeFileSync\(\s*[^)]*loonConfigPath/m,
	];
	const offenders: string[] = [];
	for (const path of files) {
		// Comments are allowed to quote the mistake this guards against.
		const text = readFileSync(path, 'utf8')
			.split('\n')
			.filter((line) => !/^\s*#/.test(line))
			.join('\n');
		for (const pattern of forbidden) {
			const match = pattern.exec(text);
			if (match) offenders.push(path + ': ' + match[0].trim());
		}
	}
	assert.deepEqual(offenders, [], 'configuration must only change through scripts/probe-frame.sh');
});
