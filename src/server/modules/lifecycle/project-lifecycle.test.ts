import { describe, expect, it, vi } from "vitest";

import type { Project, RuntimeSnapshot } from "@/shared/contracts";
import { ProjectLifecycle } from "./index";

describe("shared project lifecycle", () => {
  it("counts retained ownership through a snapshot-only compact fallback", () => {
    const project = { id: "web", name: "Web" } as Project;
    const runtime = {
      phase: "failed",
      pid: 1234,
      worktreePath: "/code/web",
      startedAt: "2026-09-09T00:00:00.000Z",
    } as RuntimeSnapshot;
    const snapshot = vi.fn(() => runtime);
    const lifecycle = new ProjectLifecycle({
      getProject: () => project,
      listProjects: () => [project],
      authorizeReservation: () => null,
      getServerCapacitySettings: () => ({ enabled: true, limit: 1 }),
    }, { snapshot });

    expect(lifecycle.capacityStatusCompact()).toEqual({
      enabled: true,
      limit: 1,
      used: 1,
      available: 0,
      holders: [{ projectId: "web", projectName: "Web", phase: "stopping" }],
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
