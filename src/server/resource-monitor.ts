import { readFile, readdir } from "node:fs/promises";
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

export class LinuxProcessResourceSampler implements ProcessResourceSampler {
  readonly supported = process.platform === "linux";

  async sample(processGroupId: number): Promise<RawResourceSample> {
    if (!this.supported) throw new Error("Process resource monitoring is not supported on this operating system.");
    const [entries, hostStat] = await Promise.all([readdir("/proc", { withFileTypes: true }), readFile("/proc/stat", "utf8")]);
    const processIds = entries.filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name)).map((entry) => entry.name);
    const samples = await Promise.all(processIds.map(async (processId) => {
      try {
        const stat = parseProcessStat(await readFile(`/proc/${processId}/stat`, "utf8"));
        if (!stat || stat.processGroupId !== processGroupId) return null;
        const status = await readFile(`/proc/${processId}/status`, "utf8");
        return { cpuTicks: stat.cpuTicks, rssBytes: parseRssBytes(status) };
      } catch {
        // Processes may exit while /proc is being scanned. A partial sample is still useful.
        return null;
      }
    }));
    const group = samples.filter((sample): sample is NonNullable<typeof sample> => sample !== null);
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
