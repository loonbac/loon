import test from "node:test";
import assert from "node:assert/strict";

import { RunMetricsTracker, emptyRunMetrics } from "./run-metrics.ts";

function assistant(usage: Record<string, unknown> | undefined, stopReason = "stop") {
  return { usage, stopReason };
}

test("a unit that solved it in one turn records one step and what it billed", () => {
  const tracker = new RunMetricsTracker();
  tracker.noteAssistantMessage(assistant({
    input: 1200, output: 300, cacheRead: 8000, cacheWrite: 0, totalTokens: 9500,
    cost: { input: 0.0005, output: 0.0003, cacheRead: 0.0001, cacheWrite: 0, total: 0.0009 },
  }));
  const metrics = tracker.snapshot();
  assert.equal(metrics.steps, 1);
  assert.equal(metrics.inputTokens, 1200);
  assert.equal(metrics.outputTokens, 300);
  assert.equal(metrics.cacheReadTokens, 8000);
  // Total comes from the provider, not from adding the four fields: they do not sum to it.
  assert.equal(metrics.totalTokens, 9500);
  assert.equal(metrics.costUsd, 0.0009);
  assert.equal(metrics.complete, true);
});

test("several turns sum into one unit cost", () => {
  const tracker = new RunMetricsTracker();
  const turn = () => assistant({
    input: 1000, output: 100, cacheRead: 0, cacheWrite: 0, totalTokens: 1100,
    cost: { input: 0.0001, output: 0.0002, cacheRead: 0, cacheWrite: 0, total: 0.0003 },
  });
  tracker.noteAssistantMessage(turn());
  tracker.noteAssistantMessage(turn());
  tracker.noteAssistantMessage(turn());
  const metrics = tracker.snapshot();
  assert.equal(metrics.steps, 3);
  assert.equal(metrics.totalTokens, 3300);
  assert.equal(Math.round(metrics.costUsd * 10000), 9);
});

test("a provider that reports no usage is not counted as reporting zero tokens", () => {
  // Counting an unreported turn as zero would make a provider that omits usage look
  // infinitely cheap and win every cost comparison.
  const tracker = new RunMetricsTracker();
  tracker.noteAssistantMessage(assistant(undefined));
  tracker.noteAssistantMessage(undefined);
  const metrics = tracker.snapshot();
  assert.equal(metrics.steps, 0);
  assert.deepEqual(metrics, emptyRunMetrics());
});

test("an errored or aborted turn, or an aborted run, marks the unit incomplete", () => {
  const tracker = new RunMetricsTracker();
  tracker.noteAssistantMessage(assistant({ input: 10, output: 1, totalTokens: 11, cost: { total: 0.01 } }));
  assert.equal(tracker.snapshot().complete, true);

  const errored = new RunMetricsTracker();
  errored.noteAssistantMessage(assistant({ input: 10, output: 1, totalTokens: 11, cost: { total: 0.01 } }, "error"));
  assert.equal(errored.snapshot().complete, false);

  const abortedTurn = new RunMetricsTracker();
  abortedTurn.noteAssistantMessage(assistant({ input: 10, output: 1, totalTokens: 11, cost: { total: 0.01 } }, "aborted"));
  assert.equal(abortedTurn.snapshot().complete, false);

  const runAborted = new RunMetricsTracker();
  runAborted.noteSettled(true);
  assert.equal(runAborted.snapshot().complete, false);
});

test("a failing tool is counted but does not make the figures defective", () => {
  // A verification command that fails is the evidence a failure outcome is built from.
  // Marking the measurement defective would make that failure impossible to record.
  const tracker = new RunMetricsTracker();
  tracker.noteSettled(false);
  tracker.noteToolEnd(120, true);
  tracker.noteToolEnd(80, true);
  tracker.noteToolEnd(30, false);
  const metrics = tracker.snapshot();
  assert.equal(metrics.failedTools, 2);
  assert.equal(metrics.toolCalls, 3);
  assert.equal(metrics.complete, true);
});

test("tool time is tracked apart from model time", () => {
  const tracker = new RunMetricsTracker();
  tracker.noteToolEnd(1500, false);
  tracker.noteToolEnd(500, false);
  tracker.noteDuration(9000);
  const metrics = tracker.snapshot();
  assert.equal(metrics.toolCalls, 2);
  assert.equal(metrics.toolDurationMs, 2000);
  assert.equal(metrics.durationMs, 9000);
});

test("non-numeric or negative figures are ignored rather than poisoning the totals", () => {
  const tracker = new RunMetricsTracker();
  tracker.noteAssistantMessage(assistant({
    input: "many", output: -5, cacheRead: Number.NaN, cacheWrite: null, totalTokens: undefined,
    cost: { total: "free" },
  }));
  tracker.noteToolEnd("fast", false);
  tracker.noteDuration(-1);
  const metrics = tracker.snapshot();
  // The turn happened, so it is a step, but nothing it reported is trusted as a number.
  assert.equal(metrics.steps, 1);
  assert.equal(metrics.inputTokens, 0);
  assert.equal(metrics.outputTokens, 0);
  assert.equal(metrics.costUsd, 0);
  assert.equal(metrics.toolDurationMs, 0);
  assert.equal(metrics.durationMs, 0);
});

test("reset clears a unit so the next one starts from zero", () => {
  const tracker = new RunMetricsTracker();
  tracker.noteAssistantMessage(assistant({ input: 5, totalTokens: 5, cost: { total: 1 } }));
  tracker.reset();
  assert.deepEqual(tracker.snapshot(), emptyRunMetrics());
});
