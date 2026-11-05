import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { applyRoutingPatch, routingRepository } from '../scripts/gentle-ai-payload.mjs';

// The owner's complaint, in one line: he restarted and nothing changed, because the patch was written
// by the session that had already loaded the unpatched file. Installing has to leave the file current,
// so that the *next* start is the first one that uses it.

function scratch(): string {
	const dir = mkdtempSync(join(tmpdir(), 'loon-routing-install-'));
	test.after?.(() => rmSync(dir, { recursive: true, force: true }));
	return dir;
}

/** A routing repository stand-in: just the command the install calls, with an observable effect. */
function fakeRoutingRepo(root: string, body: string): string {
	const repository = join(root, 'loon-routing');
	mkdirSync(join(repository, 'scripts'), { recursive: true });
	writeFileSync(join(repository, 'scripts', 'gentle-pi-patch.mjs'), body);
	writeFileSync(join(repository, 'package.json'), '{ "type": "module" }\n');
	return repository;
}

test('the sibling routing repository is found, and an explicit variable wins', () => {
	const root = scratch();
	const explicit = join(root, 'elsewhere');
	const here = join(root, 'loon', 'scripts');
	mkdirSync(here, { recursive: true });
	const sibling = fakeRoutingRepo(root, '');
	assert.equal(routingRepository({}, here), sibling, 'the sibling path is found without configuration');
	assert.equal(routingRepository({ LOON_ROUTING_REPO: explicit }, here), explicit, 'an explicit repository is honoured');
});

test('with no routing repository the install says so instead of staying silent', () => {
	const root = scratch();
	const here = join(root, 'loon', 'scripts');
	mkdirSync(here, { recursive: true });
	assert.equal(routingRepository({}, here), undefined, 'nothing to patch is not a crash');
});

test('installing applies the routing patch before any session starts', () => {
	const root = scratch();
	const marker = join(root, 'applied.txt');
	const repository = fakeRoutingRepo(
		root,
		`import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(marker)}, process.argv.slice(2).join(' '));
console.log('unit routes: applied');
`,
	);
	const result = applyRoutingPatch(repository);
	assert.equal(result.ok, true);
	assert.match(result.output, /unit routes: applied/u, 'the patch talks, and the install relays it');
	assert.equal(existsSync(marker), true, 'the patch actually ran');
	assert.equal(readFileSync(marker, 'utf8'), 'apply', 'it was asked to apply, not to report');
});

test('a patch that refuses is reported as a problem, and never as success', () => {
	const root = scratch();
	const repository = fakeRoutingRepo(root, 'console.error("wrote nothing: a moved anchor is a refusal, not a half patch");\nprocess.exit(1);\n');
	const result = applyRoutingPatch(repository);
	assert.equal(result.ok, false);
	assert.match(result.output, /wrote nothing/u);
});
