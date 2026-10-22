import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  antigravityQuotaIsAvailable,
  refreshAntigravityUsage,
  type AntigravityProviderId,
} from "./antigravity-usage.ts";
import {
  fallbackRoutesForAgent,
  type FallbackEffort,
} from "./fallback-config.ts";
import {
  callNaturalRouter,
  adaptiveRecoveryRouteAllowed,
  legacyFallbackMayPreempt,
  prepareAdaptiveApplication,
  onboardedRouteAllowed,
  recordAdaptiveFailure,
  recordAdaptiveInvariant,
  recordObservedRoute,
  recordVerifiedOutcome,
  registerAdaptiveCommands,
  resolveAdaptivePrimary,
  validAdaptiveDecision,
  type AdaptiveDecision,
  type AdaptiveRoute,
} from "./natural-adaptive-routing.ts";
import { VerificationGateTracker } from "./verified-outcome.ts";
import { RunMetricsTracker } from "./run-metrics.ts";

export type FallbackThinking = FallbackEffort;

export interface FallbackRoute {
  provider: string;
  model: string;
  label: string;
  thinking?: FallbackThinking;
}

const ANTIGRAVITY_THIRD_PARTY: FallbackRoute = {
  provider: "antigravity",
  model: "claude-sonnet-5-5",
  label: "Claude Sonnet (Antigravity, pool de terceros)",
  thinking: "high",
};

const INFRON_FREE_HIGH: FallbackRoute = {
  provider: "infronai",
  model: "deepseek/deepseek-v4.1-flash:free",
  label: "DeepSeek V4.1 Flash (Infron Free)",
  thinking: "high",
};

const COMMANDCODE_FREE_HIGH: FallbackRoute = {
  provider: "commandcode",
  model: "inclusionai/ling-3.1-flash:free",
  label: "Ling 3.1 Flash (Command Code, gratis)",
  thinking: "high",
};

const CLINE_FREE_LOW: FallbackRoute = {
  provider: "cline",
  model: "cline-free/solar-mini4",
  label: "Solar Mini 4 (Cline, gratis)",
  thinking: "low",
};

// Unknown agents and ordinary Pi sessions retain the existing global order
// and their current thinking level. The named Gentle agents below receive the
// two explicit routes requested for their workload.
// Every route here has zero marginal cost: either the subscription the user already pays
// for, or a model its provider serves free. The chain exists precisely because the
// primary route ran out of quota, so reaching for metered capacity while free capacity is
// listed spends money to buy nothing.
//
// Antigravity belongs in it because its two pools are independent: the `gemini-*` and
// `3p-*` windows are spent separately, so an exhausted Gemini pool leaves the
// third-party one untouched.
export const FALLBACK_CHAIN: readonly FallbackRoute[] = [
  ANTIGRAVITY_THIRD_PARTY,
  INFRON_FREE_HIGH,
  COMMANDCODE_FREE_HIGH,
  CLINE_FREE_LOW,
] as const;

// The two entries differ by which zero-cost pool answers second, so a provider outage
// does not take the same route down for every agent at once. None of them is metered.
export const AGENT_FALLBACK_CHAINS: Readonly<Record<string, readonly FallbackRoute[]>> = {
  "gentle-ai-explore": [ANTIGRAVITY_THIRD_PARTY, INFRON_FREE_HIGH],
  "gentle-ai-worker": [INFRON_FREE_HIGH, COMMANDCODE_FREE_HIGH],
  "jd-fix-agent": [COMMANDCODE_FREE_HIGH, INFRON_FREE_HIGH],
  "sdd-explore": [ANTIGRAVITY_THIRD_PARTY, INFRON_FREE_HIGH],
  "sdd-spec": [ANTIGRAVITY_THIRD_PARTY, COMMANDCODE_FREE_HIGH],
  "sdd-tasks": [INFRON_FREE_HIGH, ANTIGRAVITY_THIRD_PARTY],
  "sdd-apply": [COMMANDCODE_FREE_HIGH, INFRON_FREE_HIGH],
  "sdd-onboard": [CLINE_FREE_LOW, INFRON_FREE_HIGH],
};

export const PRIMARY_ANTIGRAVITY_PROVIDER = "antigravity";
// `antigravity-alt` registraba el mismo servicio bajo un segundo provider para
// simular una segunda cuenta. Con el failover multi-cuenta nativo de
// `pi-antigravity` ese hack sobra: hay un solo provider y las cuentas viven
// dentro de él, así que no se puede ni se debe enumerar una "cuenta B" desde
// aquí.
const ANTIGRAVITY_PROVIDERS = [PRIMARY_ANTIGRAVITY_PROVIDER] as const;
type AntigravityProvider = (typeof ANTIGRAVITY_PROVIDERS)[number];

const STATE_VERSION = 2;
const DEFAULT_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const RESET_BUFFER_MS = 2 * 60 * 1000;
const STATUS_KEY = "antigravity-quota-fallback";

/**
 * Maximum number of adaptive router re-asks allowed per work unit.
 *
 * The router catalog typically contains at most 3–5 viable models for any
 * given agent role, and the router excludes previously failed routes passed in
 * `excludeRoutes`. A cap of 5 re-asks allows the router to walk its full list
 * of candidate routes if each fails in turn, while providing a definitive
 * circuit breaker against pathological infinite re-ask loops.
 */
