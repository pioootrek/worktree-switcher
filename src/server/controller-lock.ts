import { randomUUID } from "node:crypto";
import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

interface LockRecord {
  pid: number;
  token: string;
  startedAt: string;
}

export interface ControllerLock {
  release(): void;
}

export class ControllerAlreadyRunningError extends Error {
  constructor(readonly pid: number) {
    super(`Worktree Switcher is already running (PID ${pid}). Stop it before starting another controller.`);
    this.name = "ControllerAlreadyRunningError";
  }
}

export function acquireControllerLock(path: string): ControllerLock {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const record: LockRecord = {
    pid: process.pid,
    token: randomUUID(),
    startedAt: new Date().toISOString(),
  };

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const descriptor = openSync(path, "wx", 0o600);
      try {
        writeFileSync(descriptor, `${JSON.stringify(record)}\n`, "utf8");
      } finally {
        closeSync(descriptor);
      }
      let released = false;
      return {
        release() {
          if (released) return;
          released = true;
          try {
            const current = parseLock(readFileSync(path, "utf8"));
            if (current?.token === record.token) unlinkSync(path);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          }
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const current = readLock(path);
      if (current && processExists(current.pid)) {
        throw new ControllerAlreadyRunningError(current.pid);
      }
      try {
        unlinkSync(path);
      } catch (unlinkError) {
        if ((unlinkError as NodeJS.ErrnoException).code !== "ENOENT") throw unlinkError;
      }
    }
  }
  throw new Error("Could not acquire the Worktree Switcher controller lock.");
}

function readLock(path: string): LockRecord | null {
  try {
    return parseLock(readFileSync(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    return null;
  }
}

function parseLock(value: string): LockRecord | null {
  try {
    const parsed = JSON.parse(value) as Partial<LockRecord>;
    return typeof parsed.pid === "number" && typeof parsed.token === "string" && typeof parsed.startedAt === "string"
      ? parsed as LockRecord
      : null;
  } catch {
    return null;
  }
}

function processExists(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
