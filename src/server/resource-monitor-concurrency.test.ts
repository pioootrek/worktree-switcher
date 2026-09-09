import { describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ active: 0, peak: 0, reads: 0, buffers: new Set<Buffer>() }));
vi.mock("node:fs/promises", () => ({
  readdir: async () => Array.from({ length: 120 }, (_, index) => ({ name: String(index + 1), isDirectory: () => true })),
  readFile: async (path: string) => {
    if (path !== "/proc/stat") throw new Error("Unbounded process read");
    return "cpu 1 2 3 4\n";
  },
  open: async (path: string) => {
    const pid = Number(path.split("/")[2]);
    if (path.endsWith("/stat")) fixture.reads++;
    if (pid === 3) throw Object.assign(new Error("process exited"), { code: "ENOENT" });
    const fields = Array<string>(20).fill("0");
    fields[0] = "S"; fields[2] = pid <= 2 ? "42" : "99";
    fields[11] = "10"; fields[12] = "5";
    // An oversized matching record must be skipped, with its descriptor closed.
    const value = pid === 4 ? "x".repeat(9000) : path.endsWith("/status") ? "VmRSS: 123 kB\n" : `${pid} (fixture worker) ${fields.join(" ")}`;
    const contents = Buffer.from(value);
    let position = 0;
    fixture.active++;
    fixture.peak = Math.max(fixture.peak, fixture.active);
    return {
      read: async (buffer: Buffer, offset: number, length: number) => {
        fixture.buffers.add(buffer);
        await new Promise<void>(resolve => setImmediate(resolve));
        // Short reads must be accumulated before parsing.
        const bytesRead = Math.min(64, length, contents.length - position);
        contents.copy(buffer, offset, position, position + bytesRead);
        position += bytesRead;
        return { bytesRead };
      },
      close: async () => { fixture.active--; },
    };
  },
}));

import { LinuxProcessResourceSampler } from "./resource-monitor";

describe.skipIf(process.platform !== "linux")("bounded process inspection", () => {
  it("reuses bounded buffers, handles short/oversized reads and closes descriptors on a busy host", async () => {
    const result = await new LinuxProcessResourceSampler().sample(42);
    expect(fixture.reads).toBe(120);
    expect(fixture.peak).toBeLessThanOrEqual(8);
    expect(fixture.active).toBe(0);
    expect(fixture.buffers.size).toBe(8);
    expect([...fixture.buffers].every(buffer => buffer.length === 8192)).toBe(true);
    expect(result).toMatchObject({ processCount: 2, rssBytes: 246 * 1024, processCpuTicks: 30, hostCpuTicks: 10 });
  });
});