export const MAX_ADAPTIVE_REASK_ATTEMPTS = 5;
// Gentle's parent process cannot observe a child-side pi.setModel() through
// the RPC session stream. This private status event reports the selected route
// immediately, before the provider starts returning assistant tokens.
const EFFECTIVE_ROUTE_STATUS_KEY = "loon-effective-subagent-route";
const ANTIGRAVITY_FAILURE_ERROR = /(?:quota\s+(?:reached|exceeded|exhausted)|resource[_\s-]?exhausted|usage\s+(?:limit|quota)[^\n]*(?:reached|exceeded|exhausted)|(?:daily|monthly)\s+(?:usage\s+)?limit[^\n]*(?:reached|exceeded|exhausted)|\b403\b|\b429\b|\b401\b|\b503\b|denied\s+this\s+request|verify\s+your\s+account|permission_denied|unauthenticated|rate[_\s-]?limit)/i;

interface ProviderCooldown {
  activeUntil: number;
  detectedAt: number;
  sourceModel: string;
}

interface CooldownState {
  version: number;
  providers: Partial<Record<AntigravityProvider, ProviderCooldown>>;
}

export function isQuotaExhaustion(errorMessage: unknown): errorMessage is string {
  if (typeof errorMessage !== "string") return false;
  return ANTIGRAVITY_FAILURE_ERROR.test(errorMessage) || errorMessage.includes("Antigravity API error");
}

export function parseWaitDurationMs(errorMessage: string): number | undefined {
  const wait = errorMessage.match(/(?:please\s+wait|retry\s+(?:in|after))\s+((?:\d+\s*[dhms]\s*)+)/i)?.[1];
  if (!wait) return undefined;

  let total = 0;
  for (const match of wait.matchAll(/(\d+)\s*([dhms])/gi)) {
    const value = Number.parseInt(match[1], 10);
    const unit = match[2].toLowerCase();
    if (unit === "d") total += value * 24 * 60 * 60 * 1000;
    if (unit === "h") total += value * 60 * 60 * 1000;
    if (unit === "m") total += value * 60 * 1000;
    if (unit === "s") total += value * 1000;
  }
  return total > 0 ? total : undefined;
}

export function cooldownDeadline(errorMessage: string, now = Date.now()): number {
  return now + (parseWaitDurationMs(errorMessage) ?? DEFAULT_COOLDOWN_MS) + RESET_BUFFER_MS;
}

export function fallbackChainForAgent(agentName: string | undefined): readonly FallbackRoute[] {
  if (!agentName) return FALLBACK_CHAIN;
  return fallbackRoutesForAgent(agentName);
}

export function fallbackIndex(
  provider: string,
  model: string,
  chain: readonly FallbackRoute[] = FALLBACK_CHAIN,
): number {
  return chain.findIndex((route) => route.provider === provider && route.model === model);
}

interface AgentDefinitionIdentity {
  name: string;
  instructions: string;
}

export function parseAgentDefinitionIdentity(
  text: string,
  fallbackName: string,
): AgentDefinitionIdentity | undefined {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!match) return undefined;
  const declaredName = match[1].match(/^name:\s*["']?([^\r\n"']+)["']?\s*$/m)?.[1]?.trim();
  const instructions = match[2].trim();
  if (!instructions) return undefined;
  return { name: declaredName || fallbackName, instructions };
}

/**
 * The text `--append-system-prompt` carries, whether it was given directly or as a file path.
 *
 * Pi documents the flag as accepting "text or file contents", and gentle-ai passes a path
 * whenever an agent's instructions exceed its inline limit — which every real agent does, by an
 * order of magnitude, because they are long contracts. Comparing that path against the contract
 * text never matched, so the agent was never identified and the router never ran for any real
 * delegation. Reading the file is what makes the two forms equivalent, which is how Pi treats
 * them.
 *
 * A value that is not a readable file is the text itself, so nothing is lost when the caller
 * passes it inline.
 */
function appendedSystemPromptValue(value: string): string {
  try {
    if (existsSync(value) && statSync(value).isFile()) return readFileSync(value, "utf8");
  } catch { /* not a path: fall through and treat the value as the text */ }
  return value;
}

export function appendedSystemPrompts(argv: readonly string[]): string[] {
  const prompts: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--append-system-prompt" && index + 1 < argv.length) {
      prompts.push(appendedSystemPromptValue(argv[index + 1]!));
      index += 1;
    } else if (argument.startsWith("--append-system-prompt=")) {
      prompts.push(appendedSystemPromptValue(argument.slice("--append-system-prompt=".length)));
    }
  }
  return prompts;
}

export function matchGentleAgentName(
  prompts: readonly string[],
  definitions: Iterable<AgentDefinitionIdentity>,
): string | undefined {
  const available = [...definitions];
  for (const prompt of [...prompts].reverse()) {
    const normalized = prompt.trim();
    const match = available.find((definition) => definition.instructions === normalized);
    if (match) return match.name;
  }
  return undefined;
}

function gentleAgentHome(environment: NodeJS.ProcessEnv): string {
  return environment.GENTLE_PI_AGENT_HOME
    || environment.PI_CODING_AGENT_DIR
    || join(homedir(), ".pi", "agent");
}

