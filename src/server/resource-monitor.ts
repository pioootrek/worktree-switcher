import { open, readFile, readdir } from "node:fs/promises";
import { cpus } from "node:os";

export interface RawResourceSample {
  rssBytes: number;
  processCount: number;
  processCpuTicks: number;
  hostCpuTicks: number;
  cpuCount: number;
}

export interface ProcessResourceSampler {
  readonly supported: boolean;
  sample(processGroupId: number): Promise<RawResourceSample>;
}

interface ProcessStat {
  processGroupId: number;
  cpuTicks: number;
}

function parseProcessStat(value: string): ProcessStat | null {
  const commandEnd = value.lastIndexOf(")");
  if (commandEnd < 0) return null;
  const fields = value.slice(commandEnd + 1).trim().split(/\s+/);
  const processGroupId = Number(fields[2]);
  const userTicks = Number(fields[11]);
  const systemTicks = Number(fields[12]);
  if (![processGroupId, userTicks, systemTicks].every(Number.isFinite)) return null;
  return { processGroupId, cpuTicks: userTicks + systemTicks };
}

function parseRssBytes(status: string): number {
  const match = status.match(/^VmRSS:\s+(\d+)\s+kB$/m);
  return match ? Number(match[1]) * 1024 : 0;
}

function parseHostCpuTicks(stat: string): number {
  const line = stat.split("\n").find((entry) => entry.startsWith("cpu "));
  if (!line) throw new Error("Host CPU counters are unavailable.");
  return line.trim().split(/\s+/).slice(1).reduce((total, value) => total + Number(value), 0);
}

class ProcessRecordTooLargeError extends Error {}

// Per-process stat/status records are small. Reject unexpectedly large records
// rather than allocating readFile's buffers for size-zero procfs files.
async function readProcessFile(path: string, buffer: Buffer): Promise<string> {
  const file = await open(path, "r");
  try {
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await file.read(buffer, size, buffer.length - size, null);
      if (bytesRead === 0) return buffer.toString("utf8", 0, size);
      size += bytesRead;
    }
    // Probe EOF using the same buffer; a full 8 KiB record is valid.
    const { bytesRead } = await file.read(buffer, 0, 1, null);
    if (bytesRead === 0) return buffer.toString("utf8", 0, size);
    throw new ProcessRecordTooLargeError("Process resource record exceeds the read limit.");
  } finally {
    await file.close();
  }
}

export class LinuxProcessResourceSampler implements ProcessResourceSampler {
  readonly supported = process.platform === "linux";

  async sample(processGroupId: number): Promise<RawResourceSample> {
    if (!this.supported) throw new Error("Process resource monitoring is not supported on this operating system.");
    const [entries, hostStat] = await Promise.all([readdir("/proc", { withFileTypes: true }), readFile("/proc/stat", "utf8")]);
    const processIds = entries.filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name)).map((entry) => entry.name);
    const group: Array<{ cpuTicks: number; rssBytes: number }> = [];
    let next = 0;
    let recordError: ProcessRecordTooLargeError | undefined;
    // Each worker reuses one bounded buffer across all of its process records.
    await Promise.all(Array.from({ length: Math.min(8, processIds.length) }, async () => {
      const buffer = Buffer.allocUnsafe(8192);
      while (next < processIds.length) {
        const processId = processIds[next++];
        try {
          const stat = parseProcessStat(await readProcessFile(`/proc/${processId}/stat`, buffer));
          if (!stat || stat.processGroupId !== processGroupId) continue;
          const status = await readProcessFile(`/proc/${processId}/status`, buffer);
          group.push({ cpuTicks: stat.cpuTicks, rssBytes: parseRssBytes(status) });
        } catch (error) {
          // Drain all workers before rejecting so every opened descriptor closes.
          // An oversized record must not silently remove a live group member.
          if (error instanceof ProcessRecordTooLargeError) recordError ??= error;
          // Processes may exit while /proc is being scanned; retain that tolerance.
        }
      }
    }));
    if (recordError) throw recordError;
    if (group.length === 0) throw new Error("The managed process group is no longer available.");
    return {
      rssBytes: group.reduce((total, sample) => total + sample.rssBytes, 0),
      processCount: group.length,
      processCpuTicks: group.reduce((total, sample) => total + sample.cpuTicks, 0),
      hostCpuTicks: parseHostCpuTicks(hostStat),
      cpuCount: Math.max(1, cpus().length),
    };
  }
}

export function defaultProcessResourceSampler(): ProcessResourceSampler {
  return new LinuxProcessResourceSampler();
}
