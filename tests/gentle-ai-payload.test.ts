import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { PAYLOAD, PAYLOAD_FILES, checkDirectory, install, loadGentlePi } from '../scripts/gentle-ai-payload.mjs';

// The point of this suite is that the rules are gentle-pi's, not a copy: the payload
// is handed to the parsers the menu itself calls. Without an installed package there
// is nothing to check against, and the suite says so instead of pretending.
let loaded: Awaited<ReturnType<typeof loadGentlePi>> | undefined;
let unavailable: string | undefined;
try {
	loaded = await loadGentlePi();
} catch (error) {
	unavailable = error instanceof Error ? error.message : String(error);
}

function scratch(payload: string = PAYLOAD): string {
	const dir = mkdtempSync(join(tmpdir(), 'loon-payload-test-'));
	for (const name of PAYLOAD_FILES) cpSync(join(payload, name), join(dir, name));
	return dir;
}

test('the repository payload passes the parsers the menu itself uses', (t) => {
	if (loaded === undefined) return t.skip('gentle-pi is not installed: ' + String(unavailable));
	const dir = scratch();
	try {
		const { problems, fixes } = checkDirectory(dir, loaded.modules);
		assert.deepEqual(problems, [], 'the payload is what gentle-pi accepts');
		assert.equal(fixes.length, 2, JSON.stringify(fixes));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('a card style gentle-pi does not know is reported as the defect the owner saw', (t) => {
	if (loaded === undefined) return t.skip('gentle-pi is not installed: ' + String(unavailable));
	const dir = scratch();
	try {
		writeFileSync(join(dir, 'card-style.json'), JSON.stringify({ schema: 'gentle-pi.card-style/v1', style: 'retro' }));
		const { problems } = checkDirectory(dir, loaded.modules);
		assert.equal(problems.length, 1, JSON.stringify(problems));
		assert.match(problems[0] ?? '', /card-style\.json is not a valid/, problems[0]);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('the payload asks for the LOON geometry, and a stock install is told to patch first', (t) => {
	if (loaded === undefined) return t.skip('gentle-pi is not installed: ' + String(unavailable));
	const payloadStyle = JSON.parse(readFileSync(join(PAYLOAD, 'card-style.json'), 'utf8')).style;
	assert.equal(payloadStyle, 'loon', 'the LOON card geometry is the point of the patch, not a preference');
	const dir = scratch();
	try {
		// Measured, not assumed: a stock install rejects it and the message names the fix.
		const { problems } = checkDirectory(dir, loaded.modules);
		if (problems.length === 0) {
			assert.equal(loaded.modules['card-style-policy'].parseCardStyleFile(readFileSync(join(dir, 'card-style.json'), 'utf8')), 'loon');
			return;
		}
		assert.match(problems[0] ?? '', /gentle-pi-patch\.ts apply/, problems[0]);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('the writer is strict about the eight section keys even though the reader fills a missing one', (t) => {
	if (loaded === undefined) return t.skip('gentle-pi is not installed: ' + String(unavailable));
	const dir = scratch();
	try {
		const file = JSON.parse(readFileSync(join(dir, 'visual-profiles.json'), 'utf8')) as {
			profiles: Array<{ visual: { visibility: Record<string, boolean> } }>;
		};
		const seven = { ...file.profiles[0]!.visual.visibility };
		delete seven.stats;
		// Measured, not assumed: isVisualSettings is the writer-side rule and it demands
		// every key; the reader normalises a missing one instead. LOON writes all eight so
		// the profile is valid on both sides and survives a save from the menu.
		assert.equal(loaded.modules['visual-customization-policy'].isVisualSettings({ ...file.profiles[0]!.visual, visibility: seven }), false);
		file.profiles[0]!.visual.visibility = seven;
		writeFileSync(join(dir, 'visual-profiles.json'), JSON.stringify(file));
		const parsed = loaded.modules['visual-profiles'].parseVisualProfilesFile(readFileSync(join(dir, 'visual-profiles.json'), 'utf8'));
		assert.equal(parsed?.length, 1);
		assert.deepEqual(Object.keys(parsed[0]!.visual.visibility).sort(), ['agents', 'changes', 'contextWarning', 'modelDetails', 'rdd', 'stats', 'todo', 'usageCost']);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('the payload names the schema gentle-pi declares, so a rename cannot pass silently', (t) => {
	if (loaded === undefined) return t.skip('gentle-pi is not installed: ' + String(unavailable));
	const card = JSON.parse(readFileSync(join(PAYLOAD, 'card-style.json'), 'utf8')) as { schema: string };
	const profiles = JSON.parse(readFileSync(join(PAYLOAD, 'visual-profiles.json'), 'utf8')) as { schema: string };
	assert.equal(card.schema, loaded.modules['card-style-policy'].CARD_STYLE_SCHEMA);
	assert.equal(profiles.schema, loaded.modules['visual-profiles'].VISUAL_PROFILES_SCHEMA);
});

test('installing keeps a copy of what was there, so the owner can go back', () => {
	const dir = mkdtempSync(join(tmpdir(), 'loon-payload-install-'));
	try {
		writeFileSync(join(dir, 'card-style.json'), JSON.stringify({ schema: 'gentle-pi.card-style/v1', style: 'neon' }));
		const done = install(dir);
		assert.ok(done.some((line) => line.startsWith('backup ')), JSON.stringify(done));
		// A file that already says what LOON asks for is left untouched, not rewritten.
		const second = install(dir);
		assert.deepEqual(
			second.filter((line) => line.includes('card-style.json')),
			['kept ' + join(dir, 'card-style.json')],
			JSON.stringify(second),
		);
		assert.equal(JSON.parse(readFileSync(join(dir, 'card-style.json'), 'utf8')).style, 'loon');
		const backup = done.find((line) => line.startsWith('backup '))!.slice('backup '.length);
		assert.equal(JSON.parse(readFileSync(backup, 'utf8')).style, 'neon', 'the old value survives in the backup');
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