export function detectGentleAgentName(
  argv: readonly string[] = process.argv,
  environment: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): string | undefined {
  if (environment.GENTLE_PI_AGENTS_CHILD !== "1") return undefined;
  const prompts = appendedSystemPrompts(argv);
  if (prompts.length === 0) return undefined;

  const definitions = new Map<string, AgentDefinitionIdentity>();
  const agentHome = gentleAgentHome(environment);
  for (const directory of [
    join(agentHome, "agents"),
    join(agentHome, "subagents"),
    join(cwd, ".pi", "agents"),
    join(cwd, ".pi", "subagents"),
  ]) {
    if (!existsSync(directory)) continue;
    for (const fileName of readdirSync(directory).filter((name) => name.endsWith(".md")).sort()) {
      const identity = parseAgentDefinitionIdentity(
        readFileSync(join(directory, fileName), "utf8"),
        fileName.replace(/\.md$/i, ""),
      );
      if (identity) definitions.set(identity.name, identity);
    }
  }

  return matchGentleAgentName(prompts, definitions.values());
}

function statePath(): string {
  const agentDir = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
  return join(agentDir, "state", "antigravity-quota-fallback.json");
}

function readState(now = Date.now()): CooldownState | undefined {
  const path = statePath();
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;

    // Preserve an active cooldown written by version 1 as account A's state.
    if (parsed.version === 1) {
      const activeUntil = parsed.activeUntil;
      if (typeof activeUntil !== "number" || !Number.isFinite(activeUntil) || activeUntil <= now) {
        return undefined;
      }
      return {
        version: STATE_VERSION,
        providers: {
          [PRIMARY_ANTIGRAVITY_PROVIDER]: {
            activeUntil,
            detectedAt: typeof parsed.detectedAt === "number" ? parsed.detectedAt : now,
            sourceModel: typeof parsed.sourceModel === "string" ? parsed.sourceModel : "unknown",
          },
        },
      };
    }

    if (parsed.version !== STATE_VERSION || !parsed.providers || typeof parsed.providers !== "object") {
      return undefined;
    }
    const providers: CooldownState["providers"] = {};
    for (const provider of ANTIGRAVITY_PROVIDERS) {
      const entry = (parsed.providers as Record<string, unknown>)[provider] as
        | Partial<ProviderCooldown>
        | undefined;
      if (
        entry &&
        typeof entry.activeUntil === "number" &&
        Number.isFinite(entry.activeUntil) &&
        entry.activeUntil > now &&
        typeof entry.detectedAt === "number" &&
        typeof entry.sourceModel === "string"
      ) {
        providers[provider] = entry as ProviderCooldown;
      }
    }
    return Object.keys(providers).length > 0 ? { version: STATE_VERSION, providers } : undefined;
  } catch {
    return undefined;
  }
}

function writeState(
  provider: AntigravityProvider,
  errorMessage: string,
  sourceModel: string,
  now = Date.now(),
): CooldownState {
  const path = statePath();
  const current = readState(now);
  const previous = current?.providers[provider];
  const state: CooldownState = {
    version: STATE_VERSION,
    providers: {
      ...current?.providers,
      [provider]: {
        activeUntil: Math.max(previous?.activeUntil ?? 0, cooldownDeadline(errorMessage, now)),
        detectedAt: now,
        sourceModel,
      },
    },
  };
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
  chmodSync(path, 0o600);
  return state;
}

function sameCooldown(left: ProviderCooldown | undefined, right: ProviderCooldown): boolean {
  return left?.activeUntil === right.activeUntil
    && left.detectedAt === right.detectedAt
    && left.sourceModel === right.sourceModel;
}

