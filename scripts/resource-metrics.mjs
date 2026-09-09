export const MiB = 1024 * 1024;

// Release criteria, calibrated with the procedure in docs/resource-budget.md.
export const limits = Object.freeze({ stoppedOverheadMiB: 32, runningOverheadMiB: 96, growthMiB: 32, stoppedCpuPercent: 0.5, runningCpuPercent: 5 });

export function summarize(samples) {
  if (samples.length < 2) throw new Error("At least two resource samples are required.");
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    if (![s.rssBytes, s.cpuMicros, s.timeMs].every(Number.isFinite) || s.rssBytes <= 0 || s.cpuMicros < 0
      || (i && (s.timeMs <= samples[i - 1].timeMs || s.cpuMicros < samples[i - 1].cpuMicros))) {
      throw new Error("Invalid or non-monotonic resource sample.");
    }
  }
  const rss = samples.map(s => s.rssBytes).sort((a, b) => a - b);
  const median = rss.length % 2 ? rss[Math.floor(rss.length / 2)] : (rss[rss.length / 2 - 1] + rss[rss.length / 2]) / 2;
  const durationMs = samples.at(-1).timeMs - samples[0].timeMs;
  return { sampleCount: samples.length, durationMs, medianRssMiB: median / MiB,
    peakRssMiB: rss.at(-1) / MiB,
    cpuPercent: (samples.at(-1).cpuMicros - samples[0].cpuMicros) / (durationMs * 1000) * 100 };
}

export function assess(phases) {
  const baseline = phases.baseline.summary;
  const checks = [];
  for (const name of ["empty", "registered", "running", "afterCycles"]) {
    const summary = phases[name].summary;
    const active = name === "running" || name === "afterCycles";
    checks.push({ name: `${name}.overheadMiB`, value: summary.medianRssMiB - baseline.medianRssMiB, limit: active ? limits.runningOverheadMiB : limits.stoppedOverheadMiB });
    checks.push({ name: `${name}.idleCpuPercent`, value: summary.cpuPercent, limit: active ? limits.runningCpuPercent : limits.stoppedCpuPercent });
  }
  checks.push({ name: "postCycleGrowthMiB", value: phases.afterCycles.summary.medianRssMiB - phases.running.summary.medianRssMiB, limit: limits.growthMiB });
  return checks.map(check => ({ ...check, passed: Number.isFinite(check.value) && check.value <= check.limit }));
}
