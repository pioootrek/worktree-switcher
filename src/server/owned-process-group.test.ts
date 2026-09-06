import type { ChildProcess } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OwnedProcessGroup } from "./owned-process-group";

afterEach(() => vi.restoreAllMocks());

describe("OwnedProcessGroup", () => {
  it("never signals a PID after observing that its original group disappeared", async () => {
    const kill = vi.spyOn(process, "kill").mockImplementation(() => {
      throw Object.assign(new Error("gone"), { code: "ESRCH" });
    });
    const group = new OwnedProcessGroup({ pid: 12345 } as ChildProcess);
    await group.stop();
    // Even if the numeric PID has since been recycled, ownership is retired.
    kill.mockReturnValue(true);
    await group.stop();
    expect(kill).toHaveBeenCalledTimes(1);
    expect(kill).toHaveBeenCalledWith(-12345, 0);
  });

  it("does not treat an inspection error as confirmed exit", async () => {
    const kill = vi.spyOn(process, "kill").mockImplementation(() => {
      throw Object.assign(new Error("denied"), { code: "EPERM" });
    });
    const group = new OwnedProcessGroup({ pid: 12345 } as ChildProcess);
    await expect(group.stop()).rejects.toThrow("denied");
    expect(kill).toHaveBeenCalledTimes(1);
    expect(kill).toHaveBeenCalledWith(-12345, 0);
  });

  it("does not signal anything when spawn never allocated a PID", async () => {
    const kill = vi.spyOn(process, "kill");
    await new OwnedProcessGroup({} as ChildProcess).stop();
    expect(kill).not.toHaveBeenCalled();
  });
});
