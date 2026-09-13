import { describe, expect, it } from "vitest";
import { dashboardFixture, testRunFixture } from "../../../tests/ui/dashboard-fixture";
import { cacheBlock, currentMetrics, storageRows, sumKnown } from "./resource-summary";

describe("resource summary", () => {
  it("distinguishes missing measurements from a measured zero and keeps project-qualified rows", () => {
    const snapshot = dashboardFixture().projects[0];
    const other = structuredClone(snapshot); other.project.id = "other";
    const rows = storageRows([snapshot, other]);
    expect(rows[0].key).not.toBe(rows[1].key);
    expect(rows[0].storage.status).toBe("unmeasured");
    expect(sumKnown([null, null])).toBeNull();
    expect(sumKnown([null, 0])).toBe(0);
    expect(sumKnown([1024, null, 2048])).toBe(3072);
  });
  it("excludes stopped or stale server samples from current consumption", () => {
    const snapshot = dashboardFixture().projects[0];
    snapshot.runtime.resources.status = "available";
    expect(currentMetrics(snapshot)).toBe(false);
    snapshot.runtime.phase = "running";
    expect(currentMetrics(snapshot)).toBe(true);
    snapshot.runtime.resources.status = "stale";
    expect(currentMetrics(snapshot)).toBe(false);
  });
  it("blocks cleanup of active, reserved, measuring, testing or missing worktrees", () => {
    const snapshot = dashboardFixture().projects[0];
    const row = storageRows([snapshot])[0];
    expect(cacheBlock(row)).toBeNull();
    snapshot.runtime.phase = "running"; snapshot.runtime.worktreePath = row.worktree.path;
    expect(cacheBlock(row)).toBe("active");
    snapshot.runtime.phase = "stopped";
    snapshot.reservation = { id: "r", projectId: "web", worktreePath: row.worktree.path, owner: "agent", kind: "agent", reason: null, createdAt: "2026-01-01", expiresAt: null, maximumExpiresAt: null };
    expect(cacheBlock(row)).toBe("reserved");
    snapshot.reservation = null; row.storage.status = "scanning";
    expect(cacheBlock(row)).toBe("scanning");
    row.storage.status = "available"; snapshot.testRuns = [testRunFixture({ phase: "queued" })];
    expect(cacheBlock(row)).toBe("tests");
    snapshot.testRuns = []; row.worktree.prunable = true;
    expect(cacheBlock(row)).toBe("missing");
  });
});
