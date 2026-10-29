import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { watchConfigDirs, type WatchHandle } from '../extensions/lib/config-watch.ts';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function fakeDir() {
	const listeners = new Set<() => void>();
	const closed: string[] = [];
	const watchDir = (dir: string, onChange: () => void): WatchHandle => {
		listeners.add(onChange);
		return {
			close: () => {
				closed.push(dir);
				listeners.delete(onChange);
			},
		};
	};
	return {
		watchDir,
		closed,
		fire: () => {
			for (const listener of [...listeners]) listener();
		},
	};
}

test('several events collapse into one debounced change', async () => {
	const dir = fakeDir();
	let changes = 0;
	watchConfigDirs(['/a', '/b'], () => {
		changes += 1;
	}, { debounceMs: 15, watchDir: dir.watchDir });

	dir.fire();
	dir.fire();
	dir.fire();
	assert.equal(changes, 0, 'reported before the debounce elapsed');
	await wait(40);
	assert.equal(changes, 1);
});

test('disposing closes every watch and stops reporting', async () => {
	const dir = fakeDir();
	let changes = 0;
	const dispose = watchConfigDirs(['/a', '/b'], () => {
		changes += 1;
	}, { debounceMs: 10, watchDir: dir.watchDir });

	dir.fire();
	dispose();
	assert.deepEqual(dir.closed, ['/a', '/b']);
	await wait(30);
	assert.equal(changes, 0, 'a pending change survived the disposer');
});

test('a directory that cannot be watched is silent, not fatal', () => {
	const missing = join(mkdtempSync(join(tmpdir(), 'loon-watch-')), 'nope');
	let changes = 0;
	const dispose = watchConfigDirs([missing], () => {
		changes += 1;
	}, { debounceMs: 10 });
	dispose();
	assert.equal(changes, 0);
});

test('a real directory reports a write', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'loon-watch-'));
	let changes = 0;
	const dispose = watchConfigDirs([dir], () => {
		changes += 1;
	}, { debounceMs: 20 });
	try {
		writeFileSync(join(dir, 'banner.json'), '{}');
		await wait(400);
		assert.ok(changes >= 1, 'a write in a watched directory was not reported');
	} finally {
		dispose();
	}
});
