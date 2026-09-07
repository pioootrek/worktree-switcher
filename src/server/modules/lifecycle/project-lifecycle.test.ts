import { describe, expect, it, vi } from "vitest";

import { ProjectLifecycle } from "./index";

describe("shared project lifecycle", () => {
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
});
