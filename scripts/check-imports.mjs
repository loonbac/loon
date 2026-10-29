#!/usr/bin/env node
// Verifies the invariant a file move can break: every relative import in the
// extension resolves, and every production module is reachable from the entry.
//
// Importing the entry directly is not an option: the extension does value
// imports of scoped peer packages (@earendil-works/pi-tui, .../pi-coding-agent)
// that a bare checkout does not install, so a plain import fails on unchanged
// code and cannot tell a broken move from the normal peer-dependency gap.
//
// Usage: node scripts/check-imports.mjs [extension-dir]
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const dir = resolve(process.argv[2] ?? "extension");
const entry = join(dir, "index.ts");

// Recursive on purpose: a flat listing of the top level misses tools/*.ts,
// which is 4.055 of the 4.896 dead lines this check exists to catch.
const listModules = (current, prefix = "") => {
	const found = [];
	for (const entry of readdirSync(current, { withFileTypes: true })) {
		if (entry.isDirectory()) {
			found.push(...listModules(join(current, entry.name), prefix + entry.name + "/"));
		} else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
			found.push(prefix + entry.name);
		}
	}
	return found;
};
const files = listModules(dir);

const specifier = /(?:from\s*|import\s*\(\s*)["'](\.{1,2}\/[^"']+)["']/g;
const missing = [];
const extensionMismatch = [];
const edges = new Map();

for (const file of files) {
	const full = join(dir, file);
	const source = readFileSync(full, "utf8");
	const targets = new Set();
	for (const match of source.matchAll(specifier)) {
		const spec = match[1];
		let target = resolve(dirname(full), spec);
		if (!existsSync(target)) {
			// A ".js" specifier that names a ".ts" file is erased by the type
			// stripper today, so it loads, but it is a trap: it breaks the moment
			// the import becomes a value import or the resolver changes.
			if (spec.endsWith(".js") && existsSync(target.replace(/\.js$/, ".ts"))) {
				extensionMismatch.push(`${file}: ${spec} (file is .ts)`);
				target = target.replace(/\.js$/, ".ts");
			} else {
				missing.push(`${file}: ${spec}`);
				continue;
			}
		}
		targets.add(target);
	}
	edges.set(full, targets);
}

const reached = new Set();
const walk = (file) => {
	if (reached.has(file)) return;
	reached.add(file);
	for (const next of edges.get(file) ?? []) walk(next);
};
walk(entry);
const orphans = files.map((f) => join(dir, f)).filter((f) => !reached.has(f));

for (const line of extensionMismatch) console.warn(`warn  ${line}`);
for (const line of missing) console.error(`error ${line} does not exist`);
for (const line of orphans) console.error(`error ${line} is unreachable from index.ts`);
console.log(
	`${files.length} modules, ${missing.length} unresolved, ${orphans.length} unreachable, ${extensionMismatch.length} .js/.ts mismatch`,
);
process.exit(missing.length + orphans.length === 0 ? 0 : 1);
