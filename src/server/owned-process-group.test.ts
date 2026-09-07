import type { ChildProcess } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OwnedProcessGroup, processGroupSelectionArgs } from "./owned-process-group";

afterEach(() => vi.restoreAllMocks());

describe("OwnedProcessGroup", () => {
  it("selects the exact process group with platform-specific ps syntax", () => {
    expect(processGroupSelectionArgs(12345, "linux")).toEqual(["-o", "stat=", "-12345"]);
    expect(processGroupSelectionArgs(12345, "darwin")).toEqual(["-o", "stat=", "-g", "12345"]);
  });

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

  it("retries transient inspection failures against only the owned group", async () => {
    const kill = vi.spyOn(process, "kill").mockReturnValue(true);
    const inspect = vi.fn()
      .mockRejectedValueOnce(new Error("busy"))
      .mockRejectedValueOnce(new Error("busy"))
      .mockResolvedValue(false);
    const group = new OwnedProcessGroup({ pid: 12345 } as ChildProcess, inspect);

    await group.stop();

    expect(inspect).toHaveBeenCalledTimes(3);
    expect(inspect).toHaveBeenCalledWith(12345);
    expect(kill).toHaveBeenCalledOnce();
    expect(kill).toHaveBeenCalledWith(-12345, 0);
  });
});
