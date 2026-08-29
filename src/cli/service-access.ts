import { chmodSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface ServiceAccessRecord {
  pid: number;
  startedAt: string;
  version: string;
  dashboardEndpoint: string;
  mcpEndpoint: string | null;
  accessUrl: string;
  logDirectory: string;
}

export function writeServiceAccess(path: string, record: ServiceAccessRecord): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  chmodSync(temporaryPath, 0o600);
  renameSync(temporaryPath, path);
}

export function readServiceAccess(path: string): ServiceAccessRecord | null {
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as Partial<ServiceAccessRecord>;
    if (
      typeof value.pid !== "number" ||
      typeof value.startedAt !== "string" ||
      typeof value.version !== "string" ||
      typeof value.dashboardEndpoint !== "string" ||
      !(typeof value.mcpEndpoint === "string" || value.mcpEndpoint === null) ||
      typeof value.accessUrl !== "string" ||
      typeof value.logDirectory !== "string"
    ) return null;
    return value as ServiceAccessRecord;
  } catch {
    return null;
  }
}

export function removeServiceAccess(path: string, pid = process.pid): void {
  const current = readServiceAccess(path);
  if (!current || current.pid !== pid) return;
  try {
    unlinkSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
