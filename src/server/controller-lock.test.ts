import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { acquireControllerLock } from "./controller-lock";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("acquireControllerLock", () => {
  it("rejects another live controller and releases only its own lock", () => {
    const directory = mkdtempSync(join(tmpdir(), "worktree-switcher-lock-"));
    directories.push(directory);
    const path = join(directory, "state", "controller.lock");
    const lock = acquireControllerLock(path);

    expect(() => acquireControllerLock(path)).toThrow(`PID ${process.pid}`);
    expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({ pid: process.pid });

    lock.release();
    expect(() => acquireControllerLock(path).release()).not.toThrow();
  });

  it("replaces a stale or malformed lock", () => {
    const directory = mkdtempSync(join(tmpdir(), "worktree-switcher-lock-"));
    directories.push(directory);
    const path = join(directory, "controller.lock");
    writeFileSync(path, "not-json");

    const lock = acquireControllerLock(path);
    expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({ pid: process.pid });
    lock.release();
  });
});
