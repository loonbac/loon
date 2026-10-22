import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import antigravityQuotaFallback, {
  FALLBACK_CHAIN,
  MAX_ADAPTIVE_REASK_ATTEMPTS,
} from "./antigravity-quota-fallback.ts";

interface TestHarness {
  directory: string;
  pi: any;
  ctx: any;
  emit: (event: string, data: any) => Promise<void>;
  sentMessages: any[];
  notifications: Array<{ message: string; level?: string }>;
  getRouterRequests: () => any[];
  cleanup: () => void;
}

function createHarness(options: { agent?: string; routerFails?: boolean; observeFails?: boolean } = {}): TestHarness {
  const directory = mkdtempSync(join(tmpdir(), "quota-fallback-test-"));
  const routerLog = join(directory, "router-log.jsonl");

  // Router mock entry script
  mkdirSync(join(directory, "dist", "src", "host"), { recursive: true });
  writeFileSync(
    join(directory, "package.json"),
    JSON.stringify({ type: "module" }),
  );
  writeFileSync(
    join(directory, "dist", "src", "host", "entry.js"),
    `import fs from "node:fs";
import process from "node:process";

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  try {
    const payload = JSON.parse(input);
    const logFile = process.env.TEST_ROUTER_LOG;
    if (logFile) {
      fs.appendFileSync(logFile, JSON.stringify(payload) + "\\n");
    }

    if (payload.action === "observe" && process.env.TEST_ROUTER_OBSERVE_FAIL === "1") {
      process.stdout.write(JSON.stringify({ ok: false, error: "observation ledger unavailable" }) + "\\n");
      process.exit(1);
    }

    if (payload.action === "quota" || payload.action === "observe") {
      process.stdout.write(JSON.stringify({ ok: true }) + "\\n");
      process.exit(0);
    }

    if (payload.action === "route") {
      if (process.env.TEST_ROUTER_FAIL === "1") {
        process.stdout.write(JSON.stringify({ ok: false, error: "router unavailable" }) + "\\n");
        process.exit(1);
      }
      const candidates = [
        { provider: "test-prov", model: "route-1" },
        { provider: "test-prov", model: "route-2" },
        { provider: "test-prov", model: "route-3" },
        { provider: "test-prov", model: "route-4" },
        { provider: "test-prov", model: "route-5" },
        { provider: "test-prov", model: "route-6" },
        { provider: "test-prov", model: "route-7" },
        { provider: "test-prov", model: "route-8" },
      ];
      const excluded = new Set((payload.excludeRoutes || []).map((r) => \`\${r.provider}/\${r.model}\`));
      const chosen = candidates.find((c) => !excluded.has(\`\${c.provider}/\${c.model}\`)) || candidates[0];

      const response = {
        ok: true,
        decision: {
          kind: "ADAPTIVE_ASSIGNMENT",
          decisionId: \`dec-\${chosen.provider}-\${chosen.model}\`,
          reason: "testing adaptive routing",
          mode: "ACTIVE_GUARDED",
          role: payload.agent || "test-agent",
          taskClass: "implementation",
          risk: "LOW",
          staticRoute: payload.staticRoute || { provider: "test-prov", model: "route-1", requestedEffort: "high", effectiveEffort: "high" },
          requestedAdaptiveRoute: {
            provider: chosen.provider,
            model: chosen.model,
            requestedEffort: "high",
            effectiveEffort: "high",
          },
          exploration: false,
          compiledPrompt: "## Goal\\nTest prompt",
          promptProfileId: "EXPLICIT",
          promptProfileVersion: "v1",
          promptCompilerVersion: "v1",
          canonicalContractHash: "contract",
          compiledPromptHash: "compiled",
          promptExecutionStatus: "ACTUAL",
          routingLatencyMs: 2,
        },
      };
      process.stdout.write(JSON.stringify(response) + "\\n");
      process.exit(0);
    }

    process.stdout.write(JSON.stringify({ ok: false, error: "unknown action" }) + "\\n");
    process.exit(1);
  } catch (err) {
    process.stderr.write(String(err) + "\\n");
    process.exit(1);
  }
});
`,
  );

  // Model catalog
  const catalogModels: Record<string, { status: string }> = {
    "test-prov/route-1": { status: "ACTIVE" },
    "test-prov/route-2": { status: "ACTIVE" },
    "test-prov/route-3": { status: "ACTIVE" },
    "test-prov/route-4": { status: "ACTIVE" },
    "test-prov/route-5": { status: "ACTIVE" },
    "test-prov/route-6": { status: "ACTIVE" },
    "test-prov/route-7": { status: "ACTIVE" },
    "test-prov/route-8": { status: "ACTIVE" },
    "antigravity/claude-sonnet-5-5": { status: "ACTIVE" },
    "infronai/deepseek/deepseek-v4.1-flash:free": { status: "ACTIVE" },
    "commandcode/inclusionai/ling-3.1-flash:free": { status: "ACTIVE" },
    "cline/cline-free/solar-mini4": { status: "ACTIVE" },
  };
  writeFileSync(
    join(directory, "model-catalog.json"),
    JSON.stringify({ schemaVersion: "model-catalog-v1", models: catalogModels }),
  );

  const prevEnv = { ...process.env };
  const prevArgv = [...process.argv];

  process.env.NATURAL_ROUTER_ROOT = directory;
  process.env.NATURAL_ROUTER_STATE_DIR = directory;
  process.env.PI_CODING_AGENT_DIR = directory;
  process.env.GENTLE_PI_CONFIG_HOME = directory;
  process.env.TEST_ROUTER_LOG = routerLog;
  if (options.routerFails) process.env.TEST_ROUTER_FAIL = "1";
  if (options.observeFails) process.env.TEST_ROUTER_OBSERVE_FAIL = "1";

  const agentName = options.agent ?? "test-agent";
  if (options.agent !== undefined || options.agent === undefined) {
    process.env.GENTLE_PI_AGENTS_CHILD = "1";
    process.env.GENTLE_PI_AGENT_HOME = directory;
    mkdirSync(join(directory, "agents"), { recursive: true });
    writeFileSync(
      join(directory, "agents", `${agentName}.md`),
      `---\nname: ${agentName}\n---\nYou are the test worker agent.\n`,
    );
    process.argv.push("--append-system-prompt", "You are the test worker agent.");
  }

  const availableModels = [
    { provider: "test-prov", id: "route-1", name: "Route 1", reasoning: false, contextWindow: 128000, input: ["text"], supportsTools: true },
    { provider: "test-prov", id: "route-2", name: "Route 2", reasoning: false, contextWindow: 128000, input: ["text"], supportsTools: true },
    { provider: "test-prov", id: "route-3", name: "Route 3", reasoning: false, contextWindow: 128000, input: ["text"], supportsTools: true },
    { provider: "test-prov", id: "route-4", name: "Route 4", reasoning: false, contextWindow: 128000, input: ["text"], supportsTools: true },
    { provider: "test-prov", id: "route-5", name: "Route 5", reasoning: false, contextWindow: 128000, input: ["text"], supportsTools: true },
    { provider: "test-prov", id: "route-6", name: "Route 6", reasoning: false, contextWindow: 128000, input: ["text"], supportsTools: true },
    { provider: "test-prov", id: "route-7", name: "Route 7", reasoning: false, contextWindow: 128000, input: ["text"], supportsTools: true },
    { provider: "test-prov", id: "route-8", name: "Route 8", reasoning: false, contextWindow: 128000, input: ["text"], supportsTools: true },
    { provider: "antigravity", id: "claude-sonnet-5-5", name: "Claude Sonnet", reasoning: false, contextWindow: 128000, input: ["text"], supportsTools: true },
    { provider: "infronai", id: "deepseek/deepseek-v4.1-flash:free", name: "DeepSeek Flash", reasoning: false, contextWindow: 128000, input: ["text"], supportsTools: true },
    { provider: "commandcode", id: "inclusionai/ling-3.1-flash:free", name: "Ling Flash", reasoning: false, contextWindow: 128000, input: ["text"], supportsTools: true },
    { provider: "cline", id: "cline-free/solar-mini4", name: "Solar Mini", reasoning: false, contextWindow: 128000, input: ["text"], supportsTools: true },
  ];

  let currentModel: any = availableModels[0];
  let thinkingLevel: any = "high";
  const eventHandlers = new Map<string, Function[]>();
  const sentMessages: any[] = [];
  const notifications: Array<{ message: string; level?: string }> = [];

  const pi = {
    on(event: string, handler: Function) {
      if (!eventHandlers.has(event)) eventHandlers.set(event, []);
      eventHandlers.get(event)!.push(handler);
    },
    getThinkingLevel() {
      return thinkingLevel;
    },
    setThinkingLevel(level: any) {
      thinkingLevel = level;
    },
    async setModel(model: any) {
      currentModel = model;
      return true;
    },
    sendMessage(message: any, options: any) {
      sentMessages.push({ message, options });
    },
    registerCommand(_name: string, _def: any) {},
    getActiveTools() {
      return ["read", "bash"];
    },
  };

  const ctx = {
    cwd: directory,
    get model() {
      return currentModel;
    },
    modelRegistry: {
      find(provider: string, id: string) {
        return availableModels.find((m) => m.provider === provider && m.id === id);
      },
      getAvailable() {
        return availableModels;
      },
    },
    ui: {
      notify(message: string, level?: string) {
        notifications.push({ message, level });
      },
      setStatus(_key: string, _val?: string) {},
    },
  };

  const emit = async (event: string, data: any) => {
    const handlers = eventHandlers.get(event) ?? [];
    for (const h of handlers) {
      await h(data, ctx);
    }
  };

  const getRouterRequests = (): any[] => {
    try {
      return readFileSync(routerLog, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    } catch {
      return [];
    }
  };

  const cleanup = () => {
    for (const key of Object.keys(process.env)) {
      if (!(key in prevEnv)) delete process.env[key];
    }
    Object.assign(process.env, prevEnv);
    process.argv.length = 0;
    process.argv.push(...prevArgv);
    rmSync(directory, { recursive: true, force: true });
  };

  return {
    directory, pi, ctx, emit, sentMessages, notifications, getRouterRequests, cleanup,
    // Overrides the chain the extension reads from the fallback config, so a test can reproduce a
    // machine with no configured chain at all. `GENTLE_FALLBACK_CONFIG` is the documented override.
    setModel: (provider: string, id: string) => {
      const found = availableModels.find((m) => m.provider === provider && m.id === id);
      if (found) currentModel = found;
    },
    setFallbackChain: (routes: Array<{ provider: string; model: string }>) => {
      const path = join(directory, "gentle-fallbacks.json");
      writeFileSync(path, JSON.stringify({ fallbacks: routes }));
      process.env.GENTLE_FALLBACK_CONFIG = path;
    },
  };
}

test("(a) an applied adaptive route fails: assert router is asked again with failed route in excludeRoutes and different route is applied", async () => {
  const harness = createHarness();
  try {
    await antigravityQuotaFallback(harness.pi);

    // Initial run: adaptive primary resolved and applied
    await harness.emit("before_agent_start", { prompt: "Solve the task", systemPrompt: "Base prompt" });
    assert.equal(harness.ctx.model.id, "route-1");

    // First failure: primary route fails
    await harness.emit("message_end", {
      message: {
        role: "assistant",
        provider: "test-prov",
        model: "route-1",
        stopReason: "error",
        errorMessage: "Execution failed for primary",
      },
    });

    // First fallback route-2 applied
    assert.equal(harness.ctx.model.id, "route-2");
    assert.equal(harness.sentMessages.length, 1);

    // Second failure: CURRENTLY APPLIED fallback route-2 fails
    await harness.emit("message_end", {
      message: {
        role: "assistant",
        provider: "test-prov",
        model: "route-2",
        stopReason: "error",
        errorMessage: "Execution failed for fallback 1",
      },
    });

    // Router must be asked again and route-3 applied
    const routeRequests = harness.getRouterRequests().filter((r) => r.action === "route");
    assert.equal(routeRequests.length, 3, "expected 3 route requests (primary + 2 fallbacks)");
    assert.deepEqual(routeRequests[2].excludeRoutes, [
      { provider: "test-prov", model: "route-1" },
      { provider: "test-prov", model: "route-2" },
    ]);
    assert.equal(harness.ctx.model.id, "route-3");
    assert.equal(harness.sentMessages.length, 2);
  } finally {
    harness.cleanup();
  }
});

test("(b) consecutive failures re-ask again with BOTH failed routes accumulated", async () => {
  const harness = createHarness();
  try {
    await antigravityQuotaFallback(harness.pi);

    await harness.emit("before_agent_start", { prompt: "Solve the task", systemPrompt: "Base prompt" });
    assert.equal(harness.ctx.model.id, "route-1");

    // Primary failure
    await harness.emit("message_end", {
      message: {
        role: "assistant",
        provider: "test-prov",
        model: "route-1",
        stopReason: "error",
        errorMessage: "Failure 1",
      },
    });
    assert.equal(harness.ctx.model.id, "route-2");

    // Second failure
    await harness.emit("message_end", {
      message: {
        role: "assistant",
        provider: "test-prov",
        model: "route-2",
        stopReason: "error",
        errorMessage: "Failure 2",
      },
    });

    const requests = harness.getRouterRequests().filter((r) => r.action === "route");
    assert.ok(requests.length >= 3, `expected at least 3 router requests, got ${requests.length}`);
    assert.deepEqual(requests[1].excludeRoutes, [{ provider: "test-prov", model: "route-1" }]);
    assert.deepEqual(requests[2].excludeRoutes, [
      { provider: "test-prov", model: "route-1" },
      { provider: "test-prov", model: "route-2" },
    ]);
  } finally {
    harness.cleanup();
  }
});

test("(c) attempt cap is respected: after cap is reached no further adaptive re-ask happens", async () => {
  const harness = createHarness();
  try {
    await antigravityQuotaFallback(harness.pi);

    await harness.emit("before_agent_start", { prompt: "Solve the task", systemPrompt: "Base prompt" });
    assert.equal(harness.ctx.model.id, "route-1");

    // Trigger failures up to MAX_ADAPTIVE_REASK_ATTEMPTS
    for (let i = 1; i <= MAX_ADAPTIVE_REASK_ATTEMPTS; i++) {
      await harness.emit("message_end", {
        message: {
          role: "assistant",
          provider: "test-prov",
          model: `route-${i}`,
          stopReason: "error",
          errorMessage: `Failure ${i}`,
        },
      });
    }

    const requestsAtCap = harness.getRouterRequests().filter((r) => r.action === "route").length;
    const messagesAtCap = harness.sentMessages.length;

    // One more failure after reaching the cap
    await harness.emit("message_end", {
      message: {
        role: "assistant",
        provider: "test-prov",
        model: `route-${MAX_ADAPTIVE_REASK_ATTEMPTS + 1}`,
        stopReason: "error",
        errorMessage: "Failure beyond cap",
      },
    });

    // Observable: router is NOT asked again, no new follow-up message sent, notification emitted
    const requestsAfter = harness.getRouterRequests().filter((r) => r.action === "route").length;
    assert.equal(requestsAfter, requestsAtCap, "router must not be asked again after cap is reached");
    assert.equal(harness.sentMessages.length, messagesAtCap, "no message dispatched after cap");
    assert.ok(
      harness.notifications.some((n) => n.message.includes(String(MAX_ADAPTIVE_REASK_ATTEMPTS))),
      "warning notification emitted informing that attempt cap was reached",
    );
  } finally {
    harness.cleanup();
  }
});

test("(d) non-adaptive run takes static chain unchanged, and antigravity-quota branch takes priority", async () => {
  // Part 1: Non-adaptive run (no gentle agent child) takes static-chain path
  const nonAdaptiveHarness = createHarness({ agent: "" });
  try {
    // Delete GENTLE_PI_AGENTS_CHILD so detectGentleAgentName returns undefined
    delete process.env.GENTLE_PI_AGENTS_CHILD;

    await antigravityQuotaFallback(nonAdaptiveHarness.pi);

    // Initial non-adaptive setup: start with route from static chain
    await nonAdaptiveHarness.pi.setModel({ provider: "antigravity", id: "claude-sonnet-5-5", name: "Claude Sonnet" });
    await nonAdaptiveHarness.emit("before_agent_start", { prompt: "Solve task", systemPrompt: "Prompt" });

    // Antigravity quota failure -> triggers antigravity quota branch (first priority)
    await nonAdaptiveHarness.emit("message_end", {
      message: {
        role: "assistant",
        provider: "antigravity",
        model: "claude-sonnet-5-5",
        stopReason: "error",
        errorMessage: "Antigravity API error: 429 resource_exhausted quota exceeded",
      },
    });

    // Assert it switched to first fallback in static chain (infronai)
    assert.equal(nonAdaptiveHarness.ctx.model.provider, "infronai");
    assert.equal(nonAdaptiveHarness.ctx.model.id, "deepseek/deepseek-v4.1-flash:free");
    assert.ok(
      nonAdaptiveHarness.notifications.some((n) => n.message.includes("Antigravity agotó su cuota")),
      "quota notification emitted",
    );

    // Next failure is an ordinary error on infronai (non-quota) -> takes static-chain branch to commandcode
    await nonAdaptiveHarness.emit("message_end", {
      message: {
        role: "assistant",
        provider: "infronai",
        model: "deepseek/deepseek-v4.1-flash:free",
        stopReason: "error",
        errorMessage: "Ordinary 500 server error",
      },
    });

    assert.equal(nonAdaptiveHarness.ctx.model.provider, "commandcode");
    assert.equal(nonAdaptiveHarness.ctx.model.id, "inclusionai/ling-3.1-flash:free");
  } finally {
    nonAdaptiveHarness.cleanup();
  }
});

test("(e) the router cannot answer: the work unit is carried on with another approved model, never cancelled", async () => {
  const harness = createHarness({ routerFails: true });
  try {
    await antigravityQuotaFallback(harness.pi);

    // No adaptive primary: the router is down, so the run starts on the static assignment.
    await harness.emit("before_agent_start", { prompt: "Solve the task", systemPrompt: "Base prompt" });
    // No fallback chain was configured either, which is this machine's real state:
    // `gentle-fallbacks.json` is {"fallbacks": []}. The chain is otherwise read from disk.
    (harness as any).setFallbackChain([]);
    const startedOn = harness.ctx.model.id;

    // The route that is running fails, and the router has nothing to say about it.
    await harness.emit("message_end", {
      message: {
        role: "assistant",
        provider: "test-prov",
        model: startedOn,
        stopReason: "error",
        errorMessage: "Execution failed",
      },
    });

    // Before this test the work unit simply stopped here: the dynamic path threw, the static
    // chain is empty on this machine (`gentle-fallbacks.json` is {"fallbacks": []}), the handler
    // returned without a switch and without a message, and the user had to retype the request.
    assert.notEqual(harness.ctx.model.id, startedOn, "the work unit was cancelled instead of moved to another model");
    assert.ok(
      harness.notifications.some((n) => /no queda ningún modelo|falló|contin/i.test(n.message)),
      "the user was never told that the route failed and that another one was tried",
    );
    assert.ok(harness.sentMessages.length >= 1, "no follow-up turn was queued, so the request was dropped");

    // What it moved to must be a model the catalogue approves, not an arbitrary one. The order
    // follows the runtime's own list, so the assertion is the rule, not a particular model.
    const moved = harness.ctx.model;
    assert.notEqual(`${moved.provider}/${moved.id}`, `${"test-prov"}/${startedOn}`);
    const approved = JSON.parse(readFileSync(join(harness.directory, "model-catalog.json"), "utf8"));
    assert.ok(
      approved.models[`${moved.provider}/${moved.id}`] !== undefined,
      `moved to ${moved.provider}/${moved.id}, which the catalogue does not approve`,
    );
  } finally {
    delete process.env.TEST_ROUTER_FAIL;
    harness.cleanup();
  }
});

test("(f) a settled work unit does not throw away the route the router chose", async () => {
  const harness = createHarness();
  try {
    await antigravityQuotaFallback(harness.pi);
    // The unit starts on the model that was already selected before the router spoke.
    (harness as any).setModel("antigravity", "claude-sonnet-5-5");
    await harness.emit("before_agent_start", { prompt: "Solve the task", systemPrompt: "Base prompt" });
    const routed = harness.ctx.model.id;
    assert.equal(routed, "route-1", "the router should have moved the unit off the pre-router model");

    // The unit finishes normally. `agent_settled` used to restore the model that was running before
    // the router chose anything, so the next unit started from the static assignment again and the
    // router had to re-decide from scratch — which is how a worker moved to deepseek came back as
    // gemini on the orchestrator's next launch.
    await harness.emit("agent_settled", { aborted: false });

    assert.equal(
      harness.ctx.model.id,
      routed,
      "settling the unit put the model back to the pre-router one, so the next unit re-decides from scratch",
    );
  } finally {
    harness.cleanup();
  }
});

test("a route that never produced an assistant message is still observed", async () => {
  const harness = createHarness();
  try {
    await antigravityQuotaFallback(harness.pi);
    await harness.emit("before_agent_start", { prompt: "Solve the task", systemPrompt: "Base prompt" });
    assert.equal(harness.ctx.model.id, "route-1");

    // The run dies before its first assistant message: no `message_end` at all.
    await harness.emit("agent_settled", { aborted: true });

    const requests = harness.getRouterRequests();
    const observations = requests.filter((r) => r.action === "observe");
    assert.equal(observations.length, 1, "the applied route was launched but never observed");
    const [observation] = observations;
    assert.equal(observation.decisionId, "dec-test-prov-route-1");
    assert.equal(observation.requested.provider, "test-prov");
    assert.equal(observation.requested.model, "route-1");
    assert.equal(observation.observed.provider, "test-prov");
    assert.equal(observation.observed.model, "route-1");
    assert.equal(observation.observed.requestedEffort, "high");
    // Recording the observation must not ask the router to decide again.
    assert.equal(requests.filter((r) => r.action === "route").length, 1, "settling issued a duplicate route request");
  } finally {
    harness.cleanup();
  }
});

test("a failed observation is recorded instead of swallowed", async () => {
  const harness = createHarness({ observeFails: true });
  try {
    await antigravityQuotaFallback(harness.pi);
    await harness.emit("before_agent_start", { prompt: "Solve the task", systemPrompt: "Base prompt" });
    assert.equal(harness.ctx.model.id, "route-1");

    // The run settles normally even though the router rejects the observation.
    await harness.emit("agent_settled", { aborted: true });

    assert.equal(harness.getRouterRequests().filter((r) => r.action === "observe").length, 1);
    const lines = readFileSync(join(harness.directory, "observation-failures.jsonl"), "utf8")
      .trim()
      .split("\n")
      .filter(Boolean);
    assert.equal(lines.length, 1, "expected exactly one recorded observation failure");
    const entry = JSON.parse(lines[0]!);
    assert.equal(entry.decisionId, "dec-test-prov-route-1");
    assert.equal(entry.observed.provider, "test-prov");
    assert.equal(entry.observed.model, "route-1");
    assert.match(entry.error, /observation ledger unavailable/);
    assert.ok(!Number.isNaN(Date.parse(entry.at)), "the failure record carries an ISO timestamp");
    assert.equal(
      harness.notifications.filter((n) => n.level === "warning" && /observ/i.test(n.message)).length,
      1,
      "the observation failure was not surfaced to the user once",
    );
    // An observation failure is not a routing failure: the circuit breaker must stay untouched.
    assert.equal(
      harness.getRouterRequests().filter((r) => r.action === "router-failure").length,
      0,
      "an observation failure was counted toward the router circuit breaker",
    );
  } finally {
    harness.cleanup();
  }
});
