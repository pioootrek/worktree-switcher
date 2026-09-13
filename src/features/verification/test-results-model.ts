import type { ProjectSnapshot, TestRun } from "@/shared/contracts";

export function executionResult(run: TestRun) {
  return run.phase === "queued" || run.phase === "running" ? run.phase : run.source.processOutcome ?? run.phase;
}

export function testResults(snapshots: ProjectSnapshot[]) {
  return snapshots.flatMap((snapshot) => snapshot.testRuns.map((run) => {
    const result = executionResult(run);
    const active = result === "queued" || result === "running";
    const worktree = snapshot.worktrees.find((w) => w.path === run.worktreePath);
    const observed = run.source.finish ?? run.source.preflight;
    const current = !active && run.source.attribution === "observed_match" && observed?.complete && observed.dirty === false
      && observed.head === worktree?.head && worktree?.dirty === false && !worktree.statusError && snapshot.metadata?.status === "fresh";
    const freshness: "pending" | "current" | "older" | "unknown" = active ? "pending" : current ? "current"
      : observed?.head && worktree?.head && observed.head !== worktree.head ? "older" : "unknown";
    return { snapshot, run, result, active, freshness, failed: ["failed", "timed_out", "interrupted"].includes(result) };
  })).sort((a, b) => Date.parse(b.run.queuedAt) - Date.parse(a.run.queuedAt) || b.run.id.localeCompare(a.run.id));
}
export type TestResult = ReturnType<typeof testResults>[number];

/** Latest completed, non-cancelled run per project/worktree/preset. */
export function latestTestResults(rows: TestResult[]) {
  const latest = new Map<string, TestResult>();
  for (const row of rows) {
    if (row.active || row.result === "cancelled") continue;
    const key = JSON.stringify([row.snapshot.project.id, row.run.worktreePath, row.run.presetId]);
    if (!latest.has(key)) latest.set(key, row);
  }
  return [...latest.values()];
}

export function testDuration(run: TestRun, now: number) {
  if (!run.startedAt) return "—";
  const seconds = Math.max(0, Math.floor(((run.finishedAt ? Date.parse(run.finishedAt) : now) - Date.parse(run.startedAt)) / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
