import { describe, expect, it } from "vitest";
import { dashboardFixture } from "../../../tests/ui/dashboard-fixture";
import { filterWorktrees, worktreeInsights } from "./worktree-insights";

describe("worktree insights", () => {
  it("requires launch evidence and protects dirty, reserved and default worktrees from inactivity", () => {
    const snapshot = dashboardFixture().projects[0];
    const base = snapshot.worktrees[0];
    snapshot.worktrees = ["old", "dirty", "default", "reserved", "unknown"].map((branch) => ({
      ...base, path: `/${branch}`, branch, lastCommitAt: "2025-01-01T00:00:00Z", dirty: branch === "dirty", isDefaultBranch: branch === "default",
    }));
    snapshot.lastLaunchedAt = Object.fromEntries(snapshot.worktrees.filter((w) => w.branch !== "unknown").map((w) => [w.path, "2025-01-02T00:00:00Z"]));
    snapshot.reservation = { worktreePath: "/reserved" } as NonNullable<typeof snapshot.reservation>;
    const rows = worktreeInsights(snapshot, Date.parse("2026-01-01"));
    expect(rows.map((r) => r.inactive)).toEqual([true, false, false, false, null]);
  });

  it("combines filters, counts overlapping review signals once, and sorts unknown values last in either direction", () => {
    const snapshot = dashboardFixture().projects[0];
    const base = snapshot.worktrees[0];
    snapshot.worktrees = ["merged", "active", "unknown"].map((branch) => ({ ...base, path: `/${branch}`, branch, merged: branch === "merged", lastCommitAt: "2025-01-01T00:00:00Z" }));
    snapshot.lastLaunchedAt = { "/merged": "2025-01-02T00:00:00Z", "/active": "2025-12-31T00:00:00Z" };
    const rows = worktreeInsights(snapshot, Date.parse("2026-01-01"));
    expect(filterWorktrees(rows, "", "review", "name")).toHaveLength(1);
    expect(filterWorktrees(rows, "", "both", "name")).toHaveLength(1);
    expect(filterWorktrees(rows, "active", "merged", "name")).toHaveLength(0);
    expect(filterWorktrees(rows, "", "all", "launched-desc").map((r) => r.worktree.branch)).toEqual(["active", "merged", "unknown"]);
    expect(filterWorktrees(rows, "", "all", "launched-asc").map((r) => r.worktree.branch)).toEqual(["merged", "active", "unknown"]);
  });
});
