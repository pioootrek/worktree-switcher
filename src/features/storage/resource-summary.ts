import type { ProjectSnapshot, WorktreeStorageSnapshot } from "@/shared/contracts";

export const runtimeActive = (snapshot: ProjectSnapshot) => ["running", "starting", "stopping"].includes(snapshot.runtime.phase);
export const currentMetrics = (snapshot: ProjectSnapshot) => runtimeActive(snapshot) && snapshot.runtime.resources?.status === "available";

export function storageRows(snapshots: ProjectSnapshot[]) {
  return snapshots.flatMap((snapshot) => snapshot.worktrees.map((worktree) => {
    const storage: WorktreeStorageSnapshot = snapshot.storage.find((entry) => entry.worktreePath === worktree.path) ?? {
      worktreePath: worktree.path, status: "unmeasured", totalBytes: null, nextBytes: null, nextCacheBytes: null,
      nodeModulesBytes: null, otherBytes: null, measuredAt: null, history: [], topDirectories: [], error: null,
    };
    return { key: JSON.stringify([snapshot.project.id, worktree.path]), snapshot, worktree, storage };
  }));
}
export type StorageRow = ReturnType<typeof storageRows>[number];

/** Null means no usable measurement; a measured zero remains zero. */
export function sumKnown(values: Array<number | null>) {
  const known = values.filter((value): value is number => value !== null && Number.isFinite(value));
  return known.length ? known.reduce((sum, value) => sum + value, 0) : null;
}

export function bytes(value: number | null) {
  if (value === null) return "—";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${value.toFixed(value >= 100 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function cacheBlock(row: StorageRow): "active" | "reserved" | "scanning" | "tests" | "missing" | null {
  if (row.worktree.prunable) return "missing";
  if (runtimeActive(row.snapshot) && row.snapshot.runtime.worktreePath === row.worktree.path) return "active";
  if (row.snapshot.reservation?.worktreePath === row.worktree.path) return "reserved";
  if (["pending", "scanning"].includes(row.storage.status)) return "scanning";
  if (row.snapshot.testRuns.some((run) => run.worktreePath === row.worktree.path && ["queued", "running"].includes(run.phase))) return "tests";
  return null;
}
