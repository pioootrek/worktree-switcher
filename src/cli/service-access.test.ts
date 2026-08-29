import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { readServiceAccess, removeServiceAccess, writeServiceAccess } from "./service-access";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("service access record", () => {
  it("stores the pairing URL owner-only and removes only the owning process record", () => {
    const directory = mkdtempSync(join(tmpdir(), "worktree-switcher-access-"));
    directories.push(directory);
    const path = join(directory, "state", "access.json");
    const record = {
      pid: process.pid,
      startedAt: "2026-08-29T12:00:00.000Z",
      version: "1.2.3",
      dashboardEndpoint: "http://127.0.0.1:47831",
      mcpEndpoint: "http://127.0.0.1:47832/mcp",
      accessUrl: "http://127.0.0.1:47831/#token=secret",
      logDirectory: "/tmp/logs",
    };

    writeServiceAccess(path, record);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readServiceAccess(path)).toEqual(record);
    removeServiceAccess(path, process.pid + 1);
    expect(readServiceAccess(path)).toEqual(record);
    removeServiceAccess(path);
    expect(readServiceAccess(path)).toBeNull();
  });
});
