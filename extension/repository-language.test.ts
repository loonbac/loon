import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
	detectWorkUnitLanguage,
	languageFromFiles,
	languageFromTaskText,
} from "./repository-language.ts";

test("a file named in the task decides the language", () => {
	assert.equal(languageFromTaskText("Fix the parser in src/main.rs"), "rust");
	assert.equal(languageFromTaskText("Update extension/index.ts to register the hook"), "typescript");
	assert.equal(languageFromTaskText("patch scripts/deploy.sh"), "shell");
	assert.equal(languageFromTaskText("read Cargo.toml and report the version"), undefined);
	// A module manifest is not source: `go.mod` is not a `.go` file.
	assert.equal(languageFromTaskText("bump the go.mod require line"), undefined);
});

test("dots that are not file extensions never decide the language", () => {
	// A version, a hostname, a dotted module path and a bare word.
	assert.equal(languageFromTaskText("Upgrade to v1.2.3 and redeploy"), undefined);
	assert.equal(languageFromTaskText("Check api.example.com is reachable"), undefined);
	assert.equal(languageFromTaskText("read src/handler.go before editing"), "go");
});

test("the most frequently named extension wins, ties toward first mention", () => {
	assert.equal(languageFromTaskText("touch a.py then b.py then c.rs"), "python");
	assert.equal(languageFromTaskText("touch a.rs then b.py"), "rust");
});

test("a dominant language needs a real share, not a bare plurality", () => {
	const go = Array.from({ length: 30 }, (_, i) => `pkg/f${i}.go`);
	const yaml = Array.from({ length: 25 }, (_, i) => `ci/s${i}.yml`);
	assert.equal(languageFromFiles({ files: [...go, ...yaml] }), "go");
	// With only two candidates the leader always clears the share, so the threshold
	// has to be exercised where it can actually reject: a three-way split.
	const rust = Array.from({ length: 10 }, (_, i) => `src/f${i}.rs`);
	const python = Array.from({ length: 10 }, (_, i) => `py/f${i}.py`);
	assert.equal(languageFromFiles({ files: [...rust, ...python, ...go.slice(0, 10)] }), undefined);
	// A clear leader among three still wins.
	assert.equal(languageFromFiles({ files: [...rust, ...python, ...go] }), "go");
});

test("unclassified files never vote and an empty set is undefined", () => {
	assert.equal(languageFromFiles({ files: ["README.md", "flake.lock", "Makefile"] }), undefined);
	assert.equal(languageFromFiles({ files: [] }), undefined);
	assert.equal(languageFromFiles({ files: ["a.rs", "README.md", "package.json"] }), "rust");
});

function gitRepository(files: Readonly<Record<string, string>>): string {
	const root = mkdtempSync(join(tmpdir(), "loon-lang-"));
	spawnSync("git", ["init", "-q"], { cwd: root });
	for (const [name, body] of Object.entries(files)) {
		const path = join(root, name);
		mkdirSync(join(path, ".."), { recursive: true });
		writeFileSync(path, body);
	}
	spawnSync("git", ["add", "-f", "."], { cwd: root });
	return root;
}

test("a task naming a file wins over the repository it lives in", () => {
	// The repository is Rust; the work unit is one shell script inside it.
	const root = gitRepository({ "src/main.rs": "fn main() {}", "scripts/deploy.sh": "echo hi" });
	assert.equal(detectWorkUnitLanguage("make scripts/deploy.sh executable", root), "shell");
	// With nothing named, the repository decides.
	assert.equal(detectWorkUnitLanguage("make the build faster", root), "rust");
});

test("a polyglot repository answers undefined instead of guessing", () => {
	const root = gitRepository({ "a.go": "package a", "b.py": "x = 1", "c.rs": "fn f() {}", "d.ts": "export {}" });
	assert.equal(detectWorkUnitLanguage("clean up the build", root), undefined);
});

test("not being a Git checkout is inconclusive, not an error", () => {
	const root = mkdtempSync(join(tmpdir(), "loon-nolang-"));
	writeFileSync(join(root, "main.rs"), "fn main() {}");
	assert.equal(detectWorkUnitLanguage("clean up the build", root), undefined);
	// The task text still works without any repository at all.
	assert.equal(detectWorkUnitLanguage("fix src/main.rs", root), "rust");
});
