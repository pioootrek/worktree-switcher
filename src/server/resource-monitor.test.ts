import { spawn } from "node:child_process";

import { describe, expect, it } from "vitest";

import { LinuxProcessResourceSampler } from "./resource-monitor";

describe.skipIf(process.platform !== "linux")("LinuxProcessResourceSampler", () => {
  it("aggregates a managed process group including its worker child", async () => {
    const child = spawn(process.execPath, [
      "-e",
      "require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});setInterval(()=>{},1000)",
    ], { detached: true, stdio: "ignore" });
    if (!child.pid) throw new Error("Fixture process did not start");
    try {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const sample = await new LinuxProcessResourceSampler().sample(child.pid!);
      expect(sample.processCount).toBeGreaterThanOrEqual(2);
      expect(sample.rssBytes).toBeGreaterThan(0);
      expect(sample.hostCpuTicks).toBeGreaterThan(0);
    } finally {
      try { process.kill(-child.pid, "SIGKILL"); } catch { /* already exited */ }
    }
  });
});