function clearRestoredProvider(
  provider: AntigravityProvider,
  expected: ProviderCooldown,
  now = Date.now(),
): CooldownState | undefined {
  // The quota request is asynchronous. Do not erase a newer provider failure
  // that another Pi process may have persisted while this request was in flight.
  const current = readState(now);
  if (!current || !sameCooldown(current.providers[provider], expected)) return current;
  delete current.providers[provider];
  if (Object.keys(current.providers).length === 0) {
    clearState();
    return undefined;
  }

  const path = statePath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(current, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
  chmodSync(path, 0o600);
  return current;
}

async function reconcileCooldownsWithLiveQuota(
  ctx: ExtensionContext,
  state: CooldownState,
): Promise<CooldownState | undefined> {
  const candidates = ANTIGRAVITY_PROVIDERS.flatMap((provider) => {
    const cooldown = state.providers[provider];
    return cooldown ? [{ provider, cooldown }] : [];
  });
  const snapshots = await Promise.all(candidates.map(async ({ provider, cooldown }) => ({
    provider,
    cooldown,
    snapshot: await refreshAntigravityUsage(ctx, provider as AntigravityProviderId),
  })));

  let reconciled: CooldownState | undefined = readState();
  for (const { provider, cooldown, snapshot } of snapshots) {
    if (!antigravityQuotaIsAvailable(snapshot)) continue;
    reconciled = clearRestoredProvider(provider, cooldown);
  }
  return reconciled;
}

function clearState(): void {
  rmSync(statePath(), { force: true });
}

function remaining(state: ProviderCooldown): string {
  const totalMinutes = Math.max(1, Math.ceil((state.activeUntil - Date.now()) / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

/**
 * Pi's own transient-error classifier answers one question: will Pi retry this
 * failed request on its own? The fallback must not enqueue a second
 * continuation on top of that retry.
 *
 * `@earendil-works/pi-ai` ships nested inside the `pi-coding-agent` package and
 * is not a declared dependency of this one, so the bare specifier is not
 * resolvable from an installed extension. A plain import throws
 * ERR_MODULE_NOT_FOUND, and because Pi awaits this factory during startup that
 * failure would take the whole extension down with it. Resolve it lazily and
 * fall back to a local transient check when it is absent.
 *
 * The local check mirrors Pi's retryable set closely enough for its purpose:
 * limit, quota and billing failures are absent from it, so a routed reroute
 * still happens exactly when a different provider or account can succeed.
 */
const TRANSIENT_PROVIDER_ERROR =
  /(?:overloaded|high demand|at capacity|rate.?limit|too many requests|\b(?:429|500|502|503|504|520|524)\b|service.?unavailable|server.?error|internal.?error|provider.?returned.?error|network.?error|connection.?(?:error|refused|lost)|other side closed|fetch failed|getaddrinfo|EAI_AGAIN|ENOTFOUND|timed? ?out|timeout|terminated|websocket.?(?:closed|error)|socket hang up|ended without|stream ended before|pending stream has been canceled)/iu;

interface RetryableAssistantMessage {
  stopReason?: string | undefined;
  errorMessage?: string | undefined;
}

async function loadRetryableAssistantError(): Promise<
  (message: RetryableAssistantMessage) => boolean
> {
  try {
    const module = (await import("@earendil-works/pi-ai")) as {
      isRetryableAssistantError?: unknown;
    };
    if (typeof module.isRetryableAssistantError === "function") {
      return module.isRetryableAssistantError as (
        message: RetryableAssistantMessage,
      ) => boolean;
    }
  } catch {
    // Not resolvable from an installed extension; use the local check below.
  }
  return (message) =>
    message.stopReason === "error" &&
    typeof message.errorMessage === "string" &&
    TRANSIENT_PROVIDER_ERROR.test(message.errorMessage);
}

// Warn about a broken observation path once per process, not once per run: a broken ledger
// fails every run the same way, and the local log already holds each failure.
let observationFailureWarned = false;

function observationFailuresPath(): string {
  const stateDir = process.env.NATURAL_ROUTER_STATE_DIR?.trim()
    || join(homedir(), ".pi", "agent", "state", "natural-adaptive-routing");
  return join(stateDir, "observation-failures.jsonl");
}

/**
 * Make a failed observation visible instead of indistinguishable from a run that produced no
 * message. This is local evidence only: it never calls `recordAdaptiveFailure`, because an
 * observation failure says nothing about the route and must not trip the router circuit breaker.
 */
function recordObservationFailure(
  ctx: ExtensionContext,
  decisionId: string,
  observed: AdaptiveRoute,
  error: unknown,
): void {
  const message = error instanceof Error ? error.message : String(error);
  try {
    const path = observationFailuresPath();
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify({
      decisionId,
      observed,
      error: message.slice(0, 240),
      at: new Date().toISOString(),
    })}\n`);
  } catch { /* The failure log can never block a valid user execution. */ }
  if (observationFailureWarned) return;
  observationFailureWarned = true;
  ctx.ui.notify(
    `Adaptive router: no se pudo registrar la observación de ${decisionId} (${message.slice(0, 120)}). Detalle en ${observationFailuresPath()}.`,
    "warning",
  );
}

export default async function antigravityQuotaFallback(pi: ExtensionAPI): Promise<void> {
  // Use Pi's own transient-error classifier so the extension does not enqueue
  // a second turn when Pi is already going to retry the failed request.
  const isRetryableAssistantError = await loadRetryableAssistantError();
  const gentleAgentName = detectGentleAgentName();
  let fallbackChain = fallbackChainForAgent(gentleAgentName);
  let originalModel: ExtensionContext["model"];
  let originalThinkingLevel: ReturnType<ExtensionAPI["getThinkingLevel"]> | undefined;
  let activeFallbackIndex: number | undefined;
  let activeRoute: { provider: string; model: string; label: string } | undefined;
  let queuedRoutes = new Set<string>();
  let switchInProgress = false;
  let adaptiveDecision: AdaptiveDecision | undefined;
  let adaptivePrimaryApplied = false;
  let adaptiveRouteObserved = false;
  // The route the extension actually set for this work unit, captured at apply time because
  // `activeRoute` is overwritten by fallbacks.
  let appliedAdaptiveRoute: AdaptiveRoute | undefined;
  let lastPrompt = "";
  // Routes already tried for the current work unit. The dynamic fallback hands
  // these to the router so it can choose the next best one itself.
  const failedRoutes: Array<{ provider: string; model: string }> = [];
  let adaptiveReaskAttempts = 0;
  const gates = new VerificationGateTracker();
  // What the current work unit costs. Reset per run, like the gate tracker: one unit's
  // cost is not evidence about the next one.
  const runMetrics = new RunMetricsTracker();
  let runStartedAt = 0;

  // A verification command that exits zero is the host's own evidence that the
  // work unit succeeded, and it is the only signal the router can admit without
  // judging the model's prose. A gate that fails is ambiguous — pre-existing,
  // flaky, or the model's fault — so it is recorded as nothing rather than guessed.
  pi.on("tool_execution_start", (event) => { gates.noteStart(event.toolCallId, event.args); });
  pi.on("tool_execution_end", (event) => {
    gates.noteEnd(event.toolCallId, event.isError);
    runMetrics.noteToolEnd(event.durationMs, event.isError);
  });

  // One path for every observation, so `message_end` and settle cannot record twice and a
  // failure leaves the flag false for settle to try again.
  const observeAppliedRoute = async (
    decision: AdaptiveDecision,
    observed: AdaptiveRoute,
    ctx: ExtensionContext,
  ): Promise<void> => {
    if (adaptiveRouteObserved) return;
    try {
      await recordObservedRoute(decision, observed);
      adaptiveRouteObserved = true;
    } catch (error) {
      recordObservationFailure(ctx, decision.decisionId, observed, error);
    }
  };

  const routeLabel = (route: FallbackRoute): string =>
    `${route.label}${route.thinking ? ` ${route.thinking}` : ""}`;

  const chainLabel = (): string => fallbackChain.map(routeLabel).join(" → ");

  const showState = (ctx: ExtensionContext, state = readState()): void => {
    const cooldowns = state
      ? ANTIGRAVITY_PROVIDERS.flatMap((provider) => {
          const entry = state.providers[provider];
          if (!entry) return [];
          return [remaining(entry)];
        }).join(", ")
      : "";
    ctx.ui.setStatus(
      STATUS_KEY,
      state ? `Antigravity → ${chainLabel()} (${cooldowns})` : undefined,
    );
  };

  const reportEffectiveRoute = (
    ctx: ExtensionContext,
    route: { provider: string; model: string },
  ): void => {
    if (!gentleAgentName) return;
    ctx.ui.setStatus(
      EFFECTIVE_ROUTE_STATUS_KEY,
      `${route.provider}/${route.model}`,
    );
  };

  const rememberOriginal = (ctx: ExtensionContext, anyProvider = false): void => {
    if (
      ctx.model &&
      (anyProvider || ANTIGRAVITY_PROVIDERS.includes(ctx.model.provider as AntigravityProvider)) &&
      !originalModel
    ) {
      originalModel = ctx.model;
      originalThinkingLevel = pi.getThinkingLevel();
    }
  };

  /**
   * Last resort when the router cannot answer and the static chain is empty.
   *
   * The chain is built from `~/.pi/agent/gentle-fallbacks.json`, which is `{"fallbacks": []}` on
   * this machine, so there is nothing to walk. When the router also fails — unavailable, or it
   * answers with a route the host refuses — `activateFallback` returns undefined, the handler
   * returns, and the work unit stops: no switch, no follow-up turn, and the user has to retype
   * the request. That is the "se cancela" this answers.
   *
   * The candidates come from the runtime and the catalogue, which is the same authority the
   * adaptive path uses, so nothing here invents a route: a model is eligible only if the runtime
   * reports it and the catalogue approves it. Routes already failed for this work unit are
   * skipped, and so are antigravity providers under a recorded cooldown, so this cannot bounce
   * back to the route that just failed.
   */
  const lastResortRoute = (ctx: ExtensionContext): { provider: string; model: string } | undefined => {
    const cooldownState = readState();
    const failed = new Set(failedRoutes.map((route) => `${route.provider}/${route.model}`));
    const current = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined;
    for (const model of ctx.modelRegistry.getAvailable()) {
      const key = `${model.provider}/${model.id}`;
      if (key === current || failed.has(key)) continue;
      if (ANTIGRAVITY_PROVIDERS.includes(model.provider as AntigravityProvider)
        && cooldownState?.providers[model.provider as AntigravityProvider]) continue;
      if (!onboardedRouteAllowed(model.provider, model.id)) continue;
      return { provider: model.provider, model: model.id };
    }
    return undefined;
  };

  const activateFallback = async (
    ctx: ExtensionContext,
    startIndex: number,
  ): Promise<{ provider: string; model: string; label: string } | undefined> => {
    if (adaptivePrimaryApplied && gentleAgentName === "jd-judge-b") {
      ctx.ui.notify("jd-judge-b is fixed to Claude Opus 4.6 high; no model substitution is permitted.", "warning");
      return undefined;
    }
    if (switchInProgress) return activeRoute;
    switchInProgress = true;
    try {
      rememberOriginal(ctx);
      const cooldownState = readState();

      // Dynamic fallback: the router's own ranking minus everything that already
      // failed for this work unit. It knows quota, cost, language and local
      // evidence; the static chain below knows none of that and stays only as the
      // safety net for when the router cannot answer at all.
      if (gentleAgentName && gentleAgentName.length > 0 && lastPrompt.length > 0) {
        try {
          const decision = await resolveAdaptivePrimary(pi, ctx, gentleAgentName, lastPrompt, failedRoutes);
          const route = validAdaptiveDecision(decision, gentleAgentName) ? decision.requestedAdaptiveRoute : undefined;
          const selected = route === undefined ? undefined : ctx.modelRegistry.find(route.provider, route.model);
          if (route !== undefined && selected !== undefined && (await pi.setModel(selected))) {
            activeFallbackIndex = undefined;
            activeRoute = { provider: route.provider, model: route.model, label: "Fallback dinámico" };
            reportEffectiveRoute(ctx, activeRoute);
            return activeRoute;
          }
        } catch {
          // The static chain below remains the safety net.
        }
      }

      for (let index = startIndex; index < fallbackChain.length; index += 1) {
        const route = fallbackChain[index];
        if (adaptivePrimaryApplied && !adaptiveRecoveryRouteAllowed(route, gentleAgentName)) continue;
        if (
          ANTIGRAVITY_PROVIDERS.includes(route.provider as AntigravityProvider) &&
          cooldownState?.providers[route.provider as AntigravityProvider]
        ) {
          continue;
        }
        const fallback = ctx.modelRegistry.find(route.provider, route.model);
        if (!fallback) {
          ctx.ui.notify(
            `No se encontró ${route.provider}/${route.model}; probando el siguiente fallback.`,
            "warning",
          );
          continue;
        }
        if (await pi.setModel(fallback)) {
          if (route.thinking) pi.setThinkingLevel(route.thinking);
          activeFallbackIndex = index;
          activeRoute = { provider: route.provider, model: route.model, label: routeLabel(route) };
          reportEffectiveRoute(ctx, activeRoute);
          return activeRoute;
        }
        ctx.ui.notify(
          `La autenticación de ${route.provider}/${route.model} no está disponible; probando el siguiente fallback.`,
          "warning",
        );
      }

      // The chain is empty and the router had nothing usable. Try one model the runtime reports
      // and the catalogue approves before giving up, so a failed route does not end the work unit.
      const lastResort = lastResortRoute(ctx);
      const candidate = lastResort === undefined ? undefined : ctx.modelRegistry.find(lastResort.provider, lastResort.model);
      if (candidate !== undefined && (await pi.setModel(candidate))) {
        activeFallbackIndex = undefined;
        activeRoute = { provider: lastResort!.provider, model: lastResort!.model, label: "Último recurso" };
        reportEffectiveRoute(ctx, activeRoute);
        return activeRoute;
      }
      ctx.ui.notify("No queda ningún modelo disponible en la cadena de fallback.", "error");
      return undefined;
    } finally {
      switchInProgress = false;
    }
  };

  pi.on("session_start", (_event, ctx) => {
    fallbackChain = fallbackChainForAgent(gentleAgentName);
    originalModel = undefined;
    originalThinkingLevel = undefined;
    activeFallbackIndex = undefined;
    activeRoute = undefined;
    queuedRoutes = new Set<string>();
    adaptiveDecision = undefined;
    adaptivePrimaryApplied = false;
    adaptiveRouteObserved = false;
    appliedAdaptiveRoute = undefined;
    failedRoutes.length = 0;
    adaptiveReaskAttempts = 0;
    showState(ctx);
    if (gentleAgentName) void callNaturalRouter({ action: "quota", force: false }, 15_000).catch(() => undefined);
  });

  // Every Pi process, including Gentle Agents children, reads the shared
  // cooldown before its run. This prevents one failed subagent per route after
  // the first Antigravity quota error has established the reset deadline.
  pi.on("before_agent_start", async (event, ctx) => {
    // Each run verifies its own tree; a gate from the previous run says nothing
    // about this one.
    gates.reset();
    runMetrics.reset();
    runStartedAt = Date.now();
    lastPrompt = event.prompt;
    failedRoutes.length = 0;
    adaptiveReaskAttempts = 0;
    // The editor writes atomically, so an already-running child can adopt a
    // newly saved chain on its next request without polling or a process restart.
    fallbackChain = fallbackChainForAgent(gentleAgentName);

    if (gentleAgentName && ctx.model && !adaptiveDecision && !activeRoute) {
      try {
        const decision = await resolveAdaptivePrimary(pi, ctx, gentleAgentName, event.prompt);
        adaptiveDecision = decision;
        if (decision.kind === "ADAPTIVE_ASSIGNMENT" && !validAdaptiveDecision(decision, gentleAgentName)) {
          await recordAdaptiveInvariant("adaptive route violated provider/model/fixed-role allowlist");
          throw new Error("adaptive route failed the host allowlist guard");
        }
        if (validAdaptiveDecision(decision, gentleAgentName)) {
          const application = prepareAdaptiveApplication(gentleAgentName, event.systemPrompt, decision);
          const requested = application.route;
          const selected = ctx.modelRegistry.find(requested.provider, requested.model);
          if (!selected) throw new Error(`selected route is unavailable: ${requested.provider}/${requested.model}`);
          rememberOriginal(ctx, true);
          if (!(await pi.setModel(selected))) throw new Error(`selected route authentication unavailable: ${requested.provider}/${requested.model}`);
          pi.setThinkingLevel(requested.requestedEffort);
          adaptivePrimaryApplied = true;
          appliedAdaptiveRoute = { ...requested };
          activeRoute = {
            provider: requested.provider,
            model: requested.model,
            label: `${requested.provider}/${requested.model} ${requested.requestedEffort}`,
          };
          reportEffectiveRoute(ctx, activeRoute);
          ctx.ui.setStatus("loon-natural-adaptive-route", `${decision.taskClass}: ${requested.provider}/${requested.model}:${requested.requestedEffort}`);
          ctx.ui.notify(
            `${decision.exploration ? "[Adaptive exploration]" : "[Adaptive]"}\n${gentleAgentName}\n${decision.staticRoute.provider}/${decision.staticRoute.model} ${decision.staticRoute.requestedEffort} → ${requested.provider}/${requested.model} ${requested.requestedEffort}\nReason: ${decision.reason}\nPrompt: ${decision.promptProfileId ?? "neutral"}`,
            "info",
          );
          return { systemPrompt: application.systemPrompt };
        }
        if (decision.mode === "SHADOW" && decision.requestedAdaptiveRoute) {
          ctx.ui.setStatus("loon-natural-adaptive-route", `SHADOW ${decision.requestedAdaptiveRoute.provider}/${decision.requestedAdaptiveRoute.model}:${decision.requestedAdaptiveRoute.requestedEffort}`);
        }
      } catch (error) {
        await recordAdaptiveFailure(error instanceof Error ? error.message : String(error));
        if (!adaptivePrimaryApplied && originalModel && ctx.model !== originalModel) {
          await pi.setModel(originalModel);
          if (originalThinkingLevel) pi.setThinkingLevel(originalThinkingLevel);
          originalModel = undefined;
          originalThinkingLevel = undefined;
          activeRoute = undefined;
        }
        ctx.ui.notify("Adaptive router no disponible; usando la ruta Gentle estática.", "warning");
      }
    }

    let state = readState();
    if (state) state = await reconcileCooldownsWithLiveQuota(ctx, state);
    showState(ctx, state);
    if (!legacyFallbackMayPreempt(adaptivePrimaryApplied)) return;
    if (!state || !ctx.model) return;

    if (
      ctx.model.provider === PRIMARY_ANTIGRAVITY_PROVIDER &&
      state.providers[PRIMARY_ANTIGRAVITY_PROVIDER]
    ) {
      rememberOriginal(ctx);
      // Sin cuenta B: un cooldown de antigravity avanza directo por la única
      // cadena autoritativa.
      await activateFallback(ctx, 0);
    }
  });

  // Pi persists provider failures as assistant messages. Switch the current
  // run and continue it exactly once: transient errors use Pi's built-in retry,
  // while quota errors need an explicit follow-up. The failed message remains
  // as evidence but is ignored when the provider request is reconstructed.
  pi.on("message_end", async (event, ctx) => {
    fallbackChain = fallbackChainForAgent(gentleAgentName);
    const message = event.message;
    if (message.role !== "assistant") return;

    if (adaptivePrimaryApplied && adaptiveDecision?.requestedAdaptiveRoute && !adaptiveRouteObserved) {
      const effort = pi.getThinkingLevel() as FallbackThinking;
      const observed: AdaptiveRoute = {
        provider: message.provider,
        model: message.model,
        requestedEffort: effort,
        effectiveEffort: effort,
      };
      await observeAppliedRoute(adaptiveDecision, observed, ctx);
    }

    if (message.stopReason !== "error") return;

    // Record the route that just failed so the dynamic fallback excludes it instead
    // of re-selecting it.
    failedRoutes.push({ provider: message.provider, model: message.model });

    let activated: { provider: string; model: string; label: string } | undefined;
    let reason: string;
    if (
      ANTIGRAVITY_PROVIDERS.includes(message.provider as AntigravityProvider) &&
      isQuotaExhaustion(message.errorMessage)
    ) {
      const provider = message.provider as AntigravityProvider;
      rememberOriginal(ctx);
      const state = writeState(provider, message.errorMessage, message.model);
      showState(ctx, state);
      const isQuota = typeof message.errorMessage === "string" && /quota|resource[_\s-]?exhausted|limit/i.test(message.errorMessage);
      reason = isQuota ? "Antigravity agotó su cuota" : "Antigravity no está disponible";
      // Las cuentas las administra el propio provider (failover nativo), así que
      // un agotamiento de cuota aquí ya significa que el provider entero quedó
      // fuera: se pasa directo a la cadena externa.
      activated = await activateFallback(ctx, 0);
    } else if (
      adaptivePrimaryApplied &&
      activeRoute &&
      message.provider === activeRoute.provider &&
      message.model === activeRoute.model &&
      originalModel
    ) {
      if (adaptiveReaskAttempts >= MAX_ADAPTIVE_REASK_ATTEMPTS) {
        ctx.ui.notify(
          `Adaptive fallback alcanzó el límite de intentos (${MAX_ADAPTIVE_REASK_ATTEMPTS}); no se intentarán más rutas.`,
          "warning",
        );
        return;
      }
      adaptiveReaskAttempts += 1;
      const isPrimary = message.provider === adaptiveDecision?.requestedAdaptiveRoute?.provider &&
        message.model === adaptiveDecision?.requestedAdaptiveRoute?.model;
      reason = isPrimary
        ? `Adaptive primary ${message.provider}/${message.model} falló`
        : `Adaptive route ${message.provider}/${message.model} falló`;
      activated = await activateFallback(ctx, 0);
    } else {
      const failedIndex = fallbackIndex(message.provider, message.model, fallbackChain);
      if (failedIndex < 0) {
        // The failed route is not part of the static chain, so walking the chain from it means
        // nothing. This is where a Gentle run used to stop: the chain is built from
        // `~/.pi/agent/gentle-fallbacks.json`, which is {"fallbacks": []} on this machine, so
        // `failedIndex` is -1, the handler returned here, and the work unit ended with no switch
        // and no follow-up turn. Ask the router, and if it cannot answer take another approved
        // model instead of cancelling. Bounded to Gentle agent runs, so a plain Pi session that
        // merely shares this extension is not moved to a different model underneath the user.
        if (!gentleAgentName || switchInProgress) return;
        reason = `${message.provider}/${message.model} falló`;
        activated = await activateFallback(ctx, 0);
      } else if (
        activeFallbackIndex !== failedIndex ||
        !originalModel ||
        failedIndex + 1 >= fallbackChain.length
      ) {
        return;
      } else {
        reason = `${routeLabel(fallbackChain[failedIndex])} falló`;
        activated = await activateFallback(ctx, failedIndex + 1);
      }
    }

    if (!activated) return;
    const routeKey = `${activated.provider}/${activated.model}`;
    if (queuedRoutes.has(routeKey)) return;

    queuedRoutes.add(routeKey);
    ctx.ui.notify(
      `${reason}; continuando con ${activated.provider}/${activated.model}.`,
      "warning",
    );
    if (isRetryableAssistantError(message)) return;

    pi.sendMessage(
      {
        customType: "antigravity-quota-fallback",
        content:
          `${reason}. Continúa automáticamente la petición pendiente con ${activated.label}; no pidas al usuario que la repita.`,
        display: true,
        details: {
          rootWorkUnitDecisionId: adaptiveDecision?.decisionId,
          primaryRoute: adaptiveDecision?.requestedAdaptiveRoute,
          fallbackReason: reason,
          fallbackProvider: activated.provider,
          fallbackModel: activated.model,
          fallbackIndex: activeFallbackIndex,
        },
      },
      { triggerTurn: true, deliverAs: "followUp" },
    );
  });

  // Model changes made by the fallback are scoped to one settled request. The
  // original route remains in the session and will be tried again once the
  // provider-reported cooldown has expired.
  pi.on("agent_settled", async (event, ctx) => {
    // A verified outcome has to be admitted before the decision it belongs to is
    // cleared, and only for a route the host actually observed running.
    const settledDecision = adaptiveDecision;
    const gate = gates.outcome();
    runMetrics.noteSettled(event.aborted);
    // Wall-clock spans the whole unit, because that is the time the user waited.
    if (runStartedAt > 0) runMetrics.noteDuration(Date.now() - runStartedAt);
    const settledMetrics = runMetrics.snapshot();
    // The last gate describes the final tree: a pass only counts if nothing failed after
    // it, so a unit that broke the tree on a later edit is not reported as verified.
    //
    // A failure is reported as a product failure, never as a model-capability failure. One
    // failing suite is equally consistent with a broken tree the model never touched, and
    // claiming a model *cannot* do this class of work is a much stronger statement than a
    // single run supports. It is also withheld entirely when the run did not finish
    // normally, because an errored or aborted run never gave the model a fair chance.
    const disposition = gate === "PASSED" ? "SUCCESS"
      : gate === "FAILED" && settledMetrics.complete ? "PRODUCT_FAILURE"
      : undefined;
    // A run with no assistant message still ran the route, so record the route this extension
    // applied. Once a fallback has taken the run over, the adaptive route did not complete, so
    // recording it would be a lie. `message_end` records first when a message arrives, because
    // its provider/model is the more accurate signal.
    if (
      adaptivePrimaryApplied
      && !adaptiveRouteObserved
      && appliedAdaptiveRoute !== undefined
      && activeFallbackIndex === undefined
      && settledDecision !== undefined
    ) {
      await observeAppliedRoute(settledDecision, appliedAdaptiveRoute, ctx);
    }
    if (adaptivePrimaryApplied && adaptiveRouteObserved && settledDecision !== undefined && disposition !== undefined) {
      try { await recordVerifiedOutcome(settledDecision.decisionId, "native_gate", disposition, settledMetrics); }
      catch { /* Evidence admission cannot block a valid user execution. */ }
    }
    gates.reset();
    runMetrics.reset();
    runStartedAt = 0;
    // The route the router chose outlives the unit that ran on it.
    //
    // This used to restore `originalModel` — the model that was running before the router spoke —
    // every time a unit settled. So a worker the router had moved to deepseek came back as the
    // static route on the next launch, and the router had to re-decide from scratch: measured on a
    // real session, the worker sat on `infronai/deepseek-v4.1-flash` from 05:23 until 06:03 and
    // then jumped to `antigravity/gemini-3.8-flash` the moment it settled.
    //
    // Keeping the route is what makes a fallback a fallback rather than a one-unit detour. The
    // original is still restored on the paths that must: a router failure that never applied a
    // route, and `session_start`, where a new session legitimately begins from the static
    // assignment. Nothing here changes which model was chosen — only that the choice survives.
    originalModel = undefined;
    originalThinkingLevel = undefined;
    activeFallbackIndex = undefined;
    activeRoute = undefined;
    queuedRoutes = new Set<string>();
    adaptiveDecision = undefined;
    adaptivePrimaryApplied = false;
    adaptiveRouteObserved = false;
    appliedAdaptiveRoute = undefined;
    failedRoutes.length = 0;
    adaptiveReaskAttempts = 0;
    showState(ctx);
    ctx.ui.setStatus("loon-natural-adaptive-route", undefined);
  });

  registerAdaptiveCommands(pi);

  pi.registerCommand("antigravity-fallback", {
    description: "Muestra o limpia el fallback automático de cuota de Antigravity",
    handler: async (args, ctx) => {
      if (args.trim() === "clear") {
        clearState();
        showState(ctx, undefined);
        ctx.ui.notify("Fallback de Antigravity limpiado; el próximo uso probará el modelo original.", "info");
        return;
      }
      const state = readState();
      if (!state) {
        ctx.ui.notify("Fallback inactivo; Antigravity se usará normalmente.", "info");
        return;
      }
      ctx.ui.notify(
        `Fallback activo${gentleAgentName ? ` para ${gentleAgentName}` : ""}: Antigravity A → ${chainLabel()}.`,
        "info",
      );
    },
  });
}
