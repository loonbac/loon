import assert from "node:assert/strict";
import test from "node:test";
import { VerificationGateTracker, isVerificationCommand, toolCommand } from "./verified-outcome.ts";

test("verification commands are recognised across the usual runners", () => {
	for (const command of [
		"npm test",
		"npm run test",
		"npm run test:unit",
		"pnpm test",
		"yarn test",
		"bun test",
		"pytest -q",
		"python -m pytest tests",
		"cargo test",
		"cargo clippy",
		"go test ./...",
		"go build ./...",
		"nix flake check",
		"npm run check",
		"npm run typecheck",
		"npm run build",
		"tsc -p tsconfig.json --noEmit",
		"ruff check .",
		"shellcheck script.sh",
	]) {
		assert.equal(isVerificationCommand(command), true, `expected a gate: ${command}`);
	}
});

test("ordinary work is not mistaken for a gate", () => {
	for (const command of [
		"ls -la",
		"git status",
		"npm run dev",
		"npm install",
		"cat package.json",
		"rg TODO src/",
		"echo test",
		"",
		"   ",
	]) {
		assert.equal(isVerificationCommand(command), false, `expected no gate: ${command}`);
	}
});

test("only the first command of a compound line decides", () => {
	// Appending something must not hide, or invent, a gate.
	assert.equal(isVerificationCommand("npm test && rm -rf dist"), true);
	assert.equal(isVerificationCommand("npm run dev; npm test"), false);
	assert.equal(isVerificationCommand("npm test\nrm -rf dist"), true);
});

test("the command is read from the conventional argument fields only", () => {
	assert.equal(toolCommand({ command: "npm test" }), "npm test");
	assert.equal(toolCommand({ cmd: "cargo test" }), "cargo test");
	assert.equal(toolCommand({ script: "go test ./..." }), "go test ./...");
	assert.equal(toolCommand({ command: "   " }), undefined);
	assert.equal(toolCommand({ file: "src/main.rs" }), undefined);
	assert.equal(toolCommand("npm test"), undefined);
	assert.equal(toolCommand(null), undefined);
	assert.equal(toolCommand([{ command: "npm test" }]), undefined);
});

test("a gate only counts once it has ended successfully", () => {
	const gates = new VerificationGateTracker();
	gates.noteStart("call-1", { command: "npm test" });
	// Started but not finished: no evidence yet.
	assert.equal(gates.passedGate(), undefined);
	gates.noteEnd("call-1", false);
	assert.equal(gates.passedGate(), "npm test");
});

test("a failing gate records nothing", () => {
	const gates = new VerificationGateTracker();
	gates.noteStart("call-1", { command: "npm test" });
	gates.noteEnd("call-1", true);
	assert.equal(gates.passedGate(), undefined);
});

test("the last passing gate describes the final tree", () => {
	// The common shape: the gate fails, the model fixes the code, the gate passes.
	const gates = new VerificationGateTracker();
	gates.noteStart("call-1", { command: "npm test" });
	gates.noteEnd("call-1", true);
	gates.noteStart("call-2", { command: "npm test" });
	gates.noteEnd("call-2", false);
	assert.equal(gates.passedGate(), "npm test");
});

test("untracked and unknown tool calls contribute nothing", () => {
	const gates = new VerificationGateTracker();
	gates.noteStart("call-1", { command: "ls" });
	gates.noteEnd("call-1", false);
	gates.noteEnd("never-started", false);
	assert.equal(gates.passedGate(), undefined);
});

test("reset clears a pass from a previous run", () => {
	const gates = new VerificationGateTracker();
	gates.noteStart("call-1", { command: "cargo test" });
	gates.noteEnd("call-1", false);
	assert.equal(gates.passedGate(), "cargo test");
	gates.reset();
	assert.equal(gates.passedGate(), undefined);
});
