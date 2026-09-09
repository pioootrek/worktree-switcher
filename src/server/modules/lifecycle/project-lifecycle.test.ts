import { describe, expect, it, vi } from "vitest";

import { ProjectLifecycle } from "./index";

describe("shared project lifecycle", () => {
  it("counts retained failed process ownership consistently in compact capacity", () => {
    const projects = [{ id: "web", name: "Web" }, { id: "api", name: "API" }];
    const summaries = new Map([
      ["web", { phase: "failed" as const, worktreePath: "/code/web", startedAt: "2026-09-08T00:00:00.000Z", failureCode: "cleanup_failed", ownsProcess: true }],
      ["api", { phase: "stopped" as const, worktreePath: null, startedAt: null, failureCode: null, ownsProcess: false }],
    ]);
    const snapshot = (id: string) => ({
      phase: summaries.get(id)!.phase,
      pid: summaries.get(id)!.ownsProcess ? 1234 : null,
      worktreePath: summaries.get(id)!.worktreePath,
      startedAt: summaries.get(id)!.startedAt,
      error: null, failure: null, logs: [],
      resources: { status: "idle" as const, currentRssBytes: null, peakRssBytes: null, cpuPercent: null,
        processCount: null, sampledAt: null, sampleAgeSeconds: null, warningThresholdBytes: null, history: [] },
    });
    const lifecycle = new ProjectLifecycle({
      getProject: (id) => projects.find((project) => project.id === id) as never,
      listProjects: () => projects as never,
      authorizeReservation: () => null,
      getServerCapacitySettings: () => ({ enabled: true, limit: 1 }),
    }, {
      snapshot: vi.fn(snapshot),
      statusSummary: vi.fn((id: string) => summaries.get(id)!),
    });

    expect(lifecycle.capacityStatusCompact()).toMatchObject({
      used: 1,
      available: 0,
      holders: [{ projectId: "web", phase: "stopping" }],
    });
    expect(lifecycle.capacityStatus()).toMatchObject({ used: 1, available: 0 });
    expect(() => lifecycle.acquireCapacity(projects[1] as never)).toThrow("Osiągnięto limit 1");

    summaries.set("web", { ...summaries.get("web")!, ownsProcess: false });
    expect(lifecycle.capacityStatusCompact()).toMatchObject({ used: 0, available: 1, holders: [] });
  });

  it("counts retained ownership through the snapshot-only compact fallback", () => {
    const projects = [{ id: "web", name: "Web" }];
    const snapshot = vi.fn(() => ({
      phase: "failed" as const, pid: 1234, worktreePath: "/code/web", startedAt: null,
      error: "cleanup unconfirmed", failure: null, logs: [],
      resources: { status: "idle" as const, currentRssBytes: null, peakRssBytes: null, cpuPercent: null,
        processCount: null, sampledAt: null, sampleAgeSeconds: null, warningThresholdBytes: null, history: [] },
    }));
    const lifecycle = new ProjectLifecycle({
      getProject: () => projects[0] as never,
      listProjects: () => projects as never,
      authorizeReservation: () => null,
      getServerCapacitySettings: () => ({ enabled: true, limit: 1 }),
    }, { snapshot });

    expect(lifecycle.capacityStatusCompact()).toMatchObject({
      used: 1,
      available: 0,
      holders: [{ projectId: "web", phase: "stopping" }],
    });
    expect(snapshot).toHaveBeenCalledOnce();
  });

  it("serializes one project across callers, allows another project, and recovers after rejection", async () => {
    const lifecycle = new ProjectLifecycle({
      getProject: () => null,
      listProjects: () => [],
      authorizeReservation: () => null,
      getServerCapacitySettings: () => ({ enabled: false, limit: 2 }),
    }, { snapshot: vi.fn() });
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const first = lifecycle.serialized("web", async () => {
      order.push("web:first");
      await gate;
      throw new Error("start failed");
    });
    const rejection = expect(first).rejects.toThrow("start failed");
    const second = lifecycle.serialized("web", async () => { order.push("web:second"); });
    await lifecycle.serialized("api", async () => { order.push("api"); });
    expect(order).toEqual(["web:first", "api"]);
    release();
    await rejection;
    await second;
    await lifecycle.serialized("web", async () => { order.push("web:third"); });
    expect(order).toEqual(["web:first", "api", "web:second", "web:third"]);
  });

  it("coordinates maintenance and scan admission per worktree and releases permits idempotently", () => {
    const lifecycle = new ProjectLifecycle({
      getProject: () => null,
      listProjects: () => [],
      authorizeReservation: () => null,
      getServerCapacitySettings: () => ({ enabled: false, limit: 2 }),
    }, { snapshot: vi.fn() });

    const releaseScan = lifecycle.acquireScan("web", "/code/web");
    expect(releaseScan).not.toBeNull();
    expect(lifecycle.acquireMaintenance("web", "/code/web")).toBeNull();
    expect(lifecycle.acquireMaintenance("api", "/code/api")).not.toBeNull();

    releaseScan?.();
    releaseScan?.();
    const releaseMaintenance = lifecycle.acquireMaintenance("web", "/code/web");
    expect(releaseMaintenance).not.toBeNull();
    expect(lifecycle.acquireScan("web", "/code/web")).toBeNull();
    releaseMaintenance?.();
    expect(lifecycle.acquireScan("web", "/code/web")).not.toBeNull();
  });

  it("closes admission and drains accepted serialized work", async () => {
    const lifecycle = new ProjectLifecycle({
      getProject: () => null,
      listProjects: () => [],
      authorizeReservation: () => null,
      getServerCapacitySettings: () => ({ enabled: false, limit: 2 }),
    }, { snapshot: vi.fn() });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const accepted = lifecycle.serialized("web", async () => gate);
    const draining = lifecycle.closeAndDrain();

    expect(lifecycle.acquireScan("web", "/code/web")).toBeNull();
    await expect(lifecycle.serialized("api", async () => undefined)).rejects.toThrow("zamykany");
    let drained = false;
    void draining.then(() => { drained = true; });
    await Promise.resolve();
    expect(drained).toBe(false);
    release();
    await accepted;
    await draining;
  });
});
