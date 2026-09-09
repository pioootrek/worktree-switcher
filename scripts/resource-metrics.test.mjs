import assert from "node:assert/strict";
import test from "node:test";
import { assess, MiB, summarize } from "./resource-metrics.mjs";

test("CPU uses one-core process time and RSS uses the sample median", () => {
  const result = summarize([
    { timeMs: 0, cpuMicros: 0, rssBytes: 40 * MiB },
    { timeMs: 1000, cpuMicros: 2000, rssBytes: 100 * MiB },
    { timeMs: 2000, cpuMicros: 10000, rssBytes: 42 * MiB },
  ]);
  assert.equal(result.cpuPercent, 0.5);
  assert.equal(result.medianRssMiB, 42);
  assert.equal(result.peakRssMiB, 100);
});

test("growth compares identical running workloads, not the empty controller", () => {
  const phase = rss => ({ summary: { medianRssMiB: rss, cpuPercent: 0.1 } });
  const phases = { baseline: phase(45), empty: phase(60), registered: phase(65), running: phase(80), afterCycles: phase(90) };
  assert.ok(assess(phases).every(check => check.passed));
  phases.afterCycles = phase(115);
  assert.equal(assess(phases).find(check => check.name === "postCycleGrowthMiB").passed, false);
});

test("invalid measurements fail rather than becoming a passing zero", () => {
  assert.throws(() => summarize([]));
  assert.throws(() => summarize([{ timeMs: 0, cpuMicros: 0, rssBytes: 1 }, { timeMs: 0, cpuMicros: 0, rssBytes: 1 }]));
  assert.throws(() => summarize([{ timeMs: 0, cpuMicros: 10, rssBytes: 1 }, { timeMs: 1, cpuMicros: 0, rssBytes: 1 }]));
});
