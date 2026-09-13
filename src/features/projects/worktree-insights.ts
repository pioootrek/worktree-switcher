import type { ProjectSnapshot, Worktree } from "@/shared/contracts";

export type WorktreeFilter = "all" | "running" | "review" | "inactive" | "merged" | "unmerged" | "both";
export type WorktreeSort = "launched-desc" | "launched-asc" | "size-desc" | "size-asc" | "commit-desc" | "commit-asc" | "name";
export const worktreeSorts: WorktreeSort[] = ["launched-desc", "launched-asc", "size-desc", "size-asc", "commit-desc", "commit-asc", "name"];

export function worktreeInsights(snapshot: ProjectSnapshot, now: number) {
  const storage = new Map(snapshot.storage.map((entry) => [entry.worktreePath, entry]));
  return snapshot.worktrees.map((worktree) => {
    const sample = storage.get(worktree.path);
    const running = snapshot.runtime.worktreePath === worktree.path && ["running", "starting", "stopping"].includes(snapshot.runtime.phase);
    const lastLaunch = snapshot.lastLaunchedAt?.[worktree.path] ?? (snapshot.runtime.phase === "running" && snapshot.runtime.worktreePath === worktree.path ? snapshot.runtime.startedAt : null);
    const lastCommit = worktree.lastCommitAt ?? null;
    const protectedWorktree = worktree.isDefaultBranch || worktree.dirty || worktree.locked || worktree.statusError || running || snapshot.reservation?.worktreePath === worktree.path;
    const inactive = protectedWorktree ? false : lastLaunch && lastCommit
      ? now - Math.max(Date.parse(lastLaunch), Date.parse(lastCommit)) >= 30 * 86400000 : null;
    return { snapshot, worktree, running, lastLaunch, lastCommit, inactive, bytes: sample?.totalBytes ?? null, measuredAt: sample?.measuredAt ?? null, measurementStatus: sample?.status ?? "unmeasured" };
  });
}
export type WorktreeInsight = ReturnType<typeof worktreeInsights>[number];

export function filterWorktrees(rows: WorktreeInsight[], query: string, filter: WorktreeFilter, sort: WorktreeSort) {
  const search = query.trim().toLowerCase();
  const filtered = rows.filter(({ snapshot, worktree: w, running, inactive }) =>
    `${snapshot.project.name} ${w.branch ?? "detached HEAD"} ${w.path} ${w.head}`.toLowerCase().includes(search)
    && (filter === "all" || filter === "running" && running || filter === "merged" && w.merged === true
      || filter === "unmerged" && w.merged === false && !w.isDefaultBranch || filter === "inactive" && inactive === true
      || filter === "both" && inactive === true && w.merged === true || filter === "review" && (inactive === true || w.merged === true)),
  );
  const value = (row: WorktreeInsight) => sort.startsWith("size") ? row.bytes
    : sort.startsWith("commit") ? row.lastCommit ? Date.parse(row.lastCommit) : null
      : row.lastLaunch ? Date.parse(row.lastLaunch) : null;
  const name = (w: Worktree) => w.branch ?? w.path;
  return filtered.sort((a, b) => {
    if (sort !== "name") {
      const av = value(a), bv = value(b);
      if (av === null && bv !== null) return 1;
      if (bv === null && av !== null) return -1;
      if (av !== null && bv !== null && av !== bv) return (av - bv) * (sort.endsWith("desc") ? -1 : 1);
    }
    return name(a.worktree).localeCompare(name(b.worktree), undefined, { numeric: true }) || a.worktree.path.localeCompare(b.worktree.path);
  });
}
