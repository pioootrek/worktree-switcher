import { describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ active: 0, peak: 0, reads: 0 }));
vi.mock("node:fs/promises", () => ({
  readdir: async () => Array.from({ length: 120 }, (_, index) => ({ name: String(index + 1), isDirectory: () => true })),
  readFile: async (path: string) => {
    if (path === "/proc/stat") return "cpu 1 2 3 4\n";
    fixture.active++;
    fixture.peak = Math.max(fixture.peak, fixture.active);
    try {
      await new Promise<void>(resolve => setImmediate(resolve));
      if (path.endsWith("/status")) return "VmRSS: 123 kB\n";
      fixture.reads++;
      const pid = Number(path.split("/")[2]);
      if (pid === 3) throw Object.assign(new Error("process exited"), { code: "ENOENT" });
      const fields = Array<string>(20).fill("0");
      fields[0] = "S"; fields[2] = pid <= 2 ? "42" : "99";
      fields[11] = "10"; fields[12] = "5";
      return `${pid} (fixture worker) ${fields.join(" ")}`;
    } finally { fixture.active--; }
  },
}));

import { LinuxProcessResourceSampler } from "./resource-monitor";

describe.skipIf(process.platform !== "linux")("bounded process inspection", () => {
  it("bounds pending reads on a busy host while preserving group totals and exit tolerance", async () => {
    const result = await new LinuxProcessResourceSampler().sample(42);
    expect(fixture.reads).toBe(120);
    expect(fixture.peak).toBeLessThanOrEqual(8);
    expect(fixture.active).toBe(0);
    expect(result).toMatchObject({ processCount: 2, rssBytes: 246 * 1024, processCpuTicks: 30, hostCpuTicks: 10 });
  });
});
