/**
 * What a work unit actually cost.
 *
 * A verified gate says the work landed; it says nothing about what it took to get there,
 * and two routes that both pass can differ by an order of magnitude in tokens, wall-clock
 * and how many model turns they needed. Without those numbers the router can only learn
 * that a model eventually works, never that it works on the first try or cheaply.
 *
 * The metrics are accumulated from the events the host already emits. Token and cost
 * figures come from the provider's own reporting on each assistant message, so they are
 * observed rather than modelled: the router never multiplies a token count by a price it
 * looked up somewhere else.
 *
 * Wall-clock covers the whole unit from the first model turn to settlement, because that
 * is the time the user waits. Tool time is tracked separately since it measures the
 * machine's work, not the model's.
 */
export interface RunMetrics {
  /** Assistant turns. The proxy for going in circles: a unit that solved it took few. */
  steps: number;
  /** Tokens the provider billed, summed over every turn of the unit. */
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Total tokens as the provider counted them, which is not the sum of the four above. */
  totalTokens: number;
  /** Dollars the provider reported for the unit. Never derived from a separate price list. */
  costUsd: number;
  /** Wall-clock from the first assistant message to settlement. */
  durationMs: number;
  toolCalls: number;
  /** Time spent inside tools, summed. Reported separately from model latency. */
  toolDurationMs: number;
  /** Tool calls that ended in error, counted whether or not they were verification. */
  failedTools: number;
  /**
   * True when the run finished normally: no turn errored or aborted and the run itself was
   * not aborted. It says the figures cover a finished run, not that the work succeeded.
   *
   * A failing tool does not clear it. A verification command that fails is the evidence a
   * failure outcome is built from, so treating it as a defective measurement would make
   * the failure impossible to record — which is exactly the trap this field used to set.
   */
  complete: boolean;
}

export function emptyRunMetrics(): RunMetrics {
  return {
    steps: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
    totalTokens: 0, costUsd: 0, durationMs: 0, toolCalls: 0, toolDurationMs: 0,
    failedTools: 0, complete: true,
  };
}

function finite(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

/**
 * Accumulates one work unit. `noteAssistantMessage` takes the raw message because the
 * usage shape belongs to the provider, and reading it defensively keeps a provider that
 * reports nothing from being counted as a provider that reported zero.
 */
export class RunMetricsTracker {
  #metrics = emptyRunMetrics();

  reset(): void { this.#metrics = emptyRunMetrics(); }

  snapshot(): RunMetrics { return { ...this.#metrics }; }

  noteAssistantMessage(message: { usage?: unknown; stopReason?: unknown } | undefined): void {
    if (message === undefined || message.usage === undefined || message.usage === null) return;
    const usage = message.usage as Record<string, unknown>;
    this.#metrics.steps += 1;
    this.#metrics.inputTokens += finite(usage.input);
    this.#metrics.outputTokens += finite(usage.output);
    this.#metrics.cacheReadTokens += finite(usage.cacheRead);
    this.#metrics.cacheWriteTokens += finite(usage.cacheWrite);
    this.#metrics.totalTokens += finite(usage.totalTokens);
    const cost = usage.cost;
    if (cost !== null && typeof cost === "object") this.#metrics.costUsd += finite((cost as Record<string, unknown>).total);
    // An aborted or failed turn still cost what it cost, but it does not describe a
    // finished unit, so the figures built from it are marked as incomplete.
    if (message.stopReason === "error" || message.stopReason === "aborted") this.#metrics.complete = false;
  }

  noteToolEnd(durationMs: unknown, isError: unknown): void {
    this.#metrics.toolCalls += 1;
    this.#metrics.toolDurationMs += finite(durationMs);
    // Counted, never fatal: a failing verification command is evidence about the work, and
    // a failing edit is a mistake worth knowing about, but neither makes the measurement
    // describe something other than a finished run.
    if (isError === true) this.#metrics.failedTools += 1;
  }

  noteSettled(aborted: unknown): void {
    if (aborted === true) this.#metrics.complete = false;
  }

  noteDuration(durationMs: number): void {
    this.#metrics.durationMs = Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : 0;
  }
}
